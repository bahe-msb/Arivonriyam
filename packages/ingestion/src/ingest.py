"""Modular ingestion pipeline.

Stages per PDF:
  1. partition  — Unstructured hi-res PDF extraction
  2. chunk      — title-bounded chunking
  3. build_docs — separate modalities, AI summary, HyDE questions → Documents
  4. store      — embed + upsert into ChromaDB
  5. log        — write ingestion_log + manifest to shared SQLite
"""

import hashlib
import json
import sys
from pathlib import Path
from typing import List

from langchain_core.documents import Document
from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_chroma import Chroma
from unstructured.partition.pdf import partition_pdf
from unstructured.chunking.title import chunk_by_title
import chromadb

from db import init_db, log_ingestion, upsert_chapters, is_ingested

_BASE = Path(__file__).parent.parent

# ChromaDB lives inside the ingestion package — it is the ingestion package's artifact
CHROMA_PATH = _BASE / "data" / "chroma"
COLLECTION  = "mm_rag_pipeline"

LLM_MODEL       = "gemma4:latest"
EMBEDDING_MODEL = "nomic-embed-text"

_llm        = ChatOllama(model=LLM_MODEL, temperature=0)
_embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL)


# ── vector store ──────────────────────────────────────────────────────────────
def get_vectorstore() -> Chroma:
    CHROMA_PATH.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_PATH))
    return Chroma(client=client, collection_name=COLLECTION, embedding_function=_embeddings)


# ── stage 1: partition ────────────────────────────────────────────────────────
def partition_document(file_path: str):
    print(f"📄 Partitioning: {file_path}", file=sys.stderr)
    elements = partition_pdf(
        filename=file_path,
        strategy="hi_res",
        infer_table_structure=True,
        extract_image_block_types=["Image"],
        extract_image_block_to_payload=True,
    )
    print(f"   ✅ {len(elements)} elements", file=sys.stderr)
    return elements


# ── stage 2: chunk ────────────────────────────────────────────────────────────
def create_chunks(elements):
    chunks = chunk_by_title(
        elements,
        max_characters=3000,
        new_after_n_chars=2400,
        combine_text_under_n_chars=500,
    )
    print(f"   ✅ {len(chunks)} chunks", file=sys.stderr)
    return chunks


# ── stage 3: build documents ──────────────────────────────────────────────────
def _separate_modalities(chunk) -> dict:
    data: dict = {"text": chunk.text, "tables": [], "images": [], "chapter": ""}
    if hasattr(chunk, "metadata") and hasattr(chunk.metadata, "orig_elements"):
        for el in chunk.metadata.orig_elements:
            t = type(el).__name__
            if t == "Title" and not data["chapter"]:
                v = (el.text or "").strip()
                if len(v) >= 3:
                    data["chapter"] = v
            elif t == "Table":
                data["tables"].append(getattr(el.metadata, "text_as_html", el.text))
            elif t == "Image" and hasattr(el, "metadata") and hasattr(el.metadata, "image_base64"):
                data["images"].append(el.metadata.image_base64)
    return data


def _ai_summary(text: str, tables: List[str], images: List[str]) -> str:
    prompt = (
        "Create a comprehensive, searchable description for document retrieval.\n\n"
        f"TEXT:\n{text}\n\n"
    )
    if tables:
        prompt += "TABLES:\n" + "\n\n".join(f"Table {i+1}:\n{t}" for i, t in enumerate(tables))
    prompt += (
        "\n\nWrite a detailed description covering key facts, concepts, "
        "questions this content answers, and alternative search terms. "
        "Prioritise findability.\n\nDESCRIPTION:"
    )
    parts: List[dict] = [{"type": "text", "text": prompt}]
    for b64 in images:
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    try:
        return _llm.invoke([HumanMessage(content=parts)]).content
    except Exception as e:
        print(f"     ⚠️  AI summary failed: {e}", file=sys.stderr)
        suffix = (f" [{len(tables)} table(s)]" if tables else "") + (f" [{len(images)} image(s)]" if images else "")
        return text[:300] + "..." + suffix


