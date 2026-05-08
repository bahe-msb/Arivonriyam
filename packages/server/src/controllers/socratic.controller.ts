import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import {
  generateLlmJson,
  retrieveTopicChunks,
  summarizeTopic,
  type RetrieverChunk,
} from "../repositories";

interface SummarizeBody {
  topic?: string;
  subject?: string;
  className?: string;
  source?: string;
  studentCount?: number;
}

interface SocraticQuestion {
  q: string;
  options: string[];
  answerIndex: number;
  explain: string;
}

interface SummaryShape {
  intro: string;
  content: string;
  key_points: string[];
  bridge: string;
  word_count: number;
  chunks_used: number;
  images_base64?: string[];
  exercise_chunks?: Array<{ text: string; page: number }>;
}

interface WikiSearchResponse {
  query?: {
    search?: Array<{ title?: string }>;
  };
}

interface WikiSummaryResponse {
  title?: string;
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
}

interface WebSnippet {
  title: string;
  summary: string;
  url: string;
}

interface PreviewCard {
  title: string;
  caption: string;
  badge: string;
  imageDataUrl?: string;
}

interface AlertSuggestionBody {
  className?: string;
  studentName?: string;
  topic?: string;
  subject?: string;
  totalQuestions?: number;
  incorrectCount?: number;
  missedQuestions?: Array<{
    question?: string;
    selectedOption?: string;
    correctOption?: string;
    explain?: string;
  }>;
}

interface AlertSuggestionShape {
  gapSummary: string;
  focusAreas: string[];
  teacherActions: string[];
  encouragement: string;
}

type SupportedLanguage = "en" | "ta";

const QUESTIONS_PER_STUDENT = 6;
const MIN_SUMMARY_WORDS = 260;
const DEFAULT_CLASS_LEVEL = 3;
const MAX_CLASS_LEVEL = 5;
const MAX_PREVIEW_CARDS = 3;

/**
 * POST /api/socratic/summarize
 *
 * Generates a RAG-grounded teacher introduction for the Socratic session.
 * Content comes from the textbook via Python subprocess (summarize.py).
 * Output is structured for ~2–3 minutes of teacher speech (>=260 words).
 *
 * Response:
 * {
 *   intro:       string          welcoming sentences naming the topic
 *   content:     string          3-4 paragraphs of core explanation
 *   key_points:  string[]        3-4 bullets to remember
 *   bridge:      string          transition into question round
 *   word_count:  number
 *   chunks_used: number          0 = no RAG context found
 *   lines:       string[]        flat list for backward-compat
 *   language:    "en" | "ta"
 *   questionsPerStudent: number  fixed to 6
 *   questions:   SocraticQuestion[]
 * }
 */
