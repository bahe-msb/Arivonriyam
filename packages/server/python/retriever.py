from __future__ import annotations

import argparse
import json
from pathlib import Path

from chromadb import PersistentClient
from fastembed import TextEmbedding

from common import normalize_text


def retrieve(
    data_root: Path,
    collection_name: str,
    embedding_model_name: str,
    grade: str,
    subject: str,
    query: str,
    top_k: int,
) -> dict[str, object]:
    chroma_root = data_root / "chroma"
    client = PersistentClient(path=str(chroma_root))
    collection = client.get_collection(collection_name)
    model = TextEmbedding(model_name=embedding_model_name)

    normalized_query = normalize_text(query)
    query_vector = list(model.embed([normalized_query]))[0].tolist()

    response = collection.query(
        query_embeddings=[query_vector],
        n_results=max(top_k, 6),
        where={
            "$and": [
                {"grade": {"$eq": grade}},
                {"subject": {"$eq": subject.lower()}},
            ]
        },
        include=["documents", "metadatas", "distances"],
    )

    documents = response.get("documents", [[]])[0]
    metadatas = response.get("metadatas", [[]])[0]
    distances = response.get("distances", [[]])[0]

    rows: list[dict[str, object]] = []
    for index, text in enumerate(documents):
        distance = float(distances[index]) if index < len(distances) else 1.0
        similarity = max(0.0, 1.0 - distance)
        metadata = metadatas[index] if index < len(metadatas) else {}
        rows.append(
            {
                "text": text,
                "score": round(similarity, 6),
                "grade": metadata.get("grade"),
                "subject": metadata.get("subject"),
                "chapter": metadata.get("chapter"),
                "page": metadata.get("page"),
                "language": metadata.get("language"),
                "source_file": metadata.get("source_file"),
            }
        )

    rows.sort(key=lambda item: float(item["score"]), reverse=True)
    return {"ok": True, "query": normalized_query, "results": rows[:top_k]}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Retrieve top textbook chunks by grade and subject")
    parser.add_argument("--grade", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--data-root", default="../data")
    parser.add_argument("--collection", default="arivondum_textbooks_v1")
    parser.add_argument(
        "--embedding-model",
        default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    payload = retrieve(
        data_root=Path(args.data_root).resolve(),
        collection_name=args.collection,
        embedding_model_name=args.embedding_model,
        grade=str(args.grade),
        subject=str(args.subject),
        query=str(args.query),
        top_k=max(1, int(args.top_k)),
    )
    print(json.dumps(payload, ensure_ascii=False))
