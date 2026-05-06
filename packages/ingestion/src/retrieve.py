"""Retrieval — two modes, both print JSON to stdout for the Node subprocess.

chapter_retrieve(class_name, subject, chapter, top_k)
    Scoped to (class, subject), queries the chapter title via HyDE.
    Used for lesson-plan blueprint generation.

topic_retrieve(class_name, subject, topic, top_k)
    Searches the full (class, subject) corpus for a topic keyword.
    Used by Socratic session summarization — broader, higher top_k.
"""

import json
import logging
import sys
import time
from pathlib import Path
from typing import List, Dict, Any

from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

from retriever import HybridRetriever
from utils.language_detect import detect_dominant_language

logger = logging.getLogger(__name__)

LLM_MODEL = "gemma4:latest"

_llm: ChatOllama | None = None
_hybrid: HybridRetriever | None = None
# Simple in-process cache for HyDE expansions — avoids re-calling the LLM
# for identical queries within the same session
_hyde_cache: dict[str, str] = {}


def _get_llm() -> ChatOllama:
    global _llm
    if _llm is None:
        _llm = ChatOllama(model=LLM_MODEL, temperature=0)
    return _llm


def _get_retriever() -> HybridRetriever:
    global _hybrid
    if _hybrid is None:
        _hybrid = HybridRetriever()
    return _hybrid


def _detect_language(text: str) -> str:
    """Legacy helper — returns 'ta' or 'en' for backward compatibility."""
    lang = detect_dominant_language(text)
    return "ta" if lang == "ta" else "en"


def _hyde_expand(query: str) -> str:
    if query in _hyde_cache:
        logger.info("HyDE cache hit for query")
        return _hyde_cache[query]

    lang = _detect_language(query)
    prompt = (
        "கீழே உள்ள கேள்விக்கான சுருக்கமான, சாத்தியமான பதிலை அதே மொழியில் எழுதுங்கள். "
        "சில விவரங்கள் இல்லாவிட்டாலும் பரவாயில்லை — இது வெக்டர் தேடலுக்காக மட்டும்." if lang == "ta"
        else "Write a short, plausible answer to the question below in the same language. "
             "Invent details if needed — this is only for vector retrieval."
    )
    prompt = f"{prompt}\n\nQUESTION: {query}\n\nANSWER:"
    t0 = time.time()
    try:
        result = _get_llm().invoke([HumanMessage(content=prompt)]).content.strip() or query
        logger.info("HyDE expand: %.1fs", time.time() - t0)
        _hyde_cache[query] = result
        return result
    except Exception as e:
        logger.warning("HyDE expand failed: %s", e)
        return query


def _doc_to_chunk(doc, score: float = 1.0) -> Dict[str, Any]:
    """Convert a LangChain Document to the JSON shape Node.js expects."""
    meta = doc.metadata
    # The new pipeline stores flat metadata — no original_content JSON blob.
    # Use page_content directly (full text, not truncated).
    raw_text = doc.page_content
    language = (
        meta.get("dominant_language")
        or meta.get("language")
        or _detect_language(raw_text)
    )
    # Map new 'standard' field to 'class' for backward compat
    grade = meta.get("class") or str(meta.get("standard", ""))
    return {
        "text":          raw_text,
        "score":         round(float(score), 4),
        "grade":         grade,
        "subject":       meta.get("subject", ""),
        "chapter":       meta.get("chapter_title") or meta.get("chapter", ""),
        "page":          int(meta.get("page_number", 0)),
        "language":      language,
        "source_file":   meta.get("source_file", ""),
        "tables_html":   [],
        "images_base64": [],
        "element_type":  meta.get("element_type", "body"),
        "keywords":      [k for k in (meta.get("keywords") or "").split(",") if k],
    }


def _build_filters(class_name: str, subject: str) -> dict | None:
    if class_name and subject:
        return {"$and": [{"class": {"$eq": class_name}}, {"subject": {"$eq": subject}}]}
    if class_name:
        return {"class": {"$eq": class_name}}
    return None


def _search(query: str, class_name: str, subject: str, top_k: int) -> List[Dict[str, Any]]:
    retriever = _get_retriever()
    filters = _build_filters(class_name, subject)
    t0 = time.time()
    try:
        docs = retriever.retrieve(query, filters=filters, top_k=top_k, dense_candidates=top_k * 4)
        logger.info("Hybrid search: %d results in %.1fs", len(docs), time.time() - t0)
        return [_doc_to_chunk(doc) for doc in docs]
    except Exception as e:
        logger.warning("Hybrid search failed: %s", e)
        return []


def chapter_retrieve(class_name: str, subject: str, chapter: str, top_k: int = 8) -> List[Dict[str, Any]]:
    t0 = time.time()
    language = _detect_language(f"{chapter} {subject}")
    logger.info("chapter_retrieve: class=%s subject=%s chapter=%r lang=%s top_k=%d",
                class_name, subject, chapter, language, top_k)
    expanded = _hyde_expand(
        f"{chapter} {subject}" if language == "en" else f"{chapter} {subject} பற்றிய பாடப்பகுதி"
    )
    result = _search(expanded, class_name, subject, top_k)
    logger.info("chapter_retrieve done: %d chunks in %.1fs total", len(result), time.time() - t0)
    return result


def topic_retrieve(class_name: str, subject: str, topic: str, top_k: int = 12) -> List[Dict[str, Any]]:
    t0 = time.time()
    language = _detect_language(topic)
    logger.info("topic_retrieve: class=%s subject=%s topic=%r lang=%s top_k=%d",
                class_name, subject, topic, language, top_k)
    expanded = _hyde_expand(
        f"{topic} பற்றி தொடக்கப்பள்ளி மாணவருக்கு எளிதாக விளக்கவும்."
        if language == "ta"
        else f"Explain {topic} in detail for a primary school student."
    )
    result = _search(expanded, class_name, subject, top_k)
    logger.info("topic_retrieve done: %d chunks in %.1fs total", len(result), time.time() - t0)
    return result


# ── CLI output (called by Node.js subprocess) ─────────────────────────────────
def run_chapter_retrieve(class_name: str, subject: str, chapter: str, top_k: int) -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")
    chunks = chapter_retrieve(class_name, subject, chapter, top_k)
    print(json.dumps(chunks, ensure_ascii=False))


def run_topic_retrieve(class_name: str, subject: str, topic: str, top_k: int) -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")
    chunks = topic_retrieve(class_name, subject, topic, top_k)
    print(json.dumps(chunks, ensure_ascii=False))