export async function postSocraticSummarize(req: Request, res: Response): Promise<void> {
  const {
    topic,
    subject,
    className = "class_1",
    source = "curriculum",
    studentCount,
  } = req.body as SummarizeBody;

  if (!topic || !subject) {
    res.status(400).json({ error: "topic and subject are required" });
    return;
  }

  try {
    const targetLanguage = await _resolveSessionLanguage(className, subject, topic);
    const sourceMode = source === "custom" ? "custom" : "curriculum";
    const classLevel = _extractClassLevel(className);
    const safeStudentCount = Math.max(
      1,
      Math.min(12, Number.isFinite(studentCount) ? Math.floor(Number(studentCount)) : 4),
    );
    const totalQuestionCount = safeStudentCount * QUESTIONS_PER_STUDENT;

    let effective: SummaryShape | null = null;

    if (sourceMode === "custom") {
      // Custom topics are summarized using child-safe web notes + class-level constraints.
      effective = await _buildCustomTopicSummary(topic, subject, classLevel, targetLanguage);
    } else {
      // Curriculum topics must stay textbook-grounded.
      const summary = await summarizeTopic(className, subject, topic, sourceMode, targetLanguage);
      if (summary && summary.chunks_used > 0) {
        const normalized = _normalizeSummary(summary);
        const candidateLines = _toLines({
          ...normalized,
          word_count: 0,
          chunks_used: summary.chunks_used,
        });
        const words = _countWords(candidateLines);

        // Carry images and exercises from the retrieval pipeline
        const summaryImages = Array.isArray(summary.images_base64)
          ? summary.images_base64.filter(Boolean)
          : [];
        const summaryExercises = Array.isArray(summary.exercise_chunks)
          ? summary.exercise_chunks
          : [];

        if (_isSummaryUsable(normalized, words)) {
          effective = {
            ...normalized,
            word_count: words,
            chunks_used: summary.chunks_used,
            images_base64: summaryImages,
            exercise_chunks: summaryExercises,
          };
        } else if (normalized.intro.length >= 20 && normalized.content.length >= 80) {
          // RAG content exists but formatting is incomplete (missing key_points/bridge).
          // Repair in-place rather than discarding textbook content for a generic fallback.
          effective = {
            ..._repairRagSummary(normalized, topic, summary.chunks_used, targetLanguage),
            images_base64: summaryImages,
            exercise_chunks: summaryExercises,
          };
        } else {
          // Thin content — use LLM fallback with RAG context as hint.
          effective = {
            ...(await _fallbackSummary(
              topic,
              subject,
              "curriculum",
              classLevel,
              _summaryToContextHint(summary),
              targetLanguage,
            )),
            images_base64: summaryImages,
            exercise_chunks: summaryExercises,
          };
        }
      } else {
        effective = null;
      }
    }

    if (!effective) {
      res.status(422).json({
        error:
          targetLanguage === "ta"
            ? `${className}/${subject} பகுதியில் "${topic}" தலைப்புக்கான பாடப்புத்தக உள்ளடக்கம் கிடைக்கவில்லை.`
            : `No textbook chunks found for topic "${topic}" in ${className}/${subject}.`,
        lines:
          targetLanguage === "ta"
            ? [
                `${topic} தலைப்புக்கான பாடப்புத்தக பகுதி கிடைக்கவில்லை. வகுப்பில் உள்ள சரியான பாடத்தலைப்பைப் பயன்படுத்தவும்.`,
              ]
            : [
                `No textbook content found for ${topic}. Please use a textbook topic name from class sections.`,
              ],
        language: targetLanguage,
        questionsPerStudent: QUESTIONS_PER_STUDENT,
        studentCount: safeStudentCount,
        questions: [],
        word_count: 0,
        chunks_used: 0,
        sourceUsed: sourceMode,
      });
      return;
    }

    effective = _tightenSummaryOpening(effective, topic, subject, targetLanguage);

    const lines = _toLines(effective);
    const questions = await _buildQuestionBank(
      topic,
      subject,
      lines,
      totalQuestionCount,
      classLevel,
      sourceMode,
      targetLanguage,
      effective.exercise_chunks ?? [],
    );

    res.json({
      ...effective,
      lines,
      language: targetLanguage,
      questionsPerStudent: QUESTIONS_PER_STUDENT,
      studentCount: safeStudentCount,
      sourceUsed: sourceMode,
      classLevel,
      questions,
      word_count: _countWords(lines),
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }
    res.status(500).json({ error: "Failed to generate summary", lines: [], questions: [] });
  }
}

export async function postSocraticPreview(req: Request, res: Response): Promise<void> {
  const {
    topic,
    subject,
    className = "class_1",
    source = "curriculum",
  } = req.body as SummarizeBody;

  if (!topic || !subject) {
    res.status(400).json({ error: "topic and subject are required" });
    return;
  }

  const sourceMode = source === "custom" ? "custom" : "curriculum";
  if (sourceMode === "custom") {
    res.json({
      cards: _fallbackPreviewCards(topic, subject, sourceMode),
      sourceUsed: sourceMode,
    });
    return;
  }

  try {
    const chunks = await retrieveTopicChunks(className, subject, topic, 6);
    const cards = _buildPreviewCards(chunks, topic, subject);

    res.json({
      cards: cards.length > 0 ? cards : _fallbackPreviewCards(topic, subject, sourceMode),
      sourceUsed: sourceMode,
    });
  } catch {
    res.json({
      cards: _fallbackPreviewCards(topic, subject, sourceMode),
      sourceUsed: sourceMode,
    });
  }
}

export async function postSocraticAlertSuggestion(req: Request, res: Response): Promise<void> {
  const {
    className = "Class 1",
    studentName,
    topic,
    subject,
    totalQuestions,
    incorrectCount,
    missedQuestions,
  } = req.body as AlertSuggestionBody;

  if (!studentName || !topic || !subject) {
    res.status(400).json({ error: "studentName, topic, and subject are required" });
    return;
  }

  const safeMisses = Array.isArray(missedQuestions)
    ? missedQuestions
        .map((miss) => ({
          question: typeof miss?.question === "string" ? miss.question.trim() : "",
          selectedOption:
            typeof miss?.selectedOption === "string" ? miss.selectedOption.trim() : "",
          correctOption: typeof miss?.correctOption === "string" ? miss.correctOption.trim() : "",
          explain: typeof miss?.explain === "string" ? miss.explain.trim() : "",
        }))
        .filter((miss) => miss.question || miss.explain)
        .slice(0, 5)
    : [];

  const safeIncorrectCount = Math.max(
    1,
    Number.isFinite(incorrectCount) ? Math.floor(Number(incorrectCount)) : safeMisses.length || 1,
  );
  const safeTotalQuestions = Math.max(
    safeIncorrectCount,
    Number.isFinite(totalQuestions) ? Math.floor(Number(totalQuestions)) : QUESTIONS_PER_STUDENT,
  );

  const prompt = [
    "Respond only in English.",
    "You are a careful teaching assistant helping a teacher support one primary-school student.",
    `Student: ${studentName}`,
    `Class: ${className}`,
    `Subject: ${subject}`,
    `Topic: ${topic}`,
    `Score snapshot: ${safeIncorrectCount} wrong out of ${safeTotalQuestions} questions.`,
    "",
    "The student missed these questions:",
    safeMisses.length > 0
      ? safeMisses
          .map(
            (miss, idx) =>
              `${idx + 1}. Question: ${miss.question}\nStudent chose: ${miss.selectedOption || "(no answer)"}\nCorrect answer: ${miss.correctOption || "Unknown"}\nLesson note: ${miss.explain || "No explanation provided."}`,
          )
          .join("\n\n")
      : "No detailed misses were provided. Use the topic and score snapshot only.",
    "",
    "Return ONLY valid JSON in this exact shape:",
    '{"gapSummary":"...","focusAreas":["...","...","..."],"teacherActions":["...","...","..."],"encouragement":"..."}',
    "",
    "Rules:",
    "- Keep everything suitable for Class 1-5 teachers and students.",
    "- gapSummary must explain the main learning gap in 2 short sentences.",
    "- focusAreas must contain 2-3 short phrases describing what the child lacks.",
    "- teacherActions must contain exactly 3 concrete next steps the teacher can do right now.",
    "- encouragement must be one warm sentence the teacher can say to the child.",
    "- Avoid jargon, blame, or advanced pedagogy terms.",
  ].join("\n");

  try {
    const generated = await generateLlmJson<AlertSuggestionShape>(prompt);
    res.json(_normalizeAlertSuggestion(generated, studentName, topic, subject, safeMisses));
  } catch {
    res.json(_fallbackAlertSuggestion(studentName, topic, subject, safeMisses));
  }
}

function _detectLanguage(text: string): SupportedLanguage {
  const sample = text.trim();
  if (!sample) return "en";

  const tamilChars = [...sample].filter((char) => char >= "\u0B80" && char <= "\u0BFF").length;
  const latinChars = [...sample].filter((char) => /[A-Za-z]/.test(char)).length;

  return tamilChars >= Math.max(12, Math.floor(latinChars / 2)) ? "ta" : "en";
}

function _pickLanguageFromChunks(chunks: RetrieverChunk[]): SupportedLanguage | null {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  const counts = chunks.reduce(
    (acc, chunk) => {
      const rawLanguage =
        typeof chunk.language === "string" ? chunk.language.trim().toLowerCase() : "";
      const language =
        rawLanguage === "ta" || rawLanguage === "en"
          ? (rawLanguage as SupportedLanguage)
          : _detectLanguage(chunk.text || "");
      acc[language] += 1;
      return acc;
    },
    { en: 0, ta: 0 },
  );

  if (counts.ta === 0 && counts.en === 0) return null;
  return counts.ta >= counts.en ? "ta" : "en";
}

async function _resolveSessionLanguage(
  className: string,
  subject: string,
  topic: string,
): Promise<SupportedLanguage> {
  const topicGuess = _detectLanguage(topic);

  try {
    const direct = await retrieveTopicChunks(className, subject, topic, 4);
    const fromDirect = _pickLanguageFromChunks(direct);
    if (fromDirect) return fromDirect;

    const fallback = await retrieveTopicChunks(className, subject, subject, 4);
    const fromFallback = _pickLanguageFromChunks(fallback);
    if (fromFallback) return fromFallback;
  } catch {
    // Use the visible topic text as the final hint when retrieval is unavailable.
  }

  return topicGuess;
}

// ── custom + fallback summary builders ───────────────────────────────────────
async function _buildCustomTopicSummary(
  topic: string,
  subject: string,
  classLevel: number,
  lang: SupportedLanguage,
): Promise<SummaryShape> {
  const snippets = await _fetchWebSnippets(topic, lang);
  const webNotes = snippets
    .map(
      (snippet, idx) =>
        `[Web note ${idx + 1}] ${snippet.title}\n${snippet.summary}\nSource: ${snippet.url}`,
    )
    .join("\n\n");

  const prompt =
    lang === "ta"
      ? [
          "தமிழில் மட்டும் பதிலளிக்கவும்.",
          "நீங்கள் இந்திய தொடக்கப்பள்ளிக்கான மென்மையான கற்பித்தல் உதவியாளர்.",
          `கற்றல் நிலை: வகுப்பு ${classLevel} (Class 1-5).`,
          `தலைப்பு: ${topic}`,
          `பாடம்: ${subject}`,
          "",
          "கீழே உள்ள WEB NOTES-ஐ மட்டும் அடிப்படையாக கொள்ளவும்.",
          "தகவல் குறைந்தால் எளிமையாகவே விளக்கவும்; கடினமான கருத்துகளை சேர்க்காதீர்கள்.",
          "மெதுவான, அன்பான இந்திய ஆசிரியர் நடையில் எழுதவும். கட்டளையிடும் குரல் வேண்டாம்.",
          "",
          "WEB NOTES:",
          webNotes || "பயன்படுத்தத் தகுந்த web notes கிடைக்கவில்லை.",
          "",
          "விதிகள்:",
          `- வகுப்பு ${classLevel} நிலைக்கு ஏற்ற எளிய தமிழில் எழுதவும்.`,
          "- தலைப்பை நேராகத் தொடங்கவும்.",
          "- வாழ்த்து வேண்டுமானால் ஒரு சுருக்கமான வரி மட்டும் போதும்.",
          "- வீடு அல்லது பள்ளி உதாரணங்களை பயன்படுத்தலாம்.",
          `- மொத்தம் குறைந்தது ${MIN_SUMMARY_WORDS} வார்த்தைகள் இருக்க வேண்டும்.`,
          "- இறுதியில் MCQ சுற்றுக்கான மென்மையான bridge வரி வேண்டும்.",
          "",
          "JSON keys மட்டும் intro, content, key_points, bridge ஆகவே இருக்க வேண்டும்.",
          "Return ONLY valid JSON.",
          '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
        ].join("\n")
      : [
          "Respond only in English.",
          "You are a calm primary-school teaching assistant.",
          `Target learners: Class ${classLevel} (India, Class 1-5 stage).`,
          `Topic: ${topic}`,
          `Subject: ${subject}`,
          "",
          "Use the WEB NOTES below as the main reference.",
          "If a detail is missing, stay simple and avoid advanced explanations.",
          "Write in a gentle Indian classroom-teacher tone, not an authoritative one.",
          "",
          "WEB NOTES:",
          webNotes || "No web notes were available.",
          "",
          "Rules:",
          `- Keep language and depth suitable for Class ${classLevel}.`,
          "- Start directly with the topic explanation.",
          "- If you greet, use only one short greeting like 'Good morning.' and then move straight into the topic.",
          "- Do not include advanced theory, equations, or terms beyond Class 5 level.",
          "- Give everyday examples from home or school where possible.",
          "- Keep the narration suitable for about 2-3 minutes.",
          `- Total words must be at least ${MIN_SUMMARY_WORDS}.`,
          "- End with a bridge line that naturally starts MCQ practice.",
          "",
          "Return ONLY valid JSON in this exact shape:",
          '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
        ].join("\n");

  try {
    const generated =
      await generateLlmJson<Omit<SummaryShape, "word_count" | "chunks_used">>(prompt);
    const normalized = _normalizeSummary(generated);
    const lines = _toLines({ ...normalized, word_count: 0, chunks_used: 0 });
    const words = _countWords(lines);
    if (words >= MIN_SUMMARY_WORDS) {
      return {
        ...normalized,
        word_count: words,
        chunks_used: snippets.length,
      };
    }
  } catch {
    // Fall through to constrained fallback.
  }

  return _fallbackSummary(topic, subject, "custom", classLevel, webNotes, lang);
}

async function _fallbackSummary(
  topic: string,
  subject: string,
  source: string,
  classLevel: number,
  contextHint = "",
  lang: SupportedLanguage = "en",
): Promise<SummaryShape> {
  const sourceNote =
    source === "custom"
      ? "This is a custom teacher-selected topic that should use simple web-friendly explanations."
      : "This is from the standard school curriculum and must stay textbook-aligned.";

  const prompt =
    lang === "ta"
      ? [
          "தமிழில் மட்டும் பதிலளிக்கவும்.",
          "நீங்கள் மென்மையான தொடக்கப்பள்ளி கற்பித்தல் உதவியாளர்.",
          `கற்றல் நிலை: வகுப்பு ${classLevel} (India, Class 1-5).`,
          `தலைப்பு: ${topic}`,
          `பாடம்: ${subject}`,
          source === "custom"
            ? "இது ஆசிரியர் தேர்ந்தெடுத்த தனிப்பயன் தலைப்பு. எளிய web-style விளக்கம் போதுமானது."
            : "இது பாடத்திட்டத்தில் உள்ள தலைப்பு. பாடப்புத்தக நடையைப் பின்பற்றவும்.",
          ...(contextHint ? ["", "குறிப்பு:", contextHint] : []),
          "",
          "சுமார் 2-3 நிமிடங்களுக்கு ஏற்ற வகையில் குறும்படிக் குரல் சுருக்கத்தை உருவாக்கவும்.",
          "தலைப்பை நேராகத் தொடங்கவும்.",
          "மிக மென்மையான ஆசிரியர் நடையில் எழுதவும்; கடுமையான கட்டளை குரல் வேண்டாம்.",
          `மொத்த வார்த்தைகள் குறைந்தது ${MIN_SUMMARY_WORDS} இருக்க வேண்டும்.`,
          "குழந்தைகள் புரியும் எளிய தமிழை மட்டும் பயன்படுத்தவும்.",
          `வகுப்பு ${Math.min(classLevel, MAX_CLASS_LEVEL)} நிலையைத் தாண்டிய கருத்துகள் வேண்டாம்.`,
          "இறுதியில் MCQ சுற்றுக்கான bridge வரி வேண்டும்.",
          "",
          "JSON keys மட்டும் intro, content, key_points, bridge ஆகவே இருக்க வேண்டும்.",
          "Return ONLY valid JSON.",
          '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
        ].join("\n")
      : [
          "Respond only in English.",
          "You are a calm primary school teaching assistant.",
          `Target learners: Class ${classLevel} (India, Class 1-5).`,
          `Topic: ${topic}`,
          `Subject: ${subject}`,
          sourceNote,
          ...(contextHint ? ["", "Reference notes:", contextHint] : []),
          "",
          "Create a short classroom narration for about 2-3 minutes.",
          "Start directly with the topic.",
          "Use a soft Indian teacher tone, not a strict or commanding tone.",
          "If you greet, use only one short greeting sentence and then continue with the summary.",
          `Total words must be at least ${MIN_SUMMARY_WORDS}.`,
          "Use simple child-friendly language only.",
          `Do not go beyond Class ${Math.min(classLevel, MAX_CLASS_LEVEL)} level concepts.`,
          "Bridge naturally into an MCQ question round at the end.",
          "",
          "Return ONLY valid JSON in this exact shape:",
          '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
        ].join("\n");

  try {
    const generated =
      await generateLlmJson<Omit<SummaryShape, "word_count" | "chunks_used">>(prompt);
    const normalized = _normalizeSummary(generated);
    const lines = _toLines({ ...normalized, word_count: 0, chunks_used: 0 });
    const words = _countWords(lines);
    if (words >= MIN_SUMMARY_WORDS) {
      return {
        ...normalized,
        word_count: words,
        chunks_used: 0,
      };
    }
  } catch {
    // Fall through to deterministic fallback.
  }

  const deterministic = _deterministicSummary(topic, subject, sourceNote, classLevel, lang);
  return {
    ...deterministic,
    word_count: _countWords(_toLines({ ...deterministic, word_count: 0, chunks_used: 0 })),
    chunks_used: 0,
  };
}

async function _buildQuestionBank(
  topic: string,
  subject: string,
  lines: string[],
  questionCount: number,
  classLevel: number,
  source: string,
  lang: SupportedLanguage,
  exerciseChunks: Array<{ text: string; page: number }> = [],
): Promise<SocraticQuestion[]> {
  const summaryText = lines.join("\n\n").slice(0, 6000);
  const exerciseText = exerciseChunks
    .map((e, i) => `[Exercise ${i + 1}, page ${e.page}]\n${e.text}`)
    .join("\n\n")
    .slice(0, 2000);
  const exerciseNote = exerciseText
    ? lang === "ta"
      ? `\n\nபாடப்புத்தகப் பயிற்சிக் கேள்விகள் (இவற்றிலிருந்தும் MCQ உருவாக்கலாம்):\n${exerciseText}`
      : `\n\nTextbook exercise questions (you may also create MCQs from these):\n${exerciseText}`
    : "";
  const prompt =
    lang === "ta"
      ? [
          "தமிழில் மட்டும் பதிலளிக்கவும்.",
          `நீங்கள் வகுப்பு ${classLevel} தொடக்கப்பள்ளி மாணவர்களுக்கான MCQ கேள்விகளை உருவாக்குகிறீர்கள்.`,
          `தலைப்பு: ${topic}`,
          `பாடம்: ${subject}`,
          `Source mode: ${source}`,
          "",
          "இந்தச் சுருக்கத்தில் உள்ள கருத்துகளை மட்டும் பயன்படுத்தவும்:",
          summaryText + exerciseNote,
          "",
          `மொத்தம் சரியாக ${questionCount} வேறுபட்ட கேள்விகளை உருவாக்கவும்.`,
          "கேள்வி விதிகள்:",
          "- தலைப்பின் உள்ளடக்கத்தை மட்டும் கேட்கவும்.",
          "- கற்றல் நடைமுறை பற்றிய meta கேள்விகள் வேண்டாம்.",
          "- ஒவ்வொரு கேள்வியும் சுருக்கமாகவும் குழந்தைகள் புரியும் வகையிலும் இருக்க வேண்டும்.",
          "- விருப்பங்கள் தெளிவாகவும் படிக்க எளிதாகவும் இருக்க வேண்டும்.",
          "",
          "ஒவ்வொரு கேள்விக்கும்:",
          "- q: ஒரு தெளிவான கேள்வி",
          "- options: சரியாக 4 குறுகிய விருப்பங்கள்",
          "- answerIndex: சரியான விடையின் index (0 முதல் 3)",
          "- explain: சரியான விடை ஏன் என்று ஒரு குறுகிய காரணம்",
          "",
          "JSON keys மட்டும் questions, q, options, answerIndex, explain ஆகவே இருக்க வேண்டும்.",
          "Return ONLY valid JSON.",
          '{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explain":"..."}]}',
        ].join("\n")
      : [
          "Respond only in English.",
          `You are creating fun, interactive MCQ questions for Class ${classLevel} primary students (under 5 years old).`,
          `Topic: ${topic}`,
          `Subject: ${subject}`,
          `Source mode: ${source}`,
          "",
          "Use only ideas that appear in this summary:",
          summaryText + exerciseNote,
          "",
          `Create exactly ${questionCount} distinct questions.`,
          "Question rules:",
          "- Focus only on topic content (definition, fact, formula/basic relation if present, example, simple application).",
          "- Do NOT ask teaching-process or meta questions (for example: 'core idea', 'why question rounds', 'answer style').",
          "- Keep each question short and child-friendly (max 16 words).",
          "- Use emojis in questions and options to make them fun and visual (e.g., '🍎 + 🍎 = ?' for math).",
          "- For math: use emoji visuals instead of plain numbers when possible.",
          "- Keep options concrete, easy to read, and visually distinct.",
          "- If textbook exercise questions are provided, adapt them into MCQ format.",
          "",
          "For each question provide:",
          "- q: one clear, fun question with emojis where appropriate",
          "- options: exactly 4 short options (no A/B/C/D labels, no 'all/none of the above')",
          "- answerIndex: index of the correct option (0 to 3)",
          "- explain: one short reason why that option is correct",
          "",
          "Return ONLY valid JSON in this exact shape:",
          '{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explain":"..."}]}',
        ].join("\n");

  try {
    const generated = await generateLlmJson<{ questions: SocraticQuestion[] }>(prompt);
    const normalized = _normalizeQuestions(generated.questions, questionCount);
    if (normalized.length >= questionCount) {
      return normalized.slice(0, questionCount);
    }
  } catch {
    // Fall through to static fallback.
  }

  return _fallbackQuestions(topic, subject, questionCount, lines, classLevel, lang);
}

function _extractClassLevel(className: string): number {
  const match = className.match(/(\d+)/);
  if (!match) return DEFAULT_CLASS_LEVEL;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return DEFAULT_CLASS_LEVEL;
  return Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(value)));
}

