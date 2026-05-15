import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import {
  generateLlmJson,
  generateLlmResponse,
  generateTamilResponse,
  generateTeluguResponse,
  retrieveTopicChunks,
  summarizeTopic,
  type RetrieverChunk,
} from "../repositories";
import {
  buildCustomTopicSummaryJsonPrompt,
  buildCustomTopicSummaryTextPrompt,
  type SocraticPromptLanguage,
} from "../prompts/socratic.prompts";

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
  diagram_captions?: string[];
  exercise_chunks?: Array<{ text: string; page: number }>;
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

interface AlertSuggestionResult extends AlertSuggestionShape {
  source: "ai" | "fallback";
  message?: string;
}

interface QuestionBankRequest {
  topic: string;
  subject: string;
  questionCount: number;
  classLevel: number;
  lang: SupportedLanguage;
  summaryLines: string[];
  exerciseChunks?: Array<{ text: string; page: number }>;
}

type SupportedLanguage = "en" | "ta" | "te";

const QUESTIONS_PER_STUDENT = 6;
const MIN_SUMMARY_WORDS = 260;
const DEFAULT_CLASS_LEVEL = 3;
const MAX_CLASS_LEVEL = 5;
const MAX_PREVIEW_CARDS = 3;
const MAX_QUESTION_BANK_SIZE = 24;
const MAX_QUESTION_CONTEXT_FACTS = 24;
const MAX_QUESTION_OPTION_WORDS = 6;
const QUESTION_GENERATION_BATCH_SIZE = 6;
const QUESTION_GENERATION_MAX_ROUNDS = 8;
const QUESTION_DUPLICATE_SIMILARITY = 0.55;
const QUESTION_KEYWORD_STOPWORDS_EN = new Set([
  "about",
  "after",
  "before",
  "class",
  "correct",
  "does",
  "explain",
  "fact",
  "from",
  "how",
  "into",
  "lesson",
  "mcq",
  "many",
  "option",
  "question",
  "round",
  "short",
  "should",
  "student",
  "students",
  "subject",
  "summary",
  "teacher",
  "textbook",
  "topic",
  "used",
  "using",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);
const QUESTION_KEYWORD_STOPWORDS_TA = new Set([
  "இங்கு",
  "இது",
  "இன்று",
  "இப்போது",
  "எந்த",
  "எந்தெந்த",
  "எப்படி",
  "எப்போது",
  "எது",
  "என்ன",
  "என்னென்ன",
  "யார்",
  "யாரை",
  "உள்ள",
  "கேள்வி",
  "சிறிய",
  "சுற்று",
  "தலைப்பு",
  "தேர்வு",
  "நம்",
  "நாம்",
  "பற்றி",
  "பதில்",
  "பாடம்",
  "பாடத்தில்",
  "மாணவர்",
  "மாணவர்கள்",
  "வழிகளில்",
  "வழியில்",
  "வகுப்பு",
  "விருப்பம்",
  "சரியான",
  "சுருக்கம்",
  "ஆசிரியர்",
]);
const QUESTION_KEYWORD_STOPWORDS_TE = new Set([
  "ఇది",
  "ఇప్పుడు",
  "ఎందుకు",
  "ఎలా",
  "ఎప్పుడు",
  "ఏది",
  "ఏవి",
  "ఎవరు",
  "ప్రశ్న",
  "సమాధానం",
  "తరగతి",
  "విద్యార్థి",
  "విద్యార్థులు",
  "విషయం",
  "టాపిక్",
  "పాఠం",
  "సారాంశం",
  "రౌండ్",
  "ఎంపిక",
  "గురువు",
]);

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
 *   language:    "en" | "ta" | "te"
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
    const questionBankCount = Math.min(MAX_QUESTION_BANK_SIZE, totalQuestionCount);

    let effective: SummaryShape | null = null;

    if (sourceMode === "custom") {
      // Custom topics stay local-only and rely on the configured LLM plus class-level constraints.
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
        const summaryDiagramCaptions = Array.isArray(summary.diagram_captions)
          ? summary.diagram_captions.filter(
              (caption): caption is string =>
                typeof caption === "string" && caption.trim().length > 0,
            )
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
            diagram_captions: summaryDiagramCaptions,
            exercise_chunks: summaryExercises,
          };
        } else if (normalized.intro.length >= 10 || normalized.content.length >= 40) {
          // RAG content exists but may be thin or missing some fields.
          // Repair in-place — curriculum topics must stay textbook-grounded, no Ollama fallback.
          effective = {
            ..._repairRagSummary(normalized, topic, summary.chunks_used, targetLanguage),
            images_base64: summaryImages,
            diagram_captions: summaryDiagramCaptions,
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
    const questions = await _buildQuestionBank({
      topic,
      subject,
      questionCount: questionBankCount,
      classLevel,
      lang: targetLanguage,
      summaryLines: lines,
      exerciseChunks: effective.exercise_chunks ?? [],
    });

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
    res.json({
      ..._normalizeAlertSuggestion(generated, studentName, topic, subject, safeMisses),
      source: "ai",
    } satisfies AlertSuggestionResult);
  } catch {
    res.json({
      ..._fallbackAlertSuggestion(studentName, topic, subject, safeMisses),
      source: "fallback",
      message: "AI suggestion is unavailable right now. Showing a local support plan instead.",
    } satisfies AlertSuggestionResult);
  }
}

