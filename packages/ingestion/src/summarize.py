"""Topic summarization — prints JSON to stdout for the Node.js subprocess.

Generates a RAG-grounded, child-friendly teacher introduction for a topic.
Target audience: Grades 1–5, Tamil-medium government schools.
Output JSON shape (stdout):
{
    "intro":       str,    // one warm opening line naming the topic
    "content":     str,    // 3-4 child-friendly paragraphs with examples / image context
    "key_points":  list,   // 3-4 short recap bullets
    "bridge":      str,    // 1-2 sentences leading into the question round
    "word_count":  int,
    "chunks_used": int
}

All stderr — diagnostic logs.
All stdout — exactly one JSON line (parsed by Node.js).
"""

import json
import logging
import sys
from typing import Dict, Any, List

from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

logger = logging.getLogger(__name__)

from retrieve import topic_retrieve

LLM_MODEL = "gemma4:latest"
_llm      = ChatOllama(model=LLM_MODEL, temperature=0.3)
_llm_json = ChatOllama(model=LLM_MODEL, temperature=0.3, format="json")

# Element-type sort priority — definitions/formulas first, body last
_ETYPE_PRIORITY = {
    "definition":      0,
    "theorem":         1,
    "formula":         2,
    "example":         3,
    "table":           4,
    "diagram_caption": 5,
    "summary":         6,
    "body":            7,
    "exercise":        8,
}


def _class_level(class_name: str) -> int:
    digits = "".join(ch for ch in class_name if ch.isdigit())
    if not digits:
        return 3
    try:
        return max(1, min(5, int(digits)))
    except Exception:
        return 3


def _grade_guidance(level: int, lang: str) -> str:
    """Return grade-appropriate vocabulary / depth guidance."""
    if lang == "ta":
        guides = {
            1: "மிக எளிய சொற்கள். ஒவ்வொரு வாக்கியமும் 8 சொற்களுக்கு மிகாமல் இருக்க வேண்டும். வீட்டு உதாரணங்கள் மட்டும்.",
            2: "எளிய சொற்கள். வாக்கியங்கள் சுருக்கமாகவும் தெளிவாகவும் இருக்க வேண்டும். பள்ளி அல்லது வீட்டு உதாரணங்கள்.",
            3: "அன்றாட வாழ்க்கை உதாரணங்கள். புதிய சொற்களை உடனே எளிமையாக விளக்கவும்.",
            4: "உதாரணங்கள், ஒப்புமைகள். இரண்டு அல்லது மூன்று புதிய சொற்கள் சரி; விளக்கம் அவசியம்.",
            5: "சிறிய ஆழமான விளக்கங்கள். வழிமுறை சொற்கள் சரி ஆனால் ஒவ்வொன்றையும் விளக்கவும்.",
        }
    else:
        guides = {
            1: "Very short sentences (max 8 words). Use only home objects as examples.",
            2: "Short clear sentences. Home or classroom examples only.",
            3: "Everyday examples. Explain each new word immediately in simple terms.",
            4: "Use analogies. Two or three new terms are fine if explained.",
            5: "Slightly deeper explanations allowed. Define each subject-specific term.",
        }
    return guides.get(level, guides[3])


def _context_block(chunks: List[Dict[str, Any]]) -> str:
    """Build a multimodal-aware context string from retrieved chunks.

    Chunks are sorted by pedagogical priority and labelled by element type
    so the LLM knows how to handle tables, formulas, and image captions
    differently from plain body text.
    """
    sorted_chunks = sorted(
        chunks,
        key=lambda c: _ETYPE_PRIORITY.get(c.get("element_type", "body"), 7),
    )

    parts = []
    for i, c in enumerate(sorted_chunks, 1):
        etype = c.get("element_type", "body")
        text = c.get("text", "").strip()
        tables = c.get("tables_html", [])
        chapter = c.get("chapter", "")

        if etype == "table":
            label = f"[TABLE {i} — explain the meaning of this table in plain child-friendly sentences; do NOT reproduce it as a table]"
            body = text
            if tables:
                body += "\nRaw table data:\n" + "\n".join(tables)
        elif etype == "formula":
            label = f"[FORMULA/RULE {i}]"
            body = text
        elif etype == "diagram_caption":
            label = f"[IMAGE CAPTION {i} — describe what students would see in this picture and what to observe]"
            body = text
        elif etype == "definition":
            label = f"[DEFINITION {i}]"
            body = text
        elif etype == "example":
            label = f"[EXAMPLE {i}]"
            body = text
        else:
            label = f"[EXCERPT {i}" + (f" — {chapter}" if chapter else "") + "]"
            body = text

        parts.append(f"{label}\n{body}")

    return "\n\n".join(parts)