async function _fetchWebSnippets(topic: string, lang: SupportedLanguage): Promise<WebSnippet[]> {
  const trimmed = topic.trim();
  if (!trimmed) return [];

  const wikiHost = lang === "ta" ? "ta.wikipedia.org" : "en.wikipedia.org";

  const searchUrl = `https://${wikiHost}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmed)}&srlimit=4&utf8=1&format=json&origin=*`;

  let search: WikiSearchResponse | null = null;
  try {
    const response = await fetch(searchUrl);
    if (response.ok) {
      search = (await response.json()) as WikiSearchResponse;
    }
  } catch {
    return [];
  }

  const titles = (search?.query?.search ?? [])
    .map((item) => (typeof item.title === "string" ? item.title.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);

  const snippets: WebSnippet[] = [];
  for (const title of titles) {
    const slug = encodeURIComponent(title.replace(/\s+/g, "_"));
    const summaryUrl = `https://${wikiHost}/api/rest_v1/page/summary/${slug}`;

    try {
      const response = await fetch(summaryUrl);
      if (!response.ok) continue;
      const data = (await response.json()) as WikiSummaryResponse;
      const summary = typeof data.extract === "string" ? data.extract.trim() : "";
      if (!summary) continue;

      snippets.push({
        title: data.title?.trim() || title,
        summary,
        url: data.content_urls?.desktop?.page || `https://${wikiHost}/wiki/${slug}`,
      });
    } catch {
      // Ignore failed snippet and continue.
    }
  }

  return snippets;
}

function _normalizeSummary(
  value: Partial<Omit<SummaryShape, "word_count" | "chunks_used">>,
): Omit<SummaryShape, "word_count" | "chunks_used"> {
  const intro = typeof value.intro === "string" ? value.intro.trim() : "";
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const key_points = Array.isArray(value.key_points)
    ? value.key_points
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const bridge = typeof value.bridge === "string" ? value.bridge.trim() : "";

  return { intro, content, key_points, bridge };
}

function _normalizeAlertSuggestion(
  value: Partial<AlertSuggestionShape>,
  studentName: string,
  topic: string,
  subject: string,
  misses: Array<{
    question: string;
    selectedOption: string;
    correctOption: string;
    explain: string;
  }>,
): AlertSuggestionShape {
  const fallback = _fallbackAlertSuggestion(studentName, topic, subject, misses);

  const gapSummary =
    typeof value.gapSummary === "string" && value.gapSummary.trim()
      ? value.gapSummary.trim()
      : fallback.gapSummary;
  const focusAreas = Array.isArray(value.focusAreas)
    ? value.focusAreas
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const teacherActions = Array.isArray(value.teacherActions)
    ? value.teacherActions
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const encouragement =
    typeof value.encouragement === "string" && value.encouragement.trim()
      ? value.encouragement.trim()
      : fallback.encouragement;

  return {
    gapSummary,
    focusAreas: focusAreas.length > 0 ? focusAreas : fallback.focusAreas,
    teacherActions: teacherActions.length > 0 ? teacherActions : fallback.teacherActions,
    encouragement,
  };
}

function _fallbackAlertSuggestion(
  studentName: string,
  topic: string,
  subject: string,
  misses: Array<{
    question: string;
    selectedOption: string;
    correctOption: string;
    explain: string;
  }>,
): AlertSuggestionShape {
  const focusAreas = misses
    .map((miss) => _focusFromMiss(miss.question, miss.explain, topic))
    .filter(
      (item, idx, arr) =>
        arr.findIndex((value) => value.toLowerCase() === item.toLowerCase()) === idx,
    )
    .slice(0, 3);

  const resolvedFocusAreas =
    focusAreas.length > 0
      ? focusAreas
      : [`core ${topic} facts`, `${subject} examples`, "matching the right option"];

  return {
    gapSummary: `${studentName} is missing a few key ${topic} ideas and needs a slower recap before the next MCQ round. The main issue is linking the question back to the lesson fact and example.`,
    focusAreas: resolvedFocusAreas,
    teacherActions: [
      `Re-teach ${topic} with one concrete ${subject} example from class or home before asking again.`,
      `Ask ${studentName} to say the correct answer back in their own words after each correction.`,
      `Give two short practice questions on ${resolvedFocusAreas[0]} before restarting a full question round.`,
    ],
    encouragement: `Start with one easy win so ${studentName} feels confident before the harder questions return.`,
  };
}

function _focusFromMiss(question: string, explain: string, topic: string): string {
  const seed = explain || question || topic;
  const cleaned = seed
    .replace(/correct answer:\s*/i, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return `core ${topic} facts`;

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  return words.length > 0 ? words.join(" ") : `core ${topic} facts`;
}

function _buildPreviewCards(
  chunks: RetrieverChunk[],
  topic: string,
  subject: string,
): PreviewCard[] {
  const unique = [...chunks]
    .sort((left, right) => {
      const leftHasImage =
        Array.isArray(left.images_base64) && left.images_base64.length > 0 ? 1 : 0;
      const rightHasImage =
        Array.isArray(right.images_base64) && right.images_base64.length > 0 ? 1 : 0;
      if (rightHasImage !== leftHasImage) return rightHasImage - leftHasImage;
      return left.score - right.score;
    })
    .filter(
      (chunk, idx, arr) =>
        arr.findIndex(
          (item) =>
            `${item.page}:${item.text.slice(0, 80)}` === `${chunk.page}:${chunk.text.slice(0, 80)}`,
        ) === idx,
    )
    .slice(0, MAX_PREVIEW_CARDS);

  return unique.map((chunk, idx) => {
    const imageBase64 = Array.isArray(chunk.images_base64)
      ? chunk.images_base64.find((value) => typeof value === "string" && value.trim().length > 0)
      : undefined;
    const title = imageBase64 ? `Textbook sketch ${idx + 1}` : `Lesson clue ${idx + 1}`;
    const badge = imageBase64
      ? `Page ${chunk.page || idx + 1} picture`
      : `Page ${chunk.page || idx + 1} idea`;

    return {
      title,
      badge,
      caption: _compactPreviewCaption(chunk.text, topic, subject),
      imageDataUrl: imageBase64 ? `data:image/jpeg;base64,${imageBase64}` : undefined,
    };
  });
}

function _fallbackPreviewCards(topic: string, subject: string, sourceMode: string): PreviewCard[] {
  const sourceCue = sourceMode === "custom" ? "Web notes" : "Textbook cue";

  return [
    {
      title: "Topic start",
      badge: sourceCue,
      caption: `We are getting ${topic} ready in simple ${subject} words for the class.`,
    },
    {
      title: "Tiny example",
      badge: "Real-life link",
      caption: `Small home and school examples will help children connect the idea quickly.`,
    },
    {
      title: "Tap and answer",
      badge: "MCQ round",
      caption: "After the summary, each student hears the question and taps one option.",
    },
  ];
}

function _compactPreviewCaption(text: string, topic: string, subject: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || "";
  const words = (sentence || cleaned).split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return `${topic} is being prepared with a simple ${subject} explanation.`;
  }

  if (words.length <= 18) return words.join(" ");
  return `${words.slice(0, 18).join(" ")}...`;
}

function _summaryToContextHint(value: Partial<SummaryShape>): string {
  const normalized = _normalizeSummary(value);
  return [normalized.intro, normalized.content, ...normalized.key_points, normalized.bridge]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2400);
}