def _hyde_questions(summary: str, n: int = 3) -> List[str]:
    prompt = (
        f"Write {n} concise questions that this passage directly answers.\n"
        "One per line, no numbering.\n\nPASSAGE:\n"
        f"{summary}\n\nQUESTIONS:"
    )
    try:
        raw = _llm.invoke([HumanMessage(content=prompt)]).content
        qs = [l.strip("-• 0123456789.\t ") for l in raw.splitlines() if l.strip()]
        return [q for q in qs if len(q) > 5][:n]
    except Exception as e:
        print(f"     ⚠️  HyDE questions failed: {e}", file=sys.stderr)
        return []


def build_documents(chunks, class_name: str, subject: str, source_file: str) -> List[Document]:
    print(f"   🧠 Building {len(chunks)} documents…", file=sys.stderr)
    docs: List[Document] = []
    for i, chunk in enumerate(chunks, 1):
        data = _separate_modalities(chunk)
        surface = _ai_summary(data["text"], data["tables"], data["images"]) \
            if (data["tables"] or data["images"]) else data["text"]
        qs = _hyde_questions(surface)
        embedded = "\n".join(f"Q: {q}" for q in qs) + "\n\n" + surface if qs else surface
        docs.append(Document(
            page_content=embedded,
            metadata={
                "class":    class_name,
                "subject":  subject,
                "source_file": source_file,
                "chapter":  data["chapter"],
                "original_content": json.dumps({
                    "raw_text":     data["text"],
                    "tables_html":  data["tables"],
                    "images_base64": data["images"],
                }),
            },
        ))
        if i % 5 == 0 or i == len(chunks):
            print(f"   … {i}/{len(chunks)}", file=sys.stderr)
    return docs


# ── stage 4: store ────────────────────────────────────────────────────────────
def store_documents(docs: List[Document]) -> None:
    get_vectorstore().add_documents(docs)
    print(f"   ✅ {len(docs)} chunks → ChromaDB", file=sys.stderr)


# ── helpers ───────────────────────────────────────────────────────────────────
def _extract_chapters(docs: List[Document]) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for doc in docs:
        ch = (doc.metadata.get("chapter") or "").strip()
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


# ── orchestrator ──────────────────────────────────────────────────────────────
PDF_DIR = _BASE / "data" / "pdfs"


def ingest_pdf(pdf_path: Path, force: bool = False) -> int:
    """Ingest one PDF. Returns chunk count. Skips if hash unchanged."""
    class_name = pdf_path.parent.name
    subject    = pdf_path.stem
    file_hash  = _file_hash(pdf_path)

    if not force and is_ingested(class_name, subject, pdf_path.name, file_hash):
        print(f"   ⏭  unchanged — skipping", file=sys.stderr)
        return 0

    elements = partition_document(str(pdf_path))
    chunks   = create_chunks(elements)
    docs     = build_documents(chunks, class_name, subject, pdf_path.name)
    store_documents(docs)

    chapters = _extract_chapters(docs)
    upsert_chapters(class_name, subject, chapters)
    log_ingestion(class_name, subject, pdf_path.name, len(docs), file_hash)
    print(f"   📝 {len(chapters)} chapters written to manifest", file=sys.stderr)
    return len(docs)


def run_ingestion(force: bool = False) -> None:
    init_db()
    print("🚀 RAG Ingestion Pipeline", file=sys.stderr)

    pdfs = sorted(PDF_DIR.rglob("*.pdf"))
    if not pdfs:
        print(f"⚠️  No PDFs found under {PDF_DIR}", file=sys.stderr)
        return

    total = 0
    for pdf in pdfs:
        rel = pdf.relative_to(PDF_DIR)
        if len(rel.parts) < 2:
            print(f"⚠️  Skip {pdf.name}: needs <class>/<subject>.pdf layout", file=sys.stderr)
            continue
        print(f"\n📚 {pdf.parent.name}/{pdf.name}", file=sys.stderr)
        try:
            total += ingest_pdf(pdf, force=force)
        except Exception as e:
            print(f"❌ Failed: {e}", file=sys.stderr)

    print(f"\n🎉 Done — {total} chunks total.", file=sys.stderr)
