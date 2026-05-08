"""Hybrid retriever: dense (BGE-M3) + sparse (BM25) fused via Reciprocal Rank Fusion.

Improvements over v1:
- BM25 index is keyed per filter (class/subject), so class_3/Science never
  contaminates a class_4/English query.
- _rrf_fuse returns (Document, float) tuples so callers can filter by score.
- BM25 scores are L∞-normalised before RRF so both branches contribute fairly.
- HNSW ef_search raised to 100 via pgvec_store for better neighbour recall.
- Jaccard-based MMR deduplication removes near-duplicate chunks after fusion.
"""

import json
import logging
import re
from pathlib import Path

from langchain_core.documents import Document
from rank_bm25 import BM25Okapi

from embeddings import get_embedding_model
from pgvec_store import get_vector_store

logger = logging.getLogger(__name__)

_BASE = Path(__file__).parent.parent
VEC_DB_PATH = _BASE / "data" / "vectors.db"

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


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _rrf_fuse(
    dense_hits: list[tuple[Document, float]],
    sparse_hits: list[tuple[Document, float]],
    k: int = 60,
) -> list[tuple[Document, float]]:
    """Reciprocal Rank Fusion — returns (Document, rrf_score) pairs."""
    rrf_scores: dict[str, float] = {}
    # Also track the best raw cosine score per chunk for downstream filtering
    cosine_scores: dict[str, float] = {}
    doc_map: dict[str, Document] = {}

    for rank, (doc, raw_score) in enumerate(dense_hits):
        key = doc.metadata.get("chunk_hash", doc.page_content[:64])
        rrf_scores[key] = rrf_scores.get(key, 0.0) + 1.0 / (k + rank + 1)
        cosine_scores[key] = max(cosine_scores.get(key, 0.0), float(raw_score))
        doc_map[key] = doc

    for rank, (doc, _) in enumerate(sparse_hits):
        key = doc.metadata.get("chunk_hash", doc.page_content[:64])
        rrf_scores[key] = rrf_scores.get(key, 0.0) + 1.0 / (k + rank + 1)
        if key not in doc_map:
            doc_map[key] = doc

    # Attach cosine score into metadata so retrieve.py can surface it
    for key, doc in doc_map.items():
        doc.metadata["_cosine_score"] = cosine_scores.get(key, 0.0)

    ranked = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return [(doc_map[key], score) for key, score in ranked]


def _mmr_deduplicate(
    fused: list[tuple[Document, float]],
    top_k: int,
    sim_threshold: float = 0.72,
) -> list[tuple[Document, float]]:
    """Remove near-duplicate chunks using token-level Jaccard similarity.

    Two chunks are considered duplicates when Jaccard(tokens_A, tokens_B) >=
    sim_threshold.  The higher-scored one is kept; the other is dropped.
    """
    token_sets = [set(_tokenize(doc.page_content)) for doc, _ in fused]
    kept: list[tuple[Document, float]] = []
    kept_sets: list[set[str]] = []

    for i, (doc, score) in enumerate(fused):
        ts = token_sets[i]
        if any(_jaccard(ts, ks) >= sim_threshold for ks in kept_sets):
            continue
        kept.append((doc, score))
        kept_sets.append(ts)
        if len(kept) >= top_k:
            break

    return kept


def _expand_tamil_query(query: str) -> list[str]:
    variants = [query]
    for term, alts in _VARIANT_MAP.items():
        if term in query:
            variants.extend(alts)
    return variants


def _filter_key(filters: dict | None) -> str:
    """Stable string key for a filter dict — used to cache BM25 per scope."""
    if not filters:
        return "__all__"
    return json.dumps(filters, sort_keys=True)


