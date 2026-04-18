UV ?= uv
VENV ?= .venv
UV_PYTHON ?= 3.11
PY := $(VENV)/bin/python

DATA_ROOT ?= ./packages/server/data
COLLECTION ?= arivonriyam_textbooks_v1
EMBEDDING_MODEL ?= sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2

.PHONY: rag-venv rag-install rag-ingest

rag-venv:
	$(UV) venv --python $(UV_PYTHON) $(VENV)

rag-install: rag-venv
	$(UV) pip install --python $(PY) -r packages/server/python/requirements.txt

rag-ingest:
	$(UV) run --python $(PY) packages/server/python/ingest.py --data-root $(DATA_ROOT) --collection $(COLLECTION) --embedding-model $(EMBEDDING_MODEL)