function _tightenSummaryOpening(
  summary: SummaryShape,
  topic: string,
  subject: string,
  lang: SupportedLanguage,
): SummaryShape {
  const introLines = _splitForFlow(summary.intro);
  const introText = introLines.join(" ").trim();
  const greeting =
    lang === "ta"
      ? /காலை வணக்கம்|வணக்கம்/i.test(introText)
        ? "காலை வணக்கம். "
        : ""
      : /\b(good morning|good afternoon|good evening|hello)\b/i.test(introText)
        ? "Good morning. "
        : "";
  const needsCompaction =
    lang === "ta"
      ? introLines.length > 2 || /\?|தயாரா|விளையாடு|அருமை/i.test(introText)
      : introLines.length > 2 ||
        /\?|are you ready|has anyone|wow|magical|let'?s play/i.test(introText);

  if (!introText || needsCompaction) {
    return {
      ...summary,
      intro:
        lang === "ta"
          ? `${greeting}இன்று நாம் ${subject} பாடத்தில் ${topic} தலைப்பை மெதுவாக தொடங்கப் போகிறோம்.`
          : `${greeting}Today we are going to start ${topic} in ${subject}.`,
    };
  }

  return summary;
}

function _isSummaryUsable(
  summary: Omit<SummaryShape, "word_count" | "chunks_used">,
  wordCount: number,
): boolean {
  return (
    wordCount >= MIN_SUMMARY_WORDS &&
    summary.intro.length >= 20 &&
    summary.content.length >= 120 &&
    summary.bridge.length >= 10 &&
    summary.key_points.length >= 3
  );
}

