"""Topic summarization — prints JSON to stdout for the Node.js subprocess.

Generates a RAG-grounded teacher introduction for a topic (~2–3 min speech).
Target: >= 260 words (primary-class pacing).

Output JSON shape (stdout):
{
    "intro":       str,    // one direct opening line naming the topic
  "content":     str,    // 3-4 paragraphs of core explanation
  "key_points":  list,   // 3-4 bullets
  "bridge":      str,    // 1-2 sentences leading into the question round
  "word_count":  int,
  "chunks_used": int
}

All stderr — diagnostic logs, model output noise, etc.
All stdout — exactly one JSON line (parsed by Node.js).
"""

import json
import sys
from typing import Dict, Any, List

from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

from retrieve import topic_retrieve

LLM_MODEL = "gemma4:latest"
_llm = ChatOllama(model=LLM_MODEL, temperature=0.3)


def _class_level(class_name: str) -> int:
    digits = "".join(ch for ch in class_name if ch.isdigit())
    if not digits:
        return 3
    try:
        return max(1, min(5, int(digits)))
    except Exception:
        return 3


def _context_block(chunks: List[Dict[str, Any]]) -> str:
    parts = []
    for i, c in enumerate(chunks, 1):
        part = f"[பகுதி {i}" if True else f"[Excerpt {i}"  # label doesn't matter
        part = f"[Excerpt {i}"
        if c.get("chapter"):
            part += f" — {c['chapter']}"
        part += f"]\n{c['text'].strip()}"
        if c.get("tables_html"):
            part += "\n" + "\n".join(c["tables_html"])
        parts.append(part)
    return "\n\n".join(parts)


def _build_prompt_ta(
    class_name: str, subject: str, topic: str, source: str, context: str
) -> str:
    class_level = _class_level(class_name)
    source_note = (
        "இது ஒரு சிறப்பு ஆசிரியர் செயல்பாடு."
        if source == "custom"
        else "இது பாடத்திட்டத்தின் அடிப்படையிலான பாடம்."
    )
    return "\n".join([
        "நீங்கள் ஒரு தமிழ் வழிக் கற்பித்தல் உதவியாளர்.",
        f"வகுப்பு: {class_name}  |  பாடம்: {subject}  |  தலைப்பு: {topic}",
        source_note,
        "",
        "கீழ்க்கண்ட பாடப்புத்தக பகுதிகளை மட்டுமே பயன்படுத்தவும்.",
        "உங்கள் சொந்த அறிவை சேர்க்காதீர்கள்.",
        "",
        "பாடப்புத்தக பகுதிகள்:",
        "=" * 40,
        context,
        "=" * 40,
        "",
        "கீழ்க்கண்ட JSON கட்டமைப்பில் ஆசிரியர் அறிமுகத்தை தமிழில் எழுதுக.",
        f"மட்டம்: வகுப்பு {class_level} (1-5 நிலை).",
        "தலைப்பை நேராகத் தொடங்கவும்.",
        "வாழ்த்து வேண்டுமானால் 'காலை வணக்கம்' போன்ற ஒரு சுருக்கமான வரி மட்டும் போதுமானது.",
        "கடினமான/மேம்பட்ட விளக்கங்களை தவிர்க்கவும்.",
        "மொத்த வார்த்தை எண்ணிக்கை: குறைந்தது 260 வார்த்தைகள் (~2–3 நிமிட பேச்சு).",
        "ஒவ்வொரு வாக்கியமும் பாடப்புத்தகத்திலிருந்து மட்டுமே உருவாக வேண்டும்.",
        "",
        "JSON மட்டுமே திரும்ப அனுப்பவும் (markdown fence இல்லாமல்):",
        '{',
        '  "intro":      "<தலைப்பை நேராகச் சொல்லும் ஒரு தொடக்க வரி>",',
        '  "content":    "<3-4 பத்திகள் — முக்கிய விளக்கம், எடுத்துக்காட்டுகள், தகவல்கள்>",',
        '  "key_points": ["<நினைவில் வைக்க 1>", "<2>", "<3>", "<4>"],',
        '  "bridge":     "<1-2 வாக்கியங்கள் — கேள்வி சுற்றுக்கு இணைப்பு>"',
        '}',
    ])


