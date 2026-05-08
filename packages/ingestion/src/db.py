"""PostgreSQL persistence — ingestion_log, manifest, pdf_images.

Replaces the previous SQLite implementation. All state lives in PostgreSQL.
Connection string read from PG_DSN env var (default: postgresql://localhost/arivonriyam_rag).
"""

import logging
import os
from datetime import datetime, timezone
from typing import List

logger = logging.getLogger(__name__)

_DSN = os.environ.get("PG_DSN", "postgresql://localhost/arivonriyam_rag")


def _conn():
    import psycopg
    return psycopg.connect(_DSN, autocommit=False)


def init_db() -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ingestion_log (
                    id          SERIAL PRIMARY KEY,
                    class_name  TEXT NOT NULL,
                    subject     TEXT NOT NULL,
                    source_file TEXT NOT NULL,
                    chunk_count INTEGER DEFAULT 0,
                    ingested_at TEXT NOT NULL,
                    file_hash   TEXT DEFAULT '',
                    UNIQUE(class_name, subject, source_file)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS manifest (
                    id            SERIAL PRIMARY KEY,
                    class_name    TEXT NOT NULL,
                    subject       TEXT NOT NULL,
                    chapter       TEXT NOT NULL,
                    chapter_order INTEGER DEFAULT 0,
                    UNIQUE(class_name, subject, chapter)
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_manifest_lookup
                    ON manifest(class_name, subject)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS pdf_images (
                    id          SERIAL PRIMARY KEY,
                    class_name  TEXT NOT NULL,
                    subject     TEXT NOT NULL,
                    source_file TEXT NOT NULL,
                    page_number INTEGER NOT NULL,
                    img_index   INTEGER NOT NULL DEFAULT 0,
                    width       INTEGER NOT NULL DEFAULT 0,
                    height      INTEGER NOT NULL DEFAULT 0,
                    image_b64   TEXT NOT NULL,
                    UNIQUE(class_name, subject, source_file, page_number, img_index)
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_pdf_images_lookup
                    ON pdf_images(class_name, subject, page_number)
            """)
        conn.commit()
    logger.info("PostgreSQL schema ready (ingestion_log, manifest, pdf_images)")


def log_ingestion(
    class_name: str,
    subject: str,
    source_file: str,
    chunk_count: int,
    file_hash: str = "",
) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ingestion_log
                    (class_name, subject, source_file, chunk_count, ingested_at, file_hash)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (class_name, subject, source_file) DO UPDATE SET
                    chunk_count = EXCLUDED.chunk_count,
                    ingested_at = EXCLUDED.ingested_at,
                    file_hash   = EXCLUDED.file_hash
            """, (
                class_name, subject, source_file, chunk_count,
                datetime.now(timezone.utc).isoformat(), file_hash,
            ))
        conn.commit()


def upsert_chapters(class_name: str, subject: str, chapters: List[str]) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM manifest WHERE class_name = %s AND subject = %s",
                (class_name, subject),
            )
            cur.executemany(
                """INSERT INTO manifest (class_name, subject, chapter, chapter_order)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (class_name, subject, chapter) DO NOTHING""",
                [(class_name, subject, ch, i) for i, ch in enumerate(chapters)],
            )
        conn.commit()


def get_chapters(class_name: str, subject: str) -> List[str]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT chapter FROM manifest WHERE class_name=%s AND subject=%s ORDER BY chapter_order",
                (class_name, subject),
            )
            rows = cur.fetchall()
    return [r[0] for r in rows]


def get_subjects(class_name: str) -> List[str]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT subject FROM manifest WHERE class_name=%s ORDER BY subject",
                (class_name,),
            )
            rows = cur.fetchall()
    return [r[0] for r in rows]


def upsert_pdf_images(
    class_name: str,
    subject: str,
    source_file: str,
    images: list[dict],
) -> None:
    """Store extracted page images. Each dict: {page_number, img_index, width, height, image_b64}."""
    if not images:
        return
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM pdf_images WHERE class_name=%s AND subject=%s AND source_file=%s",
                (class_name, subject, source_file),
            )
            cur.executemany(
                """INSERT INTO pdf_images
                   (class_name, subject, source_file, page_number, img_index, width, height, image_b64)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (class_name, subject, source_file, page_number, img_index) DO UPDATE SET
                       image_b64 = EXCLUDED.image_b64,
                       width = EXCLUDED.width,
                       height = EXCLUDED.height""",
                [
                    (class_name, subject, source_file,
                     img["page_number"], img["img_index"],
                     img["width"], img["height"], img["image_b64"])
                    for img in images
                ],
            )
        conn.commit()


def get_page_images(
    class_name: str,
    subject: str,
    page_numbers: list[int],
    limit: int = 6,
) -> list[dict]:
    """Retrieve base64 images for given pages, largest first, up to limit."""
    if not page_numbers:
        return []
    placeholders = ",".join(["%s"] * len(page_numbers))
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT page_number, img_index, width, height, image_b64
                    FROM pdf_images
                    WHERE class_name=%s AND subject=%s AND page_number IN ({placeholders})
                    ORDER BY (width * height) DESC
                    LIMIT %s""",
                [class_name, subject, *page_numbers, limit],
            )
            rows = cur.fetchall()
    return [
        {"page_number": r[0], "img_index": r[1], "width": r[2], "height": r[3], "image_b64": r[4]}
        for r in rows
    ]


def is_ingested(class_name: str, subject: str, source_file: str, file_hash: str) -> bool:
    if not file_hash:
        return False
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM ingestion_log WHERE class_name=%s AND subject=%s AND source_file=%s AND file_hash=%s",
                (class_name, subject, source_file, file_hash),
            )
            row = cur.fetchone()
    return row is not None
