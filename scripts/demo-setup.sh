#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Arivonriyam — one-command demo setup
#
# What this does (idempotent — safe to re-run):
#   1. Verifies prerequisites: node, pnpm, uv, ollama, and Postgres access
#   2. Ensures Ollama is running and `gemma4:latest` is pulled
#   3. Creates the `arivonriyam_rag` Postgres DB + required extensions
#   4. Ensures runtime tables exist for school setup, alerts, and reteach state
#   5. Optionally seeds sample school + roster data when SEED_DEMO_DATA=1
#   6. Writes server + ingestion `.env` files (only if absent)
#   7. `pnpm install` at the repo root
#   8. `uv sync` inside packages/ingestion
#   9. Pre-downloads BGE-M3 + YOLO + Table-Transformer (offline cache)
#  10. Copies repo-root PDFs into packages/ingestion/data/pdfs
#  11. Runs ingestion on those PDFs
#
# Default mode expects a local PostgreSQL instance.
# Docker fallback: USE_DOCKER_POSTGRES=1 bash scripts/demo-setup.sh
# Optional sample data: SEED_DEMO_DATA=1 bash scripts/demo-setup.sh
#
# After this finishes, run `pnpm dev` and open http://localhost:5173
# ---------------------------------------------------------------------------

set -euo pipefail

# --- helpers ---------------------------------------------------------------

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { printf "${BLUE}[demo-setup]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[ok]${NC}         %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC}       %s\n" "$*"; }
fail() { printf "${RED}[fail]${NC}       %s\n" "$*" >&2; exit 1; }

require() {
  local cmd="$1"; local install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "'$cmd' not found on PATH. Install it: $install_hint"
  fi
  ok "$cmd found: $(command -v "$cmd")"
}

is_safe_ident() {
  [[ "$1" =~ ^[A-Za-z0-9_]+$ ]]
}

docker_container_exists() {
  docker ps -a --format '{{.Names}}' | grep -Fxq "$1"
}

docker_exec_psql() {
  docker exec "$DOCKER_POSTGRES_CONTAINER" psql -U "$PG_USER" -d "$1" -c "$2"
}

run_pg_query() {
  local database="$1"
  local sql="$2"

  if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
    docker exec "$DOCKER_POSTGRES_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$database" -c "$sql"
  else
    psql -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$database" -c "$sql"
  fi
}

