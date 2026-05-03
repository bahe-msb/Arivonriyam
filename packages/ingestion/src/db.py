"""SQLite persistence — shared DB at packages/data/arivonriyam.db.

Both Python (ingestion) and Node.js (server) open the same file.
Python owns: ingestion_log, manifest
Node.js owns: plans
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import List

# packages/data/arivonriyam.db  (two levels up from packages/ingestion/src/)
DB_PATH = Path(__file__).parent.parent.parent / "data" / "arivonriyam.db"


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ingestion_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                class_name   TEXT NOT NULL,
                subject      TEXT NOT NULL,
                source_file  TEXT NOT NULL,
                chunk_count  INTEGER DEFAULT 0,
                ingested_at  TEXT NOT NULL,
                file_hash    TEXT DEFAULT '',
                UNIQUE(class_name, subject, source_file)
            );

            CREATE TABLE IF NOT EXISTS manifest (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                class_name    TEXT NOT NULL,
                subject       TEXT NOT NULL,
                chapter       TEXT NOT NULL,
                chapter_order INTEGER DEFAULT 0,
                UNIQUE(class_name, subject, chapter)
            );

            CREATE INDEX IF NOT EXISTS idx_manifest_lookup
                ON manifest(class_name, subject);
        """)


def log_ingestion(
    class_name: str,
    subject: str,
    source_file: str,
    chunk_count: int,
    file_hash: str = "",
) -> None:
    with _conn() as conn:
        conn.execute("""
            INSERT INTO ingestion_log
                (class_name, subject, source_file, chunk_count, ingested_at, file_hash)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(class_name, subject, source_file) DO UPDATE SET
                chunk_count = excluded.chunk_count,
                ingested_at = excluded.ingested_at,
                file_hash   = excluded.file_hash
        """, (
            class_name, subject, source_file, chunk_count,
            datetime.now(timezone.utc).isoformat(), file_hash,
        ))


def upsert_chapters(class_name: str, subject: str, chapters: List[str]) -> None:
    with _conn() as conn:
        conn.execute(
            "DELETE FROM manifest WHERE class_name = ? AND subject = ?",
            (class_name, subject),
        )
        conn.executemany(
            "INSERT OR IGNORE INTO manifest (class_name, subject, chapter, chapter_order) VALUES (?,?,?,?)",
            [(class_name, subject, ch, i) for i, ch in enumerate(chapters)],
        )


def get_chapters(class_name: str, subject: str) -> List[str]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT chapter FROM manifest WHERE class_name=? AND subject=? ORDER BY chapter_order",
            (class_name, subject),
        ).fetchall()
    return [r["chapter"] for r in rows]


def get_subjects(class_name: str) -> List[str]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT subject FROM manifest WHERE class_name=? ORDER BY subject",
            (class_name,),
        ).fetchall()
    return [r["subject"] for r in rows]


def is_ingested(class_name: str, subject: str, source_file: str, file_hash: str) -> bool:
    if not file_hash:
        return False
    with _conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM ingestion_log WHERE class_name=? AND subject=? AND source_file=? AND file_hash=?",
            (class_name, subject, source_file, file_hash),
        ).fetchone()
    return row is not None
