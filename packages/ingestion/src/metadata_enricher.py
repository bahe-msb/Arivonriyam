"""Metadata enrichment: structural metadata + LLM-generated question/keywords per chunk.

Question generation is language-aware: Tamil chunks get Tamil questions,
Telugu chunks get Telugu questions, English chunks get English questions.
Bilingual chunks get Tamil + English.
"""

import logging
import re
import time

from langchain_core.documents import Document
from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

from settings import get_pipeline_settings
from schema import ChunkMeta, DominantLanguage
from utils.tamil_semantics import extract_concept_hints

logger = logging.getLogger(__name__)
_SETTINGS = get_pipeline_settings()

LLM_MODEL = "gemma4:latest"

# Tamil-only prompt — for Tamil chunks
_PROMPT_TA = """\
நீங்கள் ஒரு தமிழ் ஆசிரியர். கீழே உள்ள பாட உள்ளடக்கத்தை படிக்கவும்:

---
{chunk_text}
---

இந்த உள்ளடக்கத்திற்கு மாணவர் கேட்கக்கூடிய ஒரு கேள்வியை தமிழில் மட்டும் எழுதுங்கள்.
வடிவம்:
question: <கேள்வி தமிழில்>
keywords: <3-5 முக்கிய சொற்கள், கமாவால் பிரிக்கப்பட்டவை>

Only output the above format. Nothing else."""

# English-only prompt — for English chunks
_PROMPT_EN = """\
You are a school teacher. Read the following lesson content:

---
{chunk_text}
---

Write one question a student might ask about this content, in English only.
Format:
question: <question in English>
keywords: <3-5 key terms, comma separated>

Only output the above format. Nothing else."""

# Telugu-only prompt — for Telugu chunks
_PROMPT_TE = """\
మీరు ఒక పాఠశాల ఉపాధ్యాయులు. క్రింది పాఠ్య విషయాన్ని చదవండి:

---
{chunk_text}
---

ఈ విషయంపై విద్యార్థి అడగగల ఒక ప్రశ్నను తెలుగులో మాత్రమే రాయండి.
Format:
question: <ప్రశ్న తెలుగులో>
keywords: <3-5 ముఖ్య పదాలు, కామాతో విడదీయండి>

Only output the above format. Nothing else."""

# Bilingual prompt — for mixed chunks
_PROMPT_BI = """\
You are a bilingual school teacher. Read the following lesson content:

---
{chunk_text}
---

Write one student question in Tamil and one in English based on this content.
Format:
tamil_question: <கேள்வி தமிழில்>
english_question: <question in English>
keywords: <3-5 key terms, comma separated>

Only output the above format. Nothing else."""

_RE_QUESTION    = re.compile(r"^question:\s*(.+)", re.MULTILINE)
_RE_TAMIL_Q     = re.compile(r"^tamil_question:\s*(.+)", re.MULTILINE)
_RE_ENGLISH_Q   = re.compile(r"^english_question:\s*(.+)", re.MULTILINE)
_RE_KEYWORDS    = re.compile(r"^keywords:\s*(.+)", re.MULTILINE)


def _select_prompt(lang: str) -> str:
    if lang == DominantLanguage.TAMIL:
        return _PROMPT_TA
    if lang == DominantLanguage.TELUGU:
        return _PROMPT_TE
    if lang == DominantLanguage.ENGLISH:
        return _PROMPT_EN
    return _PROMPT_BI


def _parse_response(raw: str, lang: str) -> tuple[str, str, str, list[str]]:
    """Parse LLM response into (tamil_q, telugu_q, english_q, keywords)."""
    kw_match = _RE_KEYWORDS.search(raw)
    keywords = [k.strip() for k in kw_match.group(1).split(",") if k.strip()] if kw_match else []

    if lang == DominantLanguage.TAMIL:
        m = _RE_QUESTION.search(raw)
        q = m.group(1).strip() if m else ""
        return q, "", "", keywords

    if lang == DominantLanguage.TELUGU:
        m = _RE_QUESTION.search(raw)
        q = m.group(1).strip() if m else ""
        return "", q, "", keywords

    if lang == DominantLanguage.ENGLISH:
        m = _RE_QUESTION.search(raw)
        q = m.group(1).strip() if m else ""
        return "", "", q, keywords

    # bilingual
    tq = _RE_TAMIL_Q.search(raw)
    eq = _RE_ENGLISH_Q.search(raw)
    return (
        tq.group(1).strip() if tq else "",
        "",
        eq.group(1).strip() if eq else "",
        keywords,
    )


def _structural_prefix_lines(
    chunk: dict,
    standard: int,
    subject: str,
    chapter_title: str,
) -> list[str]:
    if not _SETTINGS.embedding.prepend_structural_metadata:
        return []

    lines = [
        f"[Class: {standard}]",
        f"[Subject: {subject}]",
    ]
    if chapter_title:
        lines.append(f"[Chapter: {chapter_title}]")

    topic_title = chunk.get("topic_title") or chunk.get("section_title") or ""
    if topic_title:
        lines.append(f"[Topic: {topic_title}]")

    concept_hints = extract_concept_hints(
        chunk.get("text", ""),
        limit=_SETTINGS.embedding.max_concept_hints,
    )
    for hint in concept_hints:
        parts = [hint["tamil"]]
        if _SETTINGS.embedding.include_transliteration and hint["transliteration"]:
            parts.append(hint["transliteration"])
        if _SETTINGS.embedding.include_english_hints and hint["english"]:
            parts.append(hint["english"])
        if len(parts) > 1:
            lines.append(f"[Concept: {' | '.join(parts)}]")

    return lines


