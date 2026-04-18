from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Iterable

DIGIT_MAP = str.maketrans(
    {
        "௦": "0",
        "௧": "1",
        "௨": "2",
        "௩": "3",
        "௪": "4",
        "௫": "5",
        "௬": "6",
        "௭": "7",
        "௮": "8",
        "௯": "9",
        "०": "0",
        "१": "1",
        "२": "2",
        "३": "3",
        "४": "4",
        "५": "5",
        "६": "6",
        "७": "7",
        "८": "8",
        "९": "9",
    }
)


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = normalized.translate(DIGIT_MAP)
    normalized = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


# Chunking strategy: split into 500 character chunks with 100 character overlap, trying to split at natural boundaries like newlines or punctuation.
def split_chunks(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    if len(text) <= chunk_size:
        return [text] if text else []

    separators = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "]
    chunks: list[str] = []
    cursor = 0

    while cursor < len(text):
        hard_end = min(cursor + chunk_size, len(text))
        if hard_end == len(text):
            chunks.append(text[cursor:].strip())
            break

        cut = -1
        window = text[cursor:hard_end]
        for sep in separators:
            idx = window.rfind(sep)
            if idx > 0:
                cut = cursor + idx + len(sep)
                break

        if cut <= cursor:
            cut = hard_end

        chunks.append(text[cursor:cut].strip())
        cursor = max(cut - chunk_overlap, cursor + 1)

    return [chunk for chunk in chunks if chunk]


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