function _toLines(summary: SummaryShape): string[] {
  return [summary.intro, summary.content, ...summary.key_points, summary.bridge].flatMap(
    (block, idx) => _splitForFlow(block, idx >= 2 && idx < 2 + summary.key_points.length),
  );
}

function _splitForFlow(text: string, preserveWhole = false): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (preserveWhole) return [trimmed];

  return trimmed
    .split(/\n+/)
    .flatMap((part) => part.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function _countWords(lines: string[]): number {
  return lines.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

function _normalizeQuestions(raw: unknown, expectedCount: number): SocraticQuestion[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((q): SocraticQuestion | null => {
      if (!q || typeof q !== "object") return null;
      const rec = q as Partial<SocraticQuestion>;
      const question = typeof rec.q === "string" ? rec.q.trim() : "";
      const optionValues = Array.isArray(rec.options) ? rec.options : [];

      const options = optionValues
        .map((opt) => (typeof opt === "string" ? opt.trim() : ""))
        .filter(Boolean)
        .filter(
          (opt, idx, arr) => arr.findIndex((v) => v.toLowerCase() === opt.toLowerCase()) === idx,
        )
        .slice(0, 4);

      if (!question || options.length !== 4) return null;

      let answerIndex =
        typeof rec.answerIndex === "number" && Number.isInteger(rec.answerIndex)
          ? rec.answerIndex
          : -1;

      if (answerIndex < 0 || answerIndex > 3) {
        const alt = (q as { answer?: unknown }).answer;
        if (typeof alt === "string" && alt.trim()) {
          const answer = alt.trim();
          const byText = options.findIndex((opt) => opt.toLowerCase() === answer.toLowerCase());
          if (byText >= 0) {
            answerIndex = byText;
          } else {
            const letter = answer.toUpperCase();
            if (letter.length === 1 && "ABCD".includes(letter)) {
              answerIndex = letter.charCodeAt(0) - 65;
            }
          }
        }
      }

      if (answerIndex < 0 || answerIndex > 3) return null;

      const explain =
        typeof rec.explain === "string" && rec.explain.trim()
          ? rec.explain.trim()
          : `Correct answer: ${options[answerIndex]}.`;

      return {
        q: question,
        options,
        answerIndex,
        explain,
      };
    })
    .filter((q): q is SocraticQuestion => q !== null)
    .slice(0, expectedCount);
}

function _fallbackQuestions(
  topic: string,
  subject: string,
  count: number,
  lines: string[],
  classLevel: number,
  lang: SupportedLanguage,
): SocraticQuestion[] {
  const facts = _extractFacts(lines, Math.max(6, Math.min(18, count + 4)));
  const starterFact =
    lang === "ta"
      ? `${topic} வகுப்பு ${classLevel} மாணவர்களுக்கு எளிய மொழியில் கற்பிக்கப்படுகிறது.`
      : `${topic} is taught in simple language for Class ${classLevel}.`;
  const questionStems =
    lang === "ta"
      ? ([
          `இன்றைய ${topic} சுருக்கத்துடன் பொருந்துவது எது?`,
          `பாடத்தின் படி ${topic} குறித்து சரியானது எது?`,
          `இந்த ${subject} சுருக்கத்திலிருந்து சரியான தகவலைத் தேர்ந்தெடு.`,
          `இன்று நாம் ${topic} பற்றி கற்ற கூற்று எது?`,
        ] as const)
      : ([
          `Which option matches today's summary on ${topic}?`,
          `According to the lesson, what is true about ${topic}?`,
          `Pick the correct fact from this ${subject} summary.`,
          `Which statement did we learn today about ${topic}?`,
        ] as const);

  const questions: SocraticQuestion[] = [];
  for (let i = 0; i < count; i += 1) {
    const fact = facts[i % facts.length] ?? starterFact;
    const correct = _shortenForOption(fact);
    const wrong =
      lang === "ta"
        ? [
            `${topic} என்பது ${subject} பாடத்துடன் தொடர்பில்லாதது.`,
            `இந்தத் தலைப்பை வகுப்பு ${classLevel} மாணவர்கள் கற்க வேண்டாம்.`,
            `இந்தத் தலைப்புக்கு கல்லூரி நிலை விவரங்கள் மட்டும் தேவை.`,
          ]
        : [
            `${topic} is unrelated to ${subject}.`,
            `This topic should be skipped for Class ${classLevel}.`,
            `Only advanced college details are needed for this topic.`,
          ];

    const { options, answerIndex } = _buildOptions(correct, wrong, i, lang);
    questions.push({
      q: questionStems[i % questionStems.length],
      options,
      answerIndex,
      explain:
        lang === "ta"
          ? "இந்த விருப்பம் இன்றைய சுருக்கத்துடன் நேராகப் பொருந்துகிறது."
          : "This option directly matches today's summary.",
    });
  }

  return questions;
}

function _extractFacts(lines: string[], limit: number): string[] {
  return lines
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const words = line.split(/\s+/).filter(Boolean).length;
      return words >= 6 && words <= 22;
    })
    .filter(
      (line, idx, arr) =>
        arr.findIndex((value) => value.toLowerCase() === line.toLowerCase()) === idx,
    )
    .slice(0, limit);
}

