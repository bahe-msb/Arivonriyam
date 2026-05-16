#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Arivonriyam — one-command demo setup
#
# What this does (idempotent — safe to re-run):
#   1. Verifies prerequisites: node, pnpm, uv, ollama, tesseract (+ eng/tam/tel),
#      cmake, git, and Postgres access. (Bruno CLI is optional — warns only.)
#   2. Ensures Ollama is running and `gemma4:latest` is pulled
#   3. Creates the `arivonriyam_rag` Postgres DB + required extensions
#   4. Ensures runtime tables exist for school setup, alerts, and reteach state
#   5. Optionally seeds sample school + roster data when SEED_DEMO_DATA=1
#   6. Writes server + ingestion `.env` files (only if absent)
#   7. `pnpm install` at the repo root
#   8. `uv sync` inside packages/ingestion
#   9. Pre-downloads BGE-M3 + YOLO + Table-Transformer (offline cache)
#  10. Clones, builds, and downloads the model for whisper.cpp
#      (speech-to-text). Size via WHISPER_MODEL_SIZE (default "small").
#  11. Stages repo-root PDFs under packages/ingestion/data/pdfs
#
# NOTE: This script does NOT run ingestion. Run it manually per demo.md:
#   cd packages/ingestion && uv run python src/main.py ingest --no-questions
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

# Like `require`, but attempts an automated install when the binary is missing
# instead of stopping. Supports uv and ollama on macOS/Linux. Falls back to
# `fail` (with the manual install hint) if the auto install does not succeed.
require_or_install() {
  local cmd="$1"; local install_hint="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd found: $(command -v "$cmd")"
    return 0
  fi

  warn "'$cmd' not found — attempting automatic install..."
  local os; os="$(uname -s)"
  case "$cmd" in
    uv)
      curl -LsSf https://astral.sh/uv/install.sh | sh \
        || warn "uv installer exited non-zero"
      # The uv installer drops the binary in ~/.local/bin or ~/.cargo/bin
      for dir in "$HOME/.local/bin" "$HOME/.cargo/bin"; do
        [[ -x "$dir/uv" && ":$PATH:" != *":$dir:"* ]] && export PATH="$dir:$PATH"
      done
      ;;
    ollama)
      if [[ "$os" == "Darwin" ]]; then
        if command -v brew >/dev/null 2>&1; then
          brew install ollama || warn "brew install ollama failed"
        else
          warn "Homebrew not present. Install Ollama manually: $install_hint"
        fi
      elif [[ "$os" == "Linux" ]]; then
        curl -fsSL https://ollama.com/install.sh | sh \
          || warn "ollama installer exited non-zero"
      else
        warn "Unsupported OS '$os' for auto-install. Install manually: $install_hint"
      fi
      ;;
    cmake)
      # Required to build whisper.cpp from source.
      log "cmake is going to be installed (needed to build whisper.cpp for speech-to-text)."
      if [[ "$os" == "Darwin" ]]; then
        if command -v brew >/dev/null 2>&1; then
          brew install cmake || warn "brew install cmake failed"
        else
          warn "Homebrew not present. Install cmake manually: $install_hint"
        fi
      elif [[ "$os" == "Linux" ]]; then
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -y && sudo apt-get install -y cmake build-essential \
            || warn "apt-get install cmake build-essential failed"
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y cmake gcc-c++ make \
            || warn "dnf install cmake failed"
        else
          warn "No supported package manager. Install cmake manually: $install_hint"
        fi
      else
        warn "Unsupported OS '$os' for auto-install. Install manually: $install_hint"
      fi
      ;;
    tesseract)
      # OCR engine used by ingestion when a PDF page is image-only.
      # Need English, Tamil, and Telugu language packs.
      log "Tesseract is going to be installed (needed for OCR during ingestion)."
      if [[ "$os" == "Darwin" ]]; then
        if command -v brew >/dev/null 2>&1; then
          brew install tesseract tesseract-lang \
            || warn "brew install tesseract failed"
        else
          warn "Homebrew not present. Install tesseract manually: $install_hint"
        fi
      elif [[ "$os" == "Linux" ]]; then
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -y \
            && sudo apt-get install -y tesseract-ocr \
                 tesseract-ocr-eng tesseract-ocr-tam tesseract-ocr-tel \
            || warn "apt-get install tesseract failed"
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y tesseract tesseract-langpack-eng \
                              tesseract-langpack-tam tesseract-langpack-tel \
            || warn "dnf install tesseract failed"
        else
          warn "No supported package manager. Install tesseract + eng/tam/tel packs manually: $install_hint"
        fi
      else
        warn "Unsupported OS '$os' for auto-install. Install manually: $install_hint"
      fi
      ;;
    *)
      warn "No auto-installer defined for '$cmd'."
      ;;
  esac

  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd installed: $(command -v "$cmd")"
  else
    fail "'$cmd' still not on PATH after auto-install. Install it manually: $install_hint"
  fi
}