function _countScripts(text: string): { tamil: number; telugu: number; latin: number } {
  return {
    tamil: [...text].filter((char) => char >= "\u0B80" && char <= "\u0BFF").length,
    telugu: [...text].filter((char) => char >= "\u0C00" && char <= "\u0C7F").length,
    latin: [...text].filter((char) => /[A-Za-z]/.test(char)).length,
  };
}

function _detectLanguage(text: string): SupportedLanguage {
  const sample = text.trim();
  if (!sample) return "en";

  const { tamil: tamilChars, telugu: teluguChars, latin: latinChars } = _countScripts(sample);
  const total = tamilChars + teluguChars + latinChars;
  if (total === 0) return "en";

  const tamilRatio = tamilChars / total;
  const teluguRatio = teluguChars / total;

  if (teluguChars > 0 && tamilChars === 0 && (latinChars === 0 || teluguRatio >= 0.55)) {
    return "te";
  }

  if (tamilChars > 0 && teluguChars === 0 && (latinChars === 0 || tamilRatio >= 0.55)) {
    return "ta";
  }

  if (teluguChars > 0 && tamilChars > 0) {
    return teluguChars >= tamilChars ? "te" : "ta";
  }

  if (teluguChars > 0 && teluguRatio >= 0.45) {
    return "te";
  }

  if (tamilChars > 0 && tamilRatio >= 0.45) {
    return "ta";
  }

  return "en";
}

function _normalizeChunkLanguage(chunk: RetrieverChunk): SupportedLanguage | null {
  const rawLanguage = typeof chunk.language === "string" ? chunk.language.trim().toLowerCase() : "";
  if (rawLanguage === "ta") return "ta";
  if (rawLanguage === "te") return "te";
  if (rawLanguage === "en") return "en";

  const text = chunk.text || "";
  const { tamil: tamilChars, telugu: teluguChars, latin: latinChars } = _countScripts(text);
  if (rawLanguage === "bilingual") {
    if (teluguChars > 0 && (latinChars === 0 || teluguChars >= Math.max(tamilChars, latinChars))) {
      return "te";
    }
    if (tamilChars > 0 && (latinChars === 0 || tamilChars >= Math.max(teluguChars, latinChars))) {
      return "ta";
    }
    if (latinChars > 0) return "en";
  }

  if (!text.trim()) return null;
  return _detectLanguage(text);
}

