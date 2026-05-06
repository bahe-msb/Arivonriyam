"""SQLite-backed vector store using numpy cosine similarity.

Replaces ChromaDB which stalls on macOS with 1024-dim HNSW index rebuilds.
Linear scan via numpy is <1ms for ≤10K chunks — more than adequate for this project.
"""
import json
import logging
import sqlite3
import uuid
from pathlib import Path

import numpy as np
from langchain_core.documents import Document

logger = logging.getLogger(__name__)


def _matches_filter(meta: dict, where: dict) -> bool:
    """Evaluate a ChromaDB-style $and/$eq filter against a metadata dict."""
    if "$and" in where:
        return all(_matches_filter(meta, c) for c in where["$and"])
    if "$or" in where:
        return any(_matches_filter(meta, c) for c in where["$or"])
    for field, condition in where.items():
        if field.startswith("$"):
            continue
        val = meta.get(field)
        if isinstance(condition, dict):
            if "$eq" in condition and val != condition["$eq"]:
                return False
            if "$ne" in condition and val == condition["$ne"]:
                return False
        elif val != condition:
            return False
    return True


class _CollectionShim:
    """Minimal shim so retriever.py can call collection.get() for BM25 corpus building."""

    def __init__(self, store: "SQLiteVectorStore"):
        self._store = store

    def get(self, where=None, limit: int = 2000, include=None) -> dict:
        docs, metas = self._store.get_all(where=where, limit=limit)
        return {"documents": docs, "metadatas": metas}


class SQLiteVectorStore:
    """
    SQLite-backed cosine-similarity vector store.

    Matches the subset of langchain-chroma / chromadb interface used in this project.
    """

    def __init__(self, db_path: Path, collection_name: str, embedding_function=None):
        self._db_path = db_path
        self._table = collection_name.replace("-", "_")
        self._embeddings = embedding_function
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._init_schema()
        self._collection = _CollectionShim(self)

    def _init_schema(self) -> None:
        self._conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {self._table} (
                id        TEXT PRIMARY KEY,
                content   TEXT NOT NULL,
                embedding BLOB NOT NULL,
                metadata  TEXT NOT NULL
            )
        """)
        self._conn.commit()

    # ── write ──────────────────────────────────────────────────────────────────

    def add(
        self,
        ids: list[str],
        documents: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
    ) -> None:
        rows = [
            (id_, doc, np.array(emb, dtype=np.float32).tobytes(), json.dumps(meta))
            for id_, doc, emb, meta in zip(ids, documents, embeddings, metadatas)
        ]
        with self._conn:
            self._conn.executemany(
                f"INSERT OR REPLACE INTO {self._table} VALUES (?, ?, ?, ?)", rows
            )

    def add_documents(self, docs: list[Document]) -> None:
        """LangChain-compatible: embed and store a list of Documents."""
        if not docs:
            return
        texts = [d.page_content for d in docs]
        vectors = self._embeddings.embed_documents(texts)
        ids = [str(uuid.uuid4()) for _ in docs]
        metas = [self._flatten_meta(d.metadata) for d in docs]
        self.add(ids, texts, vectors, metas)

    @staticmethod
    def _flatten_meta(meta: dict) -> dict:
        """SQLite JSON requires JSON-serialisable values."""
        flat = {}
        for k, v in meta.items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                flat[k] = v if v is not None else ""
            else:
                flat[k] = str(v)
        return flat

    # ── read ───────────────────────────────────────────────────────────────────

    def _load_all(
        self, where: dict | None = None, limit: int = 50_000
    ) -> tuple[list[str], list[str], "np.ndarray", list[dict]]:
        rows = self._conn.execute(
            f"SELECT id, content, embedding, metadata FROM {self._table} LIMIT ?",
            (limit,),
        ).fetchall()

        if where:
            rows = [r for r in rows if _matches_filter(json.loads(r[3]), where)]

        if not rows:
            return [], [], np.empty((0,), dtype=np.float32), []

        ids      = [r[0] for r in rows]
        contents = [r[1] for r in rows]
        metas    = [json.loads(r[3]) for r in rows]
        matrix   = np.stack([np.frombuffer(r[2], dtype=np.float32) for r in rows])
        return ids, contents, matrix, metas

    def get_all(self, where: dict | None = None, limit: int = 2000):
        _, contents, _, metas = self._load_all(where=where, limit=limit)
        return contents, metas

    def similarity_search_with_score(
        self,
        query: str,
        k: int = 10,
        filter: dict | None = None,
    ) -> list[tuple[Document, float]]:
        """Embed query, compute cosine similarity, return top-k (Document, score) pairs."""
        q_vec = np.array(self._embeddings.embed_query(query), dtype=np.float32)
        _, contents, matrix, metas = self._load_all(where=filter)
        if matrix.shape[0] == 0:
            return []

        scores = matrix @ q_vec  # cosine sim — vectors are already normalized
        k = min(k, len(contents))
        top_idx = np.argpartition(scores, -k)[-k:]
        top_idx = top_idx[np.argsort(scores[top_idx])[::-1]]

        return [
            (Document(page_content=contents[i], metadata=metas[i]), float(scores[i]))
            for i in top_idx
        ]

    def count(self) -> int:
        return self._conn.execute(
            f"SELECT COUNT(*) FROM {self._table}"
        ).fetchone()[0]

    def delete_collection(self) -> None:
        """Wipe all vectors — used by --force re-ingest."""
        with self._conn:
            self._conn.execute(f"DELETE FROM {self._table}")
        logger.info("Deleted all vectors from %s", self._table)