# Make sure tesseract has the English, Tamil, and Telugu language packs.
# Tesseract may be on PATH from a prior install without the packs the
# ingestion pipeline needs, so verify and top up.
ensure_tesseract_langs() {
  if ! command -v tesseract >/dev/null 2>&1; then
    return 0
  fi
  local installed; installed="$(tesseract --list-langs 2>/dev/null | tail -n +2 | tr '\n' ' ')"
  local missing=()
  for lang in eng tam tel; do
    if ! grep -qw "$lang" <<<"$installed"; then
      missing+=("$lang")
    fi
  done
  if (( ${#missing[@]} == 0 )); then
    ok "tesseract languages OK (eng, tam, tel)"
    return 0
  fi
  log "tesseract is missing language pack(s): ${missing[*]} — installing now..."
  local os; os="$(uname -s)"
  if [[ "$os" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install tesseract-lang || warn "brew install tesseract-lang failed"
    else
      warn "Homebrew not present. Install tesseract-lang manually."
    fi
  elif [[ "$os" == "Linux" ]]; then
    local pkgs=()
    for lang in "${missing[@]}"; do
      case "$lang" in
        eng) pkgs+=("tesseract-ocr-eng") ;;
        tam) pkgs+=("tesseract-ocr-tam") ;;
        tel) pkgs+=("tesseract-ocr-tel") ;;
      esac
    done
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -y && sudo apt-get install -y "${pkgs[@]}" \
        || warn "apt-get install ${pkgs[*]} failed"
    elif command -v dnf >/dev/null 2>&1; then
      local rpms=()
      for lang in "${missing[@]}"; do
        rpms+=("tesseract-langpack-${lang}")
      done
      sudo dnf install -y "${rpms[@]}" || warn "dnf install ${rpms[*]} failed"
    else
      warn "No supported package manager. Install language packs manually: ${missing[*]}"
    fi
  else
    warn "Unsupported OS '$os' for auto-install of language packs."
  fi

  installed="$(tesseract --list-langs 2>/dev/null | tail -n +2 | tr '\n' ' ')"
  local still_missing=()
  for lang in "${missing[@]}"; do
    grep -qw "$lang" <<<"$installed" || still_missing+=("$lang")
  done
  if (( ${#still_missing[@]} == 0 )); then
    ok "tesseract languages now OK (eng, tam, tel)"
  else
    fail "tesseract still missing language packs: ${still_missing[*]}. Install them manually."
  fi
}

# Bruno (the `bru` CLI) is used for API smoke-tests during demos. It's
# optional — warn if missing but never fail.
check_bruno() {
  if command -v bru >/dev/null 2>&1; then
    ok "bru (Bruno CLI) found: $(command -v bru)"
  else
    warn "'bru' (Bruno CLI) not found — optional, only needed if you run the Bruno API collection."
    warn "  Install: npm install -g @usebruno/cli   (or download from https://www.usebruno.com/downloads)"
  fi
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
  log "Ensuring Arivonriyam runtime tables exist..."
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
  log "Seeding sample school and student roster data..."
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

# Bring whisper.cpp to a runnable state: clone if missing, build if the
# whisper-cli binary is missing, and download the ggml model file the
# server expects. Idempotent — re-running this skips work already done.
setup_whisper() {
  local whisper_root="$REPO_ROOT/whisper.cpp"
  local whisper_exec="$whisper_root/build/bin/whisper-cli"
  local model_file="$whisper_root/models/ggml-${WHISPER_MODEL_SIZE}.bin"

  # 1. clone if the directory is empty / missing
  if [[ ! -f "$whisper_root/CMakeLists.txt" ]]; then
    log "Cloning whisper.cpp into $whisper_root..."
    rm -rf "$whisper_root"
    git clone --depth 1 "$WHISPER_REPO_URL" "$whisper_root" \
      || fail "git clone of whisper.cpp failed. Check network and re-run."
    ok "whisper.cpp source cloned"
  else
    ok "whisper.cpp source already present"
  fi

  # 2. build the whisper-cli binary if missing
  if [[ -x "$whisper_exec" ]]; then
    ok "whisper-cli already built at $whisper_exec"
  else
    log "Building whisper.cpp (cmake + make — this can take a few minutes)..."
    (
      cd "$whisper_root" \
        && cmake -B build -DCMAKE_BUILD_TYPE=Release >/dev/null \
        && cmake --build build --config Release -j"$(_cpu_count)" >/dev/null
    ) || fail "whisper.cpp build failed. Re-run with verbose output: cd packages/whisper.cpp && cmake -B build && cmake --build build -j"
    [[ -x "$whisper_exec" ]] \
      || fail "Build finished but $whisper_exec is missing — check the build log."
    ok "whisper-cli built: $whisper_exec"
  fi

  # 3. download the ggml model
  if [[ -f "$model_file" ]]; then
    ok "Whisper model already present: $model_file"
  else
    log "Downloading Whisper ggml-${WHISPER_MODEL_SIZE} model (one-time)..."
    if [[ ! -x "$whisper_root/models/download-ggml-model.sh" ]]; then
      chmod +x "$whisper_root/models/download-ggml-model.sh" 2>/dev/null || true
    fi
    (
      cd "$whisper_root/models" \
        && bash ./download-ggml-model.sh "$WHISPER_MODEL_SIZE"
    ) || fail "Failed to download Whisper model ggml-${WHISPER_MODEL_SIZE}.bin. Check network."
    [[ -f "$model_file" ]] \
      || fail "Download script ran but $model_file is missing. Try a different WHISPER_MODEL_SIZE."
    ok "Whisper model ready: $model_file"
  fi
}

_cpu_count() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
  elif command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.ncpu 2>/dev/null || echo 4
  else
    echo 4
  fi
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

  log "Copying $source_count repo PDF(s) from $PDF_SOURCE_DIR to $PDF_TARGET_DIR..."
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
# Default matches packages/ingestion/src/ingest.py — questions are generated
# (its internal default is generate_questions=True). Leave empty so the
# CLI uses that default. 
#Override with INGEST_FLAGS=--no-questions for a
# faster, retrieval-only ingest.``
INGEST_FLAGS="${INGEST_FLAGS:-}"

# Speech-to-text via whisper.cpp. Valid sizes: tiny | base | small | medium |
# large-v2. Default is "large-v2" (~3 GB) for best Tamil/Telugu/English
# accuracy — override with WHISPER_MODEL_SIZE=small for faster downloads.
# Language: "auto" lets whisper detect Tamil / English / Telugu per utterance.
WHISPER_MODEL_SIZE="${WHISPER_MODEL_SIZE:-large-v2}"
WHISPER_LANGUAGE="${WHISPER_LANGUAGE:-auto}"
WHISPER_REPO_URL="${WHISPER_REPO_URL:-https://github.com/ggerganov/whisper.cpp.git}"

DOCKER_POSTGRES_CONTAINER="${DOCKER_POSTGRES_CONTAINER:-arivonriyam-pg}"
DOCKER_POSTGRES_PASSWORD="${DOCKER_POSTGRES_PASSWORD:-arivonriyam}"
PDF_SOURCE_DIR="${PDF_SOURCE_DIR:-$REPO_ROOT/pdfs}"
PDF_TARGET_DIR="$REPO_ROOT/packages/ingestion/data/pdfs"

if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
  PG_USER="${PG_USER:-arivonriyam}"
  PG_DSN_DEFAULT="postgresql://${PG_USER}:${DOCKER_POSTGRES_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}"
else
  PG_USER="postgres"
  PG_DSN_DEFAULT="postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"
fi

PG_DSN="${PG_DSN:-$PG_DSN_DEFAULT}"

is_safe_ident "$PG_DB" || fail "PG_DB must contain only letters, numbers, and underscores."

# --- 1. prerequisites ------------------------------------------------------

log "Checking prerequisites..."
require node   "https://nodejs.org/  (need v20+)"
require pnpm   "npm install -g pnpm"
require_or_install uv        "curl -LsSf https://astral.sh/uv/install.sh | sh"
require_or_install ollama    "https://ollama.com/download"
require_or_install tesseract "macOS: brew install tesseract tesseract-lang  |  Debian/Ubuntu: sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-tam tesseract-ocr-tel"
ensure_tesseract_langs
require_or_install cmake     "macOS: brew install cmake  |  Debian/Ubuntu: sudo apt-get install cmake build-essential"
require git "https://git-scm.com/downloads"
check_bruno

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

log "Checking Ollama daemon on :11434..."
if ! curl -sf http://localhost:11434/api/tags >/dev/null; then
  warn "Ollama not responding. Attempting 'ollama serve' in background..."
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
  log "Pulling $OLLAMA_MODEL (this can take a few minutes)..."
  ollama pull "$OLLAMA_MODEL"
  ok "$OLLAMA_MODEL ready"
fi

# --- 3. postgres -----------------------------------------------------------

if [[ "$USE_DOCKER_POSTGRES" == "1" ]]; then
  log "Preparing Docker-backed PostgreSQL (container=$DOCKER_POSTGRES_CONTAINER)..."

  docker info >/dev/null 2>&1 \
    || fail "Docker daemon is not running. Start Docker Desktop and re-run."

  if docker_container_exists "$DOCKER_POSTGRES_CONTAINER"; then
    if [[ "$(docker inspect -f '{{.State.Running}}' "$DOCKER_POSTGRES_CONTAINER")" != "true" ]]; then
      log "Starting existing container '$DOCKER_POSTGRES_CONTAINER'..."
      docker start "$DOCKER_POSTGRES_CONTAINER" >/dev/null
    else
      ok "Docker Postgres container already running"
    fi
  else
    log "Creating pgvector container '$DOCKER_POSTGRES_CONTAINER' on port $PG_PORT..."
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
    log "Creating database '$PG_DB' inside Docker Postgres..."
    docker_exec_psql postgres "CREATE DATABASE ${PG_DB};" >/dev/null
    ok "Database '$PG_DB' created"
  fi

  log "Enabling required extensions in '$PG_DB'..."
  docker_exec_psql "$PG_DB" "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  ok "Extensions ready (vector, pgcrypto)"
else
  log "Checking PostgreSQL connection (user=$PG_USER host=$PG_HOST port=$PG_PORT)..."
  if ! psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    fail "Cannot connect to Postgres as '$PG_USER' at $PG_HOST:$PG_PORT. Start Postgres, set PG_USER/PG_HOST/PG_PORT, or re-run with USE_DOCKER_POSTGRES=1."
  fi
  ok "Postgres reachable"

  if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
    ok "Database '$PG_DB' already exists"
  else
    log "Creating database '$PG_DB'..."
    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "CREATE DATABASE $PG_DB;" >/dev/null
    ok "Database '$PG_DB' created"
  fi

  log "Enabling required extensions in '$PG_DB'..."
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
  log "Writing $SERVER_ENV..."
  cat > "$SERVER_ENV" <<EOF
PORT=9012
OLLAMA_BASE_URL=http://localhost:11434/
OLLAMA_MODEL=$OLLAMA_MODEL
PG_DSN=$PG_DSN
WHISPER_MODEL_SIZE=$WHISPER_MODEL_SIZE
WHISPER_LANGUAGE=$WHISPER_LANGUAGE
EOF
  ok "Server .env written"
fi

if [[ -f "$INGEST_ENV" ]]; then
  ok "$INGEST_ENV already exists (leaving untouched)"
else
  log "Writing $INGEST_ENV..."
  cat > "$INGEST_ENV" <<EOF
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
PG_DSN=$PG_DSN
EOF
  ok "Ingestion .env written"
fi

# --- 5. node deps ----------------------------------------------------------

log "Installing Node dependencies (pnpm install)..."
pnpm install
ok "Node dependencies installed"

# --- 6. python deps --------------------------------------------------------

log "Syncing Python dependencies (uv sync)..."
(cd packages/ingestion && uv sync)
ok "Python dependencies ready"

# --- 7. ML model pre-download ---------------------------------------------

log "Pre-downloading ML models for offline use (~3.7 GB, one-time)..."
(cd packages/ingestion && uv run python download_models.py)
ok "ML models cached under ~/.cache/huggingface/hub/"

# --- 8. whisper.cpp (speech-to-text) --------------------------------------

log "Setting up whisper.cpp (speech-to-text) — model size: $WHISPER_MODEL_SIZE"
setup_whisper

# --- 9. stage PDFs (no auto-ingest) ---------------------------------------

log "Staging textbook PDFs from repo source for manual ingestion..."
stage_repo_pdfs

PDF_COUNT=$(find "$PDF_TARGET_DIR" -name '*.pdf' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$PDF_COUNT" == "0" ]]; then
  warn "No PDFs found under $PDF_TARGET_DIR."
  warn "Drop PDFs under $PDF_SOURCE_DIR/class_<N>/<Subject>.pdf before running ingestion."
else
  ok "Staged $PDF_COUNT PDF(s) under $PDF_TARGET_DIR — ready for manual ingestion."
fi

# --- 10. final summary -----------------------------------------------------

log "----------------------------------------------------------------"
ok  "Setup complete. (Ingestion has NOT been run — do it manually.)"
ok  "Speech-to-text ready (whisper.cpp, model: $WHISPER_MODEL_SIZE)."
log ""
log "Next steps — follow demo.md for the full judge walkthrough:"
log "  1. Start the dev servers:"
log "       pnpm dev          # client on http://localhost:5173, server on :9012"
log ""
log "  2. Run ingestion manually from the repo root (questions generated by default):"
if [[ -n "${INGEST_FLAGS:-}" ]]; then
  log "       cd packages/ingestion && uv run python src/main.py ingest $INGEST_FLAGS"
else
  log "       cd packages/ingestion && uv run python src/main.py ingest"
fi
log "     (faster, retrieval-only: append --no-questions)"
log "     (class-only:              append --class class_3)"
log ""
if [[ "$SEED_DEMO_DATA" == "1" ]]; then
  log "Sample school + roster were auto-seeded because SEED_DEMO_DATA=1 was set."
else
  log "Optional school setup: use the UI at /setup, set SEED_DEMO_DATA=1, or use the sample SQL in demo.md."
fi
log ""
log "👉 Follow demo.md for the judge walkthrough and setup details."
log "----------------------------------------------------------------"