function _pickLanguageFromChunks(chunks: RetrieverChunk[]): SupportedLanguage | null {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  const counts = chunks.reduce(
    (acc, chunk) => {
      const language = _normalizeChunkLanguage(chunk);
      if (!language) return acc;
      acc[language] += 1;
      return acc;
    },
    { en: 0, ta: 0, te: 0 },
  );

  if (counts.ta === 0 && counts.te === 0 && counts.en === 0) return null;

  if (counts.te >= counts.ta && counts.te >= counts.en) return "te";
  if (counts.ta >= counts.te && counts.ta >= counts.en) return "ta";
  return "en";
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
  const prompt = buildCustomTopicSummaryJsonPrompt({
    topic,
    subject,
    classLevel,
    lang: lang as SocraticPromptLanguage,
  });

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
        chunks_used: 0,
      };
    }
  } catch (error) {
    lastError = error;
    // JSON mode failed — try plain text below.
  }

  // --- Fallback: plain-text LLM call (no JSON constraint, much more reliable) ---
  try {
    const textPrompt = buildCustomTopicSummaryTextPrompt({
      topic,
      subject,
      classLevel,
      lang: lang as SocraticPromptLanguage,
    });

    const raw =
      lang === "ta"
        ? await generateTamilResponse(textPrompt)
        : lang === "te"
          ? await generateTeluguResponse(textPrompt)
          : await generateLlmResponse(textPrompt);

    if (raw && raw.trim().length >= 40) {
      const shape = _textToSummaryShape(raw, topic, lang);
      const lines = _toLines({ ...shape, word_count: 0, chunks_used: 0 });
      return {
        ...shape,
        word_count: _countWords(lines),
        chunks_used: 0,
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
      : lang === "te"
        ? `"${topic}" విషయానికి Ollama సారాంశాన్ని రూపొందించలేకపోయింది.`
        : `Ollama could not generate a summary for "${topic}".`,
    502,
    "ollama",
  );
}

function _countTextWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function _compactQuestionFact(text: string, lang: SupportedLanguage): string {
  const cleaned = _sanitizeSummaryText(text.replace(/\s+/g, " ").trim(), lang);
  if (!cleaned) return "";

  const firstSentence = cleaned.split(/(?<=[.!?।])\s+/)[0]?.trim() ?? cleaned;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length <= 24) return firstSentence;
  return `${words.slice(0, 24).join(" ")}...`;
}

function _buildQuestionFacts(
  summaryLines: string[],
  exerciseChunks: Array<{ text: string; page: number }>,
  lang: SupportedLanguage,
): string[] {
  const sources = [...exerciseChunks.map((chunk) => chunk.text), ...summaryLines];

  const weakFactPattern =
    lang === "ta"
      ? /mcq|கேள்வி|சுற்று|விருப்பம்|தொடங்கலாம்|தேர்வு|வணக்கம்|அறிமுக|தொடக்கம்|அமர்வு|எப்படி இருக்க|பாடத்தின் பொதுவான/i
      : lang === "te"
        ? /mcq|ప్రశ్న|రౌండ్|ఎంపిక|సారాంశం|పాఠం|పరిచయం|ప్రారంభం|సెషన్|ఎలా ఉన్నారు|నమస్కారం/i
        : /mcq|question round|tap one option|summary|lesson|classroom process|practice round|introduction|opening line|how are you/i;

  const facts: string[] = [];
  for (const source of sources) {
    const fact = _compactQuestionFact(source, lang);
    if (!fact || fact.length < 18 || weakFactPattern.test(fact)) continue;
    if (facts.some((existing) => existing.toLowerCase() === fact.toLowerCase())) continue;
    facts.push(fact);
    if (facts.length >= MAX_QUESTION_CONTEXT_FACTS) break;
  }

  return facts;
}

function _collectQuestionKeywords(
  topic: string,
  questionFacts: string[],
  lang: SupportedLanguage,
): string[] {
  const stopwords =
    lang === "ta"
      ? QUESTION_KEYWORD_STOPWORDS_TA
      : lang === "te"
        ? QUESTION_KEYWORD_STOPWORDS_TE
        : QUESTION_KEYWORD_STOPWORDS_EN;
  const minLength = lang === "ta" || lang === "te" ? 3 : 4;
  const tokens =
    `${topic} ${questionFacts.join(" ")}`
      .toLowerCase()
      .match(/[a-z]+|[\u0B80-\u0BFF]+|[\u0C00-\u0C7F]+/g) ?? [];

  const keywords: string[] = [];
  for (const token of tokens) {
    if (token.length < minLength || stopwords.has(token)) continue;
    if (keywords.includes(token)) continue;
    keywords.push(token);
    if (keywords.length >= 18) break;
  }

  return keywords;
}

function _normalizeQuestionTokens(text: string, lang: SupportedLanguage): string[] {
  const stopwords =
    lang === "ta"
      ? QUESTION_KEYWORD_STOPWORDS_TA
      : lang === "te"
        ? QUESTION_KEYWORD_STOPWORDS_TE
        : QUESTION_KEYWORD_STOPWORDS_EN;
  const minLength = lang === "ta" || lang === "te" ? 2 : 3;

  return (text.toLowerCase().match(/[a-z0-9]+|[\u0B80-\u0BFF]+|[\u0C00-\u0C7F]+/g) ?? [])
    .map((token) => {
      if (lang === "en" && token.length > 4 && token.endsWith("s")) {
        return token.slice(0, -1);
      }
      return token;
    })
    .filter((token) => token.length >= minLength && !stopwords.has(token));
}

