import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import {
  generateLlmJson,
  generateLlmResponse,
  generateTamilResponse,
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
const WEB_FETCH_TIMEOUT_MS = 8_000;

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
    const sourceMode = source === "custom" ? "custom" : "curriculum";
    const targetLanguage =
      sourceMode === "custom"
        ? _detectLanguage(`${topic} ${subject}`)
        : await _resolveSessionLanguage(className, subject, topic);
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
        } else if (normalized.intro.length >= 10 || normalized.content.length >= 40) {
          // RAG content exists but may be thin or missing some fields.
          // Repair in-place — curriculum topics must stay textbook-grounded, no Ollama fallback.
          effective = {
            ..._repairRagSummary(normalized, topic, summary.chunks_used, targetLanguage),
            images_base64: summaryImages,
            exercise_chunks: summaryExercises,
          };
        } else {
          // Truly empty RAG output — treat as no chunks found.
          effective = null;
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
  // Fetch web snippets in parallel — used as optional enrichment only.
  const snippets = await _fetchWebSnippets(topic, lang).catch(() => [] as WebSnippet[]);
  const webContext =
    snippets.length > 0
      ? snippets
          .map((s, i) => `[${i + 1}] ${s.title}: ${s.summary}`)
          .join("\n")
          .slice(0, 1200)
      : "";

  const prompt =
    lang === "ta"
      ? [
          "தமிழில் மட்டும் பதிலளிக்கவும்.",
          "நீங்கள் இந்திய தொடக்கப்பள்ளிக்கான மென்மையான கற்பித்தல் உதவியாளர்.",
          `கற்றல் நிலை: வகுப்பு ${classLevel}.`,
          `தலைப்பு: ${topic}`,
          `பாடம்: ${subject}`,
          ...(webContext ? ["", "கூடுதல் குறிப்புகள்:", webContext] : []),
          "",
          `"${topic}" பற்றி வகுப்பு ${classLevel} மாணவர்களுக்கு ஏற்ற எளிய விளக்கம் தயார் செய்யவும்.`,
          "உங்கள் சொந்த அறிவை பயன்படுத்தவும். அன்பான ஆசிரியர் நடையில் எழுதவும்.",
          "மாணவர்களிடம் கேள்வி கேட்க வேண்டாம். '?' குறியைப் பயன்படுத்த வேண்டாம்.",
          "Markdown, bold, bullet, '*', '_', '`' போன்ற குறிகள் வேண்டாம்.",
          "'நமஸ்தே', 'பாப்பா', 'மம்மி', 'பேட்டா' போன்ற இந்தி அல்லது வடஇந்திய சொற்களை பயன்படுத்த வேண்டாம்.",
          "தமிழ்நாடு பள்ளி நடைபோக்கில் 'வணக்கம்', 'அம்மா', 'அப்பா', 'மாணவர்', 'ஆசிரியர்' போன்ற சொற்களைப் பயன்படுத்தலாம்.",
          "வீடு அல்லது பள்ளி உதாரணங்களை கொடுக்கவும். MCQ சுற்றுக்கான bridge வரியுடன் முடிக்கவும்.",
          "",
          "Return ONLY valid JSON:",
          '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
        ].join("\n")
      : [
          "Respond only in English.",
          "You are a calm Indian primary-school teaching assistant.",
          `Target learners: Class ${classLevel} (India, Class 1-5).`,
          `Topic: ${topic}`,
          `Subject: ${subject}`,
          ...(webContext ? ["", "Additional context:", webContext] : []),
          "",
          `Explain "${topic}" for Class ${classLevel} students using your own knowledge.`,
          "Use a warm Indian classroom-teacher tone. Give simple home or school examples.",
          "Do not ask the students questions. Do not use question marks in the summary.",
          "Do not use Markdown, bold markers, bullets, asterisks, underscores, or backticks.",
          "Do not use Hindi or North-India classroom words like Namaste, papa, mummy, beta, or baccha.",
          "Use neutral Tamil Nadu school wording such as Good morning, mother, father, student, and teacher.",
          "Cover what it is, why it matters, and a real-life example. End with a bridge into MCQ practice.",
          "",
          "Return ONLY valid JSON in this exact shape:",
          '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
        ].join("\n");

  let lastError: unknown = null;

  try {
    const generated =
      await generateLlmJson<Omit<SummaryShape, "word_count" | "chunks_used">>(prompt);
    const normalized = _normalizeSummary(generated);
    // Accept the LLM response as long as it has real content — don't discard on word count alone.
    if (normalized.intro.length >= 20 && normalized.content.length >= 60) {
      const lines = _toLines({ ...normalized, word_count: 0, chunks_used: 0 });
      return {
        ...normalized,
        word_count: _countWords(lines),
        chunks_used: snippets.length,
      };
    }
  } catch (error) {
    lastError = error;
    // JSON mode failed — try plain text below.
  }

  // --- Fallback: plain-text LLM call (no JSON constraint, much more reliable) ---
  try {
    const textPrompt =
      lang === "ta"
        ? [
            "தமிழில் மட்டும் பதிலளிக்கவும்.",
            `நீங்கள் வகுப்பு ${classLevel} மாணவர்களுக்கு "${topic}" (${subject}) பற்றி எளிய தமிழில் விளக்க வேண்டும்.`,
            "அன்பான ஆசிரியர் நடையில் 3-4 பத்திகளில் எழுதுங்கள்.",
            "மாணவர்களிடம் கேள்வி கேட்க வேண்டாம். '?' குறியைப் பயன்படுத்த வேண்டாம்.",
            "Markdown, bold, bullet, '*', '_', '`' போன்ற குறிகள் வேண்டாம்.",
            "'நமஸ்தே', 'பாப்பா', 'மம்மி', 'பேட்டா' போன்ற இந்தி அல்லது வடஇந்திய சொற்களை பயன்படுத்த வேண்டாம்.",
            "வீடு அல்லது பள்ளி உதாரணங்கள் கொடுக்கவும்.",
            ...(webContext ? ["", "கூடுதல் குறிப்புகள்:", webContext] : []),
          ].join("\n")
        : [
            `You are a primary school teacher in India. Explain "${topic}" (${subject}) to Class ${classLevel} students.`,
            "Use simple words and give examples from daily life.",
            "Write 3-4 paragraphs in a warm, friendly tone.",
            "Do not ask the students questions. Do not use question marks.",
            "Do not use Markdown, bold markers, bullets, asterisks, underscores, or backticks.",
            "Do not use Hindi or North-India classroom words like Namaste, papa, mummy, beta, or baccha.",
            ...(webContext ? ["", "Additional context:", webContext] : []),
          ].join("\n");

    const raw =
      lang === "ta"
        ? await generateTamilResponse(textPrompt)
        : await generateLlmResponse(textPrompt);

    if (raw && raw.trim().length >= 40) {
      const shape = _textToSummaryShape(raw, topic, lang);
      const lines = _toLines({ ...shape, word_count: 0, chunks_used: 0 });
      return {
        ...shape,
        word_count: _countWords(lines),
        chunks_used: snippets.length,
      };
    }
  } catch (error) {
    lastError = error;
    // Fall through to explicit Ollama error.
  }

  if (lastError instanceof AppError) throw lastError;

  throw new AppError(
    lang === "ta"
      ? `"${topic}" தலைப்புக்கான சுருக்கத்தை Ollama உருவாக்க முடியவில்லை.`
      : `Ollama could not generate a summary for "${topic}".`,
    502,
    "ollama",
  );
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
          `நீங்கள் வகுப்பு ${classLevel} தொடக்கப்பள்ளி மாணவர்களுக்கான பாடத்திட்ட-சார்ந்த MCQ கேள்விகளை உருவாக்குகிறீர்கள்.`,
          `தலைப்பு: ${topic}`,
          `பாடம்: ${subject}`,
          `Source mode: ${source}`,
          "",
          "முக்கியம்: கீழே உள்ள சுருக்கத்தில் உள்ள உண்மைகள், வரையறைகள், எடுத்துக்காட்டுகளை மட்டுமே பயன்படுத்தவும்.",
          "உங்கள் சொந்த அறிவை சேர்க்காதீர்கள்.",
          summaryText + exerciseNote,
          "",
          `மொத்தம் சரியாக ${questionCount} வேறுபட்ட, தரமான கேள்விகளை உருவாக்கவும்.`,
          "",
          "கேள்வி தர விதிகள்:",
          "- ஒவ்வொரு கேள்வியும் சுருக்கத்தில் உள்ள ஒரு குறிப்பிட்ட உண்மை, வரையறை, அல்லது கருத்தை சோதிக்க வேண்டும்.",
          "- கேள்வி வகைகள்: நினைவுபடுத்தல் (X என்றால் என்ன?), அடையாளம் காணுதல் (எது Y?), பயன்பாடு (A என்றால் என்ன நடக்கும்?)",
          "- 'நாம் என்ன கற்றோம்?' அல்லது 'முக்கிய கருத்து என்ன?' போன்ற பொதுவான கேள்விகள் வேண்டாம்.",
          "- கற்றல் நடைமுறை பற்றிய meta கேள்விகள் வேண்டாம்.",
          "- தவறான விருப்பங்கள் நம்பகமான தவறுகளாக இருக்க வேண்டும் (பொதுவான தவறான புரிதல்கள்).",
          "- ஒவ்வொரு கேள்வியும் சுருக்கமாகவும் குழந்தைகள் புரியும் வகையிலும் இருக்க வேண்டும்.",
          "- பாடப்புத்தக பயிற்சிகள் இருந்தால், அவற்றை MCQ வடிவமாக மாற்றவும்.",
          "",
          "ஒவ்வொரு கேள்விக்கும்:",
          "- q: சுருக்கத்தில் உள்ள ஒரு குறிப்பிட்ட உண்மையை சோதிக்கும் தெளிவான கேள்வி",
          "- options: சரியாக 4 குறுகிய விருப்பங்கள் ('மேற்கூறிய அனைத்தும்' வேண்டாம்)",
          "- answerIndex: சரியான விடையின் index (0 முதல் 3)",
          "- explain: சரியான விடை ஏன் என்று பாடத்தில் இருந்து காரணம்",
          "",
          "JSON keys மட்டும் questions, q, options, answerIndex, explain ஆகவே இருக்க வேண்டும்.",
          "Return ONLY valid JSON.",
          '{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explain":"..."}]}',
        ].join("\n")
      : [
          "Respond only in English.",
          `You are creating curriculum-aligned MCQ questions for Class ${classLevel} primary school students.`,
          `Topic: ${topic}`,
          `Subject: ${subject}`,
          `Source mode: ${source}`,
          "",
          "IMPORTANT: Base ALL questions directly on the factual content below. Do NOT invent facts.",
          "Use only ideas, definitions, examples, and facts that appear in this summary:",
          summaryText + exerciseNote,
          "",
          `Create exactly ${questionCount} distinct, high-quality questions.`,
          "",
          "BANNED question patterns (NEVER use these):",
          `- "Which option matches today's summary on ${topic}?" — this is a meta question`,
          '- "What is the main idea?" — too vague',
          '- "What did we learn today?" — meta question about the session',
          '- "Today we are going to start..." — this is a statement, not a question',
          "- Any question about the teaching process, language of instruction, or session format",
          "- Any question where the options are statements about what the lesson covers",
          "",
          "GOOD question patterns (use these):",
          `- "What is [specific term from the text]?" — tests factual recall`,
          `- "How many [specific thing] are mentioned in [context]?" — tests comprehension`,
          `- "Which of these is an example of [concept]?" — tests identification`,
          `- "If [scenario from text], what happens?" — tests application`,
          "",
          "Question quality rules:",
          "- Every question MUST test a specific fact, definition, concept, or relationship from the summary content.",
          "- Question types: recall (what is X?), identification (which one is Y?), application (if A then what?), comparison.",
          "- Do NOT ask about teaching methods, learning activities, the session, or the summary itself.",
          "- Each question must have ONE clearly correct answer — wrong options must be plausible but definitively wrong.",
          "- Keep language simple and age-appropriate (max 18 words per question).",
          "- Wrong options should be common misconceptions or related-but-incorrect facts from the same domain.",
          "- If textbook exercise questions are provided, adapt them into MCQ format directly.",
          "- Vary difficulty: mix easy recall with slightly harder application questions.",
          "",
          "For each question provide:",
          "- q: one clear question testing a specific fact from the summary",
          "- options: exactly 4 short, concrete options (NOT sentences — just the answer words/phrase)",
          "- answerIndex: index of the correct option (0 to 3)",
          "- explain: one sentence explaining WHY the correct answer is right, referencing the fact from the text",
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    const response = await fetch(searchUrl, { signal: controller.signal });
    clearTimeout(timeout);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
      const response = await fetch(summaryUrl, { signal: controller.signal });
      clearTimeout(timeout);
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

function _sanitizeSummaryText(text: string, lang: SupportedLanguage): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\bnamaste\b/gi, lang === "ta" ? "வணக்கம்" : "Good morning")
    .replace(/\bpapa\b/gi, lang === "ta" ? "அப்பா" : "father")
    .replace(/\bmummy\b|\bmumma\b/gi, lang === "ta" ? "அம்மா" : "mother")
    .replace(/\bbeta\b|\bbaccha\b/gi, lang === "ta" ? "குழந்தை" : "child")
    .replace(/\bHow are you(?: doing)?(?: today)?\b[.!?]*/gi, "")
    .replace(
      /\bAre you ready\b[.!?]*/gi,
      lang === "ta" ? "இப்போது தொடங்கலாம். " : "Now let us continue. ",
    )
    .replace(
      /\bWhat do you see\b[.!?]*/gi,
      lang === "ta" ? "சுற்றிலும் பாருங்கள். " : "Look around you. ",
    )
    .replace(
      /\bCan you see\b[.!?]*/gi,
      lang === "ta" ? "இங்கு நாம் பார்க்கலாம். " : "Here we can see. ",
    )
    .replace(/\bShall we\b[.!?]*/gi, lang === "ta" ? "இப்போது தொடர்வோம். " : "Let us continue. ")
    .replace(/தயாரா[?!.]*/g, "இப்போது தொடங்கலாம். ")
    .replace(/என்ன பார்க்கிறீர்கள்[?!.]*/g, "சுற்றிலும் பாருங்கள். ")
    .replace(/\?/g, ".")
    .replace(/\s+([,.;:!])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function _normalizeSummary(
  value: Partial<Omit<SummaryShape, "word_count" | "chunks_used">>,
  lang?: SupportedLanguage,
): Omit<SummaryShape, "word_count" | "chunks_used"> {
  const rawIntro = typeof value.intro === "string" ? value.intro.trim() : "";
  const rawContent = typeof value.content === "string" ? value.content.trim() : "";
  const rawKeyPoints = Array.isArray(value.key_points)
    ? value.key_points.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean)
    : [];
  const rawBridge = typeof value.bridge === "string" ? value.bridge.trim() : "";
  const summaryLang =
    lang ?? _detectLanguage([rawIntro, rawContent, ...rawKeyPoints, rawBridge].join(" "));

  const intro = _sanitizeSummaryText(rawIntro, summaryLang);
  const content = _sanitizeSummaryText(rawContent, summaryLang);
  const key_points = rawKeyPoints
    .map((point) => _sanitizeSummaryText(point, summaryLang))
    .filter(Boolean)
    .slice(0, 4);
  const bridge = _sanitizeSummaryText(rawBridge, summaryLang);

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


function _tightenSummaryOpening(
  summary: SummaryShape,
  topic: string,
  subject: string,
  lang: SupportedLanguage,
): SummaryShape {
  const sanitized = {
    ...summary,
    intro: _sanitizeSummaryText(summary.intro, lang),
    content: _sanitizeSummaryText(summary.content, lang),
    key_points: summary.key_points.map((point) => _sanitizeSummaryText(point, lang)),
    bridge: _sanitizeSummaryText(summary.bridge, lang),
  };
  const introLines = _splitForFlow(sanitized.intro);
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
      ...sanitized,
      intro:
        lang === "ta"
          ? `${greeting}இன்று நாம் ${subject} பாடத்தில் ${topic} தலைப்பை மெதுவாக தொடங்கப் போகிறோம்.`
          : `${greeting}Today we are going to start ${topic} in ${subject}.`,
    };
  }

  return sanitized;
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

