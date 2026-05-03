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

const QUESTIONS_PER_STUDENT = 3;
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
 *   language:    "en"
 *   questionsPerStudent: number  fixed to 3
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
    const lang = "en";
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
      effective = await _buildCustomTopicSummary(topic, subject, classLevel);
    } else {
      // Curriculum topics must stay textbook-grounded.
      const summary = await summarizeTopic(className, subject, topic, sourceMode, lang);
      if (summary && summary.chunks_used > 0) {
        const normalized = _normalizeSummary(summary);
        const candidateLines = _toLines({
          ...normalized,
          word_count: 0,
          chunks_used: summary.chunks_used,
        });
        const words = _countWords(candidateLines);

        if (_isSummaryUsable(normalized, words)) {
          effective = {
            ...normalized,
            word_count: words,
            chunks_used: summary.chunks_used,
          };
        } else {
          // Keep curriculum source and use summary text as hint for a stronger fallback.
          effective = await _fallbackSummary(
            topic,
            subject,
            "curriculum",
            classLevel,
            _summaryToContextHint(summary),
          );
        }
      } else {
        effective = null;
      }
    }

    if (!effective) {
      res.status(422).json({
        error: `No textbook chunks found for topic "${topic}" in ${className}/${subject}.`,
        lines: [
          `No textbook content found for ${topic}. Please use a textbook topic name from class sections.`,
        ],
        language: "en",
        questionsPerStudent: QUESTIONS_PER_STUDENT,
        studentCount: safeStudentCount,
        questions: [],
        word_count: 0,
        chunks_used: 0,
        sourceUsed: sourceMode,
      });
      return;
    }

    effective = _tightenSummaryOpening(effective, topic, subject);

    const lines = _toLines(effective);
    const questions = await _buildQuestionBank(
      topic,
      subject,
      lines,
      totalQuestionCount,
      classLevel,
      sourceMode,
    );

    res.json({
      ...effective,
      lines,
      language: "en",
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

// ── custom + fallback summary builders ───────────────────────────────────────
async function _buildCustomTopicSummary(
  topic: string,
  subject: string,
  classLevel: number,
): Promise<SummaryShape> {
  const snippets = await _fetchWebSnippets(topic);
  const webNotes = snippets
    .map(
      (snippet, idx) =>
        `[Web note ${idx + 1}] ${snippet.title}\n${snippet.summary}\nSource: ${snippet.url}`,
    )
    .join("\n\n");

  const prompt = [
    "Respond only in English.",
    "You are a primary school teaching assistant.",
    `Target learners: Class ${classLevel} (India, Class 1-5 stage).`,
    `Topic: ${topic}`,
    `Subject: ${subject}`,
    "",
    "Use the WEB NOTES below as the main reference.",
    "If a detail is missing, stay simple and avoid advanced explanations.",
    "",
    "WEB NOTES:",
    webNotes || "No web notes were available.",
    "",
    "Rules:",
    `- Keep language and depth suitable for Class ${classLevel}.`,
    "- Start directly with the topic explanation.",
    "- If you greet, use only one short greeting like 'Good morning.' and then move straight into the topic.",
    "- Do not include advanced theory, equations, or terms beyond Class 5 level.",
    "- Give everyday examples from home/school where possible.",
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

  return _fallbackSummary(topic, subject, "custom", classLevel, webNotes);
}

async function _fallbackSummary(
  topic: string,
  subject: string,
  source: string,
  classLevel: number,
  contextHint = "",
): Promise<SummaryShape> {
  const sourceNote =
    source === "custom"
      ? "This is a custom teacher-selected topic that should use simple web-friendly explanations."
      : "This is from the standard school curriculum and must stay textbook-aligned.";

  const prompt = [
    "Respond only in English.",
    "You are a primary school teaching assistant.",
    `Target learners: Class ${classLevel} (India, Class 1-5).`,
    `Topic: ${topic}`,
    `Subject: ${subject}`,
    sourceNote,
    ...(contextHint ? ["", "Reference notes:", contextHint] : []),
    "",
    "Create a short classroom narration for about 2-3 minutes.",
    "Start directly with the topic.",
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

  const deterministic = _deterministicSummary(topic, subject, sourceNote, classLevel);
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
): Promise<SocraticQuestion[]> {
  const summaryText = lines.join("\n\n").slice(0, 6000);
  const prompt = [
    "Respond only in English.",
    `You are creating MCQ questions for Class ${classLevel} primary students.`,
    `Topic: ${topic}`,
    `Subject: ${subject}`,
    `Source mode: ${source}`,
    "",
    "Use only ideas that appear in this summary:",
    summaryText,
    "",
    `Create exactly ${questionCount} distinct questions.`,
    "Question rules:",
    "- Focus only on topic content (definition, fact, formula/basic relation if present, example, simple application).",
    "- Do NOT ask teaching-process or meta questions (for example: 'core idea', 'why question rounds', 'answer style').",
    "- Keep each question short and child-friendly (max 16 words).",
    "- Keep options concrete and easy to read.",
    "",
    "For each question provide:",
    "- q: one clear question",
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

  return _fallbackQuestions(topic, subject, questionCount, lines, classLevel);
}

function _extractClassLevel(className: string): number {
  const match = className.match(/(\d+)/);
  if (!match) return DEFAULT_CLASS_LEVEL;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return DEFAULT_CLASS_LEVEL;
  return Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(value)));
}

async function _fetchWebSnippets(topic: string): Promise<WebSnippet[]> {
  const trimmed = topic.trim();
  if (!trimmed) return [];

  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmed)}&srlimit=4&utf8=1&format=json&origin=*`;

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
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;

    try {
      const response = await fetch(summaryUrl);
      if (!response.ok) continue;
      const data = (await response.json()) as WikiSummaryResponse;
      const summary = typeof data.extract === "string" ? data.extract.trim() : "";
      if (!summary) continue;

      snippets.push({
        title: data.title?.trim() || title,
        summary,
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
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
): SummaryShape {
  const introLines = _splitForFlow(summary.intro);
  const introText = introLines.join(" ").trim();
  const greeting = /\b(good morning|good afternoon|good evening|hello)\b/i.test(introText)
    ? "Good morning. "
    : "";
  const needsCompaction =
    introLines.length > 2 || /\?|are you ready|has anyone|wow|magical|let'?s play/i.test(introText);

  if (!introText || needsCompaction) {
    return {
      ...summary,
      intro: `${greeting}Today we are going to start ${topic} in ${subject}.`,
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
): SocraticQuestion[] {
  const facts = _extractFacts(lines, Math.max(6, Math.min(18, count + 4)));
  const starterFact = `${topic} is taught in simple language for Class ${classLevel}.`;
  const questionStems = [
    `Which option matches today's summary on ${topic}?`,
    `According to the lesson, what is true about ${topic}?`,
    `Pick the correct fact from this ${subject} summary.`,
    `Which statement did we learn today about ${topic}?`,
  ] as const;

  const questions: SocraticQuestion[] = [];
  for (let i = 0; i < count; i += 1) {
    const fact = facts[i % facts.length] ?? starterFact;
    const correct = _shortenForOption(fact);
    const wrong = [
      `${topic} is unrelated to ${subject}.`,
      `This topic should be skipped for Class ${classLevel}.`,
      `Only advanced college details are needed for this topic.`,
    ];

    const { options, answerIndex } = _buildOptions(correct, wrong, i);
    questions.push({
      q: questionStems[i % questionStems.length],
      options,
      answerIndex,
      explain: "This option directly matches today's summary.",
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
): { options: string[]; answerIndex: number } {
  const options = distractors.slice(0, 3).map((value) => value.trim());
  while (options.length < 3) {
    options.push("Not enough lesson context available.");
  }

  const answerIndex = seed % 4;
  options.splice(answerIndex, 0, correct.trim());
  return { options, answerIndex };
}

function _deterministicSummary(
  topic: string,
  subject: string,
  sourceNote: string,
  classLevel: number,
): Omit<SummaryShape, "word_count" | "chunks_used"> {
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