function _shortenForOption(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 14) return text;
  return `${words.slice(0, 14).join(" ")}.`;
}

function _buildOptions(
  correct: string,
  distractors: readonly string[],
  seed: number,
  lang: SupportedLanguage = "en",
): { options: string[]; answerIndex: number } {
  const options = distractors.slice(0, 3).map((value) => value.trim());
  while (options.length < 3) {
    options.push(
      lang === "ta" ? "பாடத்தில் போதுமான தகவல் இல்லை." : "Not enough lesson context available.",
    );
  }

  const answerIndex = seed % 4;
  options.splice(answerIndex, 0, correct.trim());
  return { options, answerIndex };
}

function _extractKeyPoints(
  text: string,
  topic: string,
  count: number,
  lang: SupportedLanguage,
): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => {
      const words = s.split(/\s+/).filter(Boolean).length;
      return words >= 5 && words <= 25;
    });

  const result = sentences.slice(0, count);

  const pad =
    lang === "ta"
      ? `${topic} பற்றிய முக்கியமான விவரங்களை நினைவில் கொள்ளவும்.`
      : `Remember the key details about ${topic} from the lesson.`;
  while (result.length < count) result.push(pad);
  return result;
}

function _repairRagSummary(
  normalized: Omit<SummaryShape, "word_count" | "chunks_used">,
  topic: string,
  chunksUsed: number,
  lang: SupportedLanguage,
): SummaryShape {
  const keyPoints =
    normalized.key_points.length >= 3
      ? normalized.key_points
      : _extractKeyPoints(normalized.intro + "\n" + normalized.content, topic, 3, lang);

  const bridge =
    normalized.bridge.length >= 10
      ? normalized.bridge
      : lang === "ta"
        ? `சரி. இப்போது ${topic} பற்றி சில கேள்விகளுக்கு பதில் சொல்லுவோம்.`
        : `Great. Now let us answer a few questions about ${topic}.`;

  const repaired = {
    intro: normalized.intro,
    content: normalized.content,
    key_points: keyPoints,
    bridge,
  };
  const lines = _toLines({ ...repaired, word_count: 0, chunks_used: 0 });
  return { ...repaired, word_count: _countWords(lines), chunks_used: chunksUsed };
}