function _questionSimilarity(leftText: string, rightText: string, lang: SupportedLanguage): number {
  const leftTokens = new Set(_normalizeQuestionTokens(leftText, lang));
  const rightTokens = new Set(_normalizeQuestionTokens(rightText, lang));

  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function _normalizedAnswerSignature(question: SocraticQuestion, lang: SupportedLanguage): string {
  return _normalizeQuestionTokens(question.options[question.answerIndex] ?? "", lang).join(" ");
}

function _isNearDuplicateQuestion(
  question: SocraticQuestion,
  existing: SocraticQuestion[],
  lang: SupportedLanguage,
): boolean {
  return existing.some((candidate) => {
    if (candidate.q.trim().toLowerCase() === question.q.trim().toLowerCase()) {
      return true;
    }

    const stemSimilarity = _questionSimilarity(question.q, candidate.q, lang);
    if (stemSimilarity >= QUESTION_DUPLICATE_SIMILARITY) {
      return true;
    }

    const answerSimilarity = _questionSimilarity(
      question.options[question.answerIndex] ?? "",
      candidate.options[candidate.answerIndex] ?? "",
      lang,
    );
    const sameAnswerSignature =
      _normalizedAnswerSignature(candidate, lang) === _normalizedAnswerSignature(question, lang);

    if (sameAnswerSignature && stemSimilarity >= 0.34) {
      return true;
    }

    return answerSimilarity >= 0.6 && stemSimilarity >= 0.2;
  });
}

function _mergeQuestions(
  existing: SocraticQuestion[],
  incoming: SocraticQuestion[],
  limit: number,
  lang: SupportedLanguage,
): SocraticQuestion[] {
  const merged = [...existing];
  for (const question of incoming) {
    if (_isNearDuplicateQuestion(question, merged, lang)) continue;
    merged.push(question);
    if (merged.length >= limit) break;
  }
  return merged;
}

function _buildQuestionPrompt(
  input: QuestionBankRequest,
  questionFacts: string[],
  anchorWords: string[],
  existingQuestions: SocraticQuestion[],
  batchSize: number,
): string {
  const factsBlock =
    questionFacts.length > 0
      ? questionFacts.map((fact, idx) => `${idx + 1}. ${fact}`).join("\n")
      : input.lang === "ta"
        ? `${input.topic} பற்றிய உறுதியான தகவல்களை மட்டும் கேள்வியாக மாற்றவும்.`
        : input.lang === "te"
          ? `${input.topic} గురించి ఖచ్చితమైన నిజాలనే ప్రశ్నలుగా మార్చండి.`
          : `Stay tightly focused on ${input.topic} only.`;

  const anchorsBlock = anchorWords.length > 0 ? anchorWords.join(", ") : input.topic;
  const usedQuestionsBlock =
    existingQuestions.length > 0
      ? existingQuestions
          .slice(-8)
          .map((question, idx) => `${idx + 1}. ${question.q}`)
          .join("\n")
      : input.lang === "ta"
        ? "இன்னும் எதுவும் பயன்படுத்தப்படவில்லை."
        : input.lang === "te"
          ? "ఇంకా ఏ ప్రశ్నా ఉపయోగించలేదు."
          : "None yet.";

  if (input.lang === "ta") {
    return [
      "தமிழில் மட்டும் பதிலளிக்கவும்.",
      `நீங்கள் வகுப்பு ${input.classLevel} ${input.subject} ஆசிரியர்.`,
      `தலைப்பு: ${input.topic}`,
      "",
      "கீழே உள்ள topic facts-ஐ மட்டும் பயன்படுத்தவும்:",
      factsBlock,
      `Anchor words: ${anchorsBlock}`,
      "",
      "ஏற்கனவே பயன்படுத்திய கேள்வி கருத்துகள். இவற்றை மீண்டும் அல்லது வேறு வடிவில் கேட்க வேண்டாம்:",
      usedQuestionsBlock,
      "",
      "விதிகள்:",
      `- இந்த batch-க்கு ${batchSize} MCQ மட்டும் உருவாக்கவும்.`,
      "- மேலே உள்ள facts-இல் இல்லாத தகவலை உருவாக்க வேண்டாம்.",
      "- ஒவ்வொரு கேள்வியும் தலைப்பின் ஒரு தெளிவான உண்மை, பகுதி, வேலை, உதாரணம், வரிசை, காரணம் அல்லது விளைவைச் சோதிக்க வேண்டும்.",
      "- பாடம், சுருக்கம், வகுப்பு நடைமுறை, அல்லது பொதுவான subject பற்றி கேள்வி கேட்க வேண்டாம்.",
      "- ஒவ்வொரு கேள்வியும் வேறு fact அல்லது வேறு reasoning angle-ஐ பயன்படுத்த வேண்டும்.",
      "- முதல் கேள்விகள் எளிதாகவும், பின்னைய கேள்விகள் சிந்திக்க வைக்கும் வகையிலும் இருக்கட்டும்.",
      "- ஒவ்வொரு கேள்விக்கும் 4 விருப்பங்கள் மட்டும்; 1 சரியான பதில் மட்டும்.",
      "- விருப்பங்கள் குறுகிய சொற்கள் அல்லது சிறு சொற்றொடர்கள் மட்டும்; முழு வாக்கியங்கள் வேண்டாம்.",
      "- தவறான விருப்பங்கள் இதே topic-இல் வரும் நம்பகமான குழப்பங்கள் ஆக இருக்க வேண்டும்.",
      "- 'all of the above', 'none of the above', 'இந்த topic தொடர்பில்லை', 'skip' போன்ற பொதுவான fillers வேண்டாம்.",
      "- explain ஒரு குறுகிய வாக்கியமாக சரியான பதில் ஏன் சரி என்பதைச் சொல்ல வேண்டும்.",
      "- ஒரே கேள்வி கருத்தை மீண்டும் மீண்டும் பயன்படுத்த வேண்டாம்.",
      "",
      "Return ONLY valid JSON in this exact shape:",
      '{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explain":"..."}]}',
    ].join("\n");
  }

  if (input.lang === "te") {
    return [
      "తెలుగులో మాత్రమే సమాధానం ఇవ్వండి.",
      `మీరు తరగతి ${input.classLevel} ${input.subject} ఉపాధ్యాయులు.`,
      `టాపిక్: ${input.topic}`,
      "",
      "క్రింది టాపిక్ నిజాలను మాత్రమే ఉపయోగించండి:",
      factsBlock,
      `Anchor words: ${anchorsBlock}`,
      "",
      "ఇప్పటికే వాడిన ప్రశ్న ఆలోచనలు. వీటిని మళ్లీ వాడకండి:",
      usedQuestionsBlock,
      "",
      "నియమాలు:",
      `- ఈ బ్యాచ్‌కు ఖచ్చితంగా ${batchSize} MCQలు తయారు చేయండి.`,
      "- పై నిజాలకు బయట సమాచారం కల్పించకండి.",
      "- ప్రతి ప్రశ్న టాపిక్‌లోని స్పష్టమైన నిజం, భాగం, పని, ఉదాహరణ, కారణం లేదా ఫలితాన్ని పరీక్షించాలి.",
      "- పాఠం నడిపిన విధానం, సారాంశం, సెషన్ గురించి మెటా ప్రశ్నలు అడగకండి.",
      "- ప్రతి ప్రశ్న వేర్వేరు నిజం లేదా వేర్వేరు reasoning angle ను ఉపయోగించాలి.",
      "- మొదట సులభ recall ప్రశ్నలు, తర్వాత సులభ reasoning ప్రశ్నలు ఇవ్వండి.",
      "- ప్రతి ప్రశ్నకు 4 ఎంపికలు, 1 సరైన సమాధానం మాత్రమే ఉండాలి.",
      "- ఎంపికలు చిన్న పదాలు లేదా చిన్న పదబంధాలుగా ఉండాలి; పూర్తి వాక్యాలు కాదు.",
      "- తప్పు ఎంపికలు అదే టాపిక్‌లో సాధారణ గందరగోళాలుగా ఉండాలి.",
      "- all of the above, none of the above, skip వంటి fillers వాడకండి.",
      "- explain ఒక చిన్న వాక్యంగా సరైన సమాధానం ఎందుకు సరైందో చెప్పాలి.",
      "- ఒకే ప్రశ్న ఆలోచనను మళ్లీ మళ్లీ వాడకండి.",
      "",
      "Return ONLY valid JSON in this exact shape:",
      '{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explain":"..."}]}',
    ].join("\n");
  }

  return [
    "Respond only in English.",
    `You are writing a topic-locked MCQ bank for Class ${input.classLevel} ${input.subject}.`,
    `Topic: ${input.topic}`,
    "",
    "Use ONLY these topic facts:",
    factsBlock,
    `Anchor words: ${anchorsBlock}`,
    "",
    "Already used question ideas. Do not repeat or paraphrase any of these:",
    usedQuestionsBlock,
    "",
    "Rules:",
    `- Create exactly ${batchSize} MCQs for this batch.`,
    "- Use only the facts above. If a detail is not supported there, do not invent it.",
    "- Every question must test a concrete topic fact, part, function, sequence, example, cause, or effect.",
    "- Do not ask about the lesson, summary, classroom process, or the subject in general.",
    "- Each question must use a different fact or a clearly different reasoning angle from the previous questions.",
    "- Start with easier recall questions and move toward simple reasoning.",
    "- Each question must have exactly 4 options and exactly 1 correct answer.",
    "- Options must be short words or short phrases, never full sentences.",
    "- Wrong options must be plausible confusions from the same topic.",
    "- Never use fillers such as all of the above, none of the above, this topic is unrelated, skip, or not in the lesson.",
    "- explain must be one short sentence that states why the correct answer is right using the topic fact.",
    "- Do not repeat the same question idea or the same correct answer when avoidable.",
    "",
    "Return ONLY valid JSON in this exact shape:",
    '{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explain":"..."}]}',
  ].join("\n");
}

async function _buildQuestionBank(input: QuestionBankRequest): Promise<SocraticQuestion[]> {
  const questionFacts = _buildQuestionFacts(
    input.summaryLines,
    input.exerciseChunks ?? [],
    input.lang,
  );
  const targetCount = Math.max(
    QUESTIONS_PER_STUDENT,
    Math.min(input.questionCount, MAX_QUESTION_BANK_SIZE),
  );
  const groundingKeywords = _collectQuestionKeywords(input.topic, questionFacts, input.lang);
  let collected: SocraticQuestion[] = [];
  const maxRounds = Math.max(
    2,
    Math.min(
      QUESTION_GENERATION_MAX_ROUNDS,
      Math.ceil(targetCount / QUESTION_GENERATION_BATCH_SIZE) + 2,
    ),
  );

  for (let round = 0; round < maxRounds && collected.length < targetCount; round += 1) {
    const batchSize = Math.min(QUESTION_GENERATION_BATCH_SIZE, targetCount - collected.length);
    const prompt = _buildQuestionPrompt(
      { ...input, questionCount: targetCount },
      questionFacts,
      groundingKeywords,
      collected,
      batchSize,
    );

    try {
      const generated = await generateLlmJson<{ questions: SocraticQuestion[] }>(prompt);
      const normalized = _normalizeQuestions(generated.questions, batchSize, input.lang);
      collected = _mergeQuestions(collected, normalized, targetCount, input.lang);
      if (collected.length >= targetCount) {
        return collected.slice(0, targetCount);
      }
      if (normalized.length > 0) continue;
    } catch {
      // Retry this batch once with plain text generation in case JSON mode is brittle.
    }

    try {
      const raw =
        input.lang === "ta"
          ? await generateTamilResponse(prompt)
          : input.lang === "te"
            ? await generateTeluguResponse(prompt)
            : await generateLlmResponse(prompt);
      const parsed = _parseQuestionEnvelope(raw);
      if (parsed) {
        const normalized = _normalizeQuestions(parsed.questions, batchSize, input.lang);
        collected = _mergeQuestions(collected, normalized, targetCount, input.lang);
        if (collected.length >= targetCount) {
          return collected.slice(0, targetCount);
        }
      }
    } catch {
      // Fall through to the stricter fallback prompt.
    }
  }

  return await _fallbackQuestions(
    { ...input, questionCount: targetCount },
    questionFacts,
    groundingKeywords,
    collected,
  );
}

function _parseQuestionEnvelope(raw: string): { questions: unknown } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as { questions?: unknown };
    return parsed && typeof parsed === "object" && "questions" in parsed
      ? { questions: parsed.questions }
      : null;
  } catch {
    return null;
  }
}

