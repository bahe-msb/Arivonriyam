"""Modular ingestion pipeline.

Stages per PDF:
  1. partition  — Unstructured PDF extraction (hi_res, image payloads inline)
  2. preprocess — OCR cleanup, structural tagging, language detection
  3. chunk      — Semantic/pedagogical chunking
  4. enrich     — Structural metadata + optional Ollama question generation
  5. postprocess — Quality filtering, normalization
  6. store      — Embed (BGE-M3) + upsert into pgvector
  7. log        — write ingestion_log + manifest to PostgreSQL
"""

import hashlib
import json
import logging
import os
import time
from pathlib import Path

# Load .env from package root before any HuggingFace imports
_ENV_FILE = Path(__file__).parent.parent / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

if os.environ.get("TRANSFORMERS_OFFLINE") != "1" and os.environ.get("HF_HUB_OFFLINE") == "1":
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
import sys
from typing import List

from langchain_core.documents import Document
from unstructured.partition.pdf import partition_pdf

from db import init_db, log_ingestion, upsert_chapters, is_ingested, upsert_pdf_images
from embeddings import get_embedding_model
from preprocessor import TextPreprocessor
from chunker import SemanticChunker
from metadata_enricher import MetadataEnricher
from postprocessor import PostProcessor
from pgvec_store import get_vector_store

logger = logging.getLogger(__name__)

_BASE = Path(__file__).parent.parent

COLLECTION    = "mm_rag_pipeline"
OCR_LANGUAGES = ["eng", "tam"]

# Shared dedup hash set across the process lifetime
_seen_hashes: set[str] = set()

_vec_store = None


def get_vectorstore():
    global _vec_store
    if _vec_store is None:
        _vec_store = get_vector_store(embedding_function=get_embedding_model())
    return _vec_store


# ── stage 1: partition ────────────────────────────────────────────────────────
def partition_document(file_path: str):
    import time
    logger.info("Partitioning: %s", file_path)
    t0 = time.time()
    elements = partition_pdf(
        filename=file_path,
        strategy="hi_res",
        languages=OCR_LANGUAGES,
        infer_table_structure=True,
        extract_image_block_types=["Image", "FigureCaption"],
        extract_image_block_to_payload=True,
    )
    n_images = sum(1 for e in elements if type(e).__name__ in {"Image", "FigureCaption"})
    n_tables = sum(1 for e in elements if type(e).__name__ == "Table")
    logger.info(
        "  %d `elements extracted in` %.1fs (%d images, %d tables)",
        len(elements), time.time() - t0, n_images, n_tables,
    )
    return elements


def _extract_pdf_images(pdf_path: Path, min_px: int = 300, max_images: int = 30) -> list[dict]:
    """Extract embedded images from a PDF using PyMuPDF.

    min_px filters out small icons/logos — only real figures (diagrams, charts) pass through.
    """
    try:
        import fitz
        import base64
    except ImportError:
        logger.warning("pymupdf not installed — skipping image extraction")
        return []

    results: list[dict] = []
    try:
        doc = fitz.open(str(pdf_path))
        for page_num in range(len(doc)):
            page = doc[page_num]
            for img_idx, img_ref in enumerate(page.get_images(full=True)):
                xref = img_ref[0]
                try:
                    base_image = doc.extract_image(xref)
                    w, h = base_image["width"], base_image["height"]
                    if w < min_px or h < min_px:
                        continue
                    b64 = base64.b64encode(base_image["image"]).decode("ascii")
                    results.append({
                        "page_number": page_num + 1,
                        "img_index":   img_idx,
                        "width":       w,
                        "height":      h,
                        "image_b64":   b64,
                    })
                    if len(results) >= max_images:
                        doc.close()
                        return results
                except Exception:
                    continue
        doc.close()
    except Exception as e:
        logger.warning("Image extraction failed for %s: %s", pdf_path.name, e)
    return results


# ── stage 2–5: new pipeline ───────────────────────────────────────────────────
_preprocessor = TextPreprocessor()
_chunker      = SemanticChunker()


# ── ToC extraction ────────────────────────────────────────────────────────────

_TOC_MARKERS = frozenset({
    "பொருளடக்கம்", "பொருளடக்கம",
    "உள்ளடக்கம்", "உள்ளடக்கம",
    "contents", "table of contents", "index",
})