function _deterministicSummary(
  topic: string,
  subject: string,
  sourceNote: string,
  classLevel: number,
  lang: SupportedLanguage,
): Omit<SummaryShape, "word_count" | "chunks_used"> {
  if (lang === "ta") {
    return {
      intro: `காலை வணக்கம். இன்று நாம் ${subject} பாடத்தில் ${topic} தலைப்பை அமைதியாக தொடங்கப் போகிறோம். இந்தப் பாடம் வகுப்பு ${classLevel} மாணவர்களுக்கு எளிமையாக இருக்கும்.`,
      content: `முதலில், ${topic} என்றால் என்ன என்பதை எளிதாகப் புரிந்துகொள்வோம். இந்தத் தலைப்பை கடினமான வரிகளை மனப்பாடம் செய்ய மட்டும் நாம் கற்கவில்லை. அதை தெளிவாகச் சொல்லவும், வகுப்புப் பாடத்துடன் இணைக்கவும், அன்றாட வாழ்க்கையில் கண்டுபிடிக்கவும் நாம் கற்கிறோம். கேட்கும் போது மூன்று விஷயங்களை நினைவில் கொள்ளுங்கள்: அது என்ன, அதை எங்கு பார்க்கிறோம், அது எதற்கு உதவுகிறது. இந்த மூன்றையும் நினைவில் வைத்தால் பெரும்பாலான பள்ளிக் கேள்விகளுக்கு நம்பிக்கையுடன் பதிலளிக்கலாம்.\n\nஅடுத்து, இந்தத் தலைப்பை நம் தினசரி அனுபவத்துடன் இணைக்கலாம். வகுப்பறைச் செயல்கள், வீட்டுப் பொருட்கள், காலநிலை, உணவு, ஒளி, ஒலி, தாவரங்கள் அல்லது எளிய கருவிகள் போன்ற உதாரணங்கள் பாடத்தை உயிர்ப்புடன் காட்டும். ஒரு புதிய சொல் வந்தால் பயப்பட வேண்டாம். அதை எளிய பொருளாக உடைத்து, ஏற்கனவே தெரிந்த உதாரணத்துடன் இணைத்தால் புரிதல் வலுவாகும். இதுவே தொடக்க வகுப்புகளில் நல்ல கற்றலை உருவாக்கும்.\n\nஇப்போது தலைப்பை படிப்படியாக ஒழுங்குபடுத்திக் கொள்வோம்: பொருள், ஒரு தெளிவான தகவல், ஒரு உதாரணம், ஒரு முடிவு. இப்படிச் சிந்தித்தால் குழப்பம் குறையும். பாடத்தில் வரையறை, விதி அல்லது தொடர்பு இருந்தால் அதைச் சுருக்கமாக நினைவில் வைத்துக் கொள்ளுங்கள். உங்கள் வகுப்பு நிலையைத் தாண்டிய விபரங்கள் தேவையில்லை. குறுகியதும் சரியானதும் நீண்டதிலும் குழப்பமானதிலும் விட சிறந்தது.\n\nஇறுதியாக, முக்கிய அம்சங்களை கவனமாகக் கேட்டு, பதில்களைத் தேர்வுசெய்யும் முன் ஒவ்வொரு விருப்பத்தையும் ஒப்பிடுங்கள். தவறானவற்றை நீக்கி, பாடத்தில் சொன்ன கருத்துடன் சரியாகப் பொருந்தும் ஒன்றைத் தேர்ந்தெடுக்குங்கள். இந்த முறை மெதுவாக யோசிக்கும் மாணவர்களுக்கும் உதவும்.`,
      key_points: [
        `${topic} என்ற சொல்லின் எளிய பொருளை முதலில் சொல்.`,
        "பாடத்துடன் பொருந்தும் ஒரு அன்றாட உதாரணத்தை நினைவில் கொள்.",
        "முக்கிய தகவல் அல்லது விதியைச் சரியாக நினைவில் வை.",
        "MCQ-யில் சுருக்கத்துடன் பொருந்தும் விருப்பத்தைத் தேர்ந்தெடு.",
      ],
      bridge:
        "சரி. இப்போது MCQ சுற்றைத் தொடங்கலாம். ஒவ்வொரு கேள்வியையும் கவனமாகக் கேட்டு ஒரு சரியான விருப்பத்தைத் தொடு.",
    };
  }

  return {
    intro: `Good morning. Today we are going to start ${topic} in ${subject}. ${sourceNote} This lesson will stay simple, clear, and suitable for Class ${classLevel}.`,
    content: `First, let us understand what ${topic} means in a simple way. We are not learning this topic to memorize difficult lines. We are learning it so we can explain it clearly, use it in classwork, and identify it in real life. While listening, think of three things: what it is, where we see it, and why it is useful. If you remember these three points, you can answer most school questions with confidence.\n\nNext, connect the topic with daily experience. Use examples from classroom activities, home objects, weather, food, light, sound, plants, or simple machines depending on the lesson. When a new word appears, do not panic. Break it into easy meaning and connect it to an example you already know. That is how strong understanding is built in primary classes.\n\nNow let us organize the topic step by step: meaning, one clear fact, one example, and one result. This order helps you avoid confusion. If the lesson includes a definition, relation, rule, or formula, remember it in short form and say what it tells us. Do not add advanced details beyond your class level. Short and correct is always better than long and confusing.\n\nFinally, listen carefully to key points and compare options before choosing answers. Read every option, remove wrong ones, and pick the one that exactly matches the lesson explanation. This method helps all students, including those who need extra time.`,
    key_points: [
      `Say the meaning of ${topic} in simple words first.`,
      "Use one real-life example that matches the lesson.",
      "Remember key fact or rule exactly as taught.",
      "Choose MCQ options by matching them with summary facts.",
    ],
    bridge:
      "Great. Now we will start the MCQ round. Read each question and tap one correct option.",
  };
}
