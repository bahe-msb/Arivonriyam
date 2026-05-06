"""Modular ingestion pipeline.

Stages per PDF:
  1. partition  — Unstructured PDF extraction (auto strategy)
  2. preprocess — OCR cleanup, structural tagging, language detection
  3. chunk      — Semantic/pedagogical chunking
  4. enrich     — Structural metadata + optional Ollama question generation
  5. postprocess — Quality filtering, normalization
  6. store      — Embed (BGE-M3) + upsert into SQLite vector store
  7. log        — write ingestion_log + manifest to shared SQLite
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

from db import init_db, log_ingestion, upsert_chapters, is_ingested
from embeddings import get_embedding_model
from preprocessor import TextPreprocessor
from chunker import SemanticChunker
from metadata_enricher import MetadataEnricher
from postprocessor import PostProcessor
from pgvec_store import get_vector_store

logger = logging.getLogger(__name__)

_BASE = Path(__file__).parent.parent

VEC_DB_PATH = _BASE / "data" / "vectors.db"  # SQLite fallback path
COLLECTION  = "mm_rag_pipeline"

OCR_LANGUAGES = ["eng", "tam"]

# Shared dedup hash set across the process lifetime
_seen_hashes: set[str] = set()

_vec_store = None


def get_vectorstore():
    global _vec_store
    if _vec_store is None:
        _vec_store = get_vector_store(
            embedding_function=get_embedding_model(),
            sqlite_fallback_path=VEC_DB_PATH,
        )
    return _vec_store


# ── stage 1: partition ────────────────────────────────────────────────────────
def partition_document(file_path: str):
    import time
    logger.info("Partitioning: %s", file_path)
    t0 = time.time()
    # "auto" strategy: uses fast pdfminer text extraction for digital PDFs,
    # only falls back to hi_res OCR for scanned/image-only pages.
    # "hi_res" takes 10-60 min for 10 pages; "auto" takes seconds for digital PDFs.
    elements = partition_pdf(
        filename=file_path,
        strategy="auto",
        languages=OCR_LANGUAGES,
        infer_table_structure=True,
    )
    logger.info("  %d elements extracted in %.1fs", len(elements), time.time() - t0)
    return elements


# ── stage 2–5: new pipeline ───────────────────────────────────────────────────
_preprocessor = TextPreprocessor()
_chunker      = SemanticChunker()


def build_documents(
    elements,
    class_name: str,
    subject: str,
    source_file: str,
    generate_questions: bool = True,
) -> List[Document]:
    """Run preprocess → chunk → enrich → postprocess and return LangChain Documents."""
    standard = _parse_standard(class_name)

    # Detect chapter from Title elements (first one wins)
    chapter_title = ""
    chapter_number = 0
    for el in elements:
        if type(el).__name__ == "Title":
            txt = (getattr(el, "text", "") or "").strip()
            if len(txt) >= 3:
                chapter_title = txt
                break

    preprocessed = _preprocessor.preprocess(elements)
    chunks       = _chunker.chunk(preprocessed)

    enricher = MetadataEnricher(generate_questions=generate_questions)
    docs = enricher.enrich(
        chunks,
        source_file=source_file,
        subject=subject,
        standard=standard,
        chapter_title=chapter_title,
        chapter_number=chapter_number,
    )

    postprocessor = PostProcessor(seen_hashes=_seen_hashes)
    docs = postprocessor.filter_and_normalize(docs)

    # Patch class (grade label) into metadata — used by retrieve.py
    for doc in docs:
        doc.metadata["class"] = class_name
    return docs


# ── stage 6: store ────────────────────────────────────────────────────────────

def store_documents(docs: List[Document]) -> None:
    """Embed all docs in one shot, then write to SQLite vector store."""
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

    t0 = time.time()
    docs = build_documents(
        elements, class_name, subject, pdf_path.name,
        generate_questions=generate_questions,
    )
    logger.info("  [stage 2-5/4] preprocess+chunk+enrich+postprocess: %.1fs → %d docs",
                time.time() - t0, len(docs))

    t0 = time.time()
    store_documents(docs)
    logger.info("  [stage 6/4] embed+store: %.1fs", time.time() - t0)

    chapters = _extract_chapters(docs)
    upsert_chapters(class_name, subject, chapters)
    log_ingestion(class_name, subject, pdf_path.name, len(docs), file_hash)
    logger.info("  %d chunks, %d chapters — total %.1fs", len(docs), len(chapters), time.time() - t_start)
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
