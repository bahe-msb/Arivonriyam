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
from utils.text_utils import normalize_for_matching
from db import get_page_images

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
    """Return coarse language code used for retrieval prompt routing."""
    lang = detect_dominant_language(text)
    if lang == "ta":
        return "ta"
    if lang == "te":
        return "te"
    if lang == "bilingual":
        tamil = sum(1 for ch in text if 0x0B80 <= ord(ch) <= 0x0BFF)
        telugu = sum(1 for ch in text if 0x0C00 <= ord(ch) <= 0x0C7F)
        if telugu > tamil and telugu > 0:
            return "te"
        if tamil > 0:
            return "ta"
    return "en"


def _hyde_expand(query: str) -> str:
    if query in _hyde_cache:
        logger.info("HyDE cache hit for query")
        return _hyde_cache[query]

    lang = _detect_language(query)
    if lang == "ta":
        prompt = (
            "கீழே உள்ள கேள்விக்கான சுருக்கமான, சாத்தியமான பதிலை அதே மொழியில் எழுதுங்கள். "
            "சில விவரங்கள் இல்லாவிட்டாலும் பரவாயில்லை — இது வெக்டர் தேடலுக்காக மட்டும்."
        )
    elif lang == "te":
        prompt = (
            "క్రింద ఉన్న ప్రశ్నకు అదే భాషలో చిన్న, సాధ్యమైన సమాధానం రాయండి. "
            "కొన్ని వివరాలు ఊహించి రాయవచ్చు — ఇది వెక్టర్ రిట్రీవల్ కోసం మాత్రమే."
        )
    else:
        prompt = (
            "Write a short, plausible answer to the question below in the same language. "
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


_CONTENT_MARKERS = ("content:", "Content:", "உள்ளடக்கம்:", "విషయం:")


def _strip_hyde_prefix(text: str) -> str:
    """Remove the 'question: X\\n\\ncontent: Y' wrapper stored for HyDE embedding.

    The question prefix improves cosine matching during retrieval but must be
    stripped before the text is sent to the summarizer LLM — otherwise it
    hallucinates Q&A instead of narrating the actual lesson content.
    """
    for marker in _CONTENT_MARKERS:
        idx = text.find(marker)
        if idx != -1:
            clean = text[idx + len(marker):].strip()
            if clean:
                return clean
    return text


def _doc_to_chunk(doc, score: float = 1.0) -> Dict[str, Any]:
    """Convert a LangChain Document to the JSON shape Node.js expects."""
    meta = doc.metadata
    # Prefer metadata["raw_text"] (stored clean by enricher since v2).
    # Fall back to stripping the HyDE prefix from page_content for older data.
    raw_text = meta.get("raw_text") or _strip_hyde_prefix(doc.page_content)
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
        "tables_html":    [],
        "images_base64":  [],
        "image_captions": [],
        "element_type":   meta.get("element_type", "body"),
        "keywords":      [k for k in (meta.get("keywords") or "").split(",") if k],
    }


def _build_filters(class_name: str, subject: str) -> dict | None:
    if class_name and subject:
        return {"$and": [{"class": {"$eq": class_name}}, {"subject": {"$eq": subject}}]}
    if class_name:
        return {"class": {"$eq": class_name}}
    return None


def _search(
    query: str,
    class_name: str,
    subject: str,
    top_k: int,
    min_cosine: float = 0.20,
) -> List[Dict[str, Any]]:
    retriever = _get_retriever()
    filters = _build_filters(class_name, subject)
    t0 = time.time()
    try:
        hits = retriever.retrieve(
            query,
            filters=filters,
            top_k=top_k,
            dense_candidates=top_k * 5,
            min_cosine=min_cosine,
        )
        logger.info(
            "Hybrid search: %d results in %.1fs (best cosine=%.3f)",
            len(hits),
            time.time() - t0,
            hits[0][1] if hits else 0,
        )
        return [_doc_to_chunk(doc, doc.metadata.get("_cosine_score", score))
                for doc, score in hits]
    except Exception as e:
        logger.warning("Hybrid search failed: %s", e)
        return []


def chapter_retrieve(class_name: str, subject: str, chapter: str, top_k: int = 8) -> List[Dict[str, Any]]:
    t0 = time.time()
    language = _detect_language(f"{chapter} {subject}")
    logger.info("chapter_retrieve: class=%s subject=%s chapter=%r lang=%s top_k=%d",
                class_name, subject, chapter, language, top_k)
    expanded = _hyde_expand(
        f"{chapter} {subject}"
        if language == "en"
        else f"{chapter} {subject} பற்றிய பாடப்பகுதி"
        if language == "ta"
        else f"{chapter} {subject} గురించి పాఠ్య భాగం"
    )
    result = _search(expanded, class_name, subject, top_k)
    logger.info("chapter_retrieve done: %d chunks in %.1fs total", len(result), time.time() - t0)
    return result


def topic_retrieve(class_name: str, subject: str, topic: str, top_k: int = 14) -> List[Dict[str, Any]]:
    t0 = time.time()
    language = _detect_language(topic)
    logger.info("topic_retrieve: class=%s subject=%s topic=%r lang=%s top_k=%d",
                class_name, subject, topic, language, top_k)

    # HyDE expansion: ask for a child-friendly explanation to anchor the query
    # vector near explanatory content rather than question/exercise text.
    expanded = _hyde_expand(
        f"{topic} பற்றி தொடக்கப்பள்ளி மாணவருக்கு எளிதாக விளக்கவும்."
        if language == "ta"
        else f"{topic} ను ప్రాథమిక పాఠశాల విద్యార్థికి సులభంగా ఉదాహరణలతో వివరించండి."
        if language == "te"
        else f"Explain {topic} clearly for a primary school student with examples."
    )

    result = _search(expanded, class_name, subject, top_k, min_cosine=0.18)

    # Re-rank: chunks from a chapter whose title contains the topic keyword
    # are almost certainly on-topic — move them to the front.
    topic_lower = normalize_for_matching(topic)
    on_topic = [c for c in result
                if topic_lower in normalize_for_matching(c.get("chapter") or "")
                or topic_lower in normalize_for_matching(c.get("text", "")[:160])]
    off_topic = [c for c in result if c not in on_topic]
    result = on_topic + off_topic

    # Sort within the on-topic group by page number so the LLM reads the
    # section in book order (narrative coherence matters for summarization).
    if on_topic:
        on_topic.sort(key=lambda c: c.get("page", 0))

    # Attach extracted images and their Gemma 4 vision captions for retrieved pages
    if result and class_name and subject:
        pages = list({c["page"] for c in result if c.get("page")})
        if pages:
            img_rows = get_page_images(class_name, subject, pages, limit=6)
            page_img_map: dict[int, list[str]] = {}
            page_cap_map: dict[int, list[str]] = {}
            for row in img_rows:
                pg = row["page_number"]
                page_img_map.setdefault(pg, []).append(row["image_b64"])
                page_cap_map.setdefault(pg, []).append(row.get("caption", ""))
            for chunk in result:
                pg = chunk.get("page", 0)
                chunk["images_base64"]  = page_img_map.get(pg, [])
                chunk["image_captions"] = page_cap_map.get(pg, [])

    logger.info("topic_retrieve done: %d chunks in %.1fs total (on_topic=%d)",
                len(result), time.time() - t0, len(on_topic))
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
