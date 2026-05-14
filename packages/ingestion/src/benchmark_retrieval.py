"""Retrieval benchmark: BM25 vs pgvector vs Hybrid RRF over scoped Tamil queries.

Metrics (per method, averaged across the selected query set):
    Hit@1   — top result contains an expected keyword
    Hit@5   — any of top-5 results contains an expected keyword
    MRR@5   — mean reciprocal rank within the top-5 window
    nDCG@5  — graded ranking quality within the top-5 window
    Latency — wall-clock seconds (excluding model load)

Run:
        cd packages/ingestion
    uv run python src/benchmark_retrieval.py --class class_3 --subject Social --out rag_benchmark_class3.md

Output:
        • Console — per-query progress + aggregate summary
        • --out FILE — writes Markdown summary table for the writeup
"""

import argparse
import json
import logging
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

import numpy as np
from langchain_core.documents import Document
from rank_bm25 import BM25Okapi

from embeddings import get_embedding_model
from pgvec_store import get_vector_store
from retriever import _mmr_deduplicate, _query_fusion_weights, _rrf_fuse, _tokenize
from settings import get_pipeline_settings
from utils.text_utils import clean, normalize_for_matching

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger(__name__)
_SETTINGS = get_pipeline_settings()

# ── Query sets (expected keyword relevance proxy) ────────────────────────────
# A chunk is relevant if any expected keyword appears in chunk text or chapter.
GENERAL_TAMIL_QUERIES: list[dict] = [
    {"q": "ஒளிச்சேர்க்கை என்றால் என்ன",       "expected": ["ஒளிச்சேர்க்கை", "photosynthesis", "தாவர"]},
    {"q": "தாவரங்களின் பாகங்கள்",              "expected": ["வேர்", "தண்டு", "இலை", "பாகங்கள்"]},
    {"q": "நீர் சுழற்சி எவ்வாறு நடைபெறுகிறது", "expected": ["நீர் சுழற்சி", "ஆவியாதல்", "மழை"]},
    {"q": "விலங்குகளின் உணவு பழக்கங்கள்",      "expected": ["தாவர உண்ணி", "இறைச்சி", "விலங்கு", "உணவு"]},
    {"q": "கூட்டல் மற்றும் கழித்தல்",          "expected": ["கூட்டல்", "கழித்தல்", "எண்"]},
    {"q": "பின்னங்கள் என்றால் என்ன",           "expected": ["பின்னம்", "தொகுதி", "பகுதி"]},
    {"q": "வட்டம் மற்றும் முக்கோணம்",          "expected": ["வட்டம்", "முக்கோணம்", "வடிவம்"]},
    {"q": "தமிழ் எழுத்துக்கள் மற்றும் வகைகள்", "expected": ["உயிர்", "மெய்", "எழுத்து"]},
    {"q": "மழை மற்றும் காற்று",               "expected": ["மழை", "காற்று", "வானிலை"]},
    {"q": "விலங்கு வகைகள் யாவை",              "expected": ["பாலூட்டி", "பறவை", "ஊர்வன", "விலங்கு"]},
    {"q": "சூரிய மண்டலத்தில் உள்ள கோள்கள்",   "expected": ["சூரியன்", "கோள்", "மண்டலம்"]},
    {"q": "மின்சாரம் எவ்வாறு உருவாகிறது",      "expected": ["மின்சாரம்", "மின்"]},
    {"q": "மனித உடல் உறுப்புகள்",             "expected": ["இதயம்", "நுரையீரல்", "உறுப்பு", "உடல்"]},
    {"q": "நமது சுற்றுப்புறச் சூழல்",          "expected": ["சுற்றுப்புறம்", "சூழல்", "பருவம்"]},
    {"q": "நேர்கோடு மற்றும் வளைகோடு",         "expected": ["கோடு", "நேர்", "வளைவு", "கோடுகள்"]},
    {"q": "பெருக்கல் மற்றும் வகுத்தல்",        "expected": ["பெருக்கல்", "வகுத்தல்", "பெருக்க"]},
    {"q": "காற்று மாசுபாடு காரணங்கள்",         "expected": ["மாசு", "காற்று", "புகை"]},
    {"q": "உணவு சங்கிலி என்றால் என்ன",        "expected": ["உணவு சங்கிலி", "உற்பத்தியாளர்", "நுகர்வோர்"]},
    {"q": "நீரின் பயன்கள்",                   "expected": ["நீர்", "குடிநீர்", "பயன்"]},
    {"q": "பூமியின் அடுக்குகள்",              "expected": ["பூமி", "அடுக்கு", "மேலோடு", "கோள"]},
]