function _extractClassLevel(className: string): number {
  const match = className.match(/(\d+)/);
  if (!match) return DEFAULT_CLASS_LEVEL;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return DEFAULT_CLASS_LEVEL;
  return Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(value)));
}

function _sanitizeSummaryText(text: string, lang: SupportedLanguage): string {
  const greetingReplacement =
    lang === "ta" ? "வணக்கம்" : lang === "te" ? "నమస్కారం" : "Good morning";
  const fatherReplacement = lang === "ta" ? "அப்பா" : lang === "te" ? "నాన్న" : "father";
  const motherReplacement = lang === "ta" ? "அம்மா" : lang === "te" ? "అమ్మ" : "mother";
  const childReplacement = lang === "ta" ? "குழந்தை" : lang === "te" ? "బిడ్డ" : "child";
  const continueReplacement =
    lang === "ta"
      ? "இப்போது தொடங்கலாம். "
      : lang === "te"
        ? "ఇప్పుడు ప్రారంభిద్దాం. "
        : "Now let us continue. ";
  const lookAroundReplacement =
    lang === "ta"
      ? "சுற்றிலும் பாருங்கள். "
      : lang === "te"
        ? "చుట్టూ చూడండి. "
        : "Look around you. ";
  const hereSeeReplacement =
    lang === "ta"
      ? "இங்கு நாம் பார்க்கலாம். "
      : lang === "te"
        ? "ఇక్కడ మనం చూడవచ్చు. "
        : "Here we can see. ";
  const shallWeReplacement =
    lang === "ta"
      ? "இப்போது தொடர்வோம். "
      : lang === "te"
        ? "ఇప్పుడు కొనసాగుదాం. "
        : "Let us continue. ";

  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\bnamaste\b/gi, greetingReplacement)
    .replace(/\bpapa\b/gi, fatherReplacement)
    .replace(/\bmummy\b|\bmumma\b/gi, motherReplacement)
    .replace(/\bbeta\b|\bbaccha\b/gi, childReplacement)
    .replace(/\bHow are you(?: doing)?(?: today)?\b[.!?]*/gi, "")
    .replace(/\bAre you ready\b[.!?]*/gi, continueReplacement)
    .replace(/\bWhat do you see\b[.!?]*/gi, lookAroundReplacement)
    .replace(/\bCan you see\b[.!?]*/gi, hereSeeReplacement)
    .replace(/\bShall we\b[.!?]*/gi, shallWeReplacement)
    .replace(/தயாரா[?!.]*/g, "இப்போது தொடங்கலாம். ")
    .replace(/என்ன பார்க்கிறீர்கள்[?!.]*/g, "சுற்றிலும் பாருங்கள். ")
    .replace(/సిద్ధమేనా[?!.]*/g, "ఇప్పుడు ప్రారంభిద్దాం. ")
    .replace(/ఏమి చూస్తున్నారు[?!.]*/g, "చుట్టూ చూడండి. ")
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
  const sourceCue = sourceMode === "custom" ? "Local notes" : "Textbook cue";

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
      : lang === "te"
        ? /శుభోదయం|నమస్కారం|హలో/i.test(introText)
          ? "శుభోదయం. "
          : ""
        : /\b(good morning|good afternoon|good evening|hello)\b/i.test(introText)
          ? "Good morning. "
          : "";
  const needsCompaction =
    lang === "ta"
      ? introLines.length > 2 || /\?|தயாரா|விளையாடு|அருமை/i.test(introText)
      : lang === "te"
        ? introLines.length > 2 || /\?|సిద్ధమేనా|ఆడుకుందాం|బాగుంది/i.test(introText)
        : introLines.length > 2 ||
          /\?|are you ready|has anyone|wow|magical|let'?s play/i.test(introText);

  if (!introText || needsCompaction) {
    return {
      ...sanitized,
      intro:
        lang === "ta"
          ? `${greeting}இன்று நாம் ${subject} பாடத்தில் ${topic} தலைப்பை மெதுவாக தொடங்கப் போகிறோம்.`
          : lang === "te"
            ? `${greeting}ఈ రోజు మనం ${subject}లో ${topic} అంశాన్ని నెమ్మదిగా ప్రారంభించబోతున్నాం.`
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
      : lang === "te"
        ? `సరే. ఇప్పుడు ${topic} గురించి చిన్న MCQ రౌండ్‌కు వెళ్దాం.`
        : `Good. Now we will move to a short MCQ round on ${topic}.`);

  return { intro, content, key_points, bridge };
}

