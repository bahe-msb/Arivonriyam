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

from schema import ElementType, CHUNK_CONFIG

logger = logging.getLogger(__name__)

# Tamil sentence boundaries (danda, period, exclamation, question)
_RE_SENTENCE_SPLIT = re.compile(r"(?<=[।.!?])\s+")

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


def _chunk_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


class SemanticChunker:
    """Converts preprocessed element dicts into chunk dicts with text + metadata."""

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

        for el in elements:
            etype: ElementType = el["element_type"]
            text: str = el["text"]
            cfg = CHUNK_CONFIG.get(etype.value, CHUNK_CONFIG["body"])

            if etype in _ATOMIC_TYPES or etype in _PRESERVE_TYPES:
                # L3 / L4: keep as single atom
                chunk = self._make_chunk(el, text)
                chunks.append(chunk)
                if etype == ElementType.DEFINITION:
                    micro = {**chunk, "micro_chunk": True}
                    micro_chunks.append(micro)

            elif len(text) <= cfg["chunk_size"]:
                # Fits in one chunk without splitting
                chunks.append(self._make_chunk(el, text))

            else:
                # L2: sentence-aware sliding window
                parts = _sentence_chunks(text, cfg["chunk_size"], cfg["chunk_overlap"])
                for part in parts:
                    chunks.append(self._make_chunk(el, part))

        result = chunks + micro_chunks
        logger.info("Chunker: %d elements → %d chunks (%d micro)",
                    len(elements), len(chunks), len(micro_chunks))
        return result

    @staticmethod
    def _make_chunk(el: dict, text: str) -> dict:
        return {
            "text": text,
            "element_type": el["element_type"],
            "dominant_language": el["dominant_language"],
            "is_math_expression": el["is_math_expression"],
            "page_number": el["page_number"],
            "chunk_hash": _chunk_hash(text),
            "micro_chunk": False,
        }