SCIENCE_TAMIL_QUERIES: list[dict] = [
    {"q": "ஒளிச்சேர்க்கை என்றால் என்ன", "expected": ["ஒளிச்சேர்க்கை", "தாவர", "photosynthesis"]},
    {"q": "நீர் சுழற்சி எப்படி நடக்கிறது", "expected": ["நீர் சுழற்சி", "ஆவியாதல்", "அருவி", "மழை"]},
    {"q": "உணவு சங்கிலி என்றால் என்ன", "expected": ["உணவு சங்கிலி", "உற்பத்தியாளர்", "நுகர்வோர்"]},
    {"q": "மனித உடல் உறுப்புகள்", "expected": ["இதயம்", "நுரையீரல்", "உறுப்பு"]},
    {"q": "காற்று மாசுபாடு காரணங்கள்", "expected": ["மாசு", "காற்று", "புகை"]},
    {"q": "சூரிய மண்டலம் கோள்கள்", "expected": ["சூரியன்", "கோள்", "மண்டலம்"]},
    {"q": "விலங்கு வகைகள்", "expected": ["பாலூட்டி", "பறவை", "ஊர்வன", "விலங்கு"]},
    {"q": "தாவரங்களின் பாகங்கள்", "expected": ["வேர்", "தண்டு", "இலை"]},
    {"q": "நீரின் பயன்பாடுகள்", "expected": ["நீர்", "குடிநீர்", "பயன்"]},
    {"q": "மழை மற்றும் காற்று", "expected": ["மழை", "காற்று", "வானிலை"]},
]

MATH_TAMIL_QUERIES: list[dict] = [
    {"q": "கூட்டல் மற்றும் கழித்தல்", "expected": ["கூட்டல்", "கழித்தல்", "எண்"]},
    {"q": "பெருக்கல் மற்றும் வகுத்தல்", "expected": ["பெருக்கல்", "வகுத்தல்", "பெருக்க"]},
    {"q": "பின்னங்கள் என்றால் என்ன", "expected": ["பின்னம்", "பகுதி", "தொகுதி"]},
    {"q": "நேர்கோடு மற்றும் வளைகோடு", "expected": ["கோடு", "நேர்", "வளை"]},
    {"q": "வட்டம் மற்றும் முக்கோணம்", "expected": ["வட்டம்", "முக்கோணம்", "வடிவம்"]},
    {"q": "கோண வகைகள்", "expected": ["கோணம்", "நேர்கோணம்", "முக்கோணம்"]},
    {"q": "அளவு மற்றும் அளவீடு", "expected": ["அளவு", "செ.மீ", "மீட்டர்", "லிட்டர்"]},
    {"q": "எண்களின் இடமதிப்பு", "expected": ["இடமதிப்பு", "எண்", "பத்துகள்", "நூறுகள்"]},
    {"q": "எளிய பிரச்சினை தீர்வு", "expected": ["தீர்வு", "கணக்கு", "விடை"]},
    {"q": "ஒப்பீடு அதிகம் குறைவு", "expected": ["அதிகம்", "குறைவு", "ஒப்பீடு"]},
]