ensure_runtime_schema() {
  log "Ensuring Arivonriyam runtime tables exist…"
  run_pg_query "$PG_DB" "
    CREATE TABLE IF NOT EXISTS school_config (
      id           SERIAL PRIMARY KEY,
      school_name  TEXT NOT NULL DEFAULT '',
      location     TEXT NOT NULL DEFAULT '',
      state        TEXT NOT NULL DEFAULT '',
      teacher_name TEXT NOT NULL DEFAULT '',
      teacher_id   TEXT NOT NULL DEFAULT '',
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      class_id   INTEGER NOT NULL,
      name       TEXT NOT NULL,
      emoji      TEXT NOT NULL DEFAULT '🧒',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);

    CREATE TABLE IF NOT EXISTS session_alerts (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL,
      class_id         INTEGER NOT NULL,
      class_name       TEXT NOT NULL,
      student_id       TEXT NOT NULL,
      student_name     TEXT NOT NULL,
      student_emoji    TEXT NOT NULL,
      topic            TEXT NOT NULL,
      subject          TEXT NOT NULL,
      total_questions  INTEGER NOT NULL,
      correct_count    INTEGER NOT NULL,
      incorrect_count  INTEGER NOT NULL,
      score            INTEGER NOT NULL,
      missed_questions JSONB NOT NULL DEFAULT '[]',
      session_date     DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_session_alerts_date ON session_alerts(session_date);
    CREATE INDEX IF NOT EXISTS idx_session_alerts_class_date ON session_alerts(class_id, session_date);

    CREATE TABLE IF NOT EXISTS reteach_state_daily (
      session_date                DATE PRIMARY KEY,
      topics_by_class             JSONB NOT NULL DEFAULT '{}'::jsonb,
      selected_topic_ids_by_class JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_topic_ids         JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  " >/dev/null
  ok "Runtime schema ready"
}

seed_demo_data() {
  log "Seeding sample school and student roster data…"
  run_pg_query "$PG_DB" "
    BEGIN;

    DELETE FROM school_config;
    INSERT INTO school_config (
      school_name,
      location,
      state,
      teacher_name,
      teacher_id,
      updated_at
    ) VALUES (
      'GHSS Demo School',
      'Madurai',
      'Tamil Nadu',
      'Kavitha R.',
      'TNEID-2014-30592',
      NOW()
    );

    DELETE FROM students;
    INSERT INTO students (class_id, name, emoji) VALUES
      (1, 'Anbu', '🧒'),
      (1, 'Nila', '🌱'),
      (2, 'Rani', '📚'),
      (2, 'Surya', '🪁'),
      (3, 'Meena', '🌟'),
      (3, 'Arun', '🧒'),
      (3, 'Kavin', '📘'),
      (4, 'Divya', '📝'),
      (4, 'Vetri', '🚀'),
      (5, 'Kaviya', '🎒'),
      (5, 'Sanjay', '🧠');

    COMMIT;
  " >/dev/null
  ok "Sample school + roster seeded"
}

stage_repo_pdfs() {
  local source_count="0"

  if [[ -d "$PDF_SOURCE_DIR" ]]; then
    source_count=$(find "$PDF_SOURCE_DIR" -type f -name '*.pdf' 2>/dev/null | wc -l | tr -d ' ')
  fi

  if [[ "$source_count" == "0" ]]; then
    warn "No repo PDFs found under $PDF_SOURCE_DIR."
    return 0
  fi

  log "Copying $source_count repo PDF(s) from $PDF_SOURCE_DIR to $PDF_TARGET_DIR…"
  mkdir -p "$PDF_TARGET_DIR"

  while IFS= read -r -d '' src; do
    rel_path="${src#${PDF_SOURCE_DIR}/}"
    dest="$PDF_TARGET_DIR/$rel_path"
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
  done < <(find "$PDF_SOURCE_DIR" -type f -name '*.pdf' -print0)

  ok "Repo PDFs staged for ingestion"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

USE_DOCKER_POSTGRES="${USE_DOCKER_POSTGRES:-0}"
SEED_DEMO_DATA="${SEED_DEMO_DATA:-0}"

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_DB="${PG_DB:-arivonriyam_rag}"

OLLAMA_MODEL="${OLLAMA_MODEL:-gemma4:latest}"
INGEST_FLAGS="${INGEST_FLAGS:---no-questions}"

DOCKER_POSTGRES_CONTAINER="${DOCKER_POSTGRES_CONTAINER:-arivonriyam-pg}"
DOCKER_POSTGRES_PASSWORD="${DOCKER_POSTGRES_PASSWORD:-arivonriyam}"
PDF_SOURCE_DIR="${PDF_SOURCE_DIR:-$REPO_ROOT/pdfs}"
PDF_TARGET_DIR="$REPO_ROOT/packages/ingestion/data/pdfs"

if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
  PG_USER="${PG_USER:-arivonriyam}"
  PG_DSN_DEFAULT="postgresql://${PG_USER}:${DOCKER_POSTGRES_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}"
else
  PG_USER="${PG_USER:-$USER}"
  PG_DSN_DEFAULT="postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"
fi

PG_DSN="${PG_DSN:-$PG_DSN_DEFAULT}"

is_safe_ident "$PG_DB" || fail "PG_DB must contain only letters, numbers, and underscores."

# --- 1. prerequisites ------------------------------------------------------

log "Checking prerequisites…"
require node   "https://nodejs.org/  (need v20+)"
require pnpm   "npm install -g pnpm"
require uv     "curl -LsSf https://astral.sh/uv/install.sh | sh"
require ollama "https://ollama.com/download"

if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
  require docker "https://www.docker.com/products/docker-desktop/"
else
  require psql "Install Postgres.app (macOS) or postgresql-17 + pgvector. Or re-run with USE_DOCKER_POSTGRES=1"
fi

NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\)\..*/\1/')
if (( NODE_MAJOR < 20 )); then
  fail "Node $NODE_MAJOR detected; need Node 20+"
fi
ok "node version is $(node -v)"

# --- 2. ollama -------------------------------------------------------------

log "Checking Ollama daemon on :11434…"
if ! curl -sf http://localhost:11434/api/tags >/dev/null; then
  warn "Ollama not responding. Attempting 'ollama serve' in background…"
  (ollama serve >/dev/null 2>&1 &)
  for _ in {1..20}; do
    sleep 1
    if curl -sf http://localhost:11434/api/tags >/dev/null; then break; fi
  done
  curl -sf http://localhost:11434/api/tags >/dev/null \
    || fail "Could not reach Ollama on :11434. Start it manually with 'ollama serve'."
fi
ok "Ollama is up"

if curl -s http://localhost:11434/api/tags | grep -q "\"${OLLAMA_MODEL}\""; then
  ok "$OLLAMA_MODEL already pulled"
else
  log "Pulling $OLLAMA_MODEL (this can take a few minutes)…"
  ollama pull "$OLLAMA_MODEL"
  ok "$OLLAMA_MODEL ready"
fi

# --- 3. postgres -----------------------------------------------------------

if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
  log "Preparing Docker-backed PostgreSQL (container=$DOCKER_POSTGRES_CONTAINER)…"

  docker info >/dev/null 2>&1 \
    || fail "Docker daemon is not running. Start Docker Desktop and re-run."

  if docker_container_exists "$DOCKER_POSTGRES_CONTAINER"; then
    if [[ "$(docker inspect -f '{{.State.Running}}' "$DOCKER_POSTGRES_CONTAINER")" != "true" ]]; then
      log "Starting existing container '$DOCKER_POSTGRES_CONTAINER'…"
      docker start "$DOCKER_POSTGRES_CONTAINER" >/dev/null
    else
      ok "Docker Postgres container already running"
    fi
  else
    log "Creating pgvector container '$DOCKER_POSTGRES_CONTAINER' on port $PG_PORT…"
    docker run -d \
      --name "$DOCKER_POSTGRES_CONTAINER" \
      -e POSTGRES_PASSWORD="$DOCKER_POSTGRES_PASSWORD" \
      -e POSTGRES_USER="$PG_USER" \
      -e POSTGRES_DB="$PG_DB" \
      -p "$PG_PORT:5432" \
      pgvector/pgvector:pg17 >/dev/null
  fi

  for _ in {1..30}; do
    if docker exec "$DOCKER_POSTGRES_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  docker exec "$DOCKER_POSTGRES_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 \
    || fail "Docker Postgres did not become ready in time."
  ok "Docker Postgres reachable"

  if docker exec "$DOCKER_POSTGRES_CONTAINER" psql -U "$PG_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
    ok "Database '$PG_DB' already exists"
  else
    log "Creating database '$PG_DB' inside Docker Postgres…"
    docker_exec_psql postgres "CREATE DATABASE ${PG_DB};" >/dev/null
    ok "Database '$PG_DB' created"
  fi

  log "Enabling required extensions in '$PG_DB'…"
  docker_exec_psql "$PG_DB" "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  ok "Extensions ready (vector, pgcrypto)"
else
  log "Checking PostgreSQL connection (user=$PG_USER host=$PG_HOST port=$PG_PORT)…"
  if ! psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    fail "Cannot connect to Postgres as '$PG_USER' at $PG_HOST:$PG_PORT. Start Postgres, set PG_USER/PG_HOST/PG_PORT, or re-run with USE_DOCKER_POSTGRES=1."
  fi
  ok "Postgres reachable"

  if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
    ok "Database '$PG_DB' already exists"
  else
    log "Creating database '$PG_DB'…"
    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "CREATE DATABASE $PG_DB;" >/dev/null
    ok "Database '$PG_DB' created"
  fi

  log "Enabling required extensions in '$PG_DB'…"
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  ok "Extensions ready (vector, pgcrypto)"
fi

ensure_runtime_schema

if [[ "$SEED_DEMO_DATA" == "1" ]]; then
  seed_demo_data
fi

# --- 4. env files ----------------------------------------------------------

SERVER_ENV="$REPO_ROOT/packages/server/src/.env"
INGEST_ENV="$REPO_ROOT/packages/ingestion/.env"

if [[ -f "$SERVER_ENV" ]]; then
  ok "$SERVER_ENV already exists (leaving untouched)"
else
  log "Writing $SERVER_ENV…"
  cat > "$SERVER_ENV" <<EOF
PORT=9012
OLLAMA_BASE_URL=http://localhost:11434/
OLLAMA_MODEL=$OLLAMA_MODEL
PG_DSN=$PG_DSN
EOF
  ok "Server .env written"
fi

if [[ -f "$INGEST_ENV" ]]; then
  ok "$INGEST_ENV already exists (leaving untouched)"
else
  log "Writing $INGEST_ENV…"
  cat > "$INGEST_ENV" <<EOF
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
PG_DSN=$PG_DSN
EOF
  ok "Ingestion .env written"
fi

# --- 5. node deps ----------------------------------------------------------

log "Installing Node dependencies (pnpm install)…"
pnpm install
ok "Node dependencies installed"

# --- 6. python deps --------------------------------------------------------

log "Syncing Python dependencies (uv sync)…"
(cd packages/ingestion && uv sync)
ok "Python dependencies ready"

# --- 7. ML model pre-download ---------------------------------------------

log "Pre-downloading ML models for offline use (~3.7 GB, one-time)…"
(cd packages/ingestion && uv run python download_models.py)
ok "ML models cached under ~/.cache/huggingface/hub/"

# --- 8. ingest -------------------------------------------------------------

log "Preparing textbook PDFs from repo source…"
stage_repo_pdfs

PDF_COUNT=$(find "$PDF_TARGET_DIR" -name '*.pdf' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$PDF_COUNT" == "0" ]]; then
  warn "No PDFs found under $PDF_TARGET_DIR. Skipping ingestion."
  warn "Drop PDFs under $PDF_SOURCE_DIR/class_<N>/<Subject>.pdf and re-run this script."
else
  log "Found $PDF_COUNT PDF(s) — running ingestion (this can take 5–15 minutes)…"
  log "Ingestion command: cd packages/ingestion && uv run python src/main.py ingest $INGEST_FLAGS"
  (cd packages/ingestion && uv run python src/main.py ingest $INGEST_FLAGS)
  ok "Ingestion complete"
fi

# --- 9. final summary ------------------------------------------------------

if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
  CHUNK_COUNT=$(docker exec "$DOCKER_POSTGRES_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT COUNT(*) FROM rag_chunks' 2>/dev/null || echo "0")
else
  CHUNK_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT COUNT(*) FROM rag_chunks' 2>/dev/null || echo "0")
fi
log "----------------------------------------------------------------"
ok  "Setup complete."
ok  "rag_chunks rows in Postgres: $CHUNK_COUNT"
log ""
log "Next:"
log "  pnpm dev          # client on http://localhost:5173, server on :9012"
log "  Manual re-ingest: cd packages/ingestion && uv run python src/main.py ingest $INGEST_FLAGS"
log "  Class-only ingest: cd packages/ingestion && uv run python src/main.py ingest --class class_3 --no-questions"
log ""
if [[ "$SEED_DEMO_DATA" == "1" ]]; then
  log "Sample school + roster were auto-seeded because SEED_DEMO_DATA=1 was set."
else
  log "Optional school setup: use the UI at /setup, set SEED_DEMO_DATA=1, or use the sample SQL in demo.md."
fi
log "Then follow demo.md for the judge walkthrough and setup details."
log "----------------------------------------------------------------"
