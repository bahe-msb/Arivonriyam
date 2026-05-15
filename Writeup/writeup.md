# Arivonriyam (அறிவொன்றியம்)

### When one teacher must teach five grades, Gemma 4 helps plan, question, and reteach offline

**Track:** Future of Education

## 1. The teacher this is built for

Picture a government school in rural Tamil Nadu. One teacher, five grades, one room. She has just finished a Class 5 science chapter, is about to start Class 3 Tamil, and somewhere in the back row a child has quietly chosen the wrong option for the wrong reason. By the time she notices, the period is over.

That pressure is not unusual. UDISE+ reports about **1.1 lakh single-teacher schools** in India ([UDISE+](https://udiseplus.gov.in/), [The Hindu](https://www.thehindu.com/news/national/over-1-lakh-single-teacher-schools-in-india-catering-to-over-33-lakh-students-data/article70155374.ece), [Indian Express](https://indianexpress.com/article/education/over-33-lakh-enrolled-in-schools-run-by-just-one-teacher-10303693/)). ASER 2023 finds that only **25% of rural Class 5 children can read a Class 2 text fluently** ([ASER 2023](https://asercentre.org/aser-2023/)). UNESCO estimates India needs more than **one million additional teachers** by 2030 ([UNESCO GEM Report](https://www.unesco.org/gem-report/en/teachers)).

A generic chatbot is mostly noise in that classroom. What helps is a local co-teacher that can pull the right lesson from the textbook, run a short questioning loop in the children's language, and flag — _during_ the day — which child needs reteaching on what.

## 2. What Arivonriyam does

Arivonriyam is **not a chatbot**. It is a teacher's workflow built around three real moments:

- **Before class:** select class and subject, pull chapters from the ingested textbook, generate a six-block lesson blueprint.
- **During class:** run a Socratic session — short explanation, preview cards, and a question bank in **Tamil, Telugu, or English** depending on the textbook.
- **After class:** missed-question patterns become alerts, Gemma proposes a teacher support plan, reteach topics are stored per day, and results roll up into a heat-map dashboard plus a downloadable daily report the teacher can keep as inspection proof or share as a quick parent-facing progress record.

The stack: Svelte 5 client, Express 5 + TypeScript server, Python ingestion/retrieval pipeline, local Ollama running `gemma4:latest`, PostgreSQL with pgvector.

## 3. Architecture

Three layers, deliberately separated:

- **Client:** SvelteKit UI for planning, sessions, alerts, reports.
- **Server:** Express in TypeScript — serves the built client, exposes the API, calls Ollama, persists state in Postgres, bridges to Python via `uv run python src/main.py`.
- **Ingestion/RAG:** Python modules for OCR, chunking, enrichment, embeddings, retrieval, summarization, benchmarking.

One lesson from building the system was that textbook memory and classroom memory could not live in one vague store. We kept retrieval state (`rag_chunks`, `manifest`, `pdf_images`) separate from operational state (`session_alerts`, `reteach_state_daily`, `plans`) so the product remembers curriculum context and daily misconceptions without confusing the two.

Everything is **local-first**. `download_models.py` pre-caches models; setup uses `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`; Gemma runs through local Ollama, not a hosted API. Over **80% of Tamil Nadu government schools lack internet access** ([TNIE](https://www.newindianexpress.com/states/tamil-nadu/2021/Jul/11/more-than-80-of-tn-govt-schools-dont-have-internet-access-report-2328465.html)), so offline is not a feature — it is the deployment.

## 4. Retrieval and grounding

The hardest engineering problem here was not "generate nice text." It was making **noisy, scanned, multilingual textbooks** retrievable enough that Gemma stays grounded.

The ingestion pipeline does five things:

1. **OCR + structure:** Unstructured's `hi_res` strategy with `eng`, `tam`, `tel` OCR languages.
2. **Cleanup:** Unicode normalization, OCR artifact removal, garbage-span filtering, with page/chapter/language/element-type metadata preserved.
3. **Pedagogical chunking:** definitions, formulas, theorems, examples, tables, summaries, and body text are chunked differently — not flattened by one generic splitter.
4. **Gemma-assisted enrichment:** at ingest time, Gemma generates hypothetical questions per chunk so embeddings are closer to the questions children actually ask.
5. **Storage:** **BGE-M3** embeddings, 1024-dim vectors, HNSW index in pgvector.

Query-time retrieval is hybrid: **dense pgvector + BM25 + Reciprocal Rank Fusion**, with **HyDE expansion** for short educational queries and **Tamil OCR variant expansion** for spelling drift in scanned texts. A confidence gate in `rag.service.ts` refuses to answer when the top match is too weak. In a classroom, "I don't have enough textbook context" beats a fluent hallucination.

The pipeline also stores textbook images and Gemma-generated captions in `pdf_images`, so visual cues can flow into the classroom session.

## 5. Three things we got wrong before we got them right

**OCR drift in Tamil.** Our first chunks were unusable — Tamil glyphs broke across OCR variants and recall collapsed on obvious chapter terms. The fix was a Tamil-variant expansion pass at query time, plus BM25 to catch what dense vectors missed.

**Hallucination on custom topics.** When a teacher added their own topic, an early build happily generated answers as if it had retrieved them. We split the path: **curriculum topics stay strictly textbook-grounded**; **teacher-added custom topics** go through a separate Gemma prompt with class-level constraints, clearly marked as locally generated. Trust beats fluency.

**One generic prompt for three languages.** We tried a single English prompt with a "respond in X" instruction. It produced unnatural Tamil and Telugu. We rewrote the prompt paths separately for Tamil, Telugu, and English, with explicit language detection from the topic text and retrieved chunks, and enforced classroom register. Tamil-specific training data is still an open problem for local-language AI ([Times of India](https://timesofindia.indiatimes.com/city/chennai/cut-through-clutter-tamil-dataset-to-train-ai-models/articleshow/122155780.cms)) — separate prompt paths were the pragmatic fix.

## 6. How Gemma 4 is actually used

Gemma 4 has six verified roles in the code, not a single chatbot endpoint:

- **`metadata_enricher.py`** — hypothetical student questions per chunk at ingest.
- **`ingest.py`** — captions for extracted textbook images.
- **`lesson.service.ts`** — six-phase lesson blueprint, constrained to retrieved excerpts.
- **`summarize.py`** — teacher-facing topic introductions from retrieved chunks.
- **`socratic.controller.ts`** — topic-locked MCQ banks, six questions per student.
- **Alert-suggestion endpoint** — `{ gapSummary, focusAreas, teacherActions, encouragement }` from missed questions.

Gemma is wired into six specific moments where a teacher would otherwise have to do the work alone.

## 7. The classroom loop

From the teacher's seat, the product is a loop, not a chat. He/She works from his/her laptop dashboard, then hands a class-paired tablet locked to that class's reteach topics to the students over local Wi-Fi with no internet. While they work through the spoken summary and Socratic questions, he/she remains free to teach another group. Alerts publish only for students who actually struggled.

Each alert shows the **missed question, the student's selected option, the correct option, and the explanation**, then requests a Gemma-generated support plan. Reteach state is stored per day. The reporting surface aggregates by class and subject into a heat map and a downloadable daily report. That report gives the teacher a ready document for school or government inspection, and when a parent asks how a child is doing, the same surface can act as a quick report card backed by the day's actual session data.

That matters because reporting is usually after-hours work. Instead of rewriting attendance, reteach load, and class performance by hand at the end of the day, the teacher can download the report in one step and spend that time on follow-up.

This is why Arivonriyam is different from "RAG chatbot for education." It has memory of the day's class, knows which child struggled on what, and gives the teacher a next action — not just another answer box.

## 8. Validation and current state

This repository is a working proof-of-concept rather than a slide deck. Core product flows are already implemented and validated in code, and the ingestion package includes a retrieval benchmark script so the RAG layer can be measured directly rather than judged only by demo quality. Broader speech workflows, richer benchmark labels, and deeper classroom analytics are the next steps.

A government-school teacher who handles 20 students across standards alone has tried it; he/she shaped several design choices and confirmed it fits his/her daily routine. The full pipeline — ingest → retrieval → session → alerts → support plan → daily report — runs on a single local machine.

What the current system already proves: **Gemma 4 can act as a practical local co-teacher when it is embedded inside a grounded workflow instead of exposed as a generic chatbot.**

## 9. Why this should win

What makes Arivonriyam credible is not one flashy feature but the combination of constraints it respects.

- **Grounded, not generic:** hybrid retrieval, Tamil OCR recovery, ingest-time Gemma enrichment, and a confidence gate keep the system tied to textbook context instead of rewarding confident guessing.
- **Built for the actual deployment:** local Ollama, offline model caches, and a Postgres-backed workflow fit schools where connectivity is weak.
- **A real use of Gemma 4:** Gemma appears in six concrete places — planning, summarization, question generation, image captioning, and teacher follow-up — not one catch-all chat box.

## 10. Closing

The real opportunity in AI for education is not a flashier chat window. It is the moment before the bell when a teacher already knows which child confused the concept, has the right follow-up ready, and can reteach it in the language of the classroom.

The question we ask at the end of each school day is simple: **did the Class 3 child who missed the fraction question get reteached the right thing before going home?**

That is what Arivonriyam answers.
