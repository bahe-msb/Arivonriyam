# Arivonriyam (அறிவொன்றியம்)

An AI-powered Tamil/English/Telugu primary-school tutoring platform with Socratic dialogue and RAG-backed lesson plans. pnpm monorepo with SvelteKit frontend, Express backend, and a Python ingestion pipeline. Powered by 7 coordinated Gemma 4 agents with multi-language prompting and persistent reteach state tracking.

## Stack

| Layer      | Technology                                                                 |
| ---------- | -------------------------------------------------------------------------- |
| Frontend   | SvelteKit v2, Svelte 5, Tailwind CSS v4, shadcn-svelte                     |
| Backend    | Express v5, TypeScript, tsx; multi-language prompts (Tamil/English/Telugu) |
| AI / LLM   | Ollama (local) — `gemma4:latest`; 7 coordinated agents                     |
| RAG DB     | PostgreSQL 17 + pgvector 0.8 (HNSW cosine index)                           |
| Embeddings | BAAI/bge-m3 via sentence-transformers (CPU, 1024-dim)                      |
| Ingestion  | Python (uv) — Unstructured, BM25 hybrid retrieval                          |
| App DB     | SQLite via bun:sqlite; persistent reteach state & topic selection          |
| Tooling    | pnpm workspaces, ESLint, Prettier, uv                                      |

## Project Structure

```
.
├── packages/
│   ├── client/       # SvelteKit app
│   ├── server/       # Express API + RAG repository + multi-language Socratic prompts
│   ├── ingestion/    # Python RAG pipeline (uv)
│   └── whisper.cpp/  # Speech-to-text (submodule)
├── package.json
└── pnpm-workspace.yaml
```

## Key Features

- **7 Coordinated Gemma 4 Agents** — All agents powered by Gemma 4 (vision + text):
  1. **Image Understanding** (Gemma 4 Vision) — Caption diagrams/charts in PDFs
  2. **Question Generation** — Create hypothetical questions per chunk for HyDE retrieval
  3. **Socratic Dialogue** — Answer student questions with follow-up prompts (Tamil/English/Telugu)
  4. **Answer Analysis** — Evaluate student responses for mastery/misconception tracking
  5. **Reteach Planning** — Generate intervention lessons on detected misconceptions
  6. **Lesson Blueprints** — Multi-turn dialogue for introducing new topics
  7. **Performance Analytics** — Analyze learning patterns across sessions
- **Multi-Language Socratic Prompts** — Tamil, English, and Telugu with culturally-appropriate classroom language (see `packages/server/src/prompts/socratic.prompts.ts`)
- **Persistent Reteach State** — Daily tracking of student misconceptions across sessions via SQLite
- **Topic Selection & Persistence** — Students browse class-level curriculum with persistent selection state
- **Hybrid RAG Retrieval** — Dense (pgvector HNSW) + sparse (BM25) with RRF fusion for accurate curriculum-grounded responses
- **Offline-First Architecture** — Local Gemma 4 (text + vision) + SQLite fallback for rural schools with intermittent internet

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

### 2. Ingestion + RAG setup

Use **[packages/ingestion/README.md](packages/ingestion/README.md)** :

- PostgreSQL + pgvector setup
- `packages/ingestion/.env` variables
- `uv sync` environment setup
- PDF placement and all ingest/retrieve/summarize/query/benchmark commands

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

## Ingestion & Retrieval Docs

To keep this root README DRY, ingestion and retrieval operations are documented in one place:

- **Canonical guide**: [packages/ingestion/README.md](packages/ingestion/README.md)
  (setup, env vars, ingest/retrieve/summarize/query commands, benchmark, troubleshooting, data layout)
- **Latest class_3 Social benchmark output**: [packages/ingestion/rag_benchmark_class3.md](packages/ingestion/rag_benchmark_class3.md)

## Gemma 4 Vision & Multi-Modal Configuration

Gemma 4 handles two distinct tasks:

1. **Image Captioning** (at ingest time)
   - Captions diagrams/charts found in PDFs during ingestion.
   - Captions are stored in `pdf_images` and returned with retrieval results when relevant.

2. **Text-Based Agents** (all runtime operations)
   - Socratic dialogue, answer analysis, lesson planning, question generation
   - Gemma 4 text model configured via `ChatOllama(model="gemma4:latest")`
   - Language selection per request: Tamil (`ta`), English (`en`), Telugu (`te`)

Both use **Ollama** running locally on port `11434`.

For ingestion-specific commands (including caption backfill/migration), use [packages/ingestion/README.md](packages/ingestion/README.md).

Ensure `gemma4:latest` is pulled:

```sh
ollama pull gemma4:latest
```

## Key Notes

- **Multi-language operation** — Prompts and tutoring flows support Tamil, English, and Telugu.
- **Offline-first deployment** — Local Ollama + local databases support low-connectivity environments.
- **Ingestion runtime details** — Keep all ingestion-specific operational notes in [packages/ingestion/README.md](packages/ingestion/README.md).
