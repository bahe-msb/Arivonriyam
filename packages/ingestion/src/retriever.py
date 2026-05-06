"""Hybrid retriever: dense (BGE-M3) + sparse (BM25) fused via Reciprocal Rank Fusion.

Replaces the pure dense search in retrieve.py for better Tamil term matching.
"""

import logging
import re
from pathlib import Path
from typing import Any

from langchain_core.documents import Document
from rank_bm25 import BM25Okapi

from embeddings import get_embedding_model
from pgvec_store import get_vector_store
from utils.language_detect import detect_dominant_language

logger = logging.getLogger(__name__)

_BASE = Path(__file__).parent.parent
VEC_DB_PATH = _BASE / "data" / "vectors.db"  # SQLite fallback path
COLLECTION  = "mm_rag_pipeline"

# Common Tamil OCR spelling variants for query expansion
_VARIANT_MAP: dict[str, list[str]] = {
    "ஒளிச்சேர்க்கை": ["ஒளிசேர்க்கை", "photosynthesis"],
    "வேதியியல்":     ["chemistry", "வேதி"],
    "கணிதம்":        ["maths", "mathematics", "math"],
    "அறிவியல்":      ["science"],
    "தமிழ்":         ["tamil"],
}

_RE_TOKENIZE = re.compile(r"\s+")


def _tokenize(text: str) -> list[str]:
    return [t for t in _RE_TOKENIZE.split(text.lower()) if t]


def _rrf_fuse(
    dense_hits: list[tuple[Document, float]],
    sparse_hits: list[tuple[Document, float]],
    k: int = 60,
) -> list[Document]:
    """Reciprocal Rank Fusion of two ranked lists."""
    scores: dict[str, float] = {}
    doc_map: dict[str, Document] = {}

    for rank, (doc, _) in enumerate(dense_hits):
        key = doc.metadata.get("chunk_hash", doc.page_content[:64])
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
        doc_map[key] = doc

    for rank, (doc, _) in enumerate(sparse_hits):
        key = doc.metadata.get("chunk_hash", doc.page_content[:64])
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
        doc_map[key] = doc

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [doc_map[k] for k, _ in ranked]


def _expand_tamil_query(query: str) -> list[str]:
    """Add known spelling variants and English equivalents for Tamil terms."""
    variants = [query]
    for term, alts in _VARIANT_MAP.items():
        if term in query:
            variants.extend(alts)
    return variants


class HybridRetriever:
    """Dense (pgvector/SQLite) + BM25 hybrid retriever with RRF fusion."""

    def __init__(self):
        self._embeddings = get_embedding_model()
        self._vs = None
        self._bm25: BM25Okapi | None = None
        self._bm25_docs: list[Document] = []

    def _get_vectorstore(self):
        if self._vs is None:
            self._vs = get_vector_store(
                embedding_function=self._embeddings,
                sqlite_fallback_path=VEC_DB_PATH,
            )
        return self._vs

    def build_bm25_index(self, docs: list[Document]) -> None:
        self._bm25_docs = docs
        corpus = [_tokenize(d.page_content) for d in docs]
        self._bm25 = BM25Okapi(corpus)
        logger.info("BM25 index built: %d documents", len(docs))

    def _ensure_bm25(self, filters: dict | None) -> None:
        """Lazily build BM25 index from the vector store corpus."""
        if self._bm25 is not None:
            return
        vs = self._get_vectorstore()
        try:
            raw = vs._collection.get(where=filters or None, limit=2000)
            docs = [
                Document(page_content=text, metadata=meta)
                for text, meta in zip(raw["documents"] or [], raw["metadatas"] or [])
                if text
            ]
            if docs:
                self.build_bm25_index(docs)
        except Exception as e:
            logger.warning("BM25 index build failed: %s", e)

    def retrieve(
        self,
        query: str,
        filters: dict | None = None,
        top_k: int = 5,
        dense_candidates: int = 20,
    ) -> list[Document]:
        """Hybrid retrieval with RRF fusion."""
        expanded = _expand_tamil_query(query)
        search_query = " ".join(expanded)

        self._ensure_bm25(filters)

        # Dense retrieval via pgvector / SQLite
        vs = self._get_vectorstore()
        try:
            dense_hits = vs.similarity_search_with_score(
                search_query, k=dense_candidates, filter=filters or None
            )
        except Exception as e:
            logger.warning("Dense search failed: %s", e)
            dense_hits = []

        # Sparse BM25 retrieval
        sparse_hits: list[tuple[Document, float]] = []
        if self._bm25 and self._bm25_docs:
            tokens = _tokenize(search_query)
            scores = self._bm25.get_scores(tokens)
            top_idx = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:dense_candidates]
            sparse_hits = [(self._bm25_docs[i], float(scores[i])) for i in top_idx]

        if not dense_hits and not sparse_hits:
            return []

        fused = _rrf_fuse(dense_hits, sparse_hits)

        # Deduplicate by chunk_hash in result set
        seen: set[str] = set()
        result: list[Document] = []
        for doc in fused:
            h = doc.metadata.get("chunk_hash", "")
            if h and h in seen:
                continue
            if h:
                seen.add(h)
            result.append(doc)
            if len(result) >= top_k:
                break

        return result
