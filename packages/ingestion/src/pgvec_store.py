"""PostgreSQL + pgvector vector store.

Schema:
  table rag_chunks  — one row per chunk, 1024-dim cosine vector index (HNSW)

Cosine similarity search via <=> operator.
BM25 corpus fetched via plain SELECT (no re-embedding needed).

Falls back to SQLiteVectorStore if the PostgreSQL connection fails.
"""
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
from langchain_core.documents import Document

logger = logging.getLogger(__name__)

_DSN = os.environ.get("PG_DSN", "postgresql://localhost/arivonriyam_rag")
TABLE = "rag_chunks"
DIM   = 1024  # BGE-M3 output dimension


# ── filter helpers ────────────────────────────────────────────────────────────

def _matches_filter(meta: dict, where: dict) -> bool:
    """Evaluate a ChromaDB-style $and/$eq filter dict in Python (used for BM25 shim)."""
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


def _where_to_sql(where: dict | None) -> tuple[str, list]:
    """Convert a simple $and/$eq filter to a SQL WHERE clause + params list."""
    if not where:
        return "", []

    clauses: list[str] = []
    params:  list      = []

    conditions = where.get("$and", [where]) if "$and" not in where else where["$and"]
    for cond in conditions:
        for field, condition in cond.items():
            if field.startswith("$"):
                continue
            if isinstance(condition, dict) and "$eq" in condition:
                clauses.append(f"metadata->>%s = %s")
                params.extend([field, str(condition["$eq"])])
            elif not isinstance(condition, dict):
                clauses.append(f"metadata->>%s = %s")
                params.extend([field, str(condition)])

    if not clauses:
        return "", []
    return "WHERE " + " AND ".join(clauses), params


# ── BM25 shim ─────────────────────────────────────────────────────────────────

class _CollectionShim:
    """Minimal shim so retriever.py can call collection.get() for BM25 corpus building."""

    def __init__(self, store: "PGVectorStore"):
        self._store = store

    def get(self, where=None, limit: int = 2000, include=None) -> dict:
        docs, metas = self._store.get_all(where=where, limit=limit)
        return {"documents": docs, "metadatas": metas}


# ── main store ────────────────────────────────────────────────────────────────

class PGVectorStore:
    """
    pgvector-backed cosine similarity store.

    Interface matches the subset of langchain-chroma / SQLiteVectorStore used in
    ingest.py and retriever.py.
    """

    def __init__(self, dsn: str = _DSN, embedding_function=None):
        import psycopg
        from pgvector.psycopg import register_vector

        self._dsn = dsn
        self._embeddings = embedding_function
        self._conn = psycopg.connect(dsn, autocommit=False)
        register_vector(self._conn)
        self._init_schema()
        self._collection = _CollectionShim(self)

    def _init_schema(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {TABLE} (
                    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    content  TEXT NOT NULL,
                    embedding vector({DIM}) NOT NULL,
                    metadata JSONB NOT NULL DEFAULT '{{}}'
                )
            """)
            # HNSW index for fast cosine search — built once, maintained on inserts
            cur.execute(f"""
                CREATE INDEX IF NOT EXISTS {TABLE}_embedding_idx
                ON {TABLE} USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            """)
        self._conn.commit()
        logger.info("pgvector schema ready (table=%s, dim=%d)", TABLE, DIM)

    # ── write ─────────────────────────────────────────────────────────────────

    def add(
        self,
        ids:        list[str],
        documents:  list[str],
        embeddings: list[list[float]],
        metadatas:  list[dict],
    ) -> None:
        rows = [
            (uid, doc, np.array(emb, dtype=np.float32).tolist(), json.dumps(meta))
            for uid, doc, emb, meta in zip(ids, documents, embeddings, metadatas)
        ]
        with self._conn.cursor() as cur:
            cur.executemany(
                f"INSERT INTO {TABLE} (id, content, embedding, metadata) "
                f"VALUES (%s, %s, %s::vector, %s::jsonb) "
                f"ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, "
                f"embedding=EXCLUDED.embedding, metadata=EXCLUDED.metadata",
                rows,
            )
        self._conn.commit()
        logger.debug("Inserted %d vectors into pgvector", len(rows))

    @staticmethod
    def _flatten_meta(meta: dict) -> dict:
        flat = {}
        for k, v in meta.items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                flat[k] = v if v is not None else ""
            else:
                flat[k] = str(v)
        return flat

    # ── read ──────────────────────────────────────────────────────────────────

    def get_all(self, where: dict | None = None, limit: int = 2000):
        """Return (documents, metadatas) for BM25 corpus building."""
        where_sql, params = _where_to_sql(where)
        query = f"SELECT content, metadata FROM {TABLE} {where_sql} LIMIT %s"
        with self._conn.cursor() as cur:
            cur.execute(query, params + [limit])
            rows = cur.fetchall()
        docs  = [r[0] for r in rows]
        metas = [r[1] for r in rows]  # psycopg3 returns JSONB as dict already
        return docs, metas

    def similarity_search_with_score(
        self,
        query: str,
        k: int = 10,
        filter: dict | None = None,
    ) -> list[tuple[Document, float]]:
        """Embed query, cosine search via pgvector, return (Document, score) pairs."""
        q_vec = np.array(self._embeddings.embed_query(query), dtype=np.float32).tolist()

        where_sql, params = _where_to_sql(filter)
        # 1 - cosine_distance = cosine_similarity
        query_sql = f"""
            SELECT content, metadata, 1 - (embedding <=> %s::vector) AS score
            FROM {TABLE}
            {where_sql}
            ORDER BY embedding <=> %s::vector
            LIMIT %s
        """
        with self._conn.cursor() as cur:
            cur.execute(query_sql, [q_vec] + params + [q_vec, k])
            rows = cur.fetchall()

        return [
            (Document(page_content=r[0], metadata=r[1]), float(r[2]))
            for r in rows
        ]

    def count(self) -> int:
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {TABLE}")
            return cur.fetchone()[0]

    def delete_collection(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(f"DELETE FROM {TABLE}")
        self._conn.commit()
        logger.info("Deleted all rows from %s", TABLE)

    def close(self) -> None:
        self._conn.close()


# ── factory with SQLite fallback ──────────────────────────────────────────────

def get_vector_store(embedding_function=None, sqlite_fallback_path: Path | None = None):
    """
    Try to connect to pgvector. Falls back to SQLiteVectorStore if unavailable.
    """
    try:
        store = PGVectorStore(dsn=_DSN, embedding_function=embedding_function)
        logger.info("Vector store: pgvector (PostgreSQL)")
        return store
    except Exception as e:
        logger.warning("pgvector unavailable (%s) — falling back to SQLiteVectorStore", e)
        from sqlite_vec_store import SQLiteVectorStore
        from pathlib import Path
        fb_path = sqlite_fallback_path or (Path(__file__).parent.parent / "data" / "vectors.db")
        store = SQLiteVectorStore(
            db_path=fb_path,
            collection_name="mm_rag_pipeline",
            embedding_function=embedding_function,
        )
        logger.info("Vector store: SQLiteVectorStore (fallback)")
        return store