TAMIL_SUBJECT_QUERIES: list[dict] = [
    {"q": "தமிழ் எழுத்துக்கள் மற்றும் வகைகள்", "expected": ["உயிர்", "மெய்", "எழுத்து"]},
    {"q": "சொல் வகைகள்", "expected": ["பெயர்ச்சொல்", "வினைச்சொல்", "சொல்"]},
    {"q": "எதிர்ச்சொல் உதாரணங்கள்", "expected": ["எதிர்ச்சொல்", "சொல்"]},
    {"q": "ஒருமை பன்மை", "expected": ["ஒருமை", "பன்மை"]},
    {"q": "குறில் நெடில் வேறுபாடு", "expected": ["குறில்", "நெடில்"]},
    {"q": "வாக்கிய அமைப்பு", "expected": ["வாக்கியம்", "சொற்றொடர்"]},
    {"q": "பாடப்பகுதி சுருக்கம்", "expected": ["சுருக்கம்", "பாடம்"]},
    {"q": "புதுச்சொற்களின் பொருள்", "expected": ["பொருள்", "சொல்"]},
    {"q": "கதை பாத்திரங்கள்", "expected": ["கதை", "பாத்திரம்"]},
    {"q": "பயிற்சி வினாக்கள்", "expected": ["பயிற்சி", "வினா"]},
]

SOCIAL_TAMIL_QUERIES: list[dict] = [
    {"q": "வியக்க வைக்கும் கிராமம்", "expected": ["வியக்க வைக்கும் கிராமம்", "ஒடந்துறை", "ஊராட்சி"]},
    {"q": "கிராம சபை என்றால் என்ன", "expected": ["கிராம சபை", "மக்களாட்சி", "கூட்டம்"]},
    {"q": "கிராம சபை கூட்டம் எத்தனை முறை நடைபெறும்", "expected": ["கிராம சபை", "ஆறு முறை", "கூட்டம்"]},
    {"q": "கிராம வளர்ச்சிப் பணிகள் எவ்வாறு செயல்படுத்தப்படுகின்றன", "expected": ["கிராம வளர்ச்சிப் பணிகள்", "திட்ட", "செயல்ப"]},
    {"q": "பஞ்சாயத்து ராஜ் என்றால் என்ன", "expected": ["பஞ்சாயத்து ராஜ்", "பஞ்சாயத்து முறை", "ஊராட்சி"]},
    {"q": "ஊராட்சி மன்றத்தின் பணிகள் என்ன", "expected": ["ஊராட்சி மன்றம்", "அடிப்படைத் தேவைகள்", "வரி"]},
    {"q": "நகராட்சி என்றால் என்ன", "expected": ["நகராட்சி", "நகர மன்றம்", "மக்கள் தொகை"]},
    {"q": "நகர மன்றத்தின் பணி என்ன", "expected": ["நகர மன்றம்", "மக்களின் தேவைகள்", "நகராட்சி"]},
    {"q": "கட்டாயப்பணி மற்றும் தன்னார்வப்பணி", "expected": ["கட்டாயப்பணி", "தன்னார்வப்பணி", "வளர்ச்சித்திட்டம்"]},
    {"q": "ஊராட்சியின் கட்டாயப்பணிகள்", "expected": ["ஊராட்சியின் கட்டாயப்பணிகள்", "கட்டாயப்பணி", "மன்றம்"]},
]

SUBJECT_QUERY_SETS: dict[str, tuple[str, list[dict]]] = {
    "science": ("science_tamil", SCIENCE_TAMIL_QUERIES),
    "math": ("math_tamil", MATH_TAMIL_QUERIES),
    "maths": ("math_tamil", MATH_TAMIL_QUERIES),
    "mathematics": ("math_tamil", MATH_TAMIL_QUERIES),
    "social": ("social_tamil", SOCIAL_TAMIL_QUERIES),
    "tamil": ("tamil_subject", TAMIL_SUBJECT_QUERIES),
}

TOP_K = 5
DEFAULT_BENCHMARK_OUT = str(Path(__file__).resolve().parent.parent / "rag_benchmark_results.md")
DEFAULT_LABELS_PATH = str(Path(__file__).resolve().parent.parent / "data" / "relevance_labels.json")
LEGACY_BENCHMARK_FILENAMES = {"benchmark_results.md"}
_TAMIL_QUERY_STOPWORDS = {
    "என்ன", "என்றால்", "எது", "எவ்வாறு", "எப்படி", "மற்றும்", "உள்ள", "யாவை",
    "பற்றி", "விளக்கம்", "உதாரணங்கள்", "காரணங்கள்", "எளிமையாக", "பயன்கள்",
}


# ── isolated retrieval helpers ────────────────────────────────────────────────

