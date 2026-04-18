from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import fitz
from chromadb import PersistentClient
from fastembed import TextEmbedding

from common import build_chunk_id, discover_jobs, normalize_text, split_chunks


def ingest(data_root: Path, collection_name: str, model_name: str) -> None:
    raw_root = data_root / "raw"
    chroma_root = data_root / "chroma"
    chroma_root.mkdir(parents=True, exist_ok=True)

    client = PersistentClient(path=str(chroma_root))
    collection = client.get_or_create_collection(collection_name)
    embedding_model = TextEmbedding(model_name=model_name)

    totals = {
        "pdfs": 0,
        "pages": 0,
        "pages_with_text": 0,
        "pages_empty": 0,
        "characters": 0,
        "chunks": 0,
        "failed": [],
    }
    start = time.time()

    for grade, subject, pdf_path in discover_jobs(raw_root):
        totals["pdfs"] += 1
        print(f"[INGEST] {pdf_path.name} grade={grade} subject={subject}")

        try:
            doc = fitz.open(pdf_path)
            file_chunk_count = 0
            file_pages = 0
            file_pages_with_text = 0
            file_pages_empty = 0
            file_characters = 0

            for page_no, page in enumerate(doc, start=1):
                totals["pages"] += 1
                file_pages += 1
                original = page.get_text("text") or ""
                normalized = normalize_text(original)
                if not normalized:
                    totals["pages_empty"] += 1
                    file_pages_empty += 1
                    continue

                totals["pages_with_text"] += 1
                file_pages_with_text += 1
                totals["characters"] += len(normalized)
                file_characters += len(normalized)

                chunks = split_chunks(normalized, chunk_size=500, chunk_overlap=100)
                if not chunks:
                    continue

                embeddings = list(embedding_model.embed(chunks))
                ids = [build_chunk_id(pdf_path, page_no, idx, chunk) for idx, chunk in enumerate(chunks)]
                metadatas = [
                    {
                        "grade": grade,
                        "subject": subject,
                        "chapter": "unknown",
                        "page": page_no,
                        "language": "ta",
                        "source_file": pdf_path.name,
                        "textbook_board": "official_textbook",
                    }
                    for _ in chunks
                ]

                collection.upsert(
                    ids=ids,
                    documents=chunks,
                    metadatas=metadatas,
                    embeddings=[embedding.tolist() for embedding in embeddings],
                )
                file_chunk_count += len(chunks)
                totals["chunks"] += len(chunks)

            doc.close()
            print(
                f"[DONE] {pdf_path.name} pages={file_pages} text_pages={file_pages_with_text} "
                f"empty_pages={file_pages_empty} chars={file_characters} chunks={file_chunk_count}"
            )

            if file_pages > 0 and file_pages_with_text / file_pages < 0.2:
                print(
                    f"[WARN] {pdf_path.name}: very low text extraction rate. "
                    "This PDF is likely scanned/image-only. OCR is required for good chunking."
                )
        except Exception as exc:  # pragma: no cover
            totals["failed"].append({"file": str(pdf_path), "error": str(exc)})
            print(f"[FAIL] {pdf_path.name}: {exc}")

    elapsed = round(time.time() - start, 2)
    print("\n=== Ingest Summary ===")
    print(json.dumps({**totals, "elapsed_seconds": elapsed}, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Offline textbook ingestion into ChromaDB")
    parser.add_argument("--data-root", default="../data", help="Path to data folder containing raw/chroma")
    parser.add_argument("--collection", default="arivondum_textbooks_v1", help="Collection name")
    parser.add_argument(
        "--embedding-model",
        default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        help="FastEmbed model name",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    ingest(Path(args.data_root).resolve(), args.collection, args.embedding_model)