def _build_prompt_ta(
    class_name: str, subject: str, topic: str, source: str, context: str
) -> str:
    level = _class_level(class_name)
    grade_note = _grade_guidance(level, "ta")
    has_image = "IMAGE CAPTION" in context
    has_table = "TABLE" in context
    has_formula = "FORMULA" in context

    multimodal_notes = []
    if has_image:
        multimodal_notes.append(
            "படக் குறிப்பு (IMAGE CAPTION) இருந்தால்: மாணவர் அந்தப் படத்தில் என்ன பார்ப்பார் என்று 1-2 வாக்கியங்களில் விளக்கவும்."
        )
    if has_table:
        multimodal_notes.append(
            "அட்டவணை (TABLE) இருந்தால்: அதை அட்டவணையாக வைக்காமல் எளிய வாக்கியங்களாக மாற்றி விளக்கவும்."
        )
    if has_formula:
        multimodal_notes.append(
            "சூத்திரம் (FORMULA) இருந்தால்: அதை அன்றாட வாழ்க்கை உதாரணத்துடன் இணைத்து விளக்கவும்."
        )

    source_note = (
        "இது ஆசிரியர் தேர்ந்தெடுத்த சிறப்பு செயல்பாடு."
        if source == "custom"
        else "இது பாடத்திட்டத்தின் அடிப்படையிலான பாடம்."
    )

    return "\n".join(filter(None, [
        "நீங்கள் ஒரு அன்பான, விளையாட்டான தமிழ் ஆரம்பப்பள்ளி ஆசிரியர்.",
        "நீங்கள் ஒரு உண்மையான வகுப்பறை ஆசிரியர் போல பேசுங்கள் — பாடப்புத்தகம் அல்லது chatbot போல அல்ல.",
        f"உங்கள் மாணவர்கள் வகுப்பு {level} தொடக்கப்பள்ளி மாணவர்கள்.",
        f"வகுப்பு: {class_name}  |  பாடம்: {subject}  |  தலைப்பு: {topic}",
        source_note,
        "",
        f"மாணவர் நிலை: வகுப்பு {level}. {grade_note}",
        "",
        "எழுதும் நடை விதிகள் (மிக முக்கியம்):",
        "• தொடர்ச்சியான, பாயும் உரைநடையில் எழுதுங்கள் — ChatGPT அல்லது நல்ல ஆசிரியர் விளக்குவது போல.",
        "• Emojis-ஐ தனி வரிகளில் அல்லது தனிப்பட்ட புள்ளிகளாக வைக்காதீர்கள்.",
        "• Emojis வாக்கியங்களுக்குள் இயல்பாக இருக்க வேண்டும்: 'சூரியன் ☀️ நமக்கு ஒளியையும் வெப்பத்தையும் தருகிறது.'",
        "• ஒவ்வொரு பத்தியும் 3-5 வாக்கியங்கள் தொடர்ச்சியான உரையாக இருக்க வேண்டும், துண்டு துண்டான சிறிய வரிகள் அல்ல.",
        "• கதை சொல்வது போல பேசுங்கள், குறிப்புகளை ஓதுவது போல அல்ல.",
        "• உரையாடல் இருந்தால் இப்படி எழுதுங்கள்:",
        "  ஆசிரியர்: <ஆசிரியர் சொல்வது>",
        "  மாணவர்: <மாணவர் சொல்வது>",
        "• கணிதம் என்றால்: '🍎 + 🍎 = 2 ஆப்பிள்கள்!' போன்ற emoji காட்சிகளை வாக்கியங்களுக்குள் பயன்படுத்துங்கள்.",
        "• கீழே உள்ள பாடப்புத்தக பகுதிகளை மட்டுமே பயன்படுத்தவும்.",
        "• உங்கள் சொந்த அறிவை சேர்க்காதீர்கள்.",
        "• 'கற்போம்', 'பார்ப்போம்', 'கற்பனை செய்', 'என்ன நடக்கும் தெரியுமா?' போன்ற ஆர்வமூட்டும் சொற்களை பயன்படுத்தவும்.",
        "• ஒவ்வொரு வாக்கியமும் முழுமையாக இருக்க வேண்டும் — பாதியில் முடிக்கக் கூடாது.",
        "• உதாரணங்களை வீடு, பள்ளி, இயற்கை என்று தேர்ந்தெடுக்கவும்.",
        *([f"• {note}" for note in multimodal_notes] if multimodal_notes else []),
        "",
        "பாடப்புத்தக பகுதிகள்:",
        "=" * 40,
        context,
        "=" * 40,
        "",
        "கீழ்க்கண்ட JSON கட்டமைப்பில் ஆசிரியர் அறிமுகத்தை தமிழில் எழுதுக:",
        "",
        "intro   → தலைப்பை அன்பான வகையில் நேராகத் தொடங்கும் 1-2 வாக்கியங்கள்.",
        "           எடுத்துக்காட்டு: 'காலை வணக்கம் குழந்தைகளே! 🌞 இன்று நாம் … பற்றி பார்க்கப் போகிறோம். இது மிகவும் சுவாரஸ்யமான பாடம்!'",
        "",
        "content → 3-4 பத்திகள். ஒவ்வொரு பத்தியிலும்:",
        "           - முக்கிய கருத்து மிக எளிய சொற்களில்",
        "           - 'கற்பனை செய்… / இதை இப்படி நினைத்துக்கொள்…' போன்ற ஒப்புமை",
        "           - அன்றாட உதாரணம் (வீடு / வகுப்பறை / இயற்கை) emoji-களுடன்",
        "           - உரையாடல் இருந்தால் ஆசிரியர்: / மாணவர்: வடிவத்தில் எழுதவும்",
        "           - படம் அல்லது அட்டவணை இருந்தால் அதன் பொருளை எளிய சொற்களில்",
        "           பத்திகளை \\n\\n ஆல் பிரிக்கவும்.",
        "",
        "key_points → 3-4 சுருக்கமான நினைவூட்டல் புள்ளிகள்.",
        "              ஒவ்வொன்றும் ஒரே ஒரு எளிய வாக்கியம் மட்டும்.",
        "",
        "bridge → 1-2 வாக்கியங்கள். MCQ கேள்வி சுற்றுக்கு மென்மையாக இணைக்கவும்.",
        "          எடுத்துக்காட்டு: 'சரி, இப்போது கொஞ்சம் கேள்விகளுக்கு பதில் சொல்லலாம், சரியா?'",
        "",
        f"மொத்த வார்த்தை எண்ணிக்கை: குறைந்தது 260 வார்த்தைகள் (~2–3 நிமிட பேச்சு).",
        "",
        "JSON மட்டுமே திரும்ப அனுப்பவும் (markdown fence இல்லாமல்):",
        '{',
        '  "intro":      "<தொடக்க வரிகள்>",',
        '  "content":    "<3-4 பத்திகள், \\n\\n ஆல் பிரிக்கப்பட்டவை>",',
        '  "key_points": ["<நினைவூட்டல் 1>", "<2>", "<3>", "<4>"],',
        '  "bridge":     "<MCQ சுற்றுக்கான இணைப்பு வரிகள்>"',
        '}',
    ]))