class HybridRetriever:
    """Dense (pgvector) + BM25 hybrid retriever with RRF fusion and MMR dedup.

    BM25 indexes are cached per (class, subject) filter so a Science query
    never bleeds into an English one.
    """

    def __init__(self):
        self._embeddings = get_embedding_model()
        self._vs = None
        # key → (BM25Okapi, list[Document])
        self._bm25_cache: dict[str, tuple[BM25Okapi, list[Document]]] = {}

    def _get_vectorstore(self):
        if self._vs is None:
            self._vs = get_vector_store(
                embedding_function=self._embeddings,
                sqlite_fallback_path=VEC_DB_PATH,
            )
        return self._vs

    def _ensure_bm25(
        self, filters: dict | None
    ) -> tuple[BM25Okapi | None, list[Document]]:
        """Return (BM25Okapi, docs) for the given filter scope, building lazily."""
        key = _filter_key(filters)
        if key in self._bm25_cache:
            return self._bm25_cache[key]

        vs = self._get_vectorstore()
        try:
            raw = vs._collection.get(where=filters or None, limit=2000)
            docs = [
                Document(page_content=text, metadata=meta)
                for text, meta in zip(
                    raw["documents"] or [], raw["metadatas"] or []
                )
                if text
            ]
            if docs:
                corpus = [_tokenize(d.page_content) for d in docs]
                bm25 = BM25Okapi(corpus)
                logger.info(
                    "BM25 index built: %d docs (filter=%s)", len(docs), key
                )
                self._bm25_cache[key] = (bm25, docs)
                return bm25, docs
        except Exception as e:
            logger.warning("BM25 index build failed: %s", e)

        self._bm25_cache[key] = (None, [])
        return None, []

    def retrieve(
        self,
        query: str,
        filters: dict | None = None,
        top_k: int = 5,
        dense_candidates: int = 20,
        min_cosine: float = 0.20,
    ) -> list[tuple[Document, float]]:
        """Hybrid retrieval: dense + BM25 + RRF + MMR dedup.

        Returns (Document, rrf_score) tuples.  Documents whose best cosine
        similarity is below min_cosine are discarded before MMR.
        """
        expanded = _expand_tamil_query(query)
        search_query = " ".join(expanded)

        bm25, bm25_docs = self._ensure_bm25(filters)

        # ── dense (pgvector cosine) ────────────────────────────────────────────
        vs = self._get_vectorstore()
        try:
            dense_hits = vs.similarity_search_with_score(
                search_query, k=dense_candidates, filter=filters or None
            )
        except Exception as e:
            logger.warning("Dense search failed: %s", e)
            dense_hits = []

        # ── sparse (BM25 Okapi) ────────────────────────────────────────────────
        sparse_hits: list[tuple[Document, float]] = []
        if bm25 and bm25_docs:
            tokens = _tokenize(search_query)
            raw_scores = bm25.get_scores(tokens)
            max_score = max(raw_scores) if raw_scores.any() else 1.0
            norm = max_score if max_score > 0 else 1.0
            top_idx = sorted(
                range(len(raw_scores)),
                key=lambda i: raw_scores[i],
                reverse=True,
            )[:dense_candidates]
            sparse_hits = [
                (bm25_docs[i], float(raw_scores[i]) / norm) for i in top_idx
            ]

        if not dense_hits and not sparse_hits:
            return []

        fused = _rrf_fuse(dense_hits, sparse_hits)

        # ── cosine-score gate ──────────────────────────────────────────────────
        filtered = [
            (doc, score)
            for doc, score in fused
            if doc.metadata.get("_cosine_score", 1.0) >= min_cosine
        ]
        if not filtered:
            # relax threshold if nothing passes — better something than nothing
            logger.info(
                "No chunks above cosine %.2f — using all %d fused results",
                min_cosine, len(fused),
            )
            filtered = fused

        # ── hash deduplication then MMR token-Jaccard ─────────────────────────
        seen_hashes: set[str] = set()
        deduped: list[tuple[Document, float]] = []
        for doc, score in filtered:
            h = doc.metadata.get("chunk_hash", "")
            if h and h in seen_hashes:
                continue
            if h:
                seen_hashes.add(h)
            deduped.append((doc, score))

        return _mmr_deduplicate(deduped, top_k=top_k)
