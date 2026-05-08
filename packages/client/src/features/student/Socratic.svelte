<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { onDestroy, tick } from "svelte";
  import {
    ArrowRight,
    RotateCcw,
    BookOpen,
    Image as ImageIcon,
    Lightbulb,
    Pencil,
    Phone,
    CheckCircle2,
    Shapes,
    Sparkles,
    XCircle,
  } from "lucide-svelte";
  import { Button } from "@shadcn";
  import { Pill } from "@components";
  import { STUDENTS_BY_CLASS, CLASSES } from "@mocks";
  import {
    activeClass,
    reteachTopics,
    sessionAlerts,
    type SessionAlertRecord,
  } from "@stores";

  type SessionQuestion = {
    q: string;
    options: string[];
    answerIndex: number;
    explain: string;
  };

  type SessionTurn = SessionQuestion & { student: number };
  type SummarizeResponse = {
    lines?: string[];
    questions?: SessionQuestion[];
    error?: string;
    language?: "en" | "ta";
    images_base64?: string[];
  };

  type PreviewCard = {
    title: string;
    caption: string;
    badge: string;
    imageDataUrl?: string;
  };

  type PreviewResponse = {
    cards?: PreviewCard[];
    error?: string;
  };

  type VisualTone = {
    label: string;
    icon: typeof Sparkles;
    cardBackground: string;
    cardBorder: string;
    chipBackground: string;
    chipColor: string;
    trailColor: string;
  };

  type SessionAttempt = {
    studentIdx: number;
    question: string;
    selectedOption: string;
    correctOption: string;
    correct: boolean;
    explain: string;
  };

  type Phase = "start" | "preloading" | "ready" | "summarizing" | "session" | "complete";

  const QUESTIONS_PER_STUDENT = 6;
  const PROGRESS_SEGMENTS = 6;
  const AUTO_ADVANCE_MS = 5000;
  const FALLBACK_EMOJIS = ["🦁", "🌻", "🦚", "🌙"];
  const OPTION_LABELS = ["A", "B", "C", "D"] as const;

  const cls = $derived(CLASSES.find((c) => c.id === activeClass.id));
  const students = $derived(
    STUDENTS_BY_CLASS[activeClass.id] ??
      Array.from({ length: 4 }, (_, idx) => ({
        id: `student-${activeClass.id}-${idx + 1}`,
        name: `Student ${idx + 1}`,
        emoji: FALLBACK_EMOJIS[idx % FALLBACK_EMOJIS.length],
        streak: 0,
        status: "ok" as const,
      })),
  );
  const topic = $derived(reteachTopics.selectedTopic);

  let phase = $state<Phase>("start");

  let qIdx = $state(0);
  let answered = $state<{ studentIdx: number; correct: boolean }[]>([]);
  let answerPhase = $state<"ask" | "feedback">("ask");
  let submittedOption = $state<number | null>(null);
  let lastCorrect = $state(true);
  let feedbackTitle = $state("");
  let feedbackDetail = $state("");

  let summaryLines = $state<string[]>([]);
  let summaryIdx = $state(0);
  let summaryLoading = $state(false);
  let summaryError = $state("");
  let sessionLanguage = $state<"en" | "ta">("en");
  let summaryPreviewCards = $state<PreviewCard[]>([]);
  let summaryPreviewLoading = $state(false);
  let sessionId = $state("");
  let sessionAttempts = $state<SessionAttempt[]>([]);
  let summaryImages = $state<string[]>([]);

  let questionPlan = $state<SessionTurn[]>([]);
  let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  let mcqTtsGeneration = 0;
  let summaryFlowTimer: ReturnType<typeof setTimeout> | null = null;
  let summaryRunId = 0;

  let desktopSummaryStageEl = $state<HTMLDivElement | null>(null);
  let desktopSummarySidebarEl = $state<HTMLDivElement | null>(null);
  let mobileSummaryStageEl = $state<HTMLDivElement | null>(null);

  const totalQuestionCount = $derived(
    questionPlan.length > 0
      ? questionPlan.length
      : Math.max(1, students.length) * QUESTIONS_PER_STUDENT,
  );
  const currentQ = $derived(
    phase === "complete" ? null : questionPlan[qIdx] ?? null,
  );
  const activeStudent = $derived(students[currentQ?.student ?? 0]);
  const nextQ = $derived(
    phase === "complete" ? null : questionPlan[qIdx + 1] ?? null,
  );
  const nextStudent = $derived(students[nextQ?.student ?? 0]);
  const correctCount = $derived(answered.filter((a) => a.correct).length);
  const turnIndex = $derived(
    questionPlan.length > 0 ? Math.min(qIdx, questionPlan.length - 1) : 0,
  );
  const roundNum = $derived(
    Math.min(
      QUESTIONS_PER_STUDENT,
      Math.floor(turnIndex / Math.max(1, students.length)) + 1,
    ),
  );
  const progressStep = $derived(
    phase === "complete" ? totalQuestionCount : Math.min(qIdx + 1, totalQuestionCount),
  );
  const progressFilled = $derived(
    Math.max(1, Math.round((progressStep / totalQuestionCount) * PROGRESS_SEGMENTS)),
  );
  const failCounts = $derived(
    students.map((_, si) => answered.filter((a) => a.studentIdx === si && !a.correct).length),
  );
  const visibleSummaryLines = $derived(
    phase === "summarizing"
      ? summaryLines.slice(0, Math.max(1, summaryIdx + 1))
      : summaryLines,
  );
  const blockedBySource = $derived(phase === "session" && questionPlan.length === 0);
  const accent = $derived(cls?.color ?? "#6B94E7");
  const isFinalTurn = $derived(questionPlan.length > 0 && qIdx >= questionPlan.length - 1);
  const struggleCount = $derived(
    students.filter((_, idx) => sessionAttempts.some((attempt) => attempt.studentIdx === idx && !attempt.correct)).length,
  );
  const sessionLanguageLabel = $derived(sessionLanguage === "ta" ? "Tamil" : "English");
  const headerLanguageLabel = $derived(
    phase === "start" ? "Follows textbook" : sessionLanguageLabel,
  );
  const summaryLanguageNote = $derived(
    "Summary and MCQs will match the uploaded textbook language, including Tamil and English.",
  );

  function normalizeLanguage(value: unknown): "en" | "ta" {
    return value === "ta" ? "ta" : "en";
  }

  function detectLanguage(text: string): "en" | "ta" {
    const sample = text.trim();
    if (!sample) return "en";

    const tamilChars = [...sample].filter((char) => char >= "\u0B80" && char <= "\u0BFF").length;
    const latinChars = [...sample].filter((char) => /[A-Za-z]/.test(char)).length;
    return tamilChars >= Math.max(6, Math.floor(latinChars / 2)) ? "ta" : "en";
  }

  function fallbackLines(): string[] {
    if (sessionLanguage === "ta") {
      return [
        `இன்று நாம் ${topic?.topic ?? "இந்த தலைப்பை"} எளிய ${topic?.subject ?? "அறிவியல்"} சொற்களில் தொடங்கப் போகிறோம்.`,
        "இந்தச் சுருக்கம் பாடத்தின் முக்கிய அம்சங்களை மெதுவாகவும் எளிதாகவும் விளக்கும்.",
        "சுருக்கத்திற்குப் பிறகு, ஒவ்வொரு மாணவரும் நான்கு விருப்பங்களில் ஒன்றை மட்டும் தொட வேண்டும்.",
        "ஒவ்வொரு மாணவருக்கும் ஆறு MCQ வாய்ப்புகள் கிடைக்கும்.",
      ];
    }

    return [
      `Today we are starting ${topic?.topic ?? "this topic"} in simple ${topic?.subject ?? "Science"} words.`,
      "This short summary follows the lesson points and keeps the explanation easy to follow.",
      "After the summary, each student answers only by tapping one of four options.",
      "Each student gets six MCQ turns, one question at a time.",
    ];
  }

  function fallbackQuestions(count: number): SessionQuestion[] {
    const topicName = topic?.topic ?? "this topic";
    const subjectName = topic?.subject ?? "Science";
    if (sessionLanguage === "ta") {
      const facts = [
        `${topicName} எளிய ${subjectName} மொழியில் விளக்கப்படுகிறது.`,
        `${topicName} அன்றாட உதாரணங்கள் மூலம் கற்றுக்கொள்ளப்படுகிறது.`,
        `${topicName} கேள்விகளுக்கு ஒரு சரியான பதிலைத் தேர்ந்தெடுத்து விடை அளிக்க வேண்டும்.`,
        `${topicName} புரிதல் பாடத்தில் உள்ள தகவலைச் சேர்த்து யோசிக்கும் போது மேம்படும்.`,
        `${topicName} இளம் கற்றவர்களுக்கு படிப்படியாக மறுபார்வை செய்யப்படுகிறது.`,
        `${topicName} கேள்வியில் பதிலைத் தேர்வதற்கு முன் எல்லா விருப்பங்களையும் படிக்க வேண்டும்.`,
      ];

      const questionStems = [
        `இன்றைய ${topicName} சுருக்கத்துடன் பொருந்துவது எது?`,
        `பாடத்தின் படி ${topicName} குறித்து சரியானது எது?`,
        `இந்த ${subjectName} அமர்விலிருந்து சரியான தகவலைத் தேர்ந்தெடு.`,
        `${topicName} பற்றி சரியான கூற்று எது?`,
      ] as const;

      return Array.from({ length: count }, (_, idx) => {
        const correct = facts[idx % facts.length];
        const wrong = [
          `${topicName} என்பது ${subjectName} பாடத்தின் பகுதி அல்ல.`,
          `${topicName} கேள்விகளை வகுப்பில் தவிர்க்க வேண்டும்.`,
          `${topicName} கேள்விக்கு பதில் அளிக்க விருப்பங்களைப் படிக்கத் தேவையில்லை.`,
        ];
        const { options, answerIndex } = buildOptions(correct, wrong, idx);
        return {
          q: questionStems[idx % questionStems.length],
          options,
          answerIndex,
          explain: "இந்த விருப்பம் இன்றைய சுருக்கத்துடன் பொருந்துகிறது.",
        };
      });
    }

    const facts = [
      `${topicName} is explained in simple ${subjectName} language.`,
      `${topicName} is learned through examples from daily life.`,
      `${topicName} questions are answered by choosing one correct option.`,
      `${topicName} understanding improves when we match answers with lesson facts.`,
      `${topicName} is revised step by step for young learners.`,
      `Students should read all options before choosing the answer in ${topicName}.`,
    ];

    const questionStems = [
      `Which option matches today's summary about ${topicName}?`,
      `According to the lesson, what is true about ${topicName}?`,
      `Pick the correct fact from this ${subjectName} session.`,
      `Which statement about ${topicName} is correct?`,
    ] as const;

    return Array.from({ length: count }, (_, idx) => {
      const correct = facts[idx % facts.length];
      const wrong = [
        `${topicName} is not part of ${subjectName}.`,
        `Students should skip ${topicName} questions in class.`,
        `${topicName} can be answered without reading options.`,
      ];
      const { options, answerIndex } = buildOptions(correct, wrong, idx);
      return {
        q: questionStems[idx % questionStems.length],
        options,
        answerIndex,
        explain: "This option matches today's summary.",
      };
    });
  }

  function buildSessionRequestBody(): Record<string, unknown> {
    return {
      topic: topic?.topic ?? "this topic",
      subject: topic?.subject ?? "Science",
      className: `class_${activeClass.id}`,
      source: topic?.source === "custom" ? "custom" : "curriculum",
      studentCount: students.length,
    };
  }

  function buildFallbackPreviewCards(): PreviewCard[] {
    if (sessionLanguage === "ta") {
      return [
        {
          title: "தலைப்பு தொடக்கம்",
          badge: topic?.source === "custom" ? "Web notes" : "Textbook cue",
          caption: `${topic?.topic ?? "இந்த தலைப்பு"} எளிய ${topic?.subject ?? "அறிவியல்"} சொற்களில் தயாராகிறது.`,
        },
        {
          title: "சிறிய உதாரணம்",
          badge: "Real-life link",
          caption: "வீடும் பள்ளியும் சேர்ந்த சிறிய உதாரணங்கள் குழந்தைகளுக்கு விரைவில் புரிய உதவும்.",
        },
        {
          title: "தொட்டு பதிலளி",
          badge: "MCQ round",
          caption: "சுருக்கத்திற்குப் பிறகு, ஒவ்வொரு மாணவரும் கேள்வியை கேட்டு ஒரு பதிலைத் தொடுவார்கள்.",
        },
      ];
    }

    return [
      {
        title: "Topic start",
        badge: topic?.source === "custom" ? "Web notes" : "Textbook cue",
        caption: `We are preparing ${topic?.topic ?? "this topic"} in simple ${topic?.subject ?? "Science"} words.`,
      },
      {
        title: "Tiny example",
        badge: "Real-life link",
        caption: "Small examples from home and school help children understand quickly.",
      },
      {
        title: "Tap and answer",
        badge: "MCQ round",
        caption: "After the summary, each student hears the question and taps one option.",
      },
    ];
  }

  function normalizePreviewCards(raw: unknown): PreviewCard[] {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((item): PreviewCard | null => {
        if (!item || typeof item !== "object") return null;

        const record = item as Partial<PreviewCard>;
        const title = typeof record.title === "string" ? record.title.trim() : "";
        const caption = typeof record.caption === "string" ? record.caption.trim() : "";
        const badge = typeof record.badge === "string" ? record.badge.trim() : "";
        const imageDataUrl =
          typeof record.imageDataUrl === "string" && record.imageDataUrl.trim().length > 0
            ? record.imageDataUrl.trim()
            : undefined;

        if (!title || !caption) return null;

        return { title, caption, badge: badge || "Lesson cue", imageDataUrl };
      })
      .filter((card): card is PreviewCard => card !== null)
      .slice(0, 3);
  }

  function getPreviewCardTone(card: PreviewCard, index: number): VisualTone {
    if (card.imageDataUrl) {
      return {
        label: "Picture cue",
        icon: ImageIcon,
        cardBackground: "#fff9ed",
        cardBorder: "#f3d49a",
        chipBackground: "#ffe6b5",
        chipColor: "#ba7300",
        trailColor: "#efc05c",
      };
    }

    const toneIndex = index % 3;
    if (toneIndex === 1) {
      return {
        label: "Example",
        icon: Shapes,
        cardBackground: "#eff7ff",
        cardBorder: "#cfe1ff",
        chipBackground: "#dce9ff",
        chipColor: "#3c67c8",
        trailColor: "#8ab2ff",
      };
    }

    if (toneIndex === 2) {
      return {
        label: "Ready",
        icon: Lightbulb,
        cardBackground: "#eefcf2",
        cardBorder: "#c9eed6",
        chipBackground: "#d7f6e0",
        chipColor: "#1a8143",
        trailColor: "#6dd28b",
      };
    }

    return {
      label: "Topic",
      icon: Sparkles,
      cardBackground: `${accent}14`,
      cardBorder: `${accent}35`,
      chipBackground: `${accent}1f`,
      chipColor: accent,
      trailColor: `${accent}66`,
    };
  }

  function getSummaryLineTone(line: string, index: number): VisualTone {
    const lower = line.toLowerCase();

    if (index === 0) {
      return {
        label: "Topic start",
        icon: Sparkles,
        cardBackground: `${accent}14`,
        cardBorder: `${accent}35`,
        chipBackground: `${accent}1f`,
        chipColor: accent,
        trailColor: `${accent}66`,
      };
    }

    if (/example|for example|like|such as|home|school|daily|உதாரண|வீடு|பள்ளி/i.test(lower)) {
      return {
        label: "Example",
        icon: Shapes,
        cardBackground: "#fff8ea",
        cardBorder: "#f2d7a5",
        chipBackground: "#ffe8ba",
        chipColor: "#b87907",
        trailColor: "#efc05c",
      };
    }

    if (/remember|key|important|rule|point|fact|முக்கிய|நினைவில்|தகவல்/i.test(lower)) {
      return {
        label: "Remember",
        icon: Lightbulb,
        cardBackground: "#eef8ff",
        cardBorder: "#cce5ff",
        chipBackground: "#dbedff",
        chipColor: "#2569c7",
        trailColor: "#8ab2ff",
      };
    }

    if (/question|mcq|option|tap|round|கேள்வி|விருப்ப|தொடு/i.test(lower)) {
      return {
        label: "Next step",
        icon: ArrowRight,
        cardBackground: "#eefcf2",
        cardBorder: "#c7ebd2",
        chipBackground: "#d7f5df",
        chipColor: "#1a8143",
        trailColor: "#6dd28b",
      };
    }

    return {
      label: "Idea",
      icon: BookOpen,
      cardBackground: "#fffdf5",
      cardBorder: "#e9dfc3",
      chipBackground: "#f4ead2",
      chipColor: "#7d6222",
      trailColor: "#d6c086",
    };
  }

  function createSessionId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildOptions(
    correct: string,
    wrong: readonly string[],
    seed: number,
  ): { options: string[]; answerIndex: number } {
    const options = wrong.slice(0, 3).map((item) => item.trim());
    while (options.length < 3) options.push("Not enough context available.");

    const answerIndex = seed % 4;
    options.splice(answerIndex, 0, correct.trim());
    return { options, answerIndex };
  }

  function normalizeQuestions(raw: unknown, expectedCount: number): SessionQuestion[] {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((item): SessionQuestion | null => {
        if (!item || typeof item !== "object") return null;

        const q = item as Partial<SessionQuestion>;
        const question = typeof q.q === "string" ? q.q.trim() : "";
        const optionValues = Array.isArray(q.options) ? q.options : [];
        const options = optionValues
          .map((opt) => (typeof opt === "string" ? opt.trim() : ""))
          .filter(Boolean)
          .filter((opt, idx, arr) => arr.findIndex((v) => v.toLowerCase() === opt.toLowerCase()) === idx)
          .slice(0, 4);

        if (!question || options.length !== 4) return null;

        let answerIndex =
          typeof q.answerIndex === "number" && Number.isInteger(q.answerIndex)
            ? q.answerIndex
            : -1;

        if (answerIndex < 0 || answerIndex > 3) {
          const alt = (item as { answer?: unknown }).answer;
          if (typeof alt === "string" && alt.trim()) {
            const answer = alt.trim();
            const byText = options.findIndex((opt) => opt.toLowerCase() === answer.toLowerCase());
            if (byText >= 0) answerIndex = byText;
            else if (answer.length === 1 && "ABCD".includes(answer.toUpperCase())) {
              answerIndex = answer.toUpperCase().charCodeAt(0) - 65;
            }
          }
        }

        if (answerIndex < 0 || answerIndex > 3) return null;

        const explain =
          typeof q.explain === "string" && q.explain.trim()
            ? q.explain.trim()
            : `Correct answer: ${options[answerIndex]}.`;

        return { q: question, options, answerIndex, explain };
      })
      .filter((question): question is SessionQuestion => question !== null)
      .slice(0, expectedCount);
  }

  function buildQuestionPlan(questionBank: SessionQuestion[]): SessionTurn[] {
    const safeStudents = Math.max(1, students.length);
    const totalTurns = safeStudents * QUESTIONS_PER_STUDENT;

    const uniqueBank = questionBank.filter(
      (question, idx, arr) =>
        arr.findIndex((value) => value.q.trim().toLowerCase() === question.q.trim().toLowerCase()) === idx,
    );

    const mergedBank = [...uniqueBank];
    for (const fallback of fallbackQuestions(totalTurns + 4)) {
      const exists = mergedBank.some(
        (question) => question.q.trim().toLowerCase() === fallback.q.trim().toLowerCase(),
      );
      if (!exists) mergedBank.push(fallback);
      if (mergedBank.length >= totalTurns) break;
    }

    if (mergedBank.length === 0) return [];

    const turns: SessionTurn[] = [];
    for (let turn = 0; turn < totalTurns; turn += 1) {
      turns.push({
        ...mergedBank[turn % mergedBank.length],
        student: turn % safeStudents,
      });
    }

    return turns;
  }

  function clearAutoAdvanceTimer(): void {
    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function clearSummaryFlowTimer(): void {
    if (summaryFlowTimer !== null) {
      clearTimeout(summaryFlowTimer);
      summaryFlowTimer = null;
    }
  }

  function getCardEmoji(badge: string, index: number): string {
    const b = badge.toLowerCase();
    if (/textbook|book|web note/i.test(b)) return "📚";
    if (/real.?life|example|link/i.test(b)) return "🌍";
    if (/mcq|question|quiz|round/i.test(b)) return "🎯";
    if (/picture|image|photo/i.test(b)) return "🖼️";
    const defaults = ["💡", "🌟", "🎨", "🔍", "✏️"];
    return defaults[index % defaults.length];
  }

  /** Detect if a line looks like dialogue/conversation (e.g., "Teacher: ...", "Student: ...") */
  function isDialogueLine(line: string): { speaker: string; text: string; side: "left" | "right" } | null {
    const match = line.match(/^([\w\u0B80-\u0BFF][\w\u0B80-\u0BFF ]{0,20})\s*[:：]\s*(.+)/);
    if (!match) return null;
    const speaker = match[1].trim();
    const text = match[2].trim();
    const leftSpeakers = /^(teacher|ஆசிரியர்|அம்மா|அப்பா|mom|dad|parent|mother|father|person\s*1|speaker\s*1)/i;
    const rightSpeakers = /^(student|மாணவ|குழந்தை|child|kid|boy|girl|ram|ravi|priya|sita|person\s*2|speaker\s*2)/i;
    if (leftSpeakers.test(speaker)) return { speaker, text, side: "left" };
    if (rightSpeakers.test(speaker)) return { speaker, text, side: "right" };
    // Any unrecognised speaker — alternate sides based on line position
    return null;
  }

  /** Strip emoji characters from text so TTS doesn't read them out */
  function stripEmojis(text: string): string {
    return text
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2702}-\u{27B0}\u{1FA00}-\u{1FA9F}\u{1FAA0}-\u{1FAFF}\u{2702}-\u{27B0}\u{FE0F}\u{200D}]/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /** Add fun emojis to content text for young learners */
  function enrichWithEmojis(text: string): string {
    return text
      .replace(/\b(apple|apples|ஆப்பிள்)\b/gi, "🍎 $1")
      .replace(/\b(mango|mangoes|மாம்பழ)\b/gi, "🥭 $1")
      .replace(/\b(sun|சூரியன்)\b/gi, "☀️ $1")
      .replace(/\b(moon|நிலா|சந்திரன்)\b/gi, "🌙 $1")
      .replace(/\b(star|stars|நட்சத்திர)\b/gi, "⭐ $1")
      .replace(/\b(water|தண்ணீர்|நீர்)\b/gi, "💧 $1")
      .replace(/\b(tree|trees|மரம்)\b/gi, "🌳 $1")
      .replace(/\b(flower|flowers|பூ|மலர்)\b/gi, "🌺 $1")
      .replace(/\b(bird|birds|பறவை)\b/gi, "🐦 $1")
      .replace(/\b(fish|மீன்)\b/gi, "🐟 $1")
      .replace(/\b(cat|பூனை)\b/gi, "🐱 $1")
      .replace(/\b(dog|நாய்)\b/gi, "🐶 $1")
      .replace(/\b(cow|பசு)\b/gi, "🐄 $1")
      .replace(/\b(elephant|யானை)\b/gi, "🐘 $1")
      .replace(/\b(lion|சிங்கம்)\b/gi, "🦁 $1")
      .replace(/\b(leaf|leaves|இலை)\b/gi, "🍃 $1")
      .replace(/\b(rain|மழை)\b/gi, "🌧️ $1")
      .replace(/\b(book|புத்தகம்)\b/gi, "📖 $1")
      .replace(/\b(school|பள்ளி)\b/gi, "🏫 $1")
      .replace(/\b(home|house|வீடு)\b/gi, "🏠 $1")
      .replace(/\b(earth|பூமி)\b/gi, "🌍 $1")
      .replace(/\b(plus|add|கூட்டு)\b/gi, "➕ $1")
      .replace(/\b(minus|subtract|கழி)\b/gi, "➖ $1")
      .replace(/\b(equal|equals|சமம்)\b/gi, "🟰 $1")
      .replace(/\b(heart|இதயம்)\b/gi, "❤️ $1")
      .replace(/\b(hand|hands|கை)\b/gi, "✋ $1")
      .replace(/\b(eye|eyes|கண்)\b/gi, "👁️ $1")
      .replace(/\b(family|குடும்பம்)\b/gi, "👨‍👩‍👧 $1");
  }

  function stopSummaryPlayback(): void {
    summaryRunId += 1;
    clearSummaryFlowTimer();
    stopSpeech();
  }

  async function scrollSummaryToLine(idx: number): Promise<void> {
    await tick();

    for (const host of [desktopSummaryStageEl, desktopSummarySidebarEl, mobileSummaryStageEl]) {
      const line = host?.querySelector<HTMLElement>(`[data-summary-line="${idx}"]`);
      line?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function publishSessionAlerts(): void {
    if (!sessionId) return;

    const classId = activeClass.id;
    const className = cls?.name ?? `Class ${classId}`;
    const topicName = topic?.topic ?? "This topic";
    const subjectName = topic?.subject ?? "Science";
    const createdAt = new Date().toISOString();

    const records: SessionAlertRecord[] = students
      .map((student, idx) => {
        const attempts = sessionAttempts.filter((attempt) => attempt.studentIdx === idx);
        const missedQuestions = attempts
          .filter((attempt) => !attempt.correct)
          .map((attempt, missIdx) => ({
            id: `${student.id}-miss-${missIdx + 1}`,
            question: attempt.question,
            selectedOption: attempt.selectedOption || "(no answer)",
            correctOption: attempt.correctOption,
            explain: attempt.explain,
          }));

        const correctTurns = attempts.filter((attempt) => attempt.correct).length;

        return {
          id: `${sessionId}:${student.id}`,
          sessionId,
          classId,
          className,
          studentId: student.id,
          studentName: student.name,
          studentEmoji: student.emoji,
          topic: topicName,
          subject: subjectName,
          totalQuestions: QUESTIONS_PER_STUDENT,
          correctCount: correctTurns,
          incorrectCount: missedQuestions.length,
          score: Math.round((correctTurns / Math.max(1, QUESTIONS_PER_STUDENT)) * 100),
          missedQuestions,
          createdAt,
        };
      })
      .filter((record) => record.incorrectCount > 0);

    sessionAlerts.replaceSession(sessionId, records);
  }

  function finishSession(): void {
    clearAutoAdvanceTimer();
    publishSessionAlerts();
    phase = "complete";
  }

  function resetTurnState(): void {
    submittedOption = null;
    feedbackTitle = "";
    feedbackDetail = "";
    answerPhase = "ask";
  }

  function revealSummaryLine(idx: number, runId = summaryRunId): void {
    if (runId !== summaryRunId) return;

    if (summaryLines.length === 0) {
      phase = "session";
      return;
    }

    const nextIdx = Math.min(idx, summaryLines.length - 1);
    summaryIdx = nextIdx;
    void scrollSummaryToLine(nextIdx);

    const isLastLine = nextIdx >= summaryLines.length - 1;
    const line = summaryLines[nextIdx] ?? "";

    // Wait for TTS to finish speaking the line before advancing
    void speakAsync(line, sessionLanguage).then(() => {
      if (runId !== summaryRunId || phase !== "summarizing") return;

      // Small pause between lines for natural flow
      summaryFlowTimer = setTimeout(() => {
        if (runId !== summaryRunId || phase !== "summarizing") return;
        if (isLastLine) {
          phase = "session";
          return;
        }
        revealSummaryLine(nextIdx + 1, runId);
      }, 600);
    });
  }

  function skipSummary(): void {
    stopSummaryPlayback();
    if (summaryLines.length > 0) summaryIdx = summaryLines.length - 1;
    phase = "session";
  }

  async function fetchSummary(): Promise<void> {
    summaryLoading = true;
    summaryError = "";

    const expectedTurns = Math.max(1, students.length) * QUESTIONS_PER_STUDENT;
    const requestBody = buildSessionRequestBody();

    try {
      const response = await fetch("/api/socratic/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = (await response.json()) as SummarizeResponse;
        sessionLanguage = normalizeLanguage(data.language);
        const lines = Array.isArray(data.lines)
          ? data.lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0)
          : [];

        summaryLines = lines.length > 0 ? lines : fallbackLines();
        // Capture images from the response
        summaryImages = Array.isArray(data.images_base64)
          ? data.images_base64.filter((img): img is string => typeof img === "string" && img.length > 0)
          : [];
        questionPlan = buildQuestionPlan(normalizeQuestions(data.questions, expectedTurns));
        if (questionPlan.length === 0) {
          questionPlan = buildQuestionPlan(fallbackQuestions(expectedTurns));
        }
      } else {
        const data = (await response.json().catch(() => ({}))) as SummarizeResponse;
        sessionLanguage = normalizeLanguage(data.language ?? sessionLanguage);
        const apiError = typeof data.error === "string" ? data.error : "Could not load textbook summary.";
        summaryError = apiError;

        if (topic?.source === "custom") {
          summaryLines = fallbackLines();
          questionPlan = buildQuestionPlan(fallbackQuestions(expectedTurns));
        } else {
          summaryLines = [
            apiError,
            "Choose an exact textbook topic from the class section and try again.",
          ];
          questionPlan = [];
        }
      }
    } catch {
      summaryError = sessionLanguage === "ta"
        ? "சுருக்கத்தை ஏற்றும்போது வலைப்பின்னல் சிக்கல் ஏற்பட்டது."
        : "Network issue while loading summary.";
      if (topic?.source === "custom") {
        summaryLines = fallbackLines();
        questionPlan = buildQuestionPlan(fallbackQuestions(expectedTurns));
      } else {
        summaryLines = [
          "Could not load textbook chunks for this class topic.",
          "Select the exact chapter topic name and retry.",
        ];
        questionPlan = [];
      }
    }

    summaryLoading = false;
  }

  async function fetchSummaryPreview(): Promise<void> {
    summaryPreviewCards = buildFallbackPreviewCards();
    summaryPreviewLoading = false;
  }

  async function startSession(): Promise<void> {
    clearAutoAdvanceTimer();
    clearMcqTimer();
    stopSummaryPlayback();
    _initTTS();

    phase = "preloading";
    qIdx = 0;
    answered = [];
    summaryIdx = 0;
    summaryLines = [];
    summaryError = "";
    sessionLanguage = detectLanguage(topic?.topic ?? "");
    summaryPreviewCards = buildFallbackPreviewCards();
    sessionId = createSessionId();
    sessionAttempts = [];
    summaryImages = [];
    questionPlan = [];
    resetTurnState();

    await fetchSummaryPreview();
    await fetchSummary();

    // Content is preloaded — show "Start Beginning" button
    phase = "ready";
  }

  /** Begin playback of pre-loaded content (called when student clicks "Start Beginning") */
  function startBeginning(): void {
    if (phase !== "ready") return;
    _initTTS();
    phase = "summarizing";
    summaryIdx = 0;
    const runId = summaryRunId + 1;
    summaryRunId = runId;
    revealSummaryLine(0, runId);
  }

  function startOver(): void {
    clearAutoAdvanceTimer();
    clearMcqTimer();
    stopSummaryPlayback();

    phase = "start";
    qIdx = 0;
    answered = [];
    summaryIdx = 0;
    summaryLines = [];
    summaryError = "";
    sessionLanguage = "en";
    summaryPreviewCards = [];
    sessionId = "";
    sessionAttempts = [];
    questionPlan = [];
    resetTurnState();
  }

  function selectOption(optionIndex: number): void {
    if (!currentQ || phase !== "session" || answerPhase !== "ask") return;

    clearMcqTimer();
    submit(optionIndex === currentQ.answerIndex, optionIndex);
  }

  function submit(correct: boolean, optionIndex: number): void {
    if (!currentQ) return;

    clearAutoAdvanceTimer();

    submittedOption = optionIndex;
    lastCorrect = correct;
    answered = [...answered, { studentIdx: currentQ.student, correct }];
    sessionAttempts = [
      ...sessionAttempts,
      {
        studentIdx: currentQ.student,
        question: currentQ.q,
        selectedOption: currentQ.options[optionIndex] ?? "",
        correctOption: currentQ.options[currentQ.answerIndex] ?? "",
        correct,
        explain: currentQ.explain,
      },
    ];
    answerPhase = "feedback";

    feedbackTitle = correct ? "Right" : "Wrong";
    feedbackDetail = correct
      ? currentQ.explain
      : `Correct option: ${currentQ.options[currentQ.answerIndex]}. ${currentQ.explain}`;
    // Auto-advance is now handled by the feedback TTS $effect after speech finishes
  }

  function next(): void {
    clearAutoAdvanceTimer();
    if (questionPlan.length === 0) return;

    if (qIdx >= questionPlan.length - 1) {
      finishSession();
      return;
    }

    const previousQuestion = currentQ?.q ?? "";
    qIdx += 1;

    let guard = 0;
    while (
      qIdx < questionPlan.length - 1 &&
      guard < questionPlan.length - 1 &&
      questionPlan[qIdx]?.q === previousQuestion
    ) {
      qIdx += 1;
      guard += 1;
    }

    resetTurnState();
  }

  // ── TTS ────────────────────────────────────────────────────────────────────
  function _initTTS(): void {
    if (typeof speechSynthesis === "undefined") return;
    // Chrome loads voices async — trigger the list so _pickVoice works later
    speechSynthesis.getVoices();
    if ("onvoiceschanged" in speechSynthesis) {
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
    }
  }

  function _pickVoice(lang: "en" | "ta"): SpeechSynthesisVoice | undefined {
    const voices = speechSynthesis.getVoices();
    const prefix = lang === "ta" ? "ta" : "en";
    // prefer exact locale match (ta-IN, en-IN, en-GB…) then any matching lang
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix + "-in")) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
    );
  }

  /** Speak text and return a promise that resolves when utterance finishes. */
  function speakAsync(text: string, lang: "en" | "ta" = "en"): Promise<void> {
    return new Promise((resolve) => {
      const clean = stripEmojis(text);
      if (typeof speechSynthesis === "undefined" || !clean) {
        resolve();
        return;
      }
      speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(clean);
      utt.lang = lang === "ta" ? "ta-IN" : "en-IN";
      const voice = _pickVoice(lang);
      if (voice) utt.voice = voice;
      utt.rate = lang === "ta" ? 0.82 : 0.88;
      utt.pitch = 1.05;
      utt.onend = () => resolve();
      utt.onerror = () => resolve();
      speechSynthesis.speak(utt);
      // Safety net: if onend never fires (some browsers), resolve after max duration
      const maxMs = Math.max(3000, clean.split(/\s+/).length * 600);
      setTimeout(() => resolve(), maxMs);
    });
  }

  function speak(text: string, lang: "en" | "ta" = "en"): void {
    void speakAsync(text, lang);
  }

  function stopSpeech(): void {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  // ── MCQ Timer ──────────────────────────────────────────────────────────────
  const MCQ_TIMER_SECONDS = 12;
  let mcqTimerValue = $state(0);
  let mcqTimerInterval: ReturnType<typeof setInterval> | null = null;

  function startMcqTimer(): void {
    clearMcqTimer();
    mcqTimerValue = MCQ_TIMER_SECONDS;
    mcqTimerInterval = setInterval(() => {
      mcqTimerValue -= 1;
      if (mcqTimerValue <= 0) {
        clearMcqTimer();
      }
    }, 1000);
  }

  function clearMcqTimer(): void {
    if (mcqTimerInterval !== null) {
      clearInterval(mcqTimerInterval);
      mcqTimerInterval = null;
    }
  }

  // Speak question + options, then start timer when MCQ begins
  $effect(() => {
    if (phase === "session" && currentQ && answerPhase === "ask") {
      clearMcqTimer();
      mcqTimerValue = 0;
      const gen = ++mcqTtsGeneration;
      const student = students[currentQ.student];
      const prefix = student ? `${student.name}. ` : "";
      const optionsText = currentQ.options
        .map((opt, i) => `${OPTION_LABELS[i]}. ${opt}`)
        .join(". ");
      const fullText = `${prefix}${currentQ.q}. ${optionsText}`;
      void speakAsync(fullText, sessionLanguage).then(() => {
        if (gen !== mcqTtsGeneration) return;
        if (phase === "session" && answerPhase === "ask") {
          startMcqTimer();
        }
      });
    }
  });

  // Speak feedback after answer is submitted, then auto-advance
  $effect(() => {
    if (phase === "session" && answerPhase === "feedback" && currentQ) {
      clearAutoAdvanceTimer();
      let msg: string;
      if (lastCorrect) {
        msg = sessionLanguage === "ta"
          ? `சரியான பதில்! ${currentQ.explain}`
          : `That's right! ${currentQ.explain}`;
      } else {
        const correctOpt = currentQ.options[currentQ.answerIndex] ?? "";
        msg = sessionLanguage === "ta"
          ? `தவறான பதில். சரியான விடை: ${correctOpt}. ${currentQ.explain}`
          : `Not quite. The correct answer is: ${correctOpt}. ${currentQ.explain}`;
      }
      void speakAsync(msg, sessionLanguage).then(() => {
        if (phase === "session" && answerPhase === "feedback") {
          autoAdvanceTimer = setTimeout(() => {
            if (phase === "session" && answerPhase === "feedback") next();
          }, 1500);
        }
      });
    }
  });

  onDestroy(() => {
    clearAutoAdvanceTimer();
    clearMcqTimer();
    stopSummaryPlayback();
    stopSpeech();
  });
</script>

<!-- ═══════════════════════════════════════════════════
     DESKTOP (md+): full viewport layout
     ═══════════════════════════════════════════════════ -->
<div class="hidden md:flex h-full flex-col overflow-hidden px-8 py-5 gap-4">

  <div class="mb-2 flex shrink-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      <div class="label-eyebrow text-saffron-600">
        Student view · MCQ reteach · {cls?.name ?? "Class"}
      </div>
      <div class="page-title mt-1">Choose one option for every question</div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Pill tone="cobalt">Question {progressStep} of {totalQuestionCount}</Pill>
      <Pill tone="success">Language · {headerLanguageLabel}</Pill>
      <Button variant="secondary" onclick={() => goto(resolve("/alert"))}>
        See teacher alert <ArrowRight class="size-3.5" />
      </Button>
    </div>
  </div>

  <div
    class="min-h-0 flex-1 rounded-[28px] p-3.5"
    style="background:#0b0d14; box-shadow:0 40px 80px -30px rgba(13,17,29,0.45),0 0 0 1px #1b1d28 inset;"
  >
    <div class="flex h-full w-full flex-col overflow-hidden rounded-2xl" style="background:var(--ivory);">

      <div
        class="flex shrink-0 items-center gap-3 border-b px-5 py-3"
        style="border-color:var(--border-default);"
      >
        <div
          class="grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-white"
          style="background:{accent};"
        >
          {activeClass.id}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-[14px] font-semibold" style="color:var(--ink);">
            {topic?.topic ?? "Today's session"}
          </div>
          <div class="text-[11px]" style="color:var(--text-tertiary);">
            Lesson {roundNum} · {topic?.subject ?? "Science"} · {cls?.name ?? "Class"}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <div class="flex items-center gap-1">
            {#each [0, 1, 2, 3, 4, 5] as i (i)}
              <div
                class="rounded-full transition-all duration-300"
                style="height:8px; width:{i < progressFilled ? '20px' : '8px'}; background:{i < progressFilled ? accent : '#e5e1d8'};"
              ></div>
            {/each}
          </div>
          <span class="text-[12px] font-medium tabular-nums" style="color:var(--text-secondary);">
            {progressStep} / {totalQuestionCount}
          </span>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[1fr_292px_188px]">

        <div class="flex flex-col overflow-hidden">
          {#if phase === "start"}
            <div class="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-10 text-center">
              <div
                class="flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-medium"
                style="background:{accent}18; color:{accent};"
              >
                {#if topic?.source === "custom"}
                  <Pencil class="size-3" />
                {:else}
                  <BookOpen class="size-3" />
                {/if}
                {topic?.subject ?? "Science"}
              </div>
              <div
                class="max-w-120 text-[28px] font-semibold leading-tight tracking-tight"
                style="color:var(--ink); text-wrap:balance;"
              >
                {topic?.topic ?? "Today's reteach"}
              </div>
              <div class="text-[14px]" style="color:var(--text-secondary);">
                Short summary first (about 2-3 mins), then four-option MCQ questions.
              </div>
              <div class="max-w-110 text-[12px] leading-[1.6]" style="color:var(--text-tertiary);">
                {summaryLanguageNote}
              </div>
              <button
                type="button"
                onclick={startSession}
                class="mt-1 flex cursor-pointer items-center gap-3 rounded-2xl px-10 py-4 text-[17px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style="background:{accent}; box-shadow:0 14px 36px -10px {accent}66;"
              >
                🧠 Start Thinking <Sparkles class="size-5" />
              </button>
              <div class="text-[11px]" style="color:var(--text-tertiary);">
                Teacher: tap "Start Thinking" to pre-load. Students will see "Start Beginning" when ready.
              </div>
              <button
                type="button"
                onclick={() => goto(resolve("/student/topic"))}
                class="cursor-pointer text-[11px] underline underline-offset-2"
                style="color:var(--text-tertiary);"
              >
                ← Choose a different topic
              </button>
            </div>

          {:else if phase === "preloading"}
            <div class="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-10 text-center">
              <div class="animate-pulse text-[48px]">🧠</div>
              <div
                class="text-[24px] font-semibold"
                style="color:var(--ink);"
              >
                AI is thinking...
              </div>
              <div class="text-[14px] max-w-100" style="color:var(--text-secondary);">
                Generating summary, images, and MCQ questions. This may take a moment.
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 animate-bounce rounded-full" style="background:{accent};"></div>
                <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.1s;"></div>
                <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.2s;"></div>
              </div>
            </div>

          {:else if phase === "ready"}
            <div class="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-10 text-center">
              <div class="text-[48px]">✅</div>
              <div
                class="text-[24px] font-semibold"
                style="color:var(--ink);"
              >
                Everything is ready!
              </div>
              <div class="text-[14px] max-w-110" style="color:var(--text-secondary);">
                Summary ({summaryLines.length} sections), {questionPlan.length} MCQ questions{summaryImages.length > 0 ? `, and ${summaryImages.length} textbook images` : ""} are preloaded.
              </div>
              <button
                type="button"
                onclick={startBeginning}
                class="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl px-12 py-5 text-[20px] font-bold text-white transition-all hover:scale-[1.03] active:scale-[0.97]"
                style="background:#22c55e; box-shadow:0 16px 40px -12px #22c55e88;"
              >
                ▶ Start Beginning <ArrowRight class="size-6" />
              </button>
              <div class="text-[11px]" style="color:var(--text-tertiary);">
                Hand the tablet to the student and tap "Start Beginning" to begin.
              </div>
            </div>

          {:else if phase === "summarizing"}
            <div class="flex min-h-0 flex-1 flex-col gap-5 px-10 py-8">
              <div
                class="inline-flex w-fit items-center gap-2.5 rounded-full px-4 py-2 text-[12px] font-medium"
                style="background:{accent}18; color:{accent};"
              >
                <span class="relative flex size-2">
                  <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style="background:{accent};"
                  ></span>
                  <span class="relative inline-flex size-2 rounded-full" style="background:{accent};"></span>
                </span>
                {summaryLoading ? "AI is preparing a short summary..." : "Speaking short summary..."}
              </div>
              <div bind:this={desktopSummaryStageEl} class="max-w-145 flex-1 overflow-y-auto pr-2">
                {#if summaryLoading}
                  <div class="space-y-4 pb-3">
                    <div class="flex flex-wrap items-center gap-2 text-[12px]" style="color:var(--text-secondary);">
                      <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style="background:#fff7e8; color:#b87907;">
                        <ImageIcon class="size-3.5" /> picture clues
                      </span>
                      <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style="background:#eef8ff; color:#2569c7;">
                        <Sparkles class="size-3.5" /> child-friendly summary
                      </span>
                    </div>
                    <div class="flex items-center gap-2 overflow-x-auto pb-1">
                      {#each summaryPreviewCards as card, i (`flow-${card.title}-${i}`)}
                        {@const tone = getPreviewCardTone(card, i)}
                        <div
                          class="shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                          style="background:{tone.chipBackground}; color:{tone.chipColor}; border-color:{tone.cardBorder};"
                        >
                          {card.title}
                        </div>
                        {#if i < summaryPreviewCards.length - 1}
                          <ArrowRight class="size-4 shrink-0" style="color:{tone.trailColor};" />
                        {/if}
                      {/each}
                    </div>
                    <div class="grid gap-3 md:grid-cols-3">
                      {#each summaryPreviewCards as card, i (`preview-${card.title}-${i}`)}
                        {@const tone = getPreviewCardTone(card, i)}
                        <div
                          class="rounded-3xl border p-3.5"
                          style="background:{tone.cardBackground}; border-color:{tone.cardBorder};"
                        >
                          <div class="mb-3 flex items-start gap-2.5">
                            <div
                              class="grid size-10 shrink-0 place-items-center rounded-2xl"
                              style="background:{tone.chipBackground}; color:{tone.chipColor};"
                            >
                              <tone.icon class="size-4.5" />
                            </div>
                            <div class="min-w-0">
                              <div class="text-[11px] font-semibold uppercase tracking-[0.18em]" style="color:{tone.chipColor};">
                                {card.badge}
                              </div>
                              <div class="mt-1 text-[15px] font-semibold" style="color:var(--ink);">
                                {card.title}
                              </div>
                            </div>
                          </div>

                          {#if card.imageDataUrl}
                            <img
                              src={card.imageDataUrl}
                              alt={card.title}
                              class="h-28 w-full rounded-2xl object-cover"
                            />
                          {:else}
                            <div
                              class="flex items-center justify-between rounded-2xl border border-dashed px-3 py-3 text-[11px]"
                              style="border-color:{tone.cardBorder}; color:{tone.chipColor}; background:white;"
                            >
                              <span>idea</span>
                              <ArrowRight class="size-3.5" />
                              <span>example</span>
                              <ArrowRight class="size-3.5" />
                              <span>answer</span>
                            </div>
                          {/if}

                          <div class="mt-3 text-[13px] leading-[1.55]" style="color:var(--text-body);">
                            {card.caption}
                          </div>
                        </div>
                      {/each}
                    </div>
                    <div class="text-[12px]" style="color:var(--text-tertiary);">
                      {summaryPreviewLoading ? "Refreshing textbook cues..." : "Textbook cues are ready while the summary is being prepared."}
                    </div>
                  </div>
                {:else}
                  {#each visibleSummaryLines as line, i (i)}
                    {@const tone = getSummaryLineTone(line, i)}
                    {@const dialogue = isDialogueLine(line)}
                    <div
                      class="relative mb-4 pl-1"
                    >
                      {#if i < visibleSummaryLines.length - 1}
                        <div
                          class="absolute -bottom-4.5 left-5 top-[calc(100%-6px)] w-px"
                          style="background:{tone.trailColor}; opacity:0.45;"
                        ></div>
                      {/if}
                      {#if dialogue}
                        <div
                          data-summary-line={i}
                          class="flex transition-opacity duration-500"
                          style="justify-content:{dialogue.side === 'right' ? 'flex-end' : 'flex-start'}; opacity:{summaryIdx - i > 0 ? 0.58 : 1};"
                        >
                          <div
                            class="max-w-[80%] rounded-3xl p-4 text-[18px] font-medium leading-relaxed"
                            style="background:{dialogue.side === 'left' ? '#eef8ff' : '#f0fdf4'}; border:1px solid {dialogue.side === 'left' ? '#cfe1ff' : '#bbf7d0'};"
                          >
                            <div class="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style="color:{dialogue.side === 'left' ? '#2569c7' : '#15803d'};">
                              {dialogue.side === 'left' ? '👩‍🏫' : '🧒'} {dialogue.speaker}
                            </div>
                            {enrichWithEmojis(dialogue.text)}
                          </div>
                        </div>
                      {:else}
                        <div
                          data-summary-line={i}
                          class="rounded-3xl border p-4 text-[20px] font-medium leading-relaxed transition-opacity duration-500"
                          style="background:{tone.cardBackground}; border-color:{tone.cardBorder}; color:var(--ink); opacity:{summaryIdx - i > 0 ? 0.58 : 1};"
                        >
                          <div class="mb-2 flex items-center gap-2">
                            <div
                              class="grid size-8 shrink-0 place-items-center rounded-2xl"
                              style="background:{tone.chipBackground}; color:{tone.chipColor};"
                            >
                              <tone.icon class="size-4" />
                            </div>
                            <div class="text-[11px] font-semibold uppercase tracking-[0.18em]" style="color:{tone.chipColor};">
                              {tone.label}
                            </div>
                          </div>
                          {enrichWithEmojis(line)}
                        </div>
                      {/if}
                    </div>
                    {#if summaryImages.length > 0 && (i + 1) % 2 === 0}
                      {@const imgIdx = Math.floor((i + 1) / 2) - 1}
                      {#if imgIdx < summaryImages.length}
                        {@const img = summaryImages[imgIdx]}
                        <div class="my-3 overflow-hidden rounded-2xl border" style="border-color:#f3d49a; background:#fff9ed;">
                          <img
                            src={img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`}
                            alt="Textbook illustration {imgIdx + 1}"
                            class="w-full object-contain max-h-48"
                          />
                          <div class="px-3 py-2 text-[11px] font-medium" style="color:#ba7300;">
                            📖 Textbook image {imgIdx + 1}
                          </div>
                        </div>
                      {/if}
                    {/if}
                  {/each}
                  <button
                    type="button"
                    onclick={skipSummary}
                    class="mt-2 cursor-pointer rounded-xl px-4 py-2 text-[12px] font-semibold"
                    style="color:{accent}; background:{accent}12;"
                  >
                    Skip to MCQ
                  </button>
                {/if}
              </div>
            </div>

          {:else if blockedBySource}
            <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div class="text-[24px]">📚</div>
              <div class="text-[20px] font-semibold" style="color:var(--ink);">
                Textbook content required
              </div>
              <div class="max-w-120 text-[13px] leading-relaxed" style="color:var(--text-secondary);">
                {summaryError || "No vectorized textbook chunks were found for this class topic."}
              </div>
              <button
                type="button"
                onclick={() => goto(resolve("/student/topic"))}
                class="cursor-pointer rounded-xl px-5 py-2 text-[13px] font-semibold text-white"
                style="background:{accent};"
              >
                Pick textbook topic
              </button>
            </div>

          {:else if phase === "complete"}
            <div class="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-10 text-center">
              <div
                class="grid size-18 place-items-center rounded-full text-[30px] font-semibold text-white"
                style="background:{accent};"
              >
                ✓
              </div>
              <div class="text-[28px] font-semibold" style="color:var(--ink);">
                Session complete
              </div>
              <div class="max-w-110 text-[14px] leading-[1.7]" style="color:var(--text-secondary);">
                {totalQuestionCount} questions are finished. {correctCount} answers were correct, and {struggleCount} student{struggleCount === 1 ? "" : "s"} need a closer look.
              </div>
              <div class="flex flex-wrap items-center justify-center gap-2.5">
                <Pill tone="cobalt">{totalQuestionCount} of {totalQuestionCount} questions done</Pill>
                <Pill tone="success">Round {QUESTIONS_PER_STUDENT} of {QUESTIONS_PER_STUDENT}</Pill>
              </div>
              <div class="mt-2 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onclick={() => goto(resolve("/alert"))}
                  class="flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold text-white"
                  style="background:{accent};"
                >
                  Open alerts <ArrowRight class="size-4" />
                </button>
                <button
                  type="button"
                  onclick={() => goto(resolve("/student/topic"))}
                  class="flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold"
                  style="background:{accent}12; color:{accent};"
                >
                  Pick another topic
                </button>
              </div>
            </div>

          {:else}
            <div class="flex flex-1 flex-col overflow-y-auto p-7 pb-5">
              <div
                class="bg-saffron-50 border-saffron-100 mb-6 inline-flex shrink-0 items-center gap-2.5 self-start rounded-full border px-3.5 py-2"
              >
                <span class="text-[18px]">{activeStudent?.emoji ?? "👤"}</span>
                <span class="text-saffron-700 text-[13.5px] font-semibold">
                  {activeStudent?.name ?? "Student"}, it's your turn.
                </span>
                <span class="text-saffron-600 text-[11px]">· Tap one option</span>
              </div>

              <div
                class="text-ink max-w-155 text-[22px] font-medium leading-[1.42] tracking-[-0.01em] md:text-[25px]"
                style="text-wrap:pretty;"
              >
                {currentQ?.q}
              </div>

              <div class="mt-2 text-[13px]" style="color:var(--text-secondary);">
                Tap one option below when ready.
              </div>

              {#if answerPhase === "ask"}
                {#if mcqTimerValue > 0}
                  <div class="mt-3 flex items-center gap-3">
                    <div class="h-2 flex-1 overflow-hidden rounded-full" style="background:#e5e1d8;">
                      <div
                        class="h-full rounded-full transition-all duration-1000 ease-linear"
                        style="width:{Math.round((mcqTimerValue / MCQ_TIMER_SECONDS) * 100)}%; background:{mcqTimerValue <= 3 ? '#ef4444' : accent};"
                      ></div>
                    </div>
                    <span
                      class="text-[14px] font-bold tabular-nums"
                      style="color:{mcqTimerValue <= 3 ? '#ef4444' : accent};"
                    >
                      {mcqTimerValue}s
                    </span>
                  </div>
                {/if}
                <div class="mt-6 grid shrink-0 grid-cols-2 gap-3">
                  {#each currentQ?.options ?? [] as option, i (`${option}-${i}`)}
                    <button
                      type="button"
                      onclick={() => selectOption(i)}
                      class="cursor-pointer rounded-2xl border px-4 py-4 text-left transition-all hover:-translate-y-0.5"
                      style="background:white; border-color:var(--border-default); box-shadow:0 4px 14px -8px rgba(0,0,0,0.18);"
                    >
                      <div class="flex items-start gap-3">
                        <div
                          class="grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold"
                          style="background:{accent}12; color:{accent};"
                        >
                          {OPTION_LABELS[i]}
                        </div>
                        <div class="pt-1 text-[15px] font-semibold leading-snug" style="color:var(--ink);">
                          {option}
                        </div>
                      </div>
                    </button>
                  {/each}
                </div>
                <div class="mt-3 text-[12px]" style="color:var(--text-tertiary);">
                  No typing needed. Just tap one option.
                </div>
              {:else}
                <div class="mt-6 grid shrink-0 grid-cols-2 gap-3">
                  {#each currentQ?.options ?? [] as option, i (`review-${option}-${i}`)}
                    {@const isCorrectOption = i === currentQ?.answerIndex}
                    {@const isPicked = i === submittedOption}
                    <div
                      class="rounded-2xl border px-4 py-4"
                      style="{isCorrectOption
                        ? 'background:#ecfdf3;border-color:#86efac;'
                        : isPicked
                          ? 'background:#fff1f2;border-color:#fda4af;'
                          : 'background:white;border-color:var(--border-default);'}"
                    >
                      <div class="text-[14px] font-semibold" style="color:var(--ink);">
                        {option}
                      </div>
                    </div>
                  {/each}
                </div>

                <div
                  class="mt-5 shrink-0 rounded-2xl border p-5"
                  style="{lastCorrect
                    ? 'background:#f0fdf4;border-color:#bbf7d0;'
                    : 'background:#fff1f0;border-color:#fca5a5;'}"
                >
                  <div class="mb-2 flex items-center gap-2.5">
                    {#if lastCorrect}
                      <CheckCircle2 class="size-5" style="color:#15803d;" />
                      <div class="text-[15px] font-bold" style="color:#166534;">
                        {sessionLanguage === "ta" ? "சரியான பதில்! " : "That's right! "}
                      </div>
                    {:else}
                      <XCircle class="size-5" style="color:#dc2626;" />
                      <div class="text-[15px] font-bold" style="color:#dc2626;">
                        {sessionLanguage === "ta" ? "தவறான பதில்." : "Not quite."}
                      </div>
                    {/if}
                  </div>
                  {#if !lastCorrect}
                    <div class="mb-2.5 ml-7 rounded-xl border-l-4 bg-white px-3 py-2.5" style="border-color:#22c55e;">
                      <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style="color:#15803d;">
                        {sessionLanguage === "ta" ? "சரியான விடை" : "Correct answer"}
                      </div>
                      <div class="text-[14px] font-semibold" style="color:#166534;">
                        {currentQ?.options[currentQ.answerIndex] ?? ""}
                      </div>
                    </div>
                  {/if}
                  <div class="pl-7 text-[13px] leading-[1.6]" style="color:var(--text-body);">
                    {#if lastCorrect}
                      {currentQ?.explain ?? ""}
                    {:else}
                      {sessionLanguage === "ta" ? "ஏன்? " : "Why? "}{currentQ?.explain ?? ""}
                    {/if}
                  </div>
                  <div class="mt-1 pl-7 text-[11px]" style="color:var(--text-tertiary);">
                    {#if isFinalTurn}
                      Session will end after this review.
                    {:else}
                      Moving to {nextStudent?.name ?? "next student"}...
                    {/if}
                  </div>
                  <div class="mt-3.5 pl-7">
                    <button
                      type="button"
                      onclick={next}
                      class="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                      style="background:{accent};"
                    >
                      {isFinalTurn ? "Finish session" : `Next · ${nextStudent?.name ?? "next"}`}
                      <ArrowRight class="size-3.5" />
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div
          class="flex flex-col overflow-hidden border-l"
          style="border-color:var(--border-default); background:#fdfcf8;"
        >
          <div class="flex h-full flex-col overflow-hidden p-4">
            <div
              class="mb-1 shrink-0 text-[9.5px] font-semibold uppercase tracking-widest"
              style="color:#6B94E7;"
            >
              Summary
            </div>
            <div class="shrink-0 text-[13px] font-semibold" style="color:var(--ink);">
              {topic?.source === "custom" ? "Custom topic (web + class-level)" : "Class topic (textbook)"}
            </div>
            <div class="mt-1 shrink-0 text-[11px]" style="color:var(--text-secondary);">
              This summary stays visible while answering MCQs.
            </div>

            {#if summaryLoading && summaryLines.length === 0}
              <div class="mt-3 text-[12px]" style="color:var(--text-secondary);">
                <span class="animate-pulse">Loading summary...</span>
              </div>
            {:else if summaryLines.length === 0}
              <div class="flex flex-1 items-center justify-center text-center text-[12px]" style="color:var(--text-tertiary);">
                Summary appears here when session starts
              </div>
            {:else}
              {#if summaryPreviewCards.length > 0}
                <div class="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {#each summaryPreviewCards as card, i (`side-preview-${card.title}-${i}`)}
                    {@const tone = getPreviewCardTone(card, i)}
                    <div
                      class="min-w-32 shrink-0 rounded-2xl border p-2.5"
                      style="background:{tone.cardBackground}; border-color:{tone.cardBorder};"
                    >
                      <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em]" style="color:{tone.chipColor};">
                        {card.badge}
                      </div>
                      {#if card.imageDataUrl}
                        <img src={card.imageDataUrl} alt={card.title} class="mb-2 h-14 w-full rounded-xl object-cover" />
                      {/if}
                      <div class="text-[11px] font-semibold" style="color:var(--ink);">{card.title}</div>
                    </div>
                  {/each}
                </div>
              {/if}
              <div bind:this={desktopSummarySidebarEl} class="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
                {#if summaryImages.length > 0}
                  <div class="flex gap-2 overflow-x-auto pb-1">
                    {#each summaryImages.slice(0, 3) as img, i (`sidebar-img-${i}`)}
                      <img
                        src={img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`}
                        alt="Textbook image {i + 1}"
                        class="h-16 w-20 shrink-0 rounded-xl object-cover border"
                        style="border-color:#f3d49a;"
                      />
                    {/each}
                  </div>
                {/if}
                {#each visibleSummaryLines as line, i (i)}
                  {@const tone = getSummaryLineTone(line, i)}
                  <div
                    data-summary-line={i}
                    class="rounded-2xl border px-3 py-2.5 text-[12px] leading-relaxed"
                    style="border-color:{tone.cardBorder}; background:{tone.cardBackground}; color:var(--ink); opacity:{phase === 'summarizing' && summaryIdx - i > 0 ? 0.6 : 1};"
                  >
                    <div class="mb-1.5 flex items-center gap-2">
                      <div
                        class="grid size-6 shrink-0 place-items-center rounded-xl"
                        style="background:{tone.chipBackground}; color:{tone.chipColor};"
                      >
                        <tone.icon class="size-3.5" />
                      </div>
                      <div class="text-[9.5px] font-semibold uppercase tracking-[0.16em]" style="color:{tone.chipColor};">
                        {tone.label}
                      </div>
                    </div>
                    {enrichWithEmojis(line)}
                  </div>
                {/each}
              </div>
            {/if}

            {#if phase === "summarizing" && !summaryLoading}
              <button
                type="button"
                onclick={skipSummary}
                class="mt-3 shrink-0 cursor-pointer rounded-xl px-3 py-2 text-[11px] font-semibold"
                style="background:{accent}12; color:{accent};"
              >
                Skip summary
              </button>
            {/if}
          </div>
        </div>

        <div
          class="flex flex-col overflow-hidden border-l"
          style="background:#f5f3ee; border-color:var(--border-default);"
        >
          <div
            class="shrink-0 p-4 pb-2 text-center text-[10px] font-semibold uppercase tracking-widest"
            style="color:var(--text-tertiary);"
          >
            The Circle
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
            {#each students as s, i (s.id)}
              {@const isActive = i === currentQ?.student && answerPhase === "ask" && phase === "session"}
              {@const fails = failCounts[i]}
              {@const answeredCount = answered.filter((a) => a.studentIdx === i).length}
              <div
                class="relative shrink-0 rounded-2xl p-3 transition-all duration-200"
                style="{isActive
                  ? `background:white; border:2px solid ${accent}; box-shadow:0 6px 18px -8px ${accent}66;`
                  : 'background:rgba(255,255,255,0.5); border:1px solid var(--border-default);'}"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="grid size-9 place-items-center rounded-xl text-[18px]"
                    style="background:{isActive ? accent + '18' : '#ede9e0'};"
                  >
                    {s.emoji}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div
                      class="truncate text-[13px] font-semibold"
                      style="color:{isActive ? accent : 'var(--ink)'};"
                    >
                      {s.name}
                    </div>
                    <div class="text-[10px]" style="color:var(--text-secondary);">
                      {answeredCount}✓
                      {#if fails >= 2}
                        <span class="font-bold" style="color:#ef4444;"> · {fails}✕</span>
                      {/if}
                    </div>
                  </div>
                </div>
                {#if isActive}
                  <div class="mt-1.5 flex items-center gap-1.5">
                    <span class="inline-block size-1.5 rounded-full" style="background:#ef4444;"></span>
                    <div
                      class="text-[10px] font-semibold uppercase tracking-wide"
                      style="color:{accent};"
                    >
                      Your turn
                    </div>
                  </div>
                {/if}
                {#if fails >= 3}
                  <div
                    class="absolute -right-1.5 -top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                    style="background:#ef4444;"
                  >
                    Flagged
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          <div
            class="shrink-0 border-t p-3"
            style="border-color:var(--border-default); background:rgba(255,255,255,0.5);"
          >
            {#if phase === "session" && currentQ}
              <div class="mb-1 text-[9px] uppercase tracking-widest" style="color:var(--text-tertiary);">
                Next
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[16px]">{nextStudent?.emoji ?? "👤"}</span>
                <span class="text-[12px] font-semibold" style="color:var(--ink);">
                  {nextStudent?.name ?? "-"}
                </span>
              </div>
            {:else}
              <div class="text-center text-[10px]" style="color:var(--text-secondary);">
                {QUESTIONS_PER_STUDENT} questions each for {students.length} students.
              </div>
            {/if}
          </div>
        </div>

      </div>

      <div
        class="flex shrink-0 items-center gap-4 border-t px-5 py-2.5"
        style="border-color:var(--border-default); background:#faf9f6;"
      >
        <div class="flex items-center gap-1.5 text-[12px]" style="color:var(--text-secondary);">
          <span>☀️</span>
          <span>
            <strong style="color:var(--ink);">{correctCount}</strong> correct as a class
          </span>
        </div>
        <div class="flex items-center gap-1.5 text-[12px]" style="color:var(--text-secondary);">
          <RotateCcw class="size-3 opacity-60" />
          <span>
            Round <strong style="color:var(--ink);">{roundNum}</strong> of {QUESTIONS_PER_STUDENT}
          </span>
        </div>
        <div class="flex-1"></div>
        <button
          type="button"
          onclick={startOver}
          class="flex cursor-pointer items-center gap-1.5 text-[12px] transition-opacity hover:opacity-60"
          style="color:var(--text-secondary);"
        >
          <RotateCcw class="size-3" /> Restart
        </button>
        <button
          type="button"
          onclick={() => goto(resolve("/alert"))}
          class="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium transition-opacity hover:opacity-70"
          style="color:#ef4444;"
        >
          <Phone class="size-3" /> Call teacher
        </button>
      </div>

    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════
     MOBILE / TABLET (below md): full-screen student view
     ═══════════════════════════════════════════════════ -->
<div class="fixed inset-0 z-50 flex flex-col md:hidden" style="background:#0b0d14;">

  {#if phase === "start"}
    <div class="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div
        class="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium"
        style="background:{accent}22; color:{accent};"
      >
        {#if topic?.source === "custom"}
          <Pencil class="size-3.5" />
        {:else}
          <BookOpen class="size-3.5" />
        {/if}
        {topic?.subject ?? "Science"}
      </div>
      <div
        class="text-[30px] font-semibold leading-tight tracking-tight text-white"
        style="text-wrap:balance;"
      >
        {topic?.topic ?? "Today's reteach"}
      </div>
      <div class="text-[16px]" style="color:rgba(255,255,255,0.45);">
        Short summary first, then four-option MCQs. Tap one option to answer.
      </div>
      <button
        type="button"
        onclick={startSession}
        class="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl px-12 py-4 text-[18px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
        style="background:{accent}; box-shadow:0 16px 40px -12px {accent}88;"
      >
        🧠 Start Thinking <Sparkles class="size-5" />
      </button>
    </div>

  {:else if phase === "preloading"}
    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div class="animate-pulse text-[48px]">🧠</div>
      <div class="text-[24px] font-semibold text-white">AI is thinking...</div>
      <div class="text-[14px]" style="color:rgba(255,255,255,0.5);">
        Generating summary, images, and questions.
      </div>
      <div class="flex items-center gap-2">
        <div class="size-2 animate-bounce rounded-full" style="background:{accent};"></div>
        <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.1s;"></div>
        <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.2s;"></div>
      </div>
    </div>

  {:else if phase === "ready"}
    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div class="text-[48px]">✅</div>
      <div class="text-[24px] font-semibold text-white">Ready!</div>
      <div class="text-[14px]" style="color:rgba(255,255,255,0.55);">
        {summaryLines.length} sections, {questionPlan.length} questions preloaded.
      </div>
      <button
        type="button"
        onclick={startBeginning}
        class="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl px-12 py-5 text-[20px] font-bold text-white transition-all hover:scale-[1.03] active:scale-[0.97]"
        style="background:#22c55e; box-shadow:0 16px 40px -12px #22c55e88;"
      >
        ▶ Start Beginning <ArrowRight class="size-6" />
      </button>
    </div>

  {:else if phase === "summarizing"}
    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6">
      <div
        class="flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium"
        style="background:{accent}22; color:{accent};"
      >
        <span class="relative flex size-2">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style="background:{accent};"
          ></span>
          <span class="relative inline-flex size-2 rounded-full" style="background:{accent};"></span>
        </span>
        {summaryLoading ? "Loading short summary..." : "Showing short summary..."}
      </div>
      <div bind:this={mobileSummaryStageEl} class="w-full max-w-sm flex-1 overflow-y-auto text-center">
        {#if summaryLoading}
          <div class="space-y-4 pb-6 text-left">
            <div class="flex items-center gap-2 overflow-x-auto pb-1">
              {#each summaryPreviewCards as card, i (`mobile-flow-${card.title}-${i}`)}
                {@const tone = getPreviewCardTone(card, i)}
                <div
                  class="shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                  style="background:{tone.chipBackground}; color:{tone.chipColor}; border-color:{tone.cardBorder};"
                >
                  {card.title}
                </div>
                {#if i < summaryPreviewCards.length - 1}
                  <ArrowRight class="size-4 shrink-0" style="color:{tone.trailColor};" />
                {/if}
              {/each}
            </div>

            {#each summaryPreviewCards as card, i (`mobile-preview-${card.title}-${i}`)}
              {@const tone = getPreviewCardTone(card, i)}
              <div
                class="rounded-3xl border p-3.5"
                style="background:{tone.cardBackground}; border-color:{tone.cardBorder};"
              >
                <div class="mb-3 flex items-start gap-2.5">
                  <div
                    class="grid size-10 shrink-0 place-items-center rounded-2xl"
                    style="background:{tone.chipBackground}; color:{tone.chipColor};"
                  >
                    <tone.icon class="size-4.5" />
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-[0.18em]" style="color:{tone.chipColor};">
                      {card.badge}
                    </div>
                    <div class="mt-1 text-[15px] font-semibold" style="color:var(--ink);">
                      {card.title}
                    </div>
                  </div>
                </div>
                {#if card.imageDataUrl}
                  <img src={card.imageDataUrl} alt={card.title} class="h-28 w-full rounded-2xl object-cover" />
                {:else}
                  <div
                    class="flex h-28 items-center justify-center rounded-2xl text-6xl"
                    style="background:{tone.chipBackground};"
                  >
                    {getCardEmoji(card.badge, i)}
                  </div>
                {/if}
                <div class="mt-3 text-[13px] leading-[1.55]" style="color:var(--text-body);">
                  {card.caption}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          {#each visibleSummaryLines as line, i (i)}
            {@const tone = getSummaryLineTone(line, i)}
            {@const dialogue = isDialogueLine(line)}
            <div
              class="relative mb-4 pl-1 text-left"
            >
              {#if i < visibleSummaryLines.length - 1}
                <div
                  class="absolute -bottom-4.5 left-5 top-[calc(100%-6px)] w-px"
                  style="background:{tone.trailColor}; opacity:0.45;"
                ></div>
              {/if}
              {#if dialogue}
                <div
                  data-summary-line={i}
                  class="flex"
                  style="justify-content:{dialogue.side === 'right' ? 'flex-end' : 'flex-start'}; opacity:{summaryIdx - i > 0 ? 0.58 : 1};"
                >
                  <div
                    class="max-w-[85%] rounded-3xl p-3.5 text-[16px] font-medium leading-relaxed"
                    style="background:{dialogue.side === 'left' ? '#eef8ff' : '#f0fdf4'}; border:1px solid {dialogue.side === 'left' ? '#cfe1ff' : '#bbf7d0'};"
                  >
                    <div class="mb-1 text-[10px] font-bold uppercase tracking-wider" style="color:{dialogue.side === 'left' ? '#2569c7' : '#15803d'};">
                      {dialogue.side === 'left' ? '👩‍🏫' : '🧒'} {dialogue.speaker}
                    </div>
                    {enrichWithEmojis(dialogue.text)}
                  </div>
                </div>
              {:else}
                <div
                  data-summary-line={i}
                  class="rounded-3xl border p-4 text-[18px] font-medium leading-relaxed"
                  style="background:{tone.cardBackground}; border-color:{tone.cardBorder}; color:var(--ink); opacity:{summaryIdx - i > 0 ? 0.58 : 1};"
                >
                  <div class="mb-2 flex items-center gap-2">
                    <div
                      class="grid size-8 shrink-0 place-items-center rounded-2xl"
                      style="background:{tone.chipBackground}; color:{tone.chipColor};"
                    >
                      <tone.icon class="size-4" />
                    </div>
                    <div class="text-[11px] font-semibold uppercase tracking-[0.18em]" style="color:{tone.chipColor};">
                      {tone.label}
                    </div>
                  </div>
                  {enrichWithEmojis(line)}
                </div>
              {/if}
            </div>
            {#if summaryImages.length > 0 && (i + 1) % 2 === 0}
              {@const imgIdx = Math.floor((i + 1) / 2) - 1}
              {#if imgIdx < summaryImages.length}
                {@const img = summaryImages[imgIdx]}
                <div class="my-3 overflow-hidden rounded-2xl border" style="border-color:#f3d49a; background:#fff9ed;">
                  <img
                    src={img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`}
                    alt="Textbook image {imgIdx + 1}"
                    class="w-full object-contain max-h-36"
                  />
                </div>
              {/if}
            {/if}
          {/each}
          <button
            type="button"
            onclick={skipSummary}
            class="mt-2 cursor-pointer rounded-xl px-4 py-2 text-[12px] font-semibold"
            style="color:{accent}; background:white;"
          >
            Skip to MCQ
          </button>
        {/if}
      </div>
    </div>

  {:else if phase === "complete"}
    <div class="mx-4 my-auto flex flex-col items-center justify-center gap-5 text-center text-white">
      <div
        class="grid size-18 place-items-center rounded-full text-[28px] font-semibold"
        style="background:{accent};"
      >
        ✓
      </div>
      <div class="text-[28px] font-semibold leading-tight">Session complete</div>
      <div class="max-w-sm text-[15px] leading-[1.7]" style="color:rgba(255,255,255,0.68);">
        {totalQuestionCount} questions are finished. The round has stopped, and {struggleCount} student{struggleCount === 1 ? "" : "s"} can now be reviewed in alerts.
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2.5">
        <div class="rounded-full px-3 py-1.5 text-[12px] font-semibold" style="background:white; color:{accent};">
          {totalQuestionCount} of {totalQuestionCount} done
        </div>
        <div class="rounded-full px-3 py-1.5 text-[12px] font-semibold" style="background:{accent}22; color:white;">
          Round {QUESTIONS_PER_STUDENT} of {QUESTIONS_PER_STUDENT}
        </div>
      </div>
      <button
        type="button"
        onclick={() => goto(resolve("/alert"))}
        class="mt-2 flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold text-white"
        style="background:{accent};"
      >
        Open alerts <ArrowRight class="size-4" />
      </button>
      <button
        type="button"
        onclick={() => goto(resolve("/student/topic"))}
        class="flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold"
        style="background:white; color:{accent};"
      >
        Pick another topic
      </button>
    </div>

  {:else}
    <button
      type="button"
      onclick={startOver}
      class="absolute right-4 top-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium"
      style="color:rgba(255,255,255,0.4);"
    >
      <RotateCcw class="size-3" /> Start over
    </button>

    <div
      class="mx-3 mb-3 mt-12 flex flex-1 flex-col overflow-hidden rounded-2xl"
      style="background:var(--ivory);"
    >
      <div class="flex flex-1 flex-col overflow-y-auto p-5">
        {#if blockedBySource}
          <div class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div class="text-[24px]">📚</div>
            <div class="text-[18px] font-semibold" style="color:var(--ink);">Textbook topic required</div>
            <div class="text-[13px]" style="color:var(--text-secondary);">
              {summaryError || "No vectorized textbook chunks found for this topic."}
            </div>
            <button
              type="button"
              onclick={() => goto(resolve("/student/topic"))}
              class="cursor-pointer rounded-xl px-4 py-2 text-[13px] font-semibold text-white"
              style="background:{accent};"
            >
              Pick class topic
            </button>
          </div>
        {:else}
          <div
            class="bg-saffron-50 border-saffron-100 mb-5 inline-flex items-center gap-2.5 self-start rounded-full border px-3.5 py-2"
          >
            <span class="text-[18px]">{activeStudent?.emoji}</span>
            <span class="text-saffron-700 text-[13px] font-semibold">
              {activeStudent?.name}, it's your turn.
            </span>
          </div>

          <div
            class="text-ink text-[20px] font-medium leading-[1.45] tracking-tight"
            style="text-wrap:pretty;"
          >
            {currentQ?.q}
          </div>

          <div class="mt-2 text-[13px]" style="color:var(--text-secondary);">
            Tap one option below when ready.
          </div>

          <details class="mt-3 rounded-xl border" style="border-color:var(--border-default); background:white;">
            <summary class="cursor-pointer px-3 py-2 text-[12px] font-semibold" style="color:var(--ink);">
              View summary
            </summary>
            <div class="max-h-44 space-y-2 overflow-y-auto px-3 pb-3">
              {#if summaryImages.length > 0}
                <div class="flex gap-2 overflow-x-auto pb-1">
                  {#each summaryImages.slice(0, 2) as img, i (`mob-details-img-${i}`)}
                    <img
                      src={img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`}
                      alt="Textbook image {i + 1}"
                      class="h-12 w-16 shrink-0 rounded-lg object-cover border"
                      style="border-color:#f3d49a;"
                    />
                  {/each}
                </div>
              {/if}
              {#each summaryLines as line, i (i)}
                {@const tone = getSummaryLineTone(line, i)}
                <div
                  class="rounded-2xl border px-2.5 py-2 text-[11px] leading-relaxed"
                  style="border-color:{tone.cardBorder}; background:{tone.cardBackground};"
                >
                  <div class="mb-1 flex items-center gap-2">
                    <div
                      class="grid size-6 shrink-0 place-items-center rounded-xl"
                      style="background:{tone.chipBackground}; color:{tone.chipColor};"
                    >
                      <tone.icon class="size-3.5" />
                    </div>
                    <div class="text-[9.5px] font-semibold uppercase tracking-[0.16em]" style="color:{tone.chipColor};">
                      {tone.label}
                    </div>
                  </div>
                  {enrichWithEmojis(line)}
                </div>
              {/each}
            </div>
          </details>

          {#if answerPhase === "ask"}
            {#if mcqTimerValue > 0}
              <div class="mt-3 flex items-center gap-3">
                <div class="h-2 flex-1 overflow-hidden rounded-full" style="background:rgba(255,255,255,0.15);">
                  <div
                    class="h-full rounded-full transition-all duration-1000 ease-linear"
                    style="width:{Math.round((mcqTimerValue / MCQ_TIMER_SECONDS) * 100)}%; background:{mcqTimerValue <= 3 ? '#ef4444' : accent};"
                  ></div>
                </div>
                <span
                  class="text-[14px] font-bold tabular-nums"
                  style="color:{mcqTimerValue <= 3 ? '#ef4444' : accent};"
                >
                  {mcqTimerValue}s
                </span>
              </div>
            {/if}
            <div class="mt-5 space-y-2.5">
              {#each currentQ?.options ?? [] as option, i (`m-${option}-${i}`)}
                <button
                  type="button"
                  onclick={() => selectOption(i)}
                  class="w-full cursor-pointer rounded-xl border px-3.5 py-3 text-left"
                  style="background:white; border-color:var(--border-default);"
                >
                  <div class="flex items-start gap-3">
                    <div
                      class="grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold"
                      style="background:{accent}12; color:{accent};"
                    >
                      {OPTION_LABELS[i]}
                    </div>
                    <div class="pt-1 text-[14px] font-semibold" style="color:var(--ink);">{option}</div>
                  </div>
                </button>
              {/each}
            </div>
            <div class="mt-2 text-[11px]" style="color:var(--text-tertiary);">
              Tap one option. No typing needed.
            </div>
          {:else}
            <div class="mt-5 space-y-2.5">
              {#each currentQ?.options ?? [] as option, i (`mf-${option}-${i}`)}
                {@const isCorrectOption = i === currentQ?.answerIndex}
                {@const isPicked = i === submittedOption}
                <div
                  class="rounded-xl border px-3.5 py-3"
                  style="{isCorrectOption
                    ? 'background:#ecfdf3;border-color:#86efac;'
                    : isPicked
                      ? 'background:#fff1f2;border-color:#fda4af;'
                      : 'background:white;border-color:var(--border-default);'}"
                >
                  <div class="text-[13.5px] font-semibold" style="color:var(--ink);">{option}</div>
                </div>
              {/each}
            </div>

            <div
              class="mt-5 rounded-2xl border p-4"
              style="{lastCorrect
                ? 'background:#f0fdf4;border-color:#bbf7d0;'
                : 'background:#fff1f0;border-color:#fca5a5;'}"
            >
              <div class="mb-2 flex items-center gap-2.5">
                {#if lastCorrect}
                  <CheckCircle2 class="size-5" style="color:#15803d;" />
                  <div class="text-[15px] font-bold" style="color:#166534;">
                    {sessionLanguage === "ta" ? "சரியான பதில்! " : "That's right! "}
                  </div>
                {:else}
                  <XCircle class="size-5" style="color:#dc2626;" />
                  <div class="text-[15px] font-bold" style="color:#dc2626;">
                    {sessionLanguage === "ta" ? "தவறான பதில்." : "Not quite."}
                  </div>
                {/if}
              </div>
              {#if !lastCorrect}
                <div class="mb-2.5 ml-7 rounded-xl border-l-4 bg-white px-3 py-2.5" style="border-color:#22c55e;">
                  <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style="color:#15803d;">
                    {sessionLanguage === "ta" ? "சரியான விடை" : "Correct answer"}
                  </div>
                  <div class="text-[14px] font-semibold" style="color:#166534;">
                    {currentQ?.options[currentQ.answerIndex] ?? ""}
                  </div>
                </div>
              {/if}
              <div class="pl-7 text-[13px] leading-[1.6]" style="color:var(--text-body);">
                {#if lastCorrect}
                  {currentQ?.explain ?? ""}
                {:else}
                  {sessionLanguage === "ta" ? "ஏன்? " : "Why? "}{currentQ?.explain ?? ""}
                {/if}
              </div>
              <div class="mt-3 pl-7">
                <button
                  type="button"
                  onclick={next}
                  class="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white"
                  style="background:{accent};"
                >
                  {isFinalTurn ? "Finish session" : `Next · ${nextStudent?.name ?? "next"}`}
                  <ArrowRight class="size-3.5" />
                </button>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <div
        class="shrink-0 border-t px-4 py-3"
        style="background:#f5f3ee; border-color:var(--border-default);"
      >
        <div class="flex gap-2.5 overflow-x-auto">
          {#each students as s, i (s.id)}
            {@const isActive = i === currentQ?.student && answerPhase === "ask"}
            {@const fails = failCounts[i]}
            <div
              class="relative flex shrink-0 flex-col items-center gap-1 rounded-2xl px-3 py-2.5 text-center transition-all"
              style="{isActive
                ? `background:white; border:2px solid ${accent}; box-shadow:0 4px 12px -6px ${accent}55;`
                : 'background:rgba(255,255,255,0.5); border:1px solid var(--border-default);'}"
            >
              <div class="text-[20px]">{s.emoji}</div>
              <div
                class="text-[10px] font-semibold"
                style="color:{isActive ? accent : 'var(--ink)'};"
              >
                {s.name}
              </div>
              {#if isActive}
                <div class="text-[9px]" style="color:{accent};">◉ Now</div>
              {/if}
              {#if fails >= 3}
                <div
                  class="absolute -right-1 -top-1 size-3 rounded-full"
                  style="background:#ef4444;"
                ></div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="px-4 pb-4 text-center text-[11px]" style="color:rgba(255,255,255,0.48);">
      Student tablet is locked to Socratic Q&amp;A on small screens.
    </div>
  {/if}

</div>