def _build_prompt_en(
    class_name: str, subject: str, topic: str, source: str, context: str
) -> str:
    level = _class_level(class_name)
    grade_note = _grade_guidance(level, "en")
    has_image = "IMAGE CAPTION" in context
    has_table = "TABLE" in context
    has_formula = "FORMULA" in context

    multimodal_notes = []
    if has_image:
        multimodal_notes.append(
            "IMAGE CAPTION present: describe in 1-2 sentences what the student would see in that picture and what to observe."
        )
    if has_table:
        multimodal_notes.append(
            "TABLE present: convert it to plain sentences a child can understand — do NOT reproduce it as a table."
        )
    if has_formula:
        multimodal_notes.append(
            "FORMULA present: explain it using an everyday example, not just the equation."
        )

    source_note = (
        "This is a special teacher-created activity."
        if source == "custom"
        else "This is from the standard school curriculum."
    )

    return "\n".join(filter(None, [
        "You are a warm, playful, and encouraging primary school teacher who loves children.",
        "You speak like a real classroom teacher — not like a textbook or a chatbot.",
        f"Your students are Class {level} primary school students.",
        f"Class: {class_name}  |  Subject: {subject}  |  Topic: {topic}",
        source_note,
        "",
        f"Student level: Class {level}. {grade_note}",
        "",
        "WRITING STYLE RULES (very important):",
        "• Write in flowing, continuous prose — like how ChatGPT or a good teacher would explain.",
        "• Do NOT put emojis on separate lines or as isolated bullet points.",
        "• Emojis should be INLINE within sentences naturally: 'The sun ☀️ gives us light and warmth.'",
        "• Each paragraph should be 3-5 sentences of flowing text, not fragmented short lines.",
        "• Talk like a teacher telling a story, not dictating bullet points.",
        "• If there is a conversation or dialogue in the text, format it as:",
        "  Teacher: <what teacher says>",
        "  Student: <what student says>",
        "• For math topics: use emoji visuals inline like '🍎 + 🍎 = 2 apples!' within sentences.",
        "• Use ONLY the textbook excerpts below. Do not add external facts.",
        "• Use encouraging phrases: 'Let us see…', 'Imagine you are…', 'Think of it like…', 'Can you guess?'",
        "• Ask rhetorical questions: 'What do you think happens next?', 'Have you seen this at home?'",
        "• Every sentence must be complete — no mid-thought truncation.",
        "• Choose examples from home, classroom, or nature.",
        *([f"• {note}" for note in multimodal_notes] if multimodal_notes else []),
        "",
        "TEXTBOOK EXCERPTS:",
        "=" * 40,
        context,
        "=" * 40,
        "",
        "Write a teacher introduction as JSON:",
        "",
        "intro   → 1-2 warm sentences that open the topic directly.",
        "           Example: 'Good morning little ones! 🌞 Today we are going to explore … together. It is going to be so much fun!'",
        "",
        "content → 3-4 paragraphs of FLOWING, CONTINUOUS prose. Each paragraph should be 3-5 sentences.",
        "           Write like ChatGPT explaining something — natural flowing text, not bullet points.",
        "           Each paragraph must include:",
        "           - The core idea in the simplest possible words",
        "           - An analogy: 'Think of it like…' or 'Imagine you are seeing…'",
        "           - A real-life example (home / classroom / nature) with emojis inline",
        "           - If the text has a dialogue, write it as Teacher: / Student: conversation",
        "           - If image or table is present, explain it in plain child-friendly words",
        "           IMPORTANT: Do NOT use bullet points or lists in content. Write flowing paragraphs.",
        "           Separate paragraphs with \\n\\n.",
        "",
        "key_points → 3-4 short one-sentence recap bullets the student should remember.",
        "              Use emojis to make them memorable: '🌳 Trees give us oxygen.'",
        "",
        "bridge → 1-2 sentences. Naturally lead into the MCQ question round.",
        "          Example: 'Great job listening! 🎉 Now let us try a few fun questions together. Ready?'",
        "",
        f"Total word count: at least 260 words (~2–3 minutes of speaking).",
        "",
        "Return ONLY this JSON (no markdown fences):",
        '{',
        '  "intro":      "<warm opening sentences>",',
        '  "content":    "<3-4 paragraphs separated by \\n\\n>",',
        '  "key_points": ["<recap 1>", "<2>", "<3>", "<4>"],',
        '  "bridge":     "<transition into MCQ round>"',
        '}',
    ]))


