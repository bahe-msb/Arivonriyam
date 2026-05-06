"""Embedding model: BAAI/bge-m3 via sentence-transformers, LangChain-compatible.

Singleton pattern — model is loaded once per process.
Falls back to intfloat/multilingual-e5-large-instruct if bge-m3 is not cached locally.

Device note: forced to CPU — BGE-M3 stalls indefinitely on Apple MPS due to unsupported
ops in its ColBERT head. CPU is slower per-batch but completes reliably.
"""

import logging
from typing import List

from langchain_core.embeddings import Embeddings
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# Primary: best multilingual model with dense+sparse+colbert in one
_PRIMARY_MODEL  = "BAAI/bge-m3"
# Fallback: excellent multilingual E5 if BGE-M3 unavailable
_FALLBACK_MODEL = "intfloat/multilingual-e5-large-instruct"

# MPS stalls indefinitely with BGE-M3 — force CPU for reliable completion
_DEVICE = "cpu"

_singleton: "SentenceTransformerEmbeddings | None" = None


class SentenceTransformerEmbeddings(Embeddings):
    """LangChain Embeddings wrapper around a SentenceTransformer model."""

    def __init__(self, model_name: str):
        logger.info("Loading embedding model: %s (device=%s)", model_name, _DEVICE)
        self._model = SentenceTransformer(model_name, device=_DEVICE)
        self._model_name = model_name
        logger.info("Embedding model ready: %s (dim=%d)",
                    model_name, self._model.get_embedding_dimension())

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        vecs = self._model.encode(
            texts,
            batch_size=32,
            show_progress_bar=True,
            normalize_embeddings=True,
            device=_DEVICE,
        )
        return vecs.tolist()

    def embed_query(self, text: str) -> List[float]:
        vec = self._model.encode([text], normalize_embeddings=True, device=_DEVICE)
        return vec[0].tolist()

    @property
    def model_name(self) -> str:
        return self._model_name


def get_embedding_model() -> SentenceTransformerEmbeddings:
    """
    Return the singleton embedding model instance.

    Tries BAAI/bge-m3 first (best for multilingual Tamil/English).
    Falls back to intfloat/multilingual-e5-large-instruct on any error.
    """
    global _singleton
    if _singleton is not None:
        return _singleton

    for model_name in (_PRIMARY_MODEL, _FALLBACK_MODEL):
        try:
            _singleton = SentenceTransformerEmbeddings(model_name)
            return _singleton
        except Exception as e:
            logger.warning("Failed to load %s: %s — trying fallback", model_name, e)

    raise RuntimeError("Could not load any embedding model")
