# Arivonriyam - Live Demo Guide

> This is the single judge-facing guide for the live demo submission.
> Arivonriyam runs locally, so the demo is provided as repository files plus a setup script instead of a hosted URL.
> No login, paywall, or private API key is required.

## 1. Quick Start

### Fastest path with sample school and roster already loaded

If PostgreSQL is installed locally:

```bash
git clone <repo-url> arivonriyam
cd arivonriyam
SEED_DEMO_DATA=1 bash scripts/demo-setup.sh
pnpm dev
```

If PostgreSQL is not installed locally:

```bash
git clone <repo-url> arivonriyam
cd arivonriyam
USE_DOCKER_POSTGRES=1 SEED_DEMO_DATA=1 bash scripts/demo-setup.sh
pnpm dev
```

Open `http://localhost:5173`.

Expected first-run time on a clean machine: 20 to 35 minutes.

Most of that time is model download plus textbook ingestion.

### What the setup script does automatically

`scripts/demo-setup.sh` now does all of this:

1. checks Node.js, pnpm, uv, Ollama, and PostgreSQL access
2. prepares PostgreSQL and enables required extensions
3. creates the runtime tables used by the app
4. optionally seeds sample school and roster data when `SEED_DEMO_DATA=1`
5. installs Node and Python dependencies
6. downloads the offline models used by ingestion
7. copies committed PDFs from the repo-root `pdfs/` folder into `packages/ingestion/data/pdfs/`
8. runs ingestion automatically

The full app requires PostgreSQL.

- native PostgreSQL is supported
- Docker PostgreSQL is supported
- a true no-PostgreSQL full-app mode is not supported

## 2. What to click during the demo

Once `pnpm dev` is running, open `http://localhost:5173`.

### If you used `SEED_DEMO_DATA=1`

You can skip the school setup screen and go straight to the product flow.

### Recommended 5-step demo path

1. Open the Lesson Architect flow.
2. Choose `class_3` and `Social`, then generate a lesson blueprint.
3. Save the plan.
4. Open the student flow, run a session, and intentionally miss a few questions.
5. Open Alerts, then Report, and show the generated teacher actions and downloadable PDF.

### What this demonstrates

- textbook-grounded lesson generation
- local student questioning
- teacher alerts from missed answers
- reteach guidance
- downloadable daily reporting

## 3. Textbooks in this repo

The committed source of truth for demo textbooks is the repo-root `pdfs/` folder.

The setup script copies those PDFs into `packages/ingestion/data/pdfs/` before ingestion because the package data folder is gitignored.

To add more books, use this structure:

```text
packages/ingestion/data/pdfs/class_<N>/<Subject>.pdf
```

Examples:

- `packages/ingestion/data/pdfs/class_3/Science.pdf`
- `packages/ingestion/data/pdfs/class_5/English.pdf`

## 4. Manual ingest commands

The setup script already performs ingestion automatically. Use these only if you want to re-run it manually.

### Ingest all PDFs

```bash
cd packages/ingestion
uv run python src/main.py ingest --no-questions
cd ../..
```

### Ingest one class only

```bash
cd packages/ingestion
uv run python src/main.py ingest --class class_3 --no-questions
cd ../..
```

### Force a fresh full ingest

```bash
cd packages/ingestion
uv run python src/main.py ingest --force --no-questions
cd ../..
```

### Force one class only

```bash
cd packages/ingestion
uv run python src/main.py ingest --class class_3 --force --no-questions
cd ../..
```

## 5. Troubleshooting

| Symptom                                          | What to do                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `psql` not found                                 | Install PostgreSQL locally or use `USE_DOCKER_POSTGRES=1`.          |
| Docker setup fails                               | Start Docker Desktop and rerun the script.                          |
| Ollama is not reachable                          | Start Ollama or run `ollama serve`.                                 |
| `gemma4:latest` is missing                       | Run `ollama pull gemma4:latest`.                                    |
| `/api/health` does not return `ok`               | Check that `pnpm dev` is still running and the server port is free. |
| `rag_chunks` is empty                            | Re-run ingestion manually.                                          |
| The setup page is still empty after auto-seeding | Refresh the browser once after the script completes.                |

Quick checks:

```bash
curl -s http://localhost:9012/api/health
psql -d arivonriyam_rag -c "SELECT COUNT(*) AS chunks FROM rag_chunks;"
```

For Docker PostgreSQL:

```bash
docker exec arivonriyam-pg psql -U arivonriyam -d arivonriyam_rag -c "SELECT COUNT(*) AS chunks FROM rag_chunks;"
```

## 6. Appendix: optional school setup alternatives

### Use the UI

This is the recommended path for judges.

If you did not use `SEED_DEMO_DATA=1`, open the setup flow and enter:

- school name
- location and state
- teacher name and teacher ID
- 2 to 3 students for at least one class

Then save:

- `Save school info`
- `Save roster`

### Use SQL instead of the UI

Native PostgreSQL:

```bash
psql -d arivonriyam_rag <<'SQL'
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
DELETE FROM students WHERE class_id = 3;
INSERT INTO students (class_id, name, emoji)
VALUES
   (3, 'Meena', '🌟'),
   (3, 'Arun', '🧒'),
   (3, 'Kavin', '📘');
COMMIT;
SQL
```

Docker PostgreSQL:

```bash
docker exec -i arivonriyam-pg psql -U arivonriyam -d arivonriyam_rag <<'SQL'
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
DELETE FROM students WHERE class_id = 3;
INSERT INTO students (class_id, name, emoji)
VALUES
   (3, 'Meena', '🌟'),
   (3, 'Arun', '🧒'),
   (3, 'Kavin', '📘');
COMMIT;
SQL
```

Class mapping:

- `1` = Class 1
- `2` = Class 2
- `3` = Class 3
- `4` = Class 4
- `5` = Class 5

## 7. Appendix: useful flags

| Variable              | Default          | Purpose                                               |
| --------------------- | ---------------- | ----------------------------------------------------- |
| `USE_DOCKER_POSTGRES` | `0`              | Use Docker PostgreSQL instead of a native install     |
| `SEED_DEMO_DATA`      | `0`              | Seed a sample school profile and roster automatically |
| `INGEST_FLAGS`        | `--no-questions` | Flags passed to the ingest command                    |
| `PDF_SOURCE_DIR`      | `./pdfs`         | Repo-root PDF source copied into the ingestion folder |
| `PG_PORT`             | `5432`           | PostgreSQL port override                              |

## 8. What this demo proves

Arivonriyam demonstrates a complete local classroom loop:

- textbook ingestion from submitted files
- grounded lesson generation
- student questioning
- teacher alerts from mistakes
- reteach guidance
- downloadable teacher PDF reporting

That full loop runs on a local machine without a hosted app or login requirement.