def _ensure_complete_sentences(text: str) -> str:
    """Add a period to any line that doesn't end with sentence-final punctuation."""
    lines = text.split("\n")
    fixed = []
    for line in lines:
        stripped = line.rstrip()
        if stripped and not stripped[-1] in ".!?":
            stripped += "."
        fixed.append(stripped)
    return "\n".join(fixed)


def _build_multimodal_message(prompt: str, images: List[str]) -> HumanMessage:
    """Build a HumanMessage with text prompt + base64 images for vision models."""
    if not images:
        return HumanMessage(content=prompt)
    content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    for b64 in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })
    return HumanMessage(content=content)


def generate_topic_summary(
    class_name: str,
    subject: str,
    topic: str,
    source: str = "curriculum",
    lang: str = "ta",
    top_k: int = 12,
) -> Dict[str, Any]:
    chunks = topic_retrieve(class_name, subject, topic, top_k=top_k)
    # Use a meaningful cosine threshold; fall back to the best available if
    # nothing clears the bar (avoids empty context on edge-case topics).
    THRESHOLD = 0.25
    good = [c for c in chunks if c["score"] >= THRESHOLD]
    if not good and chunks:
        best = max(c["score"] for c in chunks)
        logger.warning(
            "No chunks above %.2f for '%s'; best=%.3f — using all %d chunks",
            THRESHOLD, topic, best, len(chunks),
        )
        good = chunks

    if not good:
        msg = (
            f"'{topic}' பற்றிய பாடப்புத்தக தகவல் கிடைக்கவில்லை."
            if lang == "ta"
            else f"No textbook content found for '{topic}'."
        )
        return {"intro": msg, "content": "", "key_points": [], "bridge": "",
                "word_count": 0, "chunks_used": 0}

    # Collect images across all retrieved chunks (dedup by value)
    seen_b64: set[str] = set()
    all_images: List[str] = []
    for c in good:
        for b64 in c.get("images_base64", []):
            if b64 and b64 not in seen_b64:
                seen_b64.add(b64)
                all_images.append(b64)

    n_images = len(all_images)
    print(f"Images in summarization: {n_images}", file=sys.stderr)

    context = _context_block(good)
    prompt = _build_prompt_ta(class_name, subject, topic, source, context) \
        if lang == "ta" \
        else _build_prompt_en(class_name, subject, topic, source, context)

    text_msg = HumanMessage(content=prompt)
    # Try multimodal first (only if there are images); fall back to text-only
    first_msg = _build_multimodal_message(prompt, all_images) if all_images else text_msg

    def _parse_raw(raw: str) -> dict:
        raw = raw.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1][4:].strip() if parts[1].startswith("json") else parts[1].strip()
        if not raw:
            raise ValueError("empty response")
        parsed = json.loads(raw)
        # Reject if model echoed placeholders (angle-bracket template values)
        if "<" in parsed.get("intro", "") or "<" in parsed.get("content", ""):
            raise ValueError("placeholder response — model echoed the template")
        if not parsed.get("intro", "").strip() or not parsed.get("content", "").strip():
            raise ValueError("blank intro/content")
        return parsed

    parsed = None
    # Attempt 1: multimodal (images + text) if images present
    if all_images:
        try:
            raw = _llm_json.invoke([first_msg]).content
            parsed = _parse_raw(raw)
        except Exception as e1:
            print(f"⚠️  multimodal attempt failed ({e1}) — retrying text-only", file=sys.stderr)

    # Attempt 2: text-only (always runs if attempt 1 skipped or failed)
    if parsed is None:
        try:
            raw2 = _llm_json.invoke([text_msg]).content
            parsed = _parse_raw(raw2)
        except Exception as e2:
            print(f"⚠️  summarize parse failed: {e2}", file=sys.stderr)

    if parsed is None:
        return {
            "intro":      context[:300],
            "content":    context[300:1800],
            "key_points": [],
            "bridge":     "",
            "word_count": len(context.split()),
            "chunks_used": len(good),
        }

    # Post-process: ensure no truncated sentences
    content_fixed = _ensure_complete_sentences(parsed.get("content", ""))
    intro_fixed   = _ensure_complete_sentences(parsed.get("intro", ""))
    bridge_fixed  = _ensure_complete_sentences(parsed.get("bridge", ""))
    key_points    = [
        _ensure_complete_sentences(p)
        for p in parsed.get("key_points", [])
        if isinstance(p, str) and p.strip()
    ]

    all_text = " ".join([intro_fixed, content_fixed, " ".join(key_points), bridge_fixed])

    return {
        "intro":        intro_fixed,
        "content":      content_fixed,
        "key_points":   key_points,
        "bridge":       bridge_fixed,
        "word_count":   len(all_text.split()),
        "chunks_used":  len(good),
        "images_count": n_images,
        "images_base64": all_images[:6],
        "exercise_chunks": [
            {"text": c["text"], "page": c.get("page", 0)}
            for c in good
            if c.get("element_type") == "exercise" and c.get("text", "").strip()
        ][:6],
    }


def run_summarize(
    class_name: str, subject: str, topic: str, source: str, lang: str, top_k: int
) -> None:
    result = generate_topic_summary(class_name, subject, topic, source, lang, top_k)
    print(json.dumps(result, ensure_ascii=False))
