# Ingestion & Retrieval Pipeline

The ingestion pipeline extracts content from SCERT textbooks, structures it semantically, embeds it with BGE-M3, and stores it in PostgreSQL with pgvector for hybrid retrieval (dense + BM25 + RRF).

---

## Quick Start

### 1. Setup PostgreSQL

```bash
psql -U $USER -c "CREATE DATABASE arivonriyam_rag;"
psql -U $USER -d arivonriyam_rag -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 2. Pre-download ML Models (One-time, Required for Offline Deployment)

**Why:** Arivonriyam is designed for offline-first deployment (rural areas with intermittent internet). All ML models must be cached locally before first use.

```bash
cd packages/ingestion
uv run python download_models.py
```

**What gets downloaded:**

- **YOLO Layout Detection** (2 models, ~200 MB) — Detects document structure (text blocks, tables, figures)
- **Table Transformer** (~1.2 GB) — Recognizes table structure in PDFs
- **BGE-M3 Embeddings** (~2.3 GB) — Multilingual embeddings for Tamil/English text

**Output:** Models cached to `~/.cache/huggingface/hub/`

**To deploy on an offline machine:**

```bash
# On internet-connected machine: run download_models.py (creates ~/.cache/huggingface/hub/)
# Copy that directory to offline machine at the same path:
rsync -av ~/.cache/huggingface/hub/ user@offline-machine:~/.cache/huggingface/hub/

# On offline machine: set environment variables
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
```

### 3. Configure environment

```bash
cd packages/ingestion
# Create .env with PostgreSQL connection string
echo "PG_DSN=postgresql://<your-user>@localhost/arivonriyam_rag" > .env
echo "HF_HUB_OFFLINE=1" >> .env
echo "TRANSFORMERS_OFFLINE=1" >> .env
```

### 4. Install Python dependencies

```bash
uv sync
```

### 5. Place PDFs

```
packages/ingestion/data/pdfs/
├── class_3/
│   ├── Science.pdf
│   ├── Maths.pdf
│   └── Tamil.pdf
├── class_4/
│   ├── Science.pdf
│   └── ...
└── ...
```

---

## Commands

### Ingest PDFs

**Ingest all PDFs (default: Ollama question generation ON)**

```bash
uv run python src/main.py ingest
```

**Ingest one class only**

```bash
uv run python src/main.py ingest --class class_4
```

**Force re-ingest (ignores file hash, always processes)**

```bash
uv run python src/main.py ingest --force
```

**Skip Ollama question generation** (faster ingestion)

```bash
uv run python src/main.py ingest --no-questions
```

> **Output**: Chunks stored in PostgreSQL `rag_chunks` table with HNSW index.
> Metadata stored in `ingestion_log` (file hash), `manifest` (chapters), `pdf_images` (diagrams + captions).

Benchmark commands are listed in the **Retrieval Benchmark** section below.

---

### Retrieve

**Chapter-scoped retrieval** (for lesson-plan blueprint generation)

```bash
uv run python src/main.py retrieve \
  --class class_4 \
  --subject Science \
  --chapter "Living World" \
  --top-k 8
```

**Topic-wide retrieval** (for Socratic session summarization)

```bash
uv run python src/main.py retrieve-topic \
  --class class_4 \
  --subject Science \
  --topic photosynthesis \
  --top-k 6
```

> **Output**: JSON array of chunks (text, score, chapter, page, images, language).
> Uses HyDE expansion + hybrid retrieval (pgvector + BM25 + RRF).

---

### Summarize Topic

Generate a teacher-friendly intro for a Socratic session (2–3 min read).

```bash
uv run python src/main.py summarize \
  --class class_4 \
  --subject Science \
  --topic "water cycle" \
  --lang ta \
  --top-k 12
