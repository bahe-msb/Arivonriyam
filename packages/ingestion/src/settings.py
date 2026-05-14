"""Feature flags and tuning knobs for the ingestion and retrieval pipeline."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", ""}


def _env_int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    value = os.environ.get(name)
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def _env_float(
    name: str,
    default: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    value = os.environ.get(name)
    try:
        parsed = float(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def _env_json_dict(name: str) -> dict[str, Any]:
    raw = os.environ.get(name, "")
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


_DEFAULT_TAMIL_OCR_CONFUSIONS = {
    "பெருககல்": "பெருக்கல்",
    "பெருக்கள்": "பெருக்கல்",
    "கோன": "கோணம்",
    "கோனங்கள்": "கோணங்கள்",
    "கனிதம்": "கணிதம்",
    "பினனம்": "பின்னம்",
    "செஙகோணம்": "செங்கோணம்",
    "வகை கள்": "வகைகள்",
}


@dataclass(frozen=True)
class ChunkingSettings:
    heading_aware: bool = _env_bool("RAG_HEADING_AWARE_CHUNKING", True)
    isolate_definitions: bool = _env_bool("RAG_ATOMIC_DEFINITION_CHUNKING", True)
    body_chunk_size: int = _env_int("RAG_BODY_CHUNK_SIZE", 320, minimum=250, maximum=400)
    body_chunk_overlap: int = _env_int("RAG_BODY_CHUNK_OVERLAP", 96, minimum=80, maximum=120)
    example_chunk_size: int = _env_int("RAG_EXAMPLE_CHUNK_SIZE", 360, minimum=250, maximum=420)
    example_chunk_overlap: int = _env_int("RAG_EXAMPLE_CHUNK_OVERLAP", 96, minimum=80, maximum=120)
    exercise_chunk_size: int = _env_int("RAG_EXERCISE_CHUNK_SIZE", 320, minimum=250, maximum=400)
    exercise_chunk_overlap: int = _env_int("RAG_EXERCISE_CHUNK_OVERLAP", 80, minimum=0, maximum=120)
    summary_chunk_size: int = _env_int("RAG_SUMMARY_CHUNK_SIZE", 360, minimum=250, maximum=420)
    summary_chunk_overlap: int = _env_int("RAG_SUMMARY_CHUNK_OVERLAP", 96, minimum=80, maximum=120)

    def element_overrides(self) -> dict[str, dict[str, int]]:
        return {
            "body": {
                "chunk_size": self.body_chunk_size,
                "chunk_overlap": self.body_chunk_overlap,
            },
            "example": {
                "chunk_size": self.example_chunk_size,
                "chunk_overlap": self.example_chunk_overlap,
            },
            "exercise": {
                "chunk_size": self.exercise_chunk_size,
                "chunk_overlap": self.exercise_chunk_overlap,
            },
            "summary": {
                "chunk_size": self.summary_chunk_size,
                "chunk_overlap": self.summary_chunk_overlap,
            },
        }


@dataclass(frozen=True)
class NormalizationSettings:
    unicode_normalization: bool = _env_bool("RAG_NORMALIZE_UNICODE", True)
    canonical_tamil: bool = _env_bool("RAG_NORMALIZE_TAMIL_CANONICAL", True)
    virama_cleanup: bool = _env_bool("RAG_NORMALIZE_VIRAMA", True)
    punctuation_normalization: bool = _env_bool("RAG_NORMALIZE_PUNCTUATION", True)
    whitespace_normalization: bool = _env_bool("RAG_NORMALIZE_WHITESPACE", True)
    ocr_confusion_corrections: bool = _env_bool("RAG_ENABLE_OCR_CONFUSION_FIXES", True)
    ocr_confusions: dict[str, str] = field(
        default_factory=lambda: {
            **_DEFAULT_TAMIL_OCR_CONFUSIONS,
            **{
                str(k): str(v)
                for k, v in _env_json_dict("RAG_TAMIL_OCR_CONFUSIONS").items()
                if k and v
            },
        }
    )


@dataclass(frozen=True)
class EmbeddingEnrichmentSettings:
    prepend_structural_metadata: bool = _env_bool("RAG_EMBED_STRUCTURAL_METADATA", True)
    include_transliteration: bool = _env_bool("RAG_EMBED_TRANSLITERATION", True)
    include_english_hints: bool = _env_bool("RAG_EMBED_ENGLISH_HINTS", True)
    max_concept_hints: int = _env_int("RAG_MAX_CONCEPT_HINTS", 4, minimum=0, maximum=8)
    extra_concept_hints: dict[str, Any] = field(default_factory=lambda: _env_json_dict("RAG_CONCEPT_HINTS"))


@dataclass(frozen=True)
class RetrievalSettings:
    rrf_k: int = _env_int("RAG_RRF_K", 50, minimum=10, maximum=200)
    bm25_weight: float = _env_float("RAG_BM25_WEIGHT", 0.80, minimum=0.1, maximum=5.0)
    vector_weight: float = _env_float("RAG_VECTOR_WEIGHT", 1.0, minimum=0.1, maximum=5.0)
    adaptive_weighting: bool = _env_bool("RAG_ADAPTIVE_FUSION", True)
    short_query_token_threshold: int = _env_int("RAG_SHORT_QUERY_TOKENS", 3, minimum=1, maximum=12)
    short_query_bm25_boost: float = _env_float("RAG_SHORT_QUERY_BM25_BOOST", 1.25, minimum=1.0, maximum=4.0)
    natural_query_vector_boost: float = _env_float("RAG_NATURAL_QUERY_VECTOR_BOOST", 1.2, minimum=1.0, maximum=4.0)
    ocr_query_bm25_boost: float = _env_float("RAG_OCR_QUERY_BM25_BOOST", 1.2, minimum=1.0, maximum=4.0)


@dataclass(frozen=True)
class BenchmarkSettings:
    diverse_queries: bool = _env_bool("RAG_BENCHMARK_DIVERSE_QUERIES", True)
    semantic_relevance_threshold: float = _env_float(
        "RAG_SEMANTIC_RELEVANCE_THRESHOLD", 0.68, minimum=0.0, maximum=1.0
    )


@dataclass(frozen=True)
class PipelineSettings:
    chunking: ChunkingSettings = field(default_factory=ChunkingSettings)
    normalization: NormalizationSettings = field(default_factory=NormalizationSettings)
    embedding: EmbeddingEnrichmentSettings = field(default_factory=EmbeddingEnrichmentSettings)
    retrieval: RetrievalSettings = field(default_factory=RetrievalSettings)
    benchmark: BenchmarkSettings = field(default_factory=BenchmarkSettings)


_SETTINGS = PipelineSettings()


def get_pipeline_settings() -> PipelineSettings:
    return _SETTINGS