"""Semantic chunker: structure-aware, pedagogical-atom-preserving chunking.

Applies a 4-level hierarchy:
  L1 — Unstructured element boundaries (Title = hard split)
  L2 — Sentence-level sliding window for large NarrativeText
  L3 — Pedagogical atom preservation (never split definitions/formulas)
  L4 — Micro-chunk every definition for a separate precision index
"""

import hashlib
import logging
import re
from typing import Any

from langchain_text_splitters import RecursiveCharacterTextSplitter

from settings import get_pipeline_settings
from schema import ElementType, CHUNK_CONFIG
from utils.text_utils import normalize_whitespace

logger = logging.getLogger(__name__)
_SETTINGS = get_pipeline_settings()

# Tamil sentence boundaries (danda, period, exclamation, question)
_RE_SENTENCE_SPLIT = re.compile(r"(?<=[।.!?])\s+")
_RE_PARAGRAPH_SPLIT = re.compile(r"\n{2,}")
_RE_DEFINITION_SENTENCE = re.compile(
    r"(?:வரையறை|Definition|என்பது|எனப்படும்|என்று\s*அழைக்கப்படுகிறது)",
    re.IGNORECASE,
)

# Atomic types — NEVER split, always one chunk
_ATOMIC_TYPES = {ElementType.DEFINITION, ElementType.FORMULA, ElementType.THEOREM}
# Types where we include full context (no mid-content split)
_PRESERVE_TYPES = {ElementType.EXAMPLE, ElementType.TABLE}


def _sentence_chunks(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split text into overlapping sentence-aligned chunks."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        separators=["।", "\n\n", "\n", ". ", "! ", "? ", " "],
        keep_separator=True,
    )
    parts = splitter.split_text(text)
    return [p.strip() for p in parts if p.strip()]


def _split_sentences(text: str) -> list[str]:
    parts = _RE_SENTENCE_SPLIT.split(text)
    return [normalize_whitespace(part) for part in parts if part.strip()]


def _looks_like_definition(text: str) -> bool:
    stripped = text.strip()
    return 20 <= len(stripped) <= 280 and bool(_RE_DEFINITION_SENTENCE.search(stripped))


def _effective_config(etype: ElementType) -> dict[str, int]:
    cfg = dict(CHUNK_CONFIG.get(etype.value, CHUNK_CONFIG["body"]))
    cfg.update(_SETTINGS.chunking.element_overrides().get(etype.value, {}))
    return cfg


def _segment_text(
    text: str,
    default_type: ElementType,
    cfg: dict[str, int],
) -> list[tuple[str, ElementType]]:
    if default_type in _ATOMIC_TYPES or default_type in _PRESERVE_TYPES:
        return [(normalize_whitespace(text), default_type)]

    paragraphs = [p.strip() for p in _RE_PARAGRAPH_SPLIT.split(text) if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    segments: list[tuple[str, ElementType]] = []
    buffered_sentences: list[str] = []

    def flush_buffer() -> None:
        if not buffered_sentences:
            return
        buffered = normalize_whitespace(" ".join(buffered_sentences))
        buffered_sentences.clear()
        if not buffered:
            return
        if len(buffered) <= cfg["chunk_size"]:
            segments.append((buffered, default_type))
            return
        for part in _sentence_chunks(buffered, cfg["chunk_size"], cfg["chunk_overlap"]):
            segments.append((part, default_type))

    for paragraph in paragraphs:
        sentences = _split_sentences(paragraph)
        if not sentences:
            continue
        for sentence in sentences:
            if _SETTINGS.chunking.isolate_definitions and _looks_like_definition(sentence):
                flush_buffer()
                segments.append((sentence, ElementType.DEFINITION))
                continue
            buffered_sentences.append(sentence)
            if len(" ".join(buffered_sentences)) >= cfg["chunk_size"]:
                flush_buffer()
        flush_buffer()

    if not segments:
        fallback = normalize_whitespace(text)
        if fallback:
            segments.append((fallback, default_type))
    return segments


def _chunk_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


class SemanticChunker:
    """Converts preprocessed element dicts into chunk dicts with text + metadata."""

    @staticmethod
    def _update_context(context: dict[str, str], el: dict) -> None:
        title = (el.get("heading_text") or el.get("text") or "").strip()
        if not title:
            return

        role = el.get("heading_role", "")
        if role == "chapter":
            context["chapter_title"] = title
            context["topic_title"] = ""
            context["section_title"] = ""
            context["section_role"] = ""
            return

        if role == "topic":
            context["topic_title"] = title
            context["section_title"] = title
            context["section_role"] = role
            return

        if role in {"subtopic", "exercise"}:
            if not context.get("topic_title"):
                context["topic_title"] = title
            context["section_title"] = title
            context["section_role"] = role

    @staticmethod
    def _make_chunk(el: dict, text: str, context: dict[str, str], element_type: ElementType | None = None) -> dict:
        chapter_title = context.get("chapter_title") or el.get("chapter_title", "")
        topic_title = context.get("topic_title") or el.get("topic_title", "")
        section_title = context.get("section_title") or el.get("section_title", "")
        section_role = context.get("section_role") or el.get("section_role", "")
        effective_type = element_type or el["element_type"]
        return {
            "text": text,
            "element_type": effective_type,
            "dominant_language": el["dominant_language"],
            "is_math_expression": el["is_math_expression"],
            "page_number": el["page_number"],
            "chunk_hash": _chunk_hash(text),
            "micro_chunk": False,
            "chapter_title": chapter_title,
            "topic_title": topic_title,
            "section_title": section_title,
            "section_role": section_role,
        }

    def chunk(self, elements: list[dict]) -> list[dict]:
        """
        Apply the 4-level chunking hierarchy to preprocessed elements.

        Args:
            elements: Output from TextPreprocessor.preprocess().

        Returns:
            List of chunk dicts with text, element_type, page_number, chunk_hash,
            and (for definitions) an extra micro_chunk=True entry in a separate pass.
        """
        chunks: list[dict] = []
        micro_chunks: list[dict] = []
        context = {
            "chapter_title": "",
            "topic_title": "",
            "section_title": "",
            "section_role": "",
        }

        for el in elements:
            etype: ElementType = el["element_type"]
            text: str = el["text"]
            if _SETTINGS.chunking.heading_aware and el.get("is_heading"):
                self._update_context(context, el)
                continue

            cfg = _effective_config(etype)

            if etype in _ATOMIC_TYPES or etype in _PRESERVE_TYPES:
                # L3 / L4: keep as single atom
                chunk = self._make_chunk(el, normalize_whitespace(text), context)
                chunks.append(chunk)
                if etype == ElementType.DEFINITION:
                    micro = {**chunk, "micro_chunk": True}
                    micro_chunks.append(micro)

            elif len(text) <= cfg["chunk_size"]:
                # Fits in one chunk without splitting
                for part, part_type in _segment_text(text, etype, cfg):
                    chunk = self._make_chunk(el, part, context, element_type=part_type)
                    chunks.append(chunk)
                    if part_type == ElementType.DEFINITION:
                        micro_chunks.append({**chunk, "micro_chunk": True})

            else:
                # L2: sentence-aware sliding window with definition extraction
                for part, part_type in _segment_text(text, etype, cfg):
                    chunk = self._make_chunk(el, part, context, element_type=part_type)
                    chunks.append(chunk)
                    if part_type == ElementType.DEFINITION:
                        micro_chunks.append({**chunk, "micro_chunk": True})

        result = chunks + micro_chunks
        logger.info("Chunker: %d elements → %d chunks (%d micro)",
                    len(elements), len(chunks), len(micro_chunks))
        return result