function _splitForFlow(text: string, preserveWhole = false): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (preserveWhole) return [trimmed];

  // Dialogue pattern: "Speaker: text" or "Speaker : text"
  const dialogueRe =
    /^[\w\u0B80-\u0BFF\u0C00-\u0C7F][\w\u0B80-\u0BFF\u0C00-\u0C7F ]{0,20}\s*[:：]\s*.+/;
  // Inline dialogue split: detect a second speaker starting mid-line
  const inlineDialogueSplitRe =
    /(?<=[.!?""']\s{1,3})(?=[A-Z\u0B80-\u0BFF\u0C00-\u0C7F][\w\u0B80-\u0BFF\u0C00-\u0C7F ]{0,20}\s*[:：])/g;

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

function _hasWeakMcqOption(option: string): boolean {
  return (
    _countTextWords(option) > MAX_QUESTION_OPTION_WORDS ||
    /all of the above|none of the above|both a and b|both a & b|this topic is unrelated|skip|not in the lesson|today.?s summary|పైవన్నీ|ఏదీ కాదు|ఈ పాఠానికి సంబంధం లేదు/i.test(
      option,
    )
  );
}

function _normalizeQuestions(
  raw: unknown,
  expectedCount: number,
  lang: SupportedLanguage,
): SocraticQuestion[] {
  if (!Array.isArray(raw)) return [];

  const deduped: SocraticQuestion[] = [];

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

      if (!question || options.length !== 4 || options.some(_hasWeakMcqOption)) return null;

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
    .filter((q) => {
      if (_isNearDuplicateQuestion(q, deduped, lang)) return false;
      deduped.push(q);
      return true;
    })
    .slice(0, expectedCount);
}

/** Reject questions about the session/summary/lesson rather than topic content. */
function _isMetaQuestion(q: SocraticQuestion): boolean {
  const lower = q.q.toLowerCase();
  const optionsLower = q.options.map((o) => o.toLowerCase()).join(" ");
  // Meta patterns: questions about the lesson/summary itself
  if (
    /which option matches|today.?s summary|what did we learn|main idea of (the|this) (lesson|summary)|what is this (lesson|topic) about|introduction|opening line|how are you|general start of the lesson/i.test(
      lower,
    )
  )
    return true;
  if (
    /இன்றைய சுருக்கம்|இந்தப் பாடம் என்ன|பாடத்தின் பொதுவான தொடக்கம்|அறிமுக|தொடக்கம்|அமர்வு|எப்படி இருக்கீங்க|எப்படி இருக்கிறீர்கள்|வணக்கம்/i.test(
      q.q,
    )
  )
    return true;
  if (/ఈరోజు సారాంశం|ఈ పాఠం ఏమిటి|పరిచయం|ప్రారంభం|సెషన్|ఎలా ఉన్నారు|నమస్కారం/i.test(q.q))
    return true;
  // Options that are statements about the lesson
  if (
    /today we are going to|this topic should be|are needed for this topic|is unrelated to|introduction|opening speech/i.test(
      optionsLower,
    )
  )
    return true;
  if (/அறிமுக உரை|தொடக்க உரை|பாடத்தின் தொடக்கம்|அமர்வு தொடக்கம்/i.test(q.options.join(" "))) {
    return true;
  }
  if (/పరిచయ మాట|ప్రారంభ ఉపన్యాసం|పాఠం ప్రారంభం|సెషన్ ప్రారంభం/i.test(q.options.join(" "))) {
    return true;
  }
  return false;
}

async function _fallbackQuestions(
  input: QuestionBankRequest,
  questionFacts: string[] = [],
  groundingKeywords: string[] = [],
  existing: SocraticQuestion[] = [],
): Promise<SocraticQuestion[]> {
  const remaining = Math.max(1, input.questionCount - existing.length);
  const prompt = _buildQuestionPrompt(input, questionFacts, groundingKeywords, existing, remaining);

  try {
    const raw =
      input.lang === "ta"
        ? await generateTamilResponse(prompt)
        : input.lang === "te"
          ? await generateTeluguResponse(prompt)
          : await generateLlmResponse(prompt);
    const parsed = _parseQuestionEnvelope(raw);
    if (parsed) {
      const normalized = _normalizeQuestions(parsed.questions, remaining, input.lang);
      const merged = _mergeQuestions(existing, normalized, input.questionCount, input.lang);
      if (merged.length > 0) return merged.slice(0, input.questionCount);
    }
  } catch {
    // LLM unavailable — return empty so upstream can surface a proper error.
  }

  return existing.slice(0, input.questionCount);
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
      : lang === "te"
        ? `${topic} గురించి ముఖ్యమైన విషయాలను గుర్తుంచుకోండి.`
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
        : lang === "te"
          ? `సరే. ఇప్పుడు ${topic} గురించి చిన్న MCQ రౌండ్‌కు వెళ్దాం.`
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
