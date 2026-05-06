"""Post-processing: quality filtering and embedding normalization.

Applied after chunking and before embedding.
"""

import logging
import re

from langchain_core.documents import Document

from utils.text_utils import ocr_garbage_ratio, remove_markdown_artifacts, normalize_whitespace
from utils.math_utils import spell_operators_in_tamil
from schema import ElementType

logger = logging.getLogger(__name__)

_MIN_CHARS = 50
_MAX_GARBAGE = 0.40
_RE_PURE_NUMERIC = re.compile(r"^\s*[\d\s\.,:\-]+\s*$")


class PostProcessor:
    """Filters and normalizes LangChain Documents before embedding."""

    def __init__(self, seen_hashes: set[str] | None = None):
        # Pass in a shared set to enable cross-document deduplication
        self._seen: set[str] = seen_hashes if seen_hashes is not None else set()

    def filter_and_normalize(self, docs: list[Document]) -> list[Document]:
        """
        Filter junk chunks and normalize text for embedding quality.

        Discards chunks that are:
          - Too short (< 50 chars)
          - Mostly OCR garbage (> 40% non-Tamil/non-ASCII chars)
          - Purely numeric with no context
          - Duplicate content (by chunk_hash)

        Also normalizes math chunks by spelling out operators in Tamil.

        Args:
            docs: LangChain Documents from MetadataEnricher.

        Returns:
            Filtered and normalized documents.
        """
        kept: list[Document] = []
        discarded = 0

        for doc in docs:
            content = doc.page_content
            meta    = doc.metadata
            chunk_hash = meta.get("chunk_hash", "")

            # Deduplication
            if chunk_hash and chunk_hash in self._seen:
                discarded += 1
                continue

            # Length filter
            raw_text = content.split("உள்ளடக்கம்: ")[-1] if "உள்ளடக்கம்: " in content else content
            if len(raw_text.strip()) < _MIN_CHARS:
                discarded += 1
                continue

            # Garbage filter
            if ocr_garbage_ratio(raw_text) > _MAX_GARBAGE:
                discarded += 1
                continue

            # Pure numeric filter
            if _RE_PURE_NUMERIC.match(raw_text):
                discarded += 1
                continue

            # Normalize for embedding
            normalized = self._normalize(content, meta)
            doc.page_content = normalized

            if chunk_hash:
                self._seen.add(chunk_hash)
            kept.append(doc)

        logger.info("PostProcessor: %d → %d docs (%d discarded)",
                    len(docs), len(kept), discarded)
        return kept

    @staticmethod
    def _normalize(content: str, meta: dict) -> str:
        """Lowercase English, normalize whitespace, spell math operators on formula chunks."""
        etype = meta.get("element_type", "body")
        if etype in ("formula", "example") and meta.get("is_math_expression"):
            content = spell_operators_in_tamil(content)
        content = remove_markdown_artifacts(content)
        content = normalize_whitespace(content)
        # Lowercase only ASCII portions — Tamil has no case
        parts = []
        i = 0
        while i < len(content):
            ch = content[i]
            parts.append(ch.lower() if ch.isascii() and ch.isalpha() else ch)
            i += 1
        return "".join(parts)