class _Engines:
    """Holds shared vector store + BM25 corpus so they load once."""

    def __init__(self, filters: dict | None):
        self.filters = filters
        self._embeddings = get_embedding_model()
        self._vs = get_vector_store(embedding_function=self._embeddings)
        self._bm25: BM25Okapi | None = None
        self._bm25_docs: list[Document] = []
        self._query_embedding_cache: dict[str, np.ndarray] = {}
        self._doc_embedding_cache: dict[str, np.ndarray] = {}
        self._build_bm25()

    def _build_bm25(self) -> None:
        raw = self._vs._collection.get(where=self.filters, limit=4000)
        docs = [
            Document(page_content=text, metadata=meta)
            for text, meta in zip(raw["documents"] or [], raw["metadatas"] or [])
            if text
        ]
        if docs:
            corpus = [_tokenize(d.page_content) for d in docs]
            self._bm25 = BM25Okapi(corpus)
            self._bm25_docs = docs
            logger.info("BM25 corpus: %d docs", len(docs))
        else:
            logger.warning("BM25 corpus empty — is data ingested?")

    # ── three retrieval modes ─────────────────────────────────────────────────

    def pgvector_only(self, query: str) -> tuple[list[tuple[Document, float]], float]:
        t0 = time.perf_counter()
        normalized_query = clean(query)
        try:
            hits = self._vs.similarity_search_with_score(
                normalized_query, k=TOP_K, filter=self.filters
            )
        except Exception as e:
            logger.warning("pgvector failed: %s", e)
            hits = []
        return hits, time.perf_counter() - t0

    def bm25_only(self, query: str) -> tuple[list[tuple[Document, float]], float]:
        t0 = time.perf_counter()
        if not self._bm25 or not self._bm25_docs:
            return [], time.perf_counter() - t0
        tokens = _tokenize(clean(query))
        raw = self._bm25.get_scores(tokens)
        mx = float(np.max(raw)) if raw.any() else 1.0
        norm = mx if mx > 0 else 1.0
        idx_sorted = sorted(range(len(raw)), key=lambda i: raw[i], reverse=True)[:TOP_K]
        hits = [(self._bm25_docs[i], float(raw[i]) / norm) for i in idx_sorted]
        return hits, time.perf_counter() - t0

    def hybrid_rrf(self, query: str) -> tuple[list[tuple[Document, float]], float]:
        t0 = time.perf_counter()
        dense, _ = self.pgvector_only(query)
        sparse, _ = self.bm25_only(query)
        bm25_weight, vector_weight = _query_fusion_weights(query)
        fused = _rrf_fuse(
            dense,
            sparse,
            k=_SETTINGS.retrieval.rrf_k,
            dense_weight=vector_weight,
            sparse_weight=bm25_weight,
        )
        deduped = _mmr_deduplicate(fused, top_k=TOP_K)
        return deduped, time.perf_counter() - t0

    def semantic_relevance(self, query: str, doc: Document) -> float:
        query_key = normalize_for_matching(query)
        if query_key not in self._query_embedding_cache:
            self._query_embedding_cache[query_key] = np.array(
                self._embeddings.embed_query(clean(query)),
                dtype=float,
            )

        doc_key = doc.metadata.get("chunk_hash") or normalize_for_matching(doc.page_content[:160])
        if doc_key not in self._doc_embedding_cache:
            raw_text = doc.metadata.get("raw_text") or doc.page_content
            self._doc_embedding_cache[doc_key] = np.array(
                self._embeddings.embed_query(raw_text),
                dtype=float,
            )

        return float(np.dot(self._query_embedding_cache[query_key], self._doc_embedding_cache[doc_key]))


# ── relevance scoring ─────────────────────────────────────────────────────────