```

Supported languages: `ta` (Tamil), `te` (Telugu), `en` (English).

> **Output**: Plain text (teacher introduction to a topic, grounded in curriculum).

---

### Query (Interactive)

Ask a free-form question (retrieval + Ollama response).

```bash
uv run python src/main.py query "What is photosynthesis?"
uv run python src/main.py query "ஒளிச்சேர்க்கை என்றால் என்ன?"
```

> **Output**: Plain text answer (context-grounded, if PDFs are ingested).

---

## Retrieval Benchmark

The submission benchmark is explicitly scoped to the chosen demo slice: `class_3` Social.

```bash
uv run python src/benchmark_retrieval.py --class class_3 --subject Social --out rag_benchmark_class3.md
```

> **Output**: Markdown table with Hit@1, Hit@5, MRR@5, nDCG@5, and latency metrics.
> This writes the judge-facing artifact to `packages/ingestion/rag_benchmark_class3.md`.
> The committed Social query set is aligned to the current class_3 Social corpus: `வியக்க வைக்கும் கிராமம்`, `கிராம சபை`, `ஊராட்சி`, `பஞ்சாயத்து ராஜ்`, and `நகராட்சி`.
> Re-run this exact command after changing `packages/ingestion/data/pdfs/class_3/Social.pdf` or `SOCIAL_TAMIL_QUERIES`.

---

## Data Layout

```
packages/ingestion/
├── download_models.py          One-time model pre-download (YOLO + Table Transformer + BGE-M3)
├── src/
│   ├── main.py                 CLI entry point
│   ├── ingest.py               Pipeline orchestrator (7 stages)
│   ├── retrieve.py             Retrieval + HyDE expansion
│   ├── retriever.py            Hybrid retriever (dense + sparse + RRF)
│   ├── summarize.py            Topic summarization
│   ├── benchmark_retrieval.py  Retrieval benchmark (diverse query sets + nDCG)
│   ├── pgvec_store.py          pgvector + HNSW wrapper
│   ├── embeddings.py           BGE-M3 singleton (1024-dim)
│   ├── preprocessor.py         OCR cleanup + element typing
│   ├── chunker.py              Semantic chunking
│   ├── metadata_enricher.py    Metadata + LLM question generation
│   ├── postprocessor.py        Quality filter + dedup
│   ├── db.py                   PostgreSQL persistence
│   ├── schema.py               Shared types + config
│   └── utils/
│       ├── language_detect.py
│       ├── text_utils.py       Tamil OCR artifact removal
│       └── math_utils.py       Math expression detection
│
├── data/
│   ├── pdfs/                   Source textbooks
│   │   ├── class_3/
│   │   ├── class_4/
│   │   └── ...
│   └── .env                    PG_DSN override
│
├── pyproject.toml              uv dependencies
├── uv.lock                     Lock file
└── README.md                   This file
```

---

## Pipeline Overview

```
PDF
 │
 ├─ 1. Partition    — Extract text + images (Unstructured)
 ├─ 2. Preprocess   — OCR cleanup, element typing, language detection
 ├─ 3. Chunk        — Semantic splitting (4-level strategy)
 ├─ 4. Enrich       — Metadata + optional LLM question generation
 ├─ 5. Postprocess  — Quality filter, dedup, normalization
 ├─ 6. Store        — BGE-M3 embed → pgvector (PostgreSQL)
 └─ 7. Log          — Record file hash + chapters in PostgreSQL
                      ↓
                PostgreSQL
                  ├── rag_chunks table
                  ├── ingestion_log
                  ├── manifest
                  └── pdf_images
```

**Key Design Decisions**:

- **Partition strategy**: `auto` (fast for digital PDFs, OCR fallback for scans)
- **Languages**: English + Tamil (Tesseract)
- **Element types**: Definition, Theorem, Example, Exercise, Summary, Table, Formula, Body
- **Chunking**: Atomic types kept whole; narrative text split with sentence alignment
- **Embedding**: BGE-M3 (1024-dim, multilingual, same model for all languages)
- **Storage**: PostgreSQL pgvector with HNSW index (cosine similarity)
- **Retrieval**: Dense (pgvector) + Sparse (BM25) fused via RRF, deduplicated by Jaccard

---

## Environment Variables

| Variable               | Default                                  | Purpose                               |
| ---------------------- | ---------------------------------------- | ------------------------------------- |
| `PG_DSN`               | `postgresql://localhost/arivonriyam_rag` | PostgreSQL connection                 |
| `HF_HUB_OFFLINE`       | `1`                                      | Offline mode (no HuggingFace network) |
| `TRANSFORMERS_OFFLINE` | `1`                                      | Offline transformers library          |

---

## Troubleshooting

### "PostgreSQL connection failed"

Check your `PG_DSN` in `.env` and ensure PostgreSQL is running.

```bash
psql -U $USER -d arivonriyam_rag -c "SELECT 1;"
```

### "No chunks found" (benchmark returns empty)

Run ingestion first:

```bash
uv run python src/main.py ingest
```

### Slow BGE-M3 embedding

BGE-M3 runs on CPU (Apple MPS causes deadlock). Embedding 100 chunks takes ~40s — this is expected.
Set `DEVICE=cpu` explicitly if needed:

```bash
DEVICE=cpu uv run python src/main.py ingest
```

### Ollama connection errors

Ensure Ollama is running on port 11434:

```bash
curl http://localhost:11434/api/tags
```

If Ollama is down, run ingestion with `--no-questions` to skip LLM question generation:

```bash
uv run python src/main.py ingest --no-questions
```

### OCR produces garbage

Check `preprocessing.ocr_garbage_ratio` (default 40%). If more than 40% of characters are non-Tamil/ASCII, the element is dropped.
Scanned PDFs may need `hi_res` strategy; modify `ingest.py:partition_document`.

---