def _build_prompt_en(
    class_name: str, subject: str, topic: str, source: str, context: str
) -> str:
    class_level = _class_level(class_name)
    source_note = (
        "This is a special teacher-created activity."
        if source == "custom"
        else "This is from the standard school curriculum."
    )
    return "\n".join([
        "You are a primary school teaching assistant.",
        f"Class: {class_name}  |  Subject: {subject}  |  Topic: {topic}",
        source_note,
        "",
        "Use ONLY the textbook excerpts below. Do not add external facts.",
        "",
        "TEXTBOOK EXCERPTS:",
        "=" * 40,
        context,
        "=" * 40,
        "",
        "Write a teacher introduction as JSON below.",
        f"Target level: Class {class_level} (Class 1-5 stage).",
        "Start directly with the topic.",
        "If you greet, use only one very short greeting sentence and then move into the topic.",
        "Avoid advanced explanations beyond primary level.",
        "Total word count: at least 260 words (~2–3 minutes of speaking).",
        "Every sentence must come from the excerpts above.",
        "",
        "Return ONLY this JSON (no markdown fences):",
        '{',
        '  "intro":      "<one direct opening sentence naming the topic>",',
        '  "content":    "<3-4 paragraphs: core explanation, examples, key facts>",',
        '  "key_points": ["<point 1>", "<2>", "<3>", "<4>"],',
        '  "bridge":     "<1-2 sentences leading into the question round>"',
        '}',
    ])


def generate_topic_summary(
    class_name: str,
    subject: str,
    topic: str,
    source: str = "curriculum",
    lang: str = "ta",
    top_k: int = 12,
) -> Dict[str, Any]:
    chunks = topic_retrieve(class_name, subject, topic, top_k=top_k)
    good = [c for c in chunks if c["score"] >= 0.15]

    if not good:
        msg = (
            f"'{topic}' பற்றிய பாடப்புத்தக தகவல் கிடைக்கவில்லை."
            if lang == "ta"
            else f"No textbook content found for '{topic}'."
        )
        return {"intro": msg, "content": "", "key_points": [], "bridge": "",
                "word_count": 0, "chunks_used": 0}

    context = _context_block(good)
    prompt = _build_prompt_ta(class_name, subject, topic, source, context) \
        if lang == "ta" \
        else _build_prompt_en(class_name, subject, topic, source, context)

    try:
        raw = _llm.invoke([HumanMessage(content=prompt)]).content.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1][4:] if parts[1].startswith("json") else parts[1]
        parsed = json.loads(raw)
    except Exception as e:
        print(f"⚠️  summarize parse failed: {e}", file=sys.stderr)
        return {
            "intro":      context[:300],
            "content":    context[300:1800],
            "key_points": [],
            "bridge":     "",
            "word_count": len(context.split()),
            "chunks_used": len(good),
        }

    all_text = " ".join([
        parsed.get("intro", ""),
        parsed.get("content", ""),
        " ".join(parsed.get("key_points", [])),
        parsed.get("bridge", ""),
    ])

    return {
        "intro":       parsed.get("intro", ""),
        "content":     parsed.get("content", ""),
        "key_points":  parsed.get("key_points", []),
        "bridge":      parsed.get("bridge", ""),
        "word_count":  len(all_text.split()),
        "chunks_used": len(good),
    }


def run_summarize(
    class_name: str, subject: str, topic: str, source: str, lang: str, top_k: int
) -> None:
    result = generate_topic_summary(class_name, subject, topic, source, lang, top_k)
    print(json.dumps(result, ensure_ascii=False))