_TITLE_COL_HINTS = {"unit", "chapter", "பாடத்தலைப்பு", "title", "lesson", "topic", "units", "name", "பாடம்"}
_PAGE_COL_HINTS  = {"page", "பக்க", "pg", "page no", "p.no", "பக்க எண்", "பக்கம்"}
_SNO_COL_HINTS   = {"s.no", "sno", "no", "வ.எண்", "வ. எண்", "#", "sl", "வ.எண", "sl.no"}


def _is_toc_marker(text: str) -> bool:
    t = text.strip().lower()
    return any(m in t for m in _TOC_MARKERS) and len(t) < 80


def _parse_toc_table_html(html: str) -> list[tuple[str, int]]:
    """Parse a ToC table HTML → [(chapter_title, page_start), ...].

    Handles both Tamil (பொருளடக்கம்) and English (CONTENTS) table formats.
    Sub-chapters like "1.1" are filtered out — only top-level rows kept.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        logger.warning("beautifulsoup4 not available for ToC parsing")
        return []

    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr")
    if len(rows) < 2:
        return []

    # Detect columns from header row
    header_cells = rows[0].find_all(["th", "td"])
    headers = [c.get_text(strip=True).lower() for c in header_cells]

    title_col: int | None = None
    page_col:  int | None = None
    sno_col:   int | None = None

    for i, h in enumerate(headers):
        if title_col is None and any(hint in h for hint in _TITLE_COL_HINTS):
            title_col = i
        if page_col is None and any(hint in h for hint in _PAGE_COL_HINTS):
            page_col = i
        if sno_col is None and any(hint in h for hint in _SNO_COL_HINTS):
            sno_col = i

    # Sensible defaults when header detection fails
    if title_col is None:
        title_col = 1 if len(headers) >= 2 else 0
    if page_col is None and len(headers) >= 3:
        page_col = 2

    results: list[tuple[str, int]] = []
    for row in rows[1:]:
        cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) <= title_col:
            continue

        # Skip sub-chapter rows ("1.1", "2.3", etc.)
        if sno_col is not None and sno_col < len(cells):
            sno = cells[sno_col].strip()
            if "." in sno and sno[0].isdigit():
                continue

        title = cells[title_col].strip()
        if not title or len(title) < 3:
            continue

        page_num = 0
        if page_col is not None and page_col < len(cells):
            digits = "".join(c for c in cells[page_col] if c.isdigit())
            page_num = int(digits) if digits else 0

        results.append((title, page_num))

    return results


def _extract_toc_chapters(elements) -> list[tuple[str, int]] | None:
    """Detect a Table of Contents page and extract (chapter_title, page_start) pairs.

    Looks for பொருளடக்கம் / INDEX / CONTENTS in the first 10 pages,
    then parses Table elements on that page.
    Returns sorted [(title, page_start), ...], or None if no ToC found.
    """
    # Phase 1: find ToC page numbers
    toc_pages: set[int] = set()
    for el in elements:
        meta = getattr(el, "metadata", None)
        pg = int(meta.page_number) if meta and meta.page_number else 0
        if pg > 10:
            break
        if _is_toc_marker(getattr(el, "text", "") or ""):
            toc_pages.update({pg, pg + 1})

    if not toc_pages:
        return None

    # Phase 2: parse Table elements on those pages
    chapters: list[tuple[str, int]] = []
    for el in elements:
        meta = getattr(el, "metadata", None)
        pg = int(meta.page_number) if meta and meta.page_number else 0
        if pg not in toc_pages:
            continue
        if type(el).__name__ == "Table":
            html = getattr(meta, "text_as_html", None)
            if html:
                parsed = _parse_toc_table_html(html)
                chapters.extend(parsed)

    if len(chapters) >= 2:
        logger.info("  ToC table extracted: %d chapters", len(chapters))
        return sorted(chapters, key=lambda x: x[1])

    # Phase 3: text fallback — numbered entries on the ToC page
    import re
    fallback: list[tuple[str, int]] = []
    for el in elements:
        meta = getattr(el, "metadata", None)
        pg = int(meta.page_number) if meta and meta.page_number else 0
        if pg not in toc_pages:
            continue
        el_type = type(el).__name__
        if el_type not in ("NarrativeText", "ListItem", "Title"):
            continue
        txt = (getattr(el, "text", "") or "").strip()
        if _is_toc_marker(txt):
            continue
        m = re.match(r"^(\d+)[.\s]+(.+?)(?:\s+(\d+))?$", txt)
        if m and len(m.group(2).strip()) >= 3:
            fallback.append((m.group(2).strip(), int(m.group(3) or 0)))

    if len(fallback) >= 2:
        logger.info("  ToC text-fallback extracted: %d chapters", len(fallback))
        return sorted(fallback, key=lambda x: x[1])

    return None


def _build_chapter_map_from_toc(
    toc_chapters: list[tuple[str, int]],
) -> dict[int, tuple[str, int]]:
    """Build page_number → (chapter_title, chapter_number) using ToC page ranges."""
    with_pages = [(t, p, i + 1) for i, (t, p) in enumerate(toc_chapters) if p > 0]
    if not with_pages:
        # No page numbers in ToC — return a simple mapping for page 0
        return {0: (toc_chapters[0][0], 1)} if toc_chapters else {}

    result: dict[int, tuple[str, int]] = {}
    for idx, (title, page_start, chapter_num) in enumerate(with_pages):
        page_end = with_pages[idx + 1][1] - 1 if idx + 1 < len(with_pages) else 9999
        for pg in range(page_start, page_end + 1):
            result[pg] = (title, chapter_num)
    return result


def _build_chapter_map(
    elements,
    toc_chapters: list[tuple[str, int]] | None = None,
) -> dict[int, tuple[str, int]]:
    """Return page_number → (chapter_title, chapter_number).

    Uses ToC page-range mapping when available; falls back to Title scanning.
    """
    if toc_chapters and len(toc_chapters) >= 2:
        return _build_chapter_map_from_toc(toc_chapters)

    # Fallback: walk elements and treat every Title as a new chapter
    page_chapter: dict[int, tuple[str, int]] = {}
    current_title = ""
    current_number = 0
    chapter_seq = 0

    for el in elements:
        page = getattr(el, "metadata", None)
        page_num = int(page.page_number) if page and page.page_number else 0

        if type(el).__name__ == "Title":
            txt = (getattr(el, "text", "") or "").strip()
            if len(txt) >= 3:
                chapter_seq += 1
                current_title = txt
                current_number = chapter_seq

        if page_num not in page_chapter:
            page_chapter[page_num] = (current_title, current_number)

    return page_chapter


def build_documents(
    elements,
    class_name: str,
    subject: str,
    source_file: str,
    generate_questions: bool = True,
    toc_chapters: list[tuple[str, int]] | None = None,
) -> List[Document]:
    """Run preprocess → chunk → enrich → postprocess and return LangChain Documents."""
    standard = _parse_standard(class_name)

    # Build page → (chapter_title, chapter_number) map.
    # Uses authoritative ToC data when available; falls back to Title scanning.
    chapter_map = _build_chapter_map(elements, toc_chapters)

    preprocessed = _preprocessor.preprocess(elements)
    chunks       = _chunker.chunk(preprocessed)

    # Inject per-chunk chapter metadata before enrichment
    for chunk in chunks:
        pg = chunk.get("page_number", 0)
        ch_title, ch_num = chapter_map.get(pg, ("", 0))
        chunk.setdefault("chapter_title", ch_title)
        chunk.setdefault("chapter_number", ch_num)

    enricher = MetadataEnricher(generate_questions=generate_questions)
    docs = enricher.enrich(
        chunks,
        source_file=source_file,
        subject=subject,
        standard=standard,
        chapter_title="",   # per-chunk chapter_title now set above
        chapter_number=0,
    )

    postprocessor = PostProcessor(seen_hashes=_seen_hashes)
    docs = postprocessor.filter_and_normalize(docs)

    # Patch class (grade label) into metadata — used by retrieve.py
    for doc in docs:
        doc.metadata["class"] = class_name
    return docs


# ── stage 6: store ────────────────────────────────────────────────────────────

def store_documents(docs: List[Document]) -> None:
    """Embed all docs in one shot, then write to pgvector."""
    total = len(docs)
    logger.info("  Embedding %d chunks (single pass)...", total)

    emb_model = get_embedding_model()
    texts = [doc.page_content for doc in docs]
    t0 = time.time()
    vectors = emb_model.embed_documents(texts)
    logger.info("  Embedded %d chunks in %.1fs", total, time.time() - t0)

    t0 = time.time()
    import uuid as _uuid
    vs = get_vectorstore()
    ids   = [str(_uuid.uuid4()) for _ in docs]
    metas = [vs._flatten_meta(doc.metadata) for doc in docs]
    vs.add(ids=ids, documents=texts, embeddings=vectors, metadatas=metas)
    logger.info("  Stored %d chunks in %.1fs", total, time.time() - t0)


# ── helpers ───────────────────────────────────────────────────────────────────
def _extract_chapters(docs: List[Document]) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for doc in docs:
        ch = (doc.metadata.get("chapter_title") or doc.metadata.get("chapter") or "").strip()
        if ch and ch not in seen:
            seen.add(ch)
            out.append(ch)
    return out


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()[:16]


def _parse_standard(class_name: str) -> int:
    digits = "".join(ch for ch in class_name if ch.isdigit())
    try:
        return max(1, min(10, int(digits))) if digits else 5
    except ValueError:
        return 5


# ── orchestrator ──────────────────────────────────────────────────────────────
PDF_DIR = _BASE / "data" / "pdfs"


def ingest_pdf(pdf_path: Path, force: bool = False, generate_questions: bool = True) -> int:
    """Ingest one PDF. Returns chunk count. Skips if hash unchanged."""
    class_name = pdf_path.parent.name
    subject    = pdf_path.stem
    file_hash  = _file_hash(pdf_path)

    if not force and is_ingested(class_name, subject, pdf_path.name, file_hash):
        logger.info("  unchanged — skipping %s", pdf_path.name)
        return 0

    t_start = time.time()

    t0 = time.time()
    elements = partition_document(str(pdf_path))
    logger.info("  [stage 1/4] partition: %.1fs", time.time() - t0)

    # Extract authoritative chapter list from ToC page before building docs
    toc_chapters = _extract_toc_chapters(elements)
    if toc_chapters:
        logger.info("  ToC found: %s", [t for t, _ in toc_chapters])
    else:
        logger.info("  No ToC detected — chapter names will come from Title elements")

    t0 = time.time()
    docs = build_documents(
        elements, class_name, subject, pdf_path.name,
        generate_questions=generate_questions,
        toc_chapters=toc_chapters,
    )
    logger.info("  [stage 2-5/4] preprocess+chunk+enrich+postprocess: %.1fs → %d docs",
                time.time() - t0, len(docs))

    t0 = time.time()
    store_documents(docs)
    logger.info("  [stage 6/4] embed+store: %.1fs", time.time() - t0)

    # Use ToC chapters (title + page_start) if available; else derive from chunk metadata
    if toc_chapters:
        chapter_titles  = [t for t, _ in toc_chapters]
        chapter_pages   = [p for _, p in toc_chapters]
    else:
        chapter_titles  = _extract_chapters(docs)
        chapter_pages   = [0] * len(chapter_titles)
    upsert_chapters(class_name, subject, chapter_titles, page_starts=chapter_pages)
    log_ingestion(class_name, subject, pdf_path.name, len(docs), file_hash)

    t0 = time.time()
    images = _extract_pdf_images(pdf_path)
    if images:
        upsert_pdf_images(class_name, subject, pdf_path.name, images)
        logger.info("  [images] stored %d images (PyMuPDF) in %.1fs", len(images), time.time() - t0)

    logger.info("  %d chunks, %d chapters — total %.1fs", len(docs), len(chapter_titles), time.time() - t_start)
    return len(docs)


def run_ingestion(force: bool = False, generate_questions: bool = False) -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")
    init_db()
    logger.info("RAG Ingestion Pipeline (question_generation=%s)", generate_questions)
    if generate_questions:
        logger.warning(
            "LLM question generation is ON — this adds ~10-60s per chunk via Ollama. "
            "Use --no-questions to skip and run fast."
        )

    pdfs = sorted(PDF_DIR.rglob("*.pdf"))
    if not pdfs:
        logger.warning("No PDFs found under %s", PDF_DIR)
        return

    total = 0
    for pdf in pdfs:
        rel = pdf.relative_to(PDF_DIR)
        if len(rel.parts) < 2:
            logger.warning("Skip %s: needs <class>/<subject>.pdf layout", pdf.name)
            continue
        logger.info("Processing %s/%s", pdf.parent.name, pdf.name)
        try:
            total += ingest_pdf(pdf, force=force, generate_questions=generate_questions)
        except Exception as e:
            logger.error("Failed %s: %s", pdf.name, e)

    logger.info("Done — %d chunks total", total)