/** Convert free-form LLM text into the structured SummaryShape. */
function _textToSummaryShape(
  text: string,
  topic: string,
  lang: SupportedLanguage,
): Omit<SummaryShape, "word_count" | "chunks_used"> {
  const cleaned = _sanitizeSummaryText(text.replace(/\r/g, "").trim(), lang);
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 20);

  const allSentences = cleaned
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const usableSentences = allSentences.filter((s) => {
    const words = s.split(/\s+/).filter(Boolean).length;
    return words >= 4 && words <= 20;
  });

  const intro = paragraphs[0] ?? usableSentences.slice(0, 2).join(" ") ?? cleaned;
  const contentParagraphs = paragraphs.length > 1 ? paragraphs.slice(1) : [];
  const content =
    contentParagraphs.length > 0
      ? contentParagraphs.join("\n\n")
      : usableSentences.slice(1).join(" ") || intro;
  const key_points = usableSentences.slice(0, 4);
  const bridge =
    allSentences.at(-1) ||
    (lang === "ta"
      ? `சரி. இப்போது ${topic} பற்றி ஒரு சிறிய MCQ சுற்றுக்கு செல்லலாம்.`
      : `Good. Now we will move to a short MCQ round on ${topic}.`);

  return { intro, content, key_points, bridge };
}

