# Arivonriyam (அறிவொன்றியம்)

An AI-powered Tamil/English primary-school tutoring platform with Socratic dialogue and RAG-backed lesson plans. pnpm monorepo with SvelteKit frontend, Express backend, and a Python ingestion pipeline.

## Stack

| Layer         | Technology                                          |
| ------------- | --------------------------------------------------- |
| Frontend      | SvelteKit v2, Svelte 5, Tailwind CSS v4, shadcn-svelte |
| Backend       | Express v5, TypeScript, tsx                         |
| AI / LLM      | Ollama (local) — `gemma4:latest`                    |
| RAG DB        | PostgreSQL 17 + pgvector 0.8 (HNSW cosine index)   |
| Embeddings    | BAAI/bge-m3 via sentence-transformers (CPU, 1024-dim) |
| Ingestion     | Python (uv) — Unstructured, BM25 hybrid retrieval  |
| App DB        | SQLite via bun:sqlite                               |
| Tooling       | pnpm workspaces, ESLint, Prettier, uv               |

## Project Structure

```
.
├── packages/
│   ├── client/       # SvelteKit app
│   ├── server/       # Express API + RAG repository
│   ├── ingestion/    # Python RAG pipeline (uv)
│   └── whisper.cpp/  # Speech-to-text (submodule)
├── package.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js 20+, pnpm 10+
- [Ollama](https://ollama.com/) running locally on port `11434` with `gemma4:latest` pulled
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [Postgres.app](https://postgresapp.com/) or PostgreSQL 17 with pgvector 0.8+

## Setup

### 1. Node dependencies
```sh
pnpm install
```

### 2. PostgreSQL + pgvector
The RAG pipeline stores embeddings in PostgreSQL. Postgres.app already includes pgvector.

```sh
psql -U $USER -c "CREATE DATABASE arivonriyam_rag;"
psql -U $USER -d arivonriyam_rag -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Set the connection string in `packages/ingestion/.env`:
```
PG_DSN=postgresql://<your-user>@localhost/arivonriyam_rag
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

### 3. Ingestion Python environment
```sh
cd packages/ingestion
uv sync
```

### 4. Ingest PDFs
PDFs must be placed under `packages/ingestion/data/pdfs/<class>/<subject>.pdf`.
Example: `data/pdfs/class3/Science.pdf`

```sh
cd packages/ingestion
uv run python src/main.py ingest          # fast (no LLM question generation)
uv run python src/main.py ingest --force  # re-ingest even if unchanged
```

> **Note:** `--no-questions` is the default. Add `--questions` only if you want
> Ollama to generate a hypothetical question per chunk (~10–60 s per chunk extra).

## Development

```sh
pnpm dev          # client + server concurrently
pnpm dev:client   # SvelteKit on http://localhost:5173
pnpm dev:server   # Express on http://localhost:9012
```

Vite proxies `/api/*` to Express — no CORS issues in dev.

## Production

```sh
pnpm build   # builds packages/client → packages/client/build/
pnpm start   # Express serves static build + API on :9012
```

## Ingestion Pipeline

```
PDF
 │
 ├─ 1. partition   — Unstructured "auto" strategy (fast for digital PDFs,
 │                   OCR fallback for scanned pages). Languages: eng + tam.
 │
 ├─ 2. preprocess  — OCR noise cleanup, structural tagging (definition /
 │                   theorem / example / formula / table / body),
 │                   Tamil/English language detection per element.
 │
 ├─ 3. chunk       — Semantic chunking: atomic types (definition, formula)
 │                   kept whole; narrative text split with sentence-aligned
 │                   sliding window. Definitions also get a micro-chunk copy.
 │
 ├─ 4. enrich      — (optional) Ollama generates one hypothetical question
 │                   per chunk in its dominant language for HyDE retrieval.
 │
 ├─ 5. postprocess — Dedup by chunk hash, quality filtering.
 │
 └─ 6. store       — BGE-M3 embeds all chunks in one pass →
                     pgvector (PostgreSQL HNSW index, cosine similarity).
                     Falls back to SQLiteVectorStore if Postgres is unreachable.
```

## Retrieval

Each lesson-plan or Socratic session query goes through:

1. **HyDE expansion** — Ollama generates a short plausible answer to use as the
   search document (cached per query within the process lifetime).
2. **Dense search** — pgvector HNSW cosine search (BGE-M3, top-K candidates).
3. **Sparse BM25** — built lazily from the full corpus on first retrieval call.
4. **RRF fusion** — Reciprocal Rank Fusion merges dense + sparse ranked lists.
5. **Dedup** — final result deduplicated by `chunk_hash`.

CLI usage (also called internally by the Node.js subprocess):
```sh
cd packages/ingestion
uv run python src/main.py retrieve       --class class3 --subject Science --chapter "Living World" --top-k 8
uv run python src/main.py retrieve-topic --class class3 --subject Science --topic "photosynthesis" --top-k 6
uv run python src/main.py query "What is photosynthesis?"
```

## Data Layout

```
packages/ingestion/
├── data/
│   ├── pdfs/          # Source PDFs  — <class>/<subject>.pdf
│   └── arivonriyam.db # SQLite app DB (ingestion log, chapter manifest)
│                      # Vector data lives in PostgreSQL (arivonriyam_rag)
├── src/
│   ├── main.py          # CLI entry point
│   ├── ingest.py        # Pipeline orchestrator
│   ├── pgvec_store.py   # pgvector store + SQLite fallback
│   ├── sqlite_vec_store.py  # SQLite fallback vector store
│   ├── retriever.py     # HybridRetriever (dense + BM25 + RRF)
│   ├── retrieve.py      # CLI wrapper for Node.js subprocess calls
│   ├── embeddings.py    # BGE-M3 singleton (CPU — MPS stalls on ColBERT head)
│   ├── preprocessor.py  # Text cleaning + structural tagging
│   ├── chunker.py       # Semantic chunker
│   ├── metadata_enricher.py  # Optional LLM question generation
│   ├── postprocessor.py # Dedup + quality filter
│   ├── schema.py        # ElementType, ChunkMeta, CHUNK_CONFIG
│   └── utils/           # language_detect, math_utils, text_utils
└── .env                 # PG_DSN, HF_HUB_OFFLINE, TRANSFORMERS_OFFLINE
```

## Key Notes

- **No ChromaDB** — removed. pgvector is the primary store; SQLiteVectorStore
  is the automatic fallback (no config needed).
- **BGE-M3 forced to CPU** — Apple MPS stalls indefinitely on the ColBERT head.
  CPU is ~40s for 85 chunks; this is expected.
- **Tamil + English** — all prompts, chunking, and retrieval are bilingual.
  Dominant language is detected per element and stored in metadata.
- **Offline mode** — `HF_HUB_OFFLINE=1` prevents any HuggingFace network calls
  after the model is cached locally.