def _unique_terms(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = clean(value).strip()
        if not cleaned:
            continue
        key = normalize_for_matching(cleaned)
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def _seed_topic(seed: dict[str, Any]) -> str:
    expected = _unique_terms(list(seed.get("expected", [])))
    if expected:
        return expected[0]
    tokens = [t for t in _tokenize(seed["q"]) if t not in _TAMIL_QUERY_STOPWORDS]
    return " ".join(tokens[:4]) if tokens else clean(seed["q"])


def _ocr_noisy_variant(text: str) -> str:
    inverse_map: dict[str, str] = {}
    for wrong, right in _SETTINGS.normalization.ocr_confusions.items():
        inverse_map.setdefault(str(right), str(wrong))

    noisy = clean(text)
    for right, wrong in inverse_map.items():
        noisy = noisy.replace(right, wrong)
    return noisy


def _infer_corpus_seeds(docs: list[Document], max_seeds: int = 6) -> list[dict[str, Any]]:
    seeds: list[dict[str, Any]] = []
    seen: set[str] = set()
    for doc in docs:
        title = (
            doc.metadata.get("topic_title")
            or doc.metadata.get("section_title")
            or doc.metadata.get("chapter_title")
            or ""
        ).strip()
        if len(title) < 3:
            continue
        key = normalize_for_matching(title)
        if key in seen:
            continue
        seen.add(key)
        keywords = [k.strip() for k in str(doc.metadata.get("keywords") or "").split(",") if k.strip()]
        expected = _unique_terms([title, *keywords[:3]])
        seeds.append({"q": title, "expected": expected})
        if len(seeds) >= max_seeds:
            break
    return seeds


def _expand_query_seeds(seeds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not _SETTINGS.benchmark.diverse_queries:
        return [
            {
                "q": clean(seed["q"]),
                "expected": _unique_terms(list(seed.get("expected", []))),
                "category": "exact_textbook",
                "topic": _seed_topic(seed),
            }
            for seed in seeds
        ]

    cases: list[dict[str, Any]] = []
    seen_queries: set[str] = set()

    for seed in seeds:
        topic = _seed_topic(seed)
        exact_query = clean(seed["q"])
        expected = _unique_terms([topic, exact_query, *list(seed.get("expected", []))])
        variants = [
            ("exact_textbook", exact_query),
            ("student_natural", f"ஆசிரியரே, {topic} பற்றி எளிமையாக சொல்லுங்கள்"),
            ("definition", f"{topic} என்றால் என்ன"),
            ("paraphrase", f"{topic} தொடர்பான முக்கிய கருத்துகள் என்ன"),
            ("ocr_noisy", _ocr_noisy_variant(f"{topic} என்றால் என்ன")),
            ("short_keyword", topic),
            ("long_explanatory", f"{topic} பற்றி ஒரு மாணவர் புரியும் வகையில் உதாரணங்களுடன் விரிவாக விளக்குங்கள்"),
        ]

        for category, query in variants:
            query_key = normalize_for_matching(query)
            if category == "ocr_noisy":
                query_key = f"ocr::{query.strip()}"
            if not query_key or query_key in seen_queries:
                continue
            seen_queries.add(query_key)
            stored_query = query if category == "ocr_noisy" else clean(query)
            cases.append(
                {
                    "q": stored_query,
                    "expected": expected,
                    "expected_norm": [normalize_for_matching(term) for term in expected],
                    "category": category,
                    "topic": topic,
                }
            )

    return cases


def _load_manual_labels(labels_file: str = "") -> dict[str, dict[str, Any]]:
    path = Path(labels_file) if labels_file else Path(DEFAULT_LABELS_PATH)
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to load relevance labels from %s: %s", path, exc)
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        normalize_for_matching(str(query)): payload
        for query, payload in raw.items()
        if isinstance(payload, dict)
    }


def _resolve_manual_label(
    item: dict[str, Any],
    label_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return (
        label_index.get(normalize_for_matching(item["q"]))
        or label_index.get(normalize_for_matching(item.get("topic", "")))
        or {}
    )


def _relevance_grade(
    doc: Document,
    item: dict[str, Any],
    manual_label: dict[str, Any],
    engines: _Engines,
) -> float:
    raw_text = doc.metadata.get("raw_text") or doc.page_content or ""
    chapter = doc.metadata.get("chapter_title") or doc.metadata.get("chapter") or ""
    topic = doc.metadata.get("topic_title") or doc.metadata.get("section_title") or ""
    keywords = str(doc.metadata.get("keywords") or "")
    haystack = normalize_for_matching(" ".join([raw_text, chapter, topic, keywords]))
    grade = 0.0

    chunk_hash = str(doc.metadata.get("chunk_hash") or "")
    relevant_hashes = {str(h) for h in manual_label.get("relevant_chunk_hashes", []) if h}
    relevant_chapters = [normalize_for_matching(str(ch)) for ch in manual_label.get("relevant_chapters", []) if ch]
    relevant_terms = [normalize_for_matching(str(term)) for term in manual_label.get("relevant_terms", []) if term]

    if chunk_hash and chunk_hash in relevant_hashes:
        return 3.0
    if any(chapter_hint and chapter_hint in normalize_for_matching(chapter) for chapter_hint in relevant_chapters):
        grade = max(grade, 2.0)
    if any(term and term in haystack for term in relevant_terms):
        grade = max(grade, 2.0)

    if any(term and term in haystack for term in item.get("expected_norm", [])):
        grade = max(grade, 1.5)

    topic_hint = normalize_for_matching(item.get("topic", ""))
    if topic_hint and topic_hint in normalize_for_matching(f"{chapter} {topic}"):
        grade = max(grade, 2.0)

    semantic_score = engines.semantic_relevance(item["q"], doc)
    if semantic_score >= _SETTINGS.benchmark.semantic_relevance_threshold:
        grade = max(grade, 1.0)

    return grade


def _ndcg_at_k(grades: list[float], ideal_grades: list[float]) -> float:
    def _dcg(values: list[float]) -> float:
        return sum(
            ((2 ** grade) - 1) / np.log2(rank + 2)
            for rank, grade in enumerate(values[:TOP_K])
            if grade > 0
        )

    best = _dcg(ideal_grades)
    if best == 0:
        return 0.0
    return _dcg(grades) / best


class QueryResult(NamedTuple):
    query: str
    category: str
    hit1: bool
    hit5: bool
    mrr5: float
    ndcg5: float
    latency: float
    top_label: str


def _eval(
    hits: list[tuple[Document, float]],
    item: dict[str, Any],
    latency: float,
    engines: _Engines,
    label_index: dict[str, dict[str, Any]],
) -> QueryResult:
    query = item["q"]
    manual_label = _resolve_manual_label(item, label_index)
    top_label = ""
    if hits:
        doc, score = hits[0]
        _ = score
        raw_label = doc.metadata.get("chapter_title") or doc.metadata.get("chapter", "")
        top_label = _sanitize_label(raw_label)

    grades: list[float] = []
    for rank, (doc, _) in enumerate(hits[:TOP_K], start=1):
        grade = _relevance_grade(doc, item, manual_label, engines)
        grades.append(grade)

    hit1 = bool(grades and grades[0] > 0)
    hit5 = any(grade > 0 for grade in grades)
    mrr5 = 0.0
    for rank, grade in enumerate(grades, start=1):
        if grade > 0:
            mrr5 = 1.0 / rank
            break

    ideal_grades = sorted(grades, reverse=True)
    if manual_label.get("relevant_chunk_hashes"):
        ideal_count = min(TOP_K, len(manual_label["relevant_chunk_hashes"]))
        positive_count = sum(1 for grade in ideal_grades if grade > 0)
        remaining = max(0, ideal_count - positive_count)
        ideal_grades = sorted(ideal_grades + [3.0] * remaining, reverse=True)[:TOP_K]
    ndcg5 = _ndcg_at_k(grades, ideal_grades)

    return QueryResult(query, item.get("category", "exact_textbook"), hit1, hit5, mrr5, ndcg5, latency, top_label)


def _normalize_subject(subject: str) -> str:
    cleaned = re.sub(r"[^a-z]", "", subject.lower())
    if cleaned in {"science", "sciences"}:
        return "science"
    if cleaned in {"math", "maths", "mathematics", "arithmetic"}:
        return "math"
    if cleaned in {"social", "socialstudies", "socialscience", "socialsciences"}:
        return "social"
    if cleaned == "tamil":
        return "tamil"
    return cleaned


def _select_queries(subject: str, docs: list[Document]) -> tuple[str, list[dict[str, Any]]]:
    key = _normalize_subject(subject)
    corpus_seeds = _infer_corpus_seeds(docs)
    if key and key in SUBJECT_QUERY_SETS:
        set_name, seeds = SUBJECT_QUERY_SETS[key]
        return f"{set_name}_diverse", _expand_query_seeds(seeds + corpus_seeds)
    return "general_tamil_diverse", _expand_query_seeds(GENERAL_TAMIL_QUERIES + corpus_seeds)


def _sanitize_label(label: str) -> str:
    if not label:
        return "—"
    cleaned = "".join(ch if ch.isprintable() else " " for ch in str(label)).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        return "—"

    signal_chars = sum(
        1
        for ch in cleaned
        if ch.isalnum() or ch.isspace() or ch in "-_/.,:()&'\""
    )
    signal_ratio = signal_chars / max(1, len(cleaned))
    if signal_ratio < 0.45:
        return "[noisy label removed]"

    return cleaned[:52]


def _resolve_output_path(out_file: str) -> Path:
    """Resolve output path and auto-migrate legacy benchmark filenames.

    Old commands commonly pass benchmark_results.md or ../benchmark_results.md,
    which previously wrote outside the ingestion folder. To keep outputs stable,
    we redirect those legacy filenames to DEFAULT_BENCHMARK_OUT.
    """
    out = Path(out_file)
    if out.name in LEGACY_BENCHMARK_FILENAMES:
        redirected = Path(DEFAULT_BENCHMARK_OUT)
        print(
            f"[benchmark] Legacy output '{out_file}' detected. "
            f"Redirecting to {redirected}"
        )
        return redirected
    return out


# ── aggregate + formatting ────────────────────────────────────────────────────

def _agg(results: list[QueryResult]) -> dict:
    n = len(results)
    if n == 0:
        return {"Hit@1": 0, "Hit@5": 0, "MRR@5": 0, "nDCG@5": 0, "AvgLatency": 0}
    return {
        "Hit@1":      round(sum(r.hit1 for r in results) / n, 3),
        "Hit@5":      round(sum(r.hit5 for r in results) / n, 3),
        "MRR@5":      round(sum(r.mrr5 for r in results) / n, 3),
        "nDCG@5":     round(sum(r.ndcg5 for r in results) / n, 3),
        "AvgLatency": round(sum(r.latency for r in results) / n, 3),
    }


def _markdown_table(
    bm25_results:   list[QueryResult],
    vec_results:    list[QueryResult],
    hybrid_results: list[QueryResult],
    query_set_name: str,
    scope: str,
) -> str:
    bm25_agg   = _agg(bm25_results)
    vec_agg    = _agg(vec_results)
    hybrid_agg = _agg(hybrid_results)

    lines = [
        "## Retrieval Benchmark",
        "",
        f"- Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"- Scope: {scope}",
        f"- Query set: {query_set_name} ({len(hybrid_results)} queries)",
        "",
        "| Method         | Hit\\@1 | Hit\\@5 | MRR\\@5 | nDCG\\@5 | Avg Latency (s) |",
        "| -------------- | ------ | ------ | ------ | -------- | --------------- |",
        f"| BM25           | {bm25_agg['Hit@1']:.3f}  | {bm25_agg['Hit@5']:.3f}  | {bm25_agg['MRR@5']:.3f}  | {bm25_agg['nDCG@5']:.3f}   | {bm25_agg['AvgLatency']:.3f}           |",
        f"| pgvector       | {vec_agg['Hit@1']:.3f}  | {vec_agg['Hit@5']:.3f}  | {vec_agg['MRR@5']:.3f}  | {vec_agg['nDCG@5']:.3f}   | {vec_agg['AvgLatency']:.3f}           |",
        f"| **Hybrid RRF** | **{hybrid_agg['Hit@1']:.3f}**  | **{hybrid_agg['Hit@5']:.3f}**  | **{hybrid_agg['MRR@5']:.3f}**  | **{hybrid_agg['nDCG@5']:.3f}**   | {hybrid_agg['AvgLatency']:.3f}           |",
        "",
        "> Relevance scoring: manual chunk labels when provided, otherwise keyword/topic match plus semantic similarity over the top-5 hits.",
        "> Latency excludes model load (embedder and BM25 index built once before benchmark loop).",
        "> Per-query chapter labels are intentionally omitted from the published table to avoid OCR-noise artifacts.",
        "",
        "### Per-Query Breakdown",
        "",
        "| # | Category | Query | BM25 H@1 | vec H@1 | RRF H@1 | RRF nDCG@5 |",
        "| - | -------- | ----- | -------- | ------- | ------- | ---------- |",
    ]

    for i, (bq, vq, hq) in enumerate(zip(bm25_results, vec_results, hybrid_results), start=1):
        b1 = "✓" if bq.hit1 else "✗"
        v1 = "✓" if vq.hit1 else "✗"
        h1 = "✓" if hq.hit1 else "✗"
        lines.append(f"| {i:2} | {hq.category} | {bq.query} | {b1} | {v1} | {h1} | {hq.ndcg5:.3f} |")

    lines.append("")
    return "\n".join(lines)


# ── main ──────────────────────────────────────────────────────────────────────

def run_benchmark(
    class_name: str = "",
    subject: str = "",
    out_file: str = DEFAULT_BENCHMARK_OUT,
    labels_file: str = "",
) -> None:
    filters: dict | None = None

    clauses: list[dict] = []
    if class_name:
        match = re.search(r"(\d+)", class_name)
        if match:
            clauses.append({"standard": {"$eq": int(match.group(1))}})
    if subject:
        clauses.append({"subject": {"$eq": subject}})

    if len(clauses) == 1:
        filters = clauses[0]
    elif len(clauses) > 1:
        filters = {"$and": clauses}

    scope = f"class={class_name or '*'} subject={subject or '*'}"
    print(f"[benchmark] Loading retrieval engines (scope: {scope}) …", flush=True)

    engines = _Engines(filters)

    n_chunks = len(engines._bm25_docs)
    if n_chunks == 0:
        print("[benchmark] ERROR: No chunks found in the vector store. Have you run ingestion?", file=sys.stderr)
        sys.exit(1)

    query_set_name, queries = _select_queries(subject, engines._bm25_docs)
    label_index = _load_manual_labels(labels_file)

    print(
        f"[benchmark] Corpus: {n_chunks} chunks. Running {len(queries)} queries × 3 methods (set={query_set_name}) …\n",
        flush=True,
    )

    bm25_results:   list[QueryResult] = []
    vec_results:    list[QueryResult] = []
    hybrid_results: list[QueryResult] = []

    for i, item in enumerate(queries, start=1):
        q        = item["q"]

        b_hits, b_lat = engines.bm25_only(q)
        v_hits, v_lat = engines.pgvector_only(q)
        h_hits, h_lat = engines.hybrid_rrf(q)

        bq = _eval(b_hits, item, b_lat, engines, label_index)
        vq = _eval(v_hits, item, v_lat, engines, label_index)
        hq = _eval(h_hits, item, h_lat, engines, label_index)

        bm25_results.append(bq)
        vec_results.append(vq)
        hybrid_results.append(hq)

        print(
            f"  {i:2}. [{item['category']}] {q[:42]:<44}  BM25 H@1={int(bq.hit1)}  vec H@1={int(vq.hit1)}  RRF H@1={int(hq.hit1)}"
            f"  | RRF top: {hq.top_label}"
        )

    print()
    table_md = _markdown_table(
        bm25_results,
        vec_results,
        hybrid_results,
        query_set_name=query_set_name,
        scope=scope,
    )
    print(table_md)

    out = _resolve_output_path(out_file)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(table_md, encoding="utf-8")
    print(f"[benchmark] Table saved → {out.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Retrieval benchmark (BM25 vs pgvector vs Hybrid RRF)")
    parser.add_argument("--class",   dest="class_name", default="", help="Filter to a specific class (e.g. class_4)")
    parser.add_argument("--subject", default="", help="Filter to a specific subject (e.g. Science)")
    parser.add_argument("--out",     default=DEFAULT_BENCHMARK_OUT, help="Output Markdown file path")
    parser.add_argument("--labels",  default="", help="Optional JSON file of manually labelled relevant chunks")
    args = parser.parse_args()
    run_benchmark(class_name=args.class_name, subject=args.subject, out_file=args.out, labels_file=args.labels)