class MetadataEnricher:
    """Attaches structural + LLM-generated metadata to each chunk dict."""

    def __init__(self, generate_questions: bool = True):
        self._gen_questions = generate_questions
        self._llm: ChatOllama | None = None

    def _get_llm(self) -> ChatOllama:
        if self._llm is None:
            self._llm = ChatOllama(model=LLM_MODEL, temperature=0)
        return self._llm

    def _generate_question(
        self, text: str, lang: str, index: int, total: int
    ) -> tuple[str, str, str, list[str]]:
        """Generate a question for one chunk in its dominant language."""
        logger.info("[%d/%d] Generating question (lang=%s)", index, total, lang)
        prompt = _select_prompt(lang).format(chunk_text=text[:600])
        try:
            raw = self._get_llm().invoke([HumanMessage(content=prompt)]).content
            return _parse_response(raw, lang)
        except Exception as e:
            logger.warning("[%d/%d] Question generation failed: %s", index, total, e)
            return ("", "", "", [])

    def enrich(
        self,
        chunks: list[dict],
        source_file: str,
        subject: str,
        standard: int,
        chapter_title: str = "",
        chapter_number: int = 0,
    ) -> list[Document]:
        """
        Convert chunk dicts to LangChain Documents with full metadata.

        Question language matches the chunk's dominant language:
          Tamil chunk  → Tamil question only
          English chunk → English question only
          Bilingual     → both

        Args:
            chunks:         Output from SemanticChunker.chunk().
            source_file:    Original PDF filename.
            subject:        Subject name ('tamil', 'maths', 'science').
            standard:       Grade (1–10).
            chapter_title:  Chapter title string.
            chapter_number: Chapter sequence number.

        Returns:
            List of LangChain Documents ready for embedding.
        """
        total = len(chunks)
        docs: list[Document] = []

        if self._gen_questions:
            logger.info("Question generation: %d chunks via LLM (this is slow — use --no-questions to skip)", total)
        t_enrich_start = time.time()

        for i, chunk in enumerate(chunks):
            lang: str = chunk["dominant_language"]

            if self._gen_questions:
                t0 = time.time()
                tq, teq, eq, kw = self._generate_question(chunk["text"], lang, i + 1, total)
                logger.info("  [%d/%d] question generated in %.1fs", i + 1, total, time.time() - t0)
            else:
                tq, teq, eq, kw = "", "", "", []

            # Per-chunk chapter overrides the document-level fallback
            eff_chapter_title  = chunk.get("chapter_title")  or chapter_title
            eff_chapter_number = chunk.get("chapter_number") or chapter_number

            meta = ChunkMeta(
                source_file=source_file,
                subject=subject,
                standard=standard,
                chapter_number=eff_chapter_number,
                chapter_title=eff_chapter_title,
                topic_title=chunk.get("topic_title", ""),
                section_title=chunk.get("section_title", ""),
                section_role=chunk.get("section_role", ""),
                page_number=chunk.get("page_number", 0),
                element_type=chunk["element_type"],
                dominant_language=lang,
                is_math_expression=chunk["is_math_expression"],
                chunk_index=i,
                total_chunks_in_chapter=total,
                chunk_hash=chunk["chunk_hash"],
                hypothetical_question_tamil=tq,
                hypothetical_question_telugu=teq,
                hypothetical_question_english=eq,
                keywords=kw,
            )

            # page_content = HyDE-enriched text (question + clean content) so
            # that cosine similarity matches well during retrieval.
            # The raw clean text is also stored in metadata["raw_text"] so
            # retrieve.py can surface it to the summarizer without the prefix.
            question = tq or teq or eq
            if lang == DominantLanguage.TAMIL and tq:
                prefix_label = "கேள்வி"
                content_label = "உள்ளடக்கம்"
            elif lang == DominantLanguage.TELUGU and teq:
                prefix_label = "ప్రశ్న"
                content_label = "విషయం"
            else:
                prefix_label = "Question"
                content_label = "Content"

            base_content = (
                f"{prefix_label}: {question}\n\n{content_label}: {chunk['text']}"
                if question
                else chunk["text"]
            )
            structural_prefix = _structural_prefix_lines(
                chunk,
                standard=standard,
                subject=subject,
                chapter_title=eff_chapter_title,
            )
            enriched = (
                "\n".join(structural_prefix) + "\n\n" + base_content
                if structural_prefix
                else base_content
            )

            flat = meta.model_dump()
            flat["keywords"] = ",".join(flat.get("keywords") or [])
            flat["raw_text"] = chunk["text"]   # clean text without HyDE prefix
            docs.append(Document(page_content=enriched, metadata=flat))

        logger.info("Enrichment done: %d docs in %.1fs", len(docs), time.time() - t_enrich_start)
        return docs
