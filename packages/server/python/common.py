from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Iterable

import tiktoken


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


# Chunking strategy: split into token chunks with overlap for better retrieval consistency.
def split_chunks(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    text = text.strip()
    if not text:
        return []

    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    encoding = tiktoken.get_encoding("cl100k_base")
    token_ids = encoding.encode(text)
    if len(token_ids) <= chunk_size:
        return [text]

    stride = chunk_size - chunk_overlap
    chunks: list[str] = []
    cursor = 0
    while cursor < len(token_ids):
        hard_end = min(cursor + chunk_size, len(token_ids))
        chunk = encoding.decode(token_ids[cursor:hard_end]).strip()
        if chunk:
            chunks.append(chunk)

        if hard_end == len(token_ids):
            break
        cursor += stride

    return chunks


def discover_jobs(raw_root: Path) -> Iterable[tuple[str, str, Path]]:
    for grade_dir in sorted(raw_root.glob("grade*")):
        grade = grade_dir.name.replace("grade", "")
        for subject_dir in sorted(grade_dir.iterdir()):
            if not subject_dir.is_dir():
                continue
            subject = subject_dir.name.lower()
            for pdf_path in sorted(subject_dir.glob("*.pdf")):
                yield grade, subject, pdf_path


def build_chunk_id(pdf_path: Path, page: int, idx: int, chunk: str) -> str:
    digest = hashlib.sha1(chunk.encode("utf-8")).hexdigest()[:12]
    return f"{pdf_path.stem}-p{page}-c{idx}-{digest}"
