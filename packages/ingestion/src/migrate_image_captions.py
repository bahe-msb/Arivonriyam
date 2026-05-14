"""One-off migration: generate Gemma 4 vision captions for images already in pdf_images.

Reads rows where caption IS NULL or empty, calls Gemma 4 vision for each,
and writes the caption back. Safe to re-run — skips rows that already have a caption.

Usage:
    python migrate_image_captions.py
    python migrate_image_captions.py --batch-size 5   # default 10
    python migrate_image_captions.py --dry-run        # count only, no LLM calls
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path

_ENV_FILE = Path(__file__).parent.parent / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                    format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

_DSN = os.environ.get("PG_DSN", "postgresql://localhost/arivonriyam_rag")

_CAPTION_PROMPT = (
    "You are captioning images extracted from a school textbook. "
    "Describe what this diagram or figure illustrates in one concise sentence "
    "that would help a student understand the educational concept it represents."
)


def _get_llm():
    from langchain_ollama import ChatOllama
    return ChatOllama(model="gemma4:latest", temperature=0, timeout=30)


def _caption_one(llm, image_b64: str) -> str:
    from langchain_core.messages import HumanMessage
    content = [
        {"type": "text", "text": _CAPTION_PROMPT},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
    ]
    return llm.invoke([HumanMessage(content=content)]).content.strip()


def ensure_caption_column() -> None:
    import psycopg
    with psycopg.connect(_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE pdf_images ADD COLUMN IF NOT EXISTS caption TEXT DEFAULT ''")
        conn.commit()
    logger.info("caption column ready")


def fetch_uncaptioned(limit: int | None = None) -> list[dict]:
    import psycopg
    sql = """
        SELECT id, class_name, subject, source_file, page_number, img_index, image_b64
        FROM pdf_images
        WHERE caption IS NULL OR caption = ''
        ORDER BY id
    """
    if limit:
        sql += f" LIMIT {limit}"
    with psycopg.connect(_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    return [
        {"id": r[0], "class_name": r[1], "subject": r[2], "source_file": r[3],
         "page_number": r[4], "img_index": r[5], "image_b64": r[6]}
        for r in rows
    ]


def write_caption(row_id: int, caption: str) -> None:
    import psycopg
    with psycopg.connect(_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE pdf_images SET caption = %s WHERE id = %s", (caption, row_id))
        conn.commit()


def run(batch_size: int = 10, dry_run: bool = False) -> None:
    ensure_caption_column()
    rows = fetch_uncaptioned()
    total = len(rows)
    logger.info("Found %d images without captions", total)

    if total == 0:
        logger.info("Nothing to do.")
        return

    if dry_run:
        logger.info("Dry run — exiting without calling Gemma 4.")
        return

    llm = _get_llm()
    ok = 0
    failed = 0
    t_start = time.time()

    for i, row in enumerate(rows, 1):
        label = f"{row['class_name']}/{row['subject']} p{row['page_number']} img{row['img_index']}"
        try:
            t0 = time.time()
            caption = _caption_one(llm, row["image_b64"])
            write_caption(row["id"], caption)
            elapsed = time.time() - t0
            logger.info("[%d/%d] %s → %s (%.1fs)", i, total, label, caption[:80], elapsed)
            ok += 1
        except Exception as e:
            logger.warning("[%d/%d] %s FAILED: %s", i, total, label, e)
            failed += 1

        if i % batch_size == 0:
            rate = i / (time.time() - t_start)
            remaining = (total - i) / rate if rate > 0 else 0
            logger.info("Progress: %d/%d done — ~%.0fs remaining", i, total, remaining)

    logger.info(
        "Done: %d captioned, %d failed — total %.1fs",
        ok, failed, time.time() - t_start,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill Gemma 4 vision captions for pdf_images")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true", help="Count rows only, no LLM calls")
    args = parser.parse_args()
    run(batch_size=args.batch_size, dry_run=args.dry_run)
