"""Retrieval — two modes, both print JSON to stdout for the Node subprocess.

chapter_retrieve(class_name, subject, chapter, top_k)
    Scoped to (class, subject), queries the chapter title via HyDE.
    Used for lesson-plan blueprint generation.

topic_retrieve(class_name, subject, topic, top_k)
    Searches the full (class, subject) corpus for a topic keyword.
    Used by Socratic session summarization — broader, higher top_k.
"""

import json
import sys
from pathlib import Path
from typing import List, Dict, Any

from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_chroma import Chroma
import chromadb

_BASE = Path(__file__).parent.parent
CHROMA_PATH = _BASE / "data" / "chroma"
COLLECTION  = "mm_rag_pipeline"

LLM_MODEL       = "gemma4:latest"
EMBEDDING_MODEL = "nomic-embed-text"

_llm        = ChatOllama(model=LLM_MODEL, temperature=0)
_embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL)


def _get_vectorstore() -> Chroma:
    CHROMA_PATH.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_PATH))
    return Chroma(client=client, collection_name=COLLECTION, embedding_function=_embeddings)


def _hyde_expand(query: str) -> str:
    prompt = (
        "Write a short, plausible answer to the question below. "
        "Invent details if needed — this is only for vector retrieval.\n\n"
        f"QUESTION: {query}\n\nANSWER:"
    )
    try:
        return _llm.invoke([HumanMessage(content=prompt)]).content.strip() or query
    except Exception as e:
        print(f"⚠️  HyDE expand failed: {e}", file=sys.stderr)
        return query


def _doc_to_chunk(doc, score: float) -> Dict[str, Any]:
    try:
        original = json.loads(doc.metadata.get("original_content", "{}"))
    except json.JSONDecodeError:
        original = {}
    return {
        "text":        original.get("raw_text") or doc.page_content[:800],
        "score":       round(float(score), 4),
        "grade":       doc.metadata.get("class", ""),
        "subject":     doc.metadata.get("subject", ""),
        "chapter":     doc.metadata.get("chapter", ""),
        "page":        int(doc.metadata.get("page_number", 0)),
        "language":    "en",
        "source_file": doc.metadata.get("source_file", ""),
        "tables_html": original.get("tables_html", []),
        "images_base64": original.get("images_base64", []),
    }


def _search(query: str, class_name: str, subject: str, top_k: int) -> List[Dict[str, Any]]:
    vs = _get_vectorstore()
    filt: dict = {}
    if class_name and subject:
        filt = {"$and": [{"class": {"$eq": class_name}}, {"subject": {"$eq": subject}}]}
    elif class_name:
        filt = {"class": {"$eq": class_name}}
    try:
        results = vs.similarity_search_with_score(query, k=top_k, filter=filt if filt else None)
        return [_doc_to_chunk(doc, score) for doc, score in results]
    except Exception as e:
        print(f"⚠️  ChromaDB search failed: {e}", file=sys.stderr)
        return []


def chapter_retrieve(class_name: str, subject: str, chapter: str, top_k: int = 8) -> List[Dict[str, Any]]:
    expanded = _hyde_expand(f"{chapter} {subject}")
    return _search(expanded, class_name, subject, top_k)


def topic_retrieve(class_name: str, subject: str, topic: str, top_k: int = 12) -> List[Dict[str, Any]]:
    expanded = _hyde_expand(f"Explain {topic} in detail for a primary school student.")
    return _search(expanded, class_name, subject, top_k)


# ── CLI output (called by Node.js subprocess) ─────────────────────────────────
def run_chapter_retrieve(class_name: str, subject: str, chapter: str, top_k: int) -> None:
    chunks = chapter_retrieve(class_name, subject, chapter, top_k)
    print(json.dumps(chunks, ensure_ascii=False))


def run_topic_retrieve(class_name: str, subject: str, topic: str, top_k: int) -> None:
    chunks = topic_retrieve(class_name, subject, topic, top_k)
    print(json.dumps(chunks, ensure_ascii=False))