function _splitForFlow(text: string, preserveWhole = false): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (preserveWhole) return [trimmed];

  // Dialogue pattern: "Speaker: text" or "Speaker : text"
  const dialogueRe = /^[\w\u0B80-\u0BFF][\w\u0B80-\u0BFF ]{0,20}\s*[:：]\s*.+/;
  // Inline dialogue split: detect a second speaker starting mid-line
  const inlineDialogueSplitRe =
    /(?<=[.!?""']\s{1,3})(?=[A-Z\u0B80-\u0BFF][\w\u0B80-\u0BFF ]{0,20}\s*[:：])/g;

  // Split by paragraphs (double newline) to keep natural text flow.
  const paragraphs = trimmed.split(/\n\n+/);
  const result: string[] = [];

  for (const para of paragraphs) {
    const subLines = para.split(/\n/);
    // If any sub-line looks like dialogue, keep them as separate lines
    if (subLines.some((sl) => dialogueRe.test(sl.trim()))) {
      for (const sl of subLines) {
        // Further split if multiple speakers are jammed into one line
        const parts = sl.trim().split(inlineDialogueSplitRe);
        for (const part of parts) {
          const t = part.trim();
          if (t) result.push(t);
        }
      }
    } else {
      // Regular paragraph — merge into one flowing block
      const merged = subLines
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (merged) {
        // Also check if the merged block contains inline dialogue
        if (dialogueRe.test(merged)) {
          const parts = merged.split(inlineDialogueSplitRe);
          for (const part of parts) {
            const t = part.trim();
            if (t) result.push(t);
          }
        } else {
          result.push(merged);
        }
      }
    }
  }

  return result;
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
    .filter((q) => !_isMetaQuestion(q))
    .slice(0, expectedCount);
}

/** Reject questions about the session/summary/lesson rather than topic content. */
function _isMetaQuestion(q: SocraticQuestion): boolean {
  const lower = q.q.toLowerCase();
  const optionsLower = q.options.map((o) => o.toLowerCase()).join(" ");
  // Meta patterns: questions about the lesson/summary itself
  if (
    /which option matches|today.?s summary|what did we learn|main idea of (the|this) (lesson|summary)|what is this (lesson|topic) about/i.test(
      lower,
    )
  )
    return true;
  // Options that are statements about the lesson
  if (
    /today we are going to|this topic should be|are needed for this topic|is unrelated to/i.test(
      optionsLower,
    )
  )
    return true;
  return false;
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
        ? `சரி. இப்போது ${topic} பற்றி ஒரு சிறிய MCQ சுற்றுக்கு செல்லலாம்.`
        : `Good. Now we will move to a short MCQ round on ${topic}.`;

  const repaired = {
    intro: normalized.intro,
    content: normalized.content,
    key_points: keyPoints,
    bridge,
  };
  const lines = _toLines({ ...repaired, word_count: 0, chunks_used: 0 });
  return { ...repaired, word_count: _countWords(lines), chunks_used: chunksUsed };
}
