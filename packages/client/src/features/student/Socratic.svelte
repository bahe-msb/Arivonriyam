<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { onDestroy, onMount, tick } from "svelte";
  import {
    ArrowRight,
    RotateCcw,
    BookOpen,
    Image as ImageIcon,
    Lightbulb,
    Phone,
    CheckCircle2,
    Shapes,
    Sparkles,
    XCircle,
  } from "lucide-svelte";
  import { Button } from "@shadcn";
  import { Pill } from "@components";
  import { CLASSES } from "@mocks";
  import {
    activeClass,
    reteachTopics,
    schoolConfig,
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
  type SessionLanguage = "en" | "ta" | "te";
  type SummarizeResponse = {
    lines?: string[];
    questions?: SessionQuestion[];
    error?: string;
    language?: SessionLanguage;
    images_base64?: string[];
    diagram_captions?: string[];
    exercise_chunks?: Array<{ text: string; page: number }>;
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
  const TABLET_STUDENT_BREAKPOINT = 835;
  const SUMMARY_SEGMENT_WORD_LIMIT = 18;
  const SUMMARY_SEGMENT_SENTENCE_LIMIT = 2;
  type SocraticStudent = { id: string; name: string; emoji: string };

  const FALLBACK_EMOJIS = ["🦁", "🌻", "🦚", "🌙"];
  const OPTION_LABELS = ["A", "B", "C", "D"] as const;

  const cls = $derived(CLASSES.find((c) => c.id === activeClass.id));
  const students = $derived<SocraticStudent[]>(
    schoolConfig.studentsByClass[activeClass.id]?.map((s) => ({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
    })) ??
      Array.from({ length: 4 }, (_, idx): SocraticStudent => ({
        id: `student-${activeClass.id}-${idx + 1}`,
        name: `Student ${idx + 1}`,
        emoji: FALLBACK_EMOJIS[idx % FALLBACK_EMOJIS.length],
      })),
  );

  // Start screen: no class pre-selected; derived topic comes from per-class store
  let startClassId = $state<number | null>(null);
  const topic = $derived(
    startClassId !== null ? reteachTopics.getSelectedTopic(startClassId) : null,
  );

  function pickStartClass(id: number): void {
    startClassId = id;
    activeClass.set(id);
  }

  let phase = $state<Phase>("start");

  let qIdx = $state(0);
  let answered = $state<{ studentIdx: number; correct: boolean }[]>([]);
  let answerPhase = $state<"ask" | "feedback">("ask");
  let submittedOption = $state<number | null>(null);
  let lastCorrect = $state(true);
  let feedbackTitle = $state("");
  let useTabletStudentShell = $state(false);
  let feedbackDetail = $state("");

  function syncTabletStudentShell(): void {
    if (typeof window === "undefined") return;

    useTabletStudentShell =
      navigator.maxTouchPoints > 1 &&
      window.innerWidth >= 768 &&
      Math.min(window.innerWidth, window.innerHeight) <= TABLET_STUDENT_BREAKPOINT;
  }

  let summaryLines = $state<string[]>([]);
  let summaryIdx = $state(0);
  let speakingSummaryLineIdx = $state<number | null>(null);
  let summarySpeechCharIdx = $state(0);
  let summaryLoading = $state(false);
  let summaryError = $state("");
  let sessionLanguage = $state<SessionLanguage>("en");
  let summaryPreviewCards = $state<PreviewCard[]>([]);
  let summaryPreviewLoading = $state(false);
  let sessionId = $state("");
  let sessionAttempts = $state<SessionAttempt[]>([]);
  let summaryImages = $state<string[]>([]);
  let summaryDiagramCaptions = $state<string[]>([]);
  let summaryExerciseChunks = $state<Array<{ text: string; page: number }>>([]);

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
  const plannedRounds = $derived(
    questionPlan.length > 0
      ? Math.max(1, Math.ceil(questionPlan.length / Math.max(1, students.length)))
      : QUESTIONS_PER_STUDENT,
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
  const canSkipSummary = $derived(questionPlan.length > 0);
  const accent = $derived(cls?.color ?? "#6B94E7");
  const isFinalTurn = $derived(questionPlan.length > 0 && qIdx >= questionPlan.length - 1);
  const struggleCount = $derived(
    students.filter((_, idx) => sessionAttempts.some((attempt) => attempt.studentIdx === idx && !attempt.correct)).length,
  );
  const sessionLanguageLabel = $derived(
    sessionLanguage === "ta" ? "Tamil" : sessionLanguage === "te" ? "Telugu" : "English",
  );
  const headerLanguageLabel = $derived(
    phase === "start" ? "Follows textbook" : sessionLanguageLabel,
  );
  const summaryLanguageNote = $derived(
    "Summary and MCQs will match the uploaded textbook language, including Tamil, Telugu, and English.",
  );

  function normalizeLanguage(value: unknown): SessionLanguage {
    if (value === "ta") return "ta";
    if (value === "te") return "te";
    return "en";
  }

  function detectLanguage(text: string): SessionLanguage {
    const sample = text.trim();
    if (!sample) return "en";

    const tamilChars = [...sample].filter((char) => char >= "\u0B80" && char <= "\u0BFF").length;
    const teluguChars = [...sample].filter((char) => char >= "\u0C00" && char <= "\u0C7F").length;
    const latinChars = [...sample].filter((char) => /[A-Za-z]/.test(char)).length;

    if (teluguChars >= Math.max(6, Math.floor(latinChars / 2)) && teluguChars >= tamilChars) {
      return "te";
    }
    if (tamilChars >= Math.max(6, Math.floor(latinChars / 2))) {
      return "ta";
    }
    return "en";
  }

  function countWords(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }

  function chunkSummaryByWords(text: string, wordLimit = SUMMARY_SEGMENT_WORD_LIMIT): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= wordLimit) return [text];

    // Prefer breaks at clause boundaries (comma, semicolon, dash, ellipsis,
    // 'and'/'but'/'so'). Falling back to a hard word-slice can sever short
    // phrases like "Don't worry" mid-thought across boxes.
    const clauseBreak = /([,;:—–]|\s\.\.\.|\s(?:and|but|so|because|then|or)\s)/i;
    const segments: string[] = [];
    let remaining = text.trim();
    let guard = 0;
    while (countWords(remaining) > wordLimit && guard++ < 32) {
      const slice = remaining.split(/\s+/).slice(0, wordLimit).join(" ");
      const match = clauseBreak.exec(slice);
      let cutAt = slice.length;
      if (match && match.index > Math.floor(wordLimit / 3)) {
        cutAt = match.index + match[0].length;
      }
      const head = remaining.slice(0, cutAt).trim();
      if (!head) break;
      segments.push(head);
      remaining = remaining.slice(cutAt).trim();
    }
    if (remaining) segments.push(remaining);
    return segments;
  }

  function splitSummaryLine(line: string): string[] {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (!trimmed) return [];
    if (isDialogueLine(trimmed)) return [trimmed];

    const sentences = trimmed
      .split(/(?<=[.!?।])\s+/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      return chunkSummaryByWords(trimmed);
    }

    const segments: string[] = [];
    let pending = "";
    let pendingWordCount = 0;
    let pendingSentenceCount = 0;

    const flush = () => {
      if (!pending) return;
      segments.push(pending);
      pending = "";
      pendingWordCount = 0;
      pendingSentenceCount = 0;
    };

    for (const sentence of sentences) {
      const sentenceWordCount = countWords(sentence);
      if (sentenceWordCount > SUMMARY_SEGMENT_WORD_LIMIT + 4) {
        flush();
        segments.push(...chunkSummaryByWords(sentence));
        continue;
      }

      const wouldOverflowWords = pendingWordCount + sentenceWordCount > SUMMARY_SEGMENT_WORD_LIMIT;
      const wouldOverflowSentences = pendingSentenceCount >= SUMMARY_SEGMENT_SENTENCE_LIMIT;

      if (pending && (wouldOverflowWords || wouldOverflowSentences)) {
        flush();
      }

      pending = pending ? `${pending} ${sentence}` : sentence;
      pendingWordCount += sentenceWordCount;
      pendingSentenceCount += 1;
    }

    flush();
    return segments.length > 0 ? segments : chunkSummaryByWords(trimmed);
  }

  function normalizeSummaryLines(raw: string[]): string[] {
    return raw.flatMap((line) => splitSummaryLine(line)).filter(Boolean);
  }

  function resetSummarySpeechHighlight(): void {
    speakingSummaryLineIdx = null;
    summarySpeechCharIdx = 0;
  }

  function getSummaryHighlightParts(
    line: string,
    index: number,
  ): { before: string; active: string; after: string } | null {
    if (phase !== "summarizing" || summaryIdx !== index || speakingSummaryLineIdx !== index) {
      return null;
    }

    const text = line.trim();
    if (!text) return null;

    let cursor = Math.max(0, Math.min(summarySpeechCharIdx, text.length));
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) {
      cursor += 1;
    }
    if (cursor >= text.length) return null;

    let start = cursor;
    while (start > 0 && !/\s/.test(text[start - 1] ?? "")) {
      start -= 1;
    }

    let end = cursor;
    while (end < text.length && !/\s/.test(text[end] ?? "")) {
      end += 1;
    }

    return {
      before: text.slice(0, start),
      active: text.slice(start, end),
      after: text.slice(end),
    };
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

    if (sessionLanguage === "te") {
      return [
        `ఈ రోజు మనం ${topic?.topic ?? "ఈ అంశాన్ని"} సులభమైన ${topic?.subject ?? "సైన్స్"} పదాలతో ప్రారంభిస్తాం.`,
        "ఈ సారాంశం పాఠంలోని ముఖ్యాంశాలను నెమ్మదిగా, సులభంగా వివరిస్తుంది.",
        "సారాంశం తర్వాత ప్రతి విద్యార్థి నాలుగు ఎంపికలలో ఒకదాన్ని మాత్రమే తాకి సమాధానం ఇవ్వాలి.",
        "ప్రతి విద్యార్థికి ఆరు MCQ అవకాశాలు ఉంటాయి.",
      ];
    }

    return [
      `Today we are starting ${topic?.topic ?? "this topic"} in simple ${topic?.subject ?? "Science"} words.`,
      "This short summary follows the lesson points and keeps the explanation easy to follow.",
      "After the summary, each student answers only by tapping one of four options.",
      "Each student gets six MCQ turns, one question at a time.",
    ];
  }

  function questionSignature(question: SessionQuestion): string {
    return question.q.trim().toLowerCase();
  }

  function mergeUniqueQuestions(
    primary: SessionQuestion[],
    secondary: SessionQuestion[],
    limit: number,
  ): SessionQuestion[] {
    const merged: SessionQuestion[] = [];
    const seen = new Set<string>();

    for (const question of [...primary, ...secondary]) {
      const signature = questionSignature(question);
      if (!signature || seen.has(signature)) continue;
      seen.add(signature);
      merged.push(question);
      if (merged.length >= limit) break;
    }

    return merged;
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
          badge: topic?.source === "custom" ? "Local notes" : "Textbook cue",
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

    if (sessionLanguage === "te") {
      return [
        {
          title: "అంశం ప్రారంభం",
          badge: topic?.source === "custom" ? "Local notes" : "Textbook cue",
          caption: `${topic?.topic ?? "ఈ అంశం"} ను సులభమైన ${topic?.subject ?? "సైన్స్"} పదాల్లో సిద్ధం చేస్తున్నాం.`,
        },
        {
          title: "చిన్న ఉదాహరణ",
          badge: "Real-life link",
          caption: "ఇల్లు మరియు పాఠశాల ఉదాహరణలు పిల్లలకు త్వరగా అర్థమవడానికి సహాయపడతాయి.",
        },
        {
          title: "తాకి సమాధానం",
          badge: "MCQ round",
          caption: "సారాంశం తర్వాత ప్రతి విద్యార్థి ప్రశ్న విని ఒక ఎంపికను తాకి సమాధానం ఇస్తాడు.",
        },
      ];
    }

    return [
      {
        title: "Topic start",
        badge: topic?.source === "custom" ? "Local notes" : "Textbook cue",
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

    if (/example|for example|like|such as|home|school|daily|உதாரண|வீடு|பள்ளி|ఉదాహరణ|ఇల్లు|పాఠశాల|రోజువారీ/i.test(lower)) {
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

    if (/remember|key|important|rule|point|fact|முக்கிய|நினைவில்|தகவல்|గుర్తుంచుకో|ముఖ్య|నియమం|విషయం/i.test(lower)) {
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

    if (/question|mcq|option|tap|round|கேள்வி|விருப்ப|தொடு|ప్రశ్న|ఎంపిక|తాకు|రౌండ్/i.test(lower)) {
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
    const sourceBank = mergeUniqueQuestions(questionBank, [], totalTurns).slice(0, totalTurns);

    if (sourceBank.length === 0) return [];

    const turns: SessionTurn[] = [];
    for (let round = 0; round < QUESTIONS_PER_STUDENT && turns.length < sourceBank.length; round += 1) {
      for (let student = 0; student < safeStudents; student += 1) {
        const question = sourceBank[turns.length];
        if (!question) break;

        turns.push({
          ...question,
          student,
        });
      }
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

  /** Track dialogue speakers for alternating sides */
  let _dialogueSpeakers: string[] = [];

  /** Detect if a line looks like dialogue/conversation (e.g., "Teacher: ...", "Student: ...") */
  function isDialogueLine(line: string): { speaker: string; text: string; side: "left" | "right" } | null {
    const match = line.match(/^([\w\u0B80-\u0BFF\u0C00-\u0C7F][\w\u0B80-\u0BFF\u0C00-\u0C7F ]{0,20})\s*[:：]\s*[""]?(.+?)[""]?\s*$/);
    if (!match) return null;
    const speaker = match[1].trim();
    const text = match[2].trim();
    if (!text || text.length < 2) return null;

    const leftSpeakers = /^(teacher|ఆచార్య|టీచర్|ஆசிரியர்|அம்மா|అమ్మ|அப்பா|నాన్న|mom|dad|parent|mother|father|person\s*1|speaker\s*1)/i;
    const rightSpeakers = /^(student|విద్యార్థి|పిల్ల|మాణவ|மாணவ|குழந்தை|child|kid|boy|girl|ram|ravi|priya|sita|person\s*2|speaker\s*2)/i;
    if (leftSpeakers.test(speaker)) return { speaker, text, side: "left" };
    if (rightSpeakers.test(speaker)) return { speaker, text, side: "right" };

    // For any other speaker name — alternate sides based on who's speaking
    if (!_dialogueSpeakers.includes(speaker)) {
      _dialogueSpeakers.push(speaker);
    }
    const speakerIdx = _dialogueSpeakers.indexOf(speaker);
    return { speaker, text, side: speakerIdx % 2 === 0 ? "left" : "right" };
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
    resetSummarySpeechHighlight();
    stopSpeech();
  }

  function finishSummaryPlayback(showLastLine = false): void {
    stopSummaryPlayback();
    if (showLastLine && summaryLines.length > 0) {
      summaryIdx = summaryLines.length - 1;
    }
    phase = "session";
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
    if (topic) reteachTopics.markCompleted(topic.id);
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
      finishSummaryPlayback();
      return;
    }

    const nextIdx = Math.min(idx, summaryLines.length - 1);
    summaryIdx = nextIdx;
    speakingSummaryLineIdx = nextIdx;
    summarySpeechCharIdx = 0;
    void scrollSummaryToLine(nextIdx);

    const isLastLine = nextIdx >= summaryLines.length - 1;
    const line = summaryLines[nextIdx] ?? "";

    // Wait for TTS to finish speaking the line before advancing
    void speakAsync(line, sessionLanguage, {
      addPauses: false,
      onBoundary: (charIndex) => {
        if (runId !== summaryRunId || phase !== "summarizing" || summaryIdx !== nextIdx) return;
        summarySpeechCharIdx = charIndex;
      },
    }).then(() => {
      if (runId !== summaryRunId || phase !== "summarizing") return;
      summarySpeechCharIdx = line.length;

      // Longer pause between lines for natural flow and comprehension
      summaryFlowTimer = setTimeout(() => {
        if (runId !== summaryRunId || phase !== "summarizing") return;
        if (isLastLine) {
          finishSummaryPlayback(true);
          return;
        }
        revealSummaryLine(nextIdx + 1, runId);
      }, 1200);
    });
  }

  function skipSummary(): void {
    if (!canSkipSummary) return;
    finishSummaryPlayback(true);
  }

  function customTopicLoadErrorMessage(): string {
    return sessionLanguage === "ta"
      ? "Ollama இந்த custom topic-க்கு சுருக்கத்தை உருவாக்கவில்லை. மீண்டும் முயற்சிக்கவும்."
      : sessionLanguage === "te"
        ? "ఈ custom topic కోసం Ollama సారాంశాన్ని తయారు చేయలేదు. దయచేసి మళ్లీ ప్రయత్నించండి."
      : "Ollama did not generate a summary for this custom topic. Please try again.";
  }

  async function fetchSummary(): Promise<void> {
    summaryLoading = true;
    summaryError = "";

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
        const lines = normalizeSummaryLines(
          Array.isArray(data.lines)
            ? data.lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0)
          : [],
        );
        const expectedTurns = Math.max(1, students.length) * QUESTIONS_PER_STUDENT;
        const normalizedPlan = buildQuestionPlan(normalizeQuestions(data.questions, expectedTurns));
        if (topic?.source === "custom") {
          if (lines.length === 0 || normalizedPlan.length === 0) {
            summaryError = typeof data.error === "string" && data.error.trim()
              ? data.error
              : lines.length === 0
                ? customTopicLoadErrorMessage()
                : sessionLanguage === "ta"
                  ? "MCQகள் தயாராகவில்லை. மீண்டும் முயற்சிக்கவும்."
                  : sessionLanguage === "te"
                    ? "MCQలు సిద్ధం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి."
                    : "MCQs could not be prepared. Please try again.";
            summaryLines = normalizeSummaryLines([summaryError]);
            questionPlan = [];
          } else {
            summaryLines = lines;
            questionPlan = normalizedPlan;
          }
        } else {
          summaryLines = lines.length > 0 ? lines : normalizeSummaryLines(fallbackLines());
          questionPlan = normalizedPlan;
          if (normalizedPlan.length === 0) {
            summaryError = typeof data.error === "string" && data.error.trim()
              ? data.error
              : sessionLanguage === "ta"
                ? "MCQகள் தயாராகவில்லை. மீண்டும் முயற்சிக்கவும்."
                : sessionLanguage === "te"
                  ? "MCQలు సిద్ధం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి."
                  : "MCQs could not be prepared. Please try again.";
          }
        }

        // Capture images from the response
        summaryImages = Array.isArray(data.images_base64)
          ? data.images_base64.filter((img): img is string => typeof img === "string" && img.length > 0)
          : [];
        summaryDiagramCaptions = Array.isArray(data.diagram_captions)
          ? data.diagram_captions.filter(
              (caption): caption is string => typeof caption === "string" && caption.trim().length > 0,
            )
          : [];
        summaryExerciseChunks = Array.isArray(data.exercise_chunks)
          ? data.exercise_chunks.filter(
              (chunk): chunk is { text: string; page: number } =>
                !!chunk && typeof chunk.text === "string" && chunk.text.trim().length > 0,
            )
          : [];
      } else {
        const data = (await response.json().catch(() => ({}))) as SummarizeResponse;
        sessionLanguage = normalizeLanguage(data.language ?? sessionLanguage);
        const apiError = typeof data.error === "string" ? data.error : "Could not load textbook summary.";
        summaryError = apiError;

        if (topic?.source === "custom") {
          summaryLines = normalizeSummaryLines([apiError || customTopicLoadErrorMessage()]);
          summaryImages = [];
          summaryDiagramCaptions = [];
          summaryExerciseChunks = [];
          questionPlan = [];
        } else {
          summaryLines = normalizeSummaryLines([
            apiError,
            "Choose an exact textbook topic from the class section and try again.",
          ]);
          questionPlan = [];
          summaryDiagramCaptions = [];
          summaryExerciseChunks = [];
        }
      }
    } catch (error) {
      summaryError = sessionLanguage === "ta"
        ? "சுருக்கத்தை ஏற்றும்போது வலைப்பின்னல் சிக்கல் ஏற்பட்டது."
        : sessionLanguage === "te"
          ? "సారాంశాన్ని లోడ్ చేస్తున్నప్పుడు నెట్‌వర్క్ సమస్య వచ్చింది."
          : "Network issue while loading summary.";
      if (topic?.source === "custom") {
        summaryLines = normalizeSummaryLines([summaryError || customTopicLoadErrorMessage()]);
        summaryImages = [];
        summaryDiagramCaptions = [];
        summaryExerciseChunks = [];
        questionPlan = [];
      } else {
        summaryLines = normalizeSummaryLines([
          "Could not load textbook chunks for this class topic.",
          "Select the exact chapter topic name and retry.",
        ]);
        questionPlan = [];
        summaryDiagramCaptions = [];
        summaryExerciseChunks = [];
      }
    }

    summaryLoading = false;
  }

  async function fetchSummaryPreview(): Promise<void> {
    summaryPreviewCards = buildFallbackPreviewCards();
    summaryPreviewLoading = false;
  }

  async function startSession(): Promise<void> {
    if (reteachTopics.readOnly) return;
    clearAutoAdvanceTimer();
    clearMcqTimer();
    stopSummaryPlayback();
    _initTTS();

    phase = "preloading";
    qIdx = 0;
    answered = [];
    summaryIdx = 0;
    summaryLines = [];
    _dialogueSpeakers = [];
    summaryError = "";
    sessionLanguage = detectLanguage(topic?.topic ?? "");
    summaryPreviewCards = buildFallbackPreviewCards();
    sessionId = createSessionId();
    sessionAttempts = [];
    summaryImages = [];
    summaryDiagramCaptions = [];
    summaryExerciseChunks = [];
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
    if (summaryError || summaryLines.length === 0 || questionPlan.length === 0) return;
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
    summaryExerciseChunks = [];
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

  function _pickVoice(lang: SessionLanguage): SpeechSynthesisVoice | undefined {
    const voices = speechSynthesis.getVoices();
    const prefix = lang === "ta" ? "ta" : lang === "te" ? "te" : "en";

    if (lang === "en") {
      // Strongly prefer Indian English voices for natural accent
      const indianVoice =
        voices.find((v) => v.lang === "en-IN") ??
        voices.find((v) => v.lang.toLowerCase() === "en-in") ??
        voices.find((v) => /\bindia\b/i.test(v.name) && v.lang.startsWith("en")) ??
        voices.find((v) => v.lang.toLowerCase().startsWith("en-in"));
      if (indianVoice) return indianVoice;
    }

    if (lang === "te") {
      const teluguVoice =
        voices.find((v) => v.lang === "te-IN") ??
        voices.find((v) => v.lang.toLowerCase() === "te-in") ??
        voices.find((v) => /telugu/i.test(v.name));
      if (teluguVoice) return teluguVoice;
    }

    // Fallback: locale match then any matching lang
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix + "-in")) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
    );
  }

  /** Speak text and return a promise that resolves when utterance finishes. */
  function speakAsync(
    text: string,
    lang: SessionLanguage = "en",
    options: {
      addPauses?: boolean;
      onBoundary?: (charIndex: number) => void;
      fallbackMs?: number;
    } = {},
  ): Promise<void> {
    return new Promise((resolve) => {
      const clean = stripEmojis(text);
      if (typeof speechSynthesis === "undefined" || !clean) {
        resolve();
        return;
      }

      let settled = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer !== null) {
          clearTimeout(fallbackTimer);
        }
        resolve();
      };

      speechSynthesis.cancel();
      // Add natural pauses: insert brief pauses after commas and periods
      const spokenText =
        options.addPauses === false
          ? clean
          : clean.replace(/([,;])\s*/g, "$1 ... ").replace(/([.!?])\s+/g, "$1 ... ");
      const utt = new SpeechSynthesisUtterance(spokenText);
      utt.lang = lang === "ta" ? "ta-IN" : lang === "te" ? "te-IN" : "en-IN";
      const voice = _pickVoice(lang);
      if (voice) utt.voice = voice;
      utt.rate = lang === "ta" ? 0.72 : lang === "te" ? 0.74 : 0.78;
      utt.pitch = 1.05;
      utt.onboundary = (event) => {
        if (typeof event.charIndex !== "number") return;
        options.onBoundary?.(Math.max(0, Math.min(clean.length, event.charIndex)));
      };
      utt.onend = finish;
      utt.onerror = finish;
      speechSynthesis.speak(utt);
      // Safety net: if onend never fires (some browsers), resolve after max duration
      const maxMs =
        options.fallbackMs ?? Math.max(8000, spokenText.split(/\s+/).length * 1000 + 3000);
      fallbackTimer = setTimeout(finish, maxMs);
    });
  }

  function speak(text: string, lang: SessionLanguage = "en"): void {
    void speakAsync(text, lang);
  }

  function stopSpeech(): void {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  // ── MCQ Timer ──────────────────────────────────────────────────────────────
  const MCQ_TIMER_SECONDS = 12;
  let mcqTimerValue = $state(0);
  let mcqTimerRound = $state(0); // 0 = not started, 1 = first 12s, 2 = second 12s
  let mcqTimerInterval: ReturnType<typeof setInterval> | null = null;

  function startMcqTimer(): void {
    clearMcqTimer();
    mcqTimerRound = 1;
    mcqTimerValue = MCQ_TIMER_SECONDS;
    mcqTimerInterval = setInterval(() => {
      mcqTimerValue -= 1;
      if (mcqTimerValue <= 0) {
        if (mcqTimerRound === 1) {
          // First 12s expired — give a second chance
          mcqTimerRound = 2;
          mcqTimerValue = MCQ_TIMER_SECONDS;
          // Nudge speech
          speak(
            sessionLanguage === "ta"
              ? "நேரம் முடிகிறது, விரைவாக பதிலளிக்கவும்!"
              : sessionLanguage === "te"
                ? "సమయం ముగియబోతోంది, త్వరగా సమాధానం చెప్పండి!"
              : "Time is running out, please answer quickly!",
            sessionLanguage,
          );
        } else {
          // Second 12s expired — auto-reveal answer
          clearMcqTimer();
          _autoRevealAnswer();
        }
      }
    }, 1000);
  }

  function clearMcqTimer(): void {
    if (mcqTimerInterval !== null) {
      clearInterval(mcqTimerInterval);
      mcqTimerInterval = null;
    }
    mcqTimerRound = 0;
  }

  /** Auto-reveal answer when student doesn't respond in time */
  function _autoRevealAnswer(): void {
    if (!currentQ || phase !== "session" || answerPhase !== "ask") return;
    // Mark as incorrect / unanswered
    submittedOption = null;
    lastCorrect = false;
    answered = [...answered, { studentIdx: currentQ.student, correct: false }];
    sessionAttempts = [
      ...sessionAttempts,
      {
        studentIdx: currentQ.student,
        question: currentQ.q,
        selectedOption:
          sessionLanguage === "ta"
            ? "பதில் இல்லை (நேரம் முடிந்தது)"
            : sessionLanguage === "te"
              ? "సమాధానం లేదు (సమయం ముగిసింది)"
              : "No answer (timed out)",
        correctOption: currentQ.options[currentQ.answerIndex] ?? "",
        correct: false,
        explain: currentQ.explain,
      },
    ];
    answerPhase = "feedback";
    feedbackTitle =
      sessionLanguage === "ta" ? "நேரம் முடிந்தது" : sessionLanguage === "te" ? "సమయం ముగిసింది" : "Time Up";
    feedbackDetail =
      sessionLanguage === "ta"
        ? `சரியான விடை: ${currentQ.options[currentQ.answerIndex]}. ${currentQ.explain}`
        : sessionLanguage === "te"
          ? `సరైన సమాధానం: ${currentQ.options[currentQ.answerIndex]}. ${currentQ.explain}`
          : `Correct answer: ${currentQ.options[currentQ.answerIndex]}. ${currentQ.explain}`;
  }

  // Speak question + options, then start timer when MCQ begins
  $effect(() => {
    if (phase === "session" && currentQ && answerPhase === "ask") {
      clearMcqTimer();
      mcqTimerValue = 0;
      const gen = ++mcqTtsGeneration;
      const student = students[currentQ.student];
      const prefix = student ? `${student.name}, ` : "";
      const optionsText = currentQ.options
        .map((opt, i) => `${OPTION_LABELS[i]}, ${opt}`)
        .join(". ");
      const fullText = `${prefix}${currentQ.q}. ... ${optionsText}`;
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
          : sessionLanguage === "te"
            ? `సరైన సమాధానం! ${currentQ.explain}`
          : `That's right! ${currentQ.explain}`;
      } else {
        const correctOpt = currentQ.options[currentQ.answerIndex] ?? "";
        msg = sessionLanguage === "ta"
          ? `தவறான பதில். சரியான விடை: ${correctOpt}. ${currentQ.explain}`
          : sessionLanguage === "te"
            ? `తప్పు సమాధానం. సరైన సమాధానం: ${correctOpt}. ${currentQ.explain}`
          : `Not quite. The correct answer is: ${correctOpt}. ${currentQ.explain}`;
      }
      void speakAsync(msg, sessionLanguage, {
        fallbackMs: Math.max(15000, stripEmojis(msg).split(/\s+/).length * 1300 + 5000),
      }).then(() => {
        if (phase === "session" && answerPhase === "feedback") {
          if (qIdx >= questionPlan.length - 1) {
            next();
            return;
          }

          autoAdvanceTimer = setTimeout(() => {
            if (phase === "session" && answerPhase === "feedback") next();
          }, 1500);
        }
      });
    }
  });

  onMount(() => {
    syncTabletStudentShell();
    window.addEventListener("resize", syncTabletStudentShell);

    return () => {
      window.removeEventListener("resize", syncTabletStudentShell);
    };
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
<div
  class={useTabletStudentShell
    ? "fixed inset-0 z-50 flex flex-col overflow-hidden"
    : "hidden h-full flex-col gap-4 overflow-hidden px-8 py-5 md:flex"}
>

  {#if !useTabletStudentShell}
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
  {/if}

  <div
    class={useTabletStudentShell ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 rounded-[28px] p-3.5"}
    style={useTabletStudentShell
      ? ""
      : "background:#0b0d14; box-shadow:0 40px 80px -30px rgba(13,17,29,0.45),0 0 0 1px #1b1d28 inset;"}
  >
    <div
      class={useTabletStudentShell
        ? "flex h-full w-full flex-col overflow-hidden"
        : "flex h-full w-full flex-col overflow-hidden rounded-2xl"}
      style="background:var(--ivory);"
    >

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
              <!-- Class selector: disabled if no topic set for that class -->
              <div class="flex flex-wrap justify-center gap-1.5">
                {#each CLASSES as c (c.id)}
                  {@const hasTopic = reteachTopics.getSelectedTopic(c.id) !== null}
                  <button
                    type="button"
                    onclick={() => pickStartClass(c.id)}
                    disabled={!hasTopic}
                    class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-35 disabled:cursor-not-allowed"
                    style="{startClassId === c.id
                      ? `background:${c.color}18;border-color:${c.color};color:${c.color};`
                      : 'background:white;border-color:var(--border-default);color:var(--text-secondary);'}"
                  >
                    <span class="inline-block size-1.5 rounded-full" style="background:{c.color};"></span>
                    {c.name}
                  </button>
                {/each}
              </div>

              {#if startClassId === null}
                <div class="text-[16px] font-semibold" style="color:var(--ink);">Select a class to begin</div>
                <div class="text-[13px]" style="color:var(--text-secondary);">
                  Choose a class above, then start the session for that class.
                </div>
              {:else if topic}
                <div
                  class="flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-medium"
                  style="background:{accent}18; color:{accent};"
                >
                  {cls?.name ?? "Class"}
                </div>
                <div
                  class="max-w-120 text-[28px] font-semibold leading-tight tracking-tight"
                  style="color:var(--ink); text-wrap:balance;"
                >
                  {topic.topic}
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
              {:else}
                <div class="text-[18px] font-semibold" style="color:var(--ink);">No topic set for {cls?.name ?? "this class"}</div>
                <div class="text-[13px]" style="color:var(--text-secondary);">
                  Go to Topic Picker to select a topic for this class first.
                </div>
                <button
                  type="button"
                  onclick={() => goto(resolve("/student/topic"))}
                  class="flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold text-white"
                  style="background:{accent};"
                >
                  Go to Topic Picker <ArrowRight class="size-4" />
                </button>
              {/if}
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
                Generating the summary and MCQ questions together. This may take a moment.
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 animate-bounce rounded-full" style="background:{accent};"></div>
                <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.1s;"></div>
                <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.2s;"></div>
              </div>
            </div>

          {:else if phase === "ready"}
            {#if summaryError || questionPlan.length === 0}
              <div class="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-10 text-center">
                <div class="text-[48px]">⚠️</div>
                <div class="text-[24px] font-semibold" style="color:var(--ink);">
                  Could not prepare this topic
                </div>
                <div class="max-w-110 text-[14px] leading-[1.7]" style="color:var(--text-secondary);">
                  {summaryError || "The summary or MCQ questions could not be prepared."}
                </div>
                <div class="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onclick={startSession}
                    class="flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold text-white"
                    style="background:{accent};"
                  >
                    Retry <RotateCcw class="size-4" />
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
            {/if}

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
                    {@const summaryHighlight = getSummaryHighlightParts(line, i)}
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
                          {#if summaryHighlight}
                            <span style="opacity:0.46;">{summaryHighlight.before}</span>
                            <span
                              class="rounded-lg px-1 py-0.5"
                              style="background:{accent}24; box-shadow:0 0 0 1px {accent}18;"
                            >
                              {summaryHighlight.active}
                            </span>
                            <span>{summaryHighlight.after}</span>
                          {:else}
                            {enrichWithEmojis(line)}
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                  <button
                    type="button"
                    onclick={skipSummary}
                    disabled={!canSkipSummary}
                    title={!canSkipSummary ? "Skip is available after MCQs are ready." : undefined}
                    class="mt-2 rounded-xl px-4 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                    style={canSkipSummary
                      ? `color:${accent}; background:${accent}12;`
                      : "color:rgba(100,116,139,0.65); background:rgba(148,163,184,0.12);"}
                  >
                    Skip to MCQ
                  </button>
                {/if}
              </div>
            </div>

          {:else if questionPlan.length === 0}
            <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div class="text-[24px]">⚠️</div>
              <div class="text-[20px] font-semibold" style="color:var(--ink);">
                Could not prepare this topic
              </div>
              <div class="max-w-120 text-[13px] leading-relaxed" style="color:var(--text-secondary);">
                {summaryError || "The summary or MCQ questions could not be prepared."}
              </div>
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
                <Pill tone="success">Round {plannedRounds} of {plannedRounds}</Pill>
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
                        style="width:{Math.round((mcqTimerValue / MCQ_TIMER_SECONDS) * 100)}%; background:{mcqTimerValue <= 3 ? '#ef4444' : mcqTimerRound === 2 ? '#f59e0b' : accent};"
                      ></div>
                    </div>
                    <span
                      class="text-[14px] font-bold tabular-nums"
                      style="color:{mcqTimerValue <= 3 ? '#ef4444' : mcqTimerRound === 2 ? '#f59e0b' : accent};"
                    >
                      {mcqTimerValue}s
                    </span>
                    {#if mcqTimerRound === 2}
                      <span class="text-[10px] font-semibold uppercase" style="color:#f59e0b;">Last chance</span>
                    {/if}
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
                        {sessionLanguage === "ta"
                          ? "சரியான பதில்! "
                          : sessionLanguage === "te"
                            ? "సరైన సమాధానం! "
                            : "That's right! "}
                      </div>
                    {:else}
                      <XCircle class="size-5" style="color:#dc2626;" />
                      <div class="text-[15px] font-bold" style="color:#dc2626;">
                        {sessionLanguage === "ta"
                          ? "தவறான பதில்."
                          : sessionLanguage === "te"
                            ? "తప్పు సమాధానం."
                            : "Not quite."}
                      </div>
                    {/if}
                  </div>
                  {#if !lastCorrect}
                    <div class="mb-2.5 ml-7 rounded-xl border-l-4 bg-white px-3 py-2.5" style="border-color:#22c55e;">
                      <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style="color:#15803d;">
                        {sessionLanguage === "ta"
                          ? "சரியான விடை"
                          : sessionLanguage === "te"
                            ? "సరైన సమాధానం"
                            : "Correct answer"}
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
                      {sessionLanguage === "ta"
                        ? "ஏன்? "
                        : sessionLanguage === "te"
                          ? "ఎందుకు? "
                          : "Why? "}{currentQ?.explain ?? ""}
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
              {topic?.source === "custom" ? "Custom topic (class-level)" : "Class topic (textbook)"}
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
              <div bind:this={desktopSummarySidebarEl} class="mt-3 flex-1 overflow-y-auto pr-1">
                {#if summaryImages.length > 0}
                  <div class="mb-2 flex gap-2 overflow-x-auto pb-1">
                    {#each summaryImages.slice(0, 3) as img, i (`sidebar-img-${i}`)}
                      <div class="w-18 shrink-0">
                        <img
                          src={img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`}
                          alt={summaryDiagramCaptions[i] || `Textbook image ${i + 1}`}
                          class="h-14 w-18 rounded-lg object-cover border"
                          style="border-color:#e8dfc8;"
                        />
                        {#if summaryDiagramCaptions[i]}
                          <div class="mt-1 text-[9px] leading-[1.35]" style="color:var(--text-secondary);">
                            {summaryDiagramCaptions[i]}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                <div class="text-[12px] leading-[1.7]" style="color:var(--text-body);">
                  {#each visibleSummaryLines as line, i (i)}
                    {@const dialogue = isDialogueLine(line)}
                    {@const summaryHighlight = getSummaryHighlightParts(line, i)}
                    {#if dialogue}
                      <div class="my-1.5 rounded-lg px-2.5 py-1.5 text-[11px]" style="background:{dialogue.side === 'left' ? '#f0f7ff' : '#f0fdf4'};">
                        <span class="font-bold" style="color:{dialogue.side === 'left' ? '#2569c7' : '#15803d'};">{dialogue.speaker}:</span>
                        {dialogue.text}
                      </div>
                    {:else}
                      <p
                        class="mb-1.5"
                        style="color:{phase === 'summarizing' && summaryIdx === i ? 'var(--ink)' : phase === 'summarizing' && i < summaryIdx ? '#999' : 'var(--text-body)'}; font-weight:{phase === 'summarizing' && summaryIdx === i ? 500 : 400};"
                      >
                        {#if summaryHighlight}
                          <span style="opacity:0.46;">{summaryHighlight.before}</span>
                          <span
                            class="rounded px-1 py-0.5"
                            style="background:{accent}24; box-shadow:0 0 0 1px {accent}18;"
                          >
                            {summaryHighlight.active}
                          </span>
                          <span>{summaryHighlight.after}</span>
                        {:else}
                          {enrichWithEmojis(line)}
                        {/if}
                      </p>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}

            {#if phase === "summarizing" && !summaryLoading}
              <button
                type="button"
                onclick={skipSummary}
                disabled={!canSkipSummary}
                title={!canSkipSummary ? "Skip is available after MCQs are ready." : undefined}
                class="mt-3 shrink-0 rounded-xl px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                style={canSkipSummary
                  ? `background:${accent}12; color:${accent};`
                  : "color:rgba(100,116,139,0.65); background:rgba(148,163,184,0.12);"}
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
                Up to {QUESTIONS_PER_STUDENT} questions each for {students.length} students.
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
            Round <strong style="color:var(--ink);">{roundNum}</strong> of {plannedRounds}
          </span>
        </div>
        <div class="flex-1"></div>
        <button
          type="button"
          onclick={startOver}
          class="flex cursor-pointer items-center gap-1.5 text-[12px] transition-opacity hover:opacity-60"
          style="color:#ef4444;"
        >
          <RotateCcw class="size-3" /> Restart
        </button>
        <!-- <button
          type="button"
          onclick={() => goto(resolve("/alert"))}
          class="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium transition-opacity hover:opacity-70"
          style="color:#ef4444;"
        >
          <Phone class="size-3" /> Call teacher
        </button> -->
      </div>

    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════
     MOBILE / TABLET (below md): full-screen student view
     ═══════════════════════════════════════════════════ -->
<div class="fixed inset-0 z-50 flex flex-col md:hidden" style="background:#0b0d14;">

  {#if phase === "start"}
    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <!-- Class selector: disabled if no topic set for that class -->
      <div class="flex flex-wrap justify-center gap-1.5">
        {#each CLASSES as c (c.id)}
          {@const hasTopic = reteachTopics.getSelectedTopic(c.id) !== null}
          <button
            type="button"
            onclick={() => pickStartClass(c.id)}
            disabled={!hasTopic}
            class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-35 disabled:cursor-not-allowed"
            style="{startClassId === c.id
              ? `background:${c.color}33;border-color:${c.color};color:${c.color};`
              : 'background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.18);color:rgba(255,255,255,0.55);'}"
          >
            <span class="inline-block size-1.5 rounded-full" style="background:{c.color};"></span>
            {c.name}
          </button>
        {/each}
      </div>

      {#if startClassId === null}
        <div class="text-[18px] font-semibold text-white">Select a class to begin</div>
        <div class="text-[14px]" style="color:rgba(255,255,255,0.45);">
          Choose a class above to see its topic.
        </div>
      {:else if topic}
        <div
          class="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium"
          style="background:{accent}22; color:{accent};"
        >
          {cls?.name ?? "Class"}
        </div>
        <div
          class="text-[26px] font-semibold leading-tight tracking-tight text-white"
          style="text-wrap:balance;"
        >
          {topic.topic}
        </div>
        <div class="text-[14px]" style="color:rgba(255,255,255,0.45);">
          Short summary first, then four-option MCQs. Tap one option to answer.
        </div>
        <button
          type="button"
          onclick={startSession}
          class="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl px-12 py-4 text-[18px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style="background:{accent}; box-shadow:0 16px 40px -12px {accent}88;"
        >
          🧠 Start Thinking <Sparkles class="size-5" />
        </button>
      {:else}
        <div class="text-[18px] font-semibold text-white">No topic set for {cls?.name ?? "this class"}</div>
        <div class="text-[14px]" style="color:rgba(255,255,255,0.45);">
          Go to Topic Picker to select a topic first.
        </div>
        <button
          type="button"
          onclick={() => goto(resolve("/student/topic"))}
          class="flex cursor-pointer items-center gap-2 rounded-2xl px-6 py-3 text-[14px] font-semibold text-white"
          style="background:{accent};"
        >
          Go to Topic Picker <ArrowRight class="size-4" />
        </button>
      {/if}
    </div>

  {:else if phase === "preloading"}
    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div class="animate-pulse text-[48px]">🧠</div>
      <div class="text-[24px] font-semibold text-white">AI is thinking...</div>
      <div class="text-[14px]" style="color:rgba(255,255,255,0.5);">
        Generating the summary and MCQ questions together.
      </div>
      <div class="flex items-center gap-2">
        <div class="size-2 animate-bounce rounded-full" style="background:{accent};"></div>
        <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.1s;"></div>
        <div class="size-2 animate-bounce rounded-full" style="background:{accent}; animation-delay:0.2s;"></div>
      </div>
    </div>

  {:else if phase === "ready"}
    {#if summaryError || questionPlan.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div class="text-[48px]">⚠️</div>
        <div class="text-[24px] font-semibold text-white">Could not prepare this topic</div>
        <div class="text-[14px] max-w-sm leading-[1.7]" style="color:rgba(255,255,255,0.58);">
          {summaryError || "The summary or MCQ questions could not be prepared."}
        </div>
        <button
          type="button"
          onclick={startSession}
          class="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl px-10 py-4 text-[17px] font-semibold text-white"
          style="background:{accent}; box-shadow:0 16px 40px -12px {accent}88;"
        >
          Retry <RotateCcw class="size-5" />
        </button>
      </div>
    {:else}
      <div class="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div class="text-[48px]">✅</div>
        <div class="text-[24px] font-semibold text-white">Ready!</div>
        <div class="text-[14px]" style="color:rgba(255,255,255,0.55);">
          {summaryLines.length} sections and {questionPlan.length} questions are ready.
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
    {/if}

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
            {@const summaryHighlight = getSummaryHighlightParts(line, i)}
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
                  {#if summaryHighlight}
                    <span style="opacity:0.46;">{summaryHighlight.before}</span>
                    <span
                      class="rounded-lg px-1 py-0.5"
                      style="background:{accent}24; box-shadow:0 0 0 1px {accent}18;"
                    >
                      {summaryHighlight.active}
                    </span>
                    <span>{summaryHighlight.after}</span>
                  {:else}
                    {enrichWithEmojis(line)}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
          <button
            type="button"
            onclick={skipSummary}
            disabled={!canSkipSummary}
            title={!canSkipSummary ? "Skip is available after MCQs are ready." : undefined}
            class="mt-2 rounded-xl px-4 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            style={canSkipSummary
              ? `color:${accent}; background:white;`
              : "color:rgba(100,116,139,0.65); background:rgba(255,255,255,0.68);"}
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
        {totalQuestionCount} questions are finished. The round has stopped, and {struggleCount} student{struggleCount === 1 ? "" : "s"} may need a closer look.
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2.5">
        <div class="rounded-full px-3 py-1.5 text-[12px] font-semibold" style="background:white; color:{accent};">
          {totalQuestionCount} of {totalQuestionCount} done
        </div>
        <div class="rounded-full px-3 py-1.5 text-[12px] font-semibold" style="background:{accent}22; color:white;">
          Round {plannedRounds} of {plannedRounds}
        </div>
      </div>
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
        {#if questionPlan.length === 0}
          <div class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div class="text-[24px]">⚠️</div>
            <div class="text-[18px] font-semibold" style="color:var(--ink);">Could not prepare this topic</div>
            <div class="text-[13px]" style="color:var(--text-secondary);">
              {summaryError || "The summary or MCQ questions could not be prepared."}
            </div>
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
                    <div class="w-16 shrink-0">
                      <img
                        src={img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`}
                        alt={summaryDiagramCaptions[i] || `Textbook image ${i + 1}`}
                        class="h-12 w-16 rounded-lg object-cover border"
                        style="border-color:#f3d49a;"
                      />
                      {#if summaryDiagramCaptions[i]}
                        <div class="mt-1 text-[9px] leading-[1.3]" style="color:var(--text-secondary);">
                          {summaryDiagramCaptions[i]}
                        </div>
                      {/if}
                    </div>
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
                    style="width:{Math.round((mcqTimerValue / MCQ_TIMER_SECONDS) * 100)}%; background:{mcqTimerValue <= 3 ? '#ef4444' : mcqTimerRound === 2 ? '#f59e0b' : accent};"
                  ></div>
                </div>
                <span
                  class="text-[14px] font-bold tabular-nums"
                  style="color:{mcqTimerValue <= 3 ? '#ef4444' : mcqTimerRound === 2 ? '#f59e0b' : accent};"
                >
                  {mcqTimerValue}s
                </span>
                {#if mcqTimerRound === 2}
                  <span class="text-[10px] font-semibold uppercase" style="color:#f59e0b;">Last chance</span>
                {/if}
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
                    {sessionLanguage === "ta"
                      ? "சரியான பதில்! "
                      : sessionLanguage === "te"
                        ? "సరైన సమాధానం! "
                        : "That's right! "}
                  </div>
                {:else}
                  <XCircle class="size-5" style="color:#dc2626;" />
                  <div class="text-[15px] font-bold" style="color:#dc2626;">
                    {sessionLanguage === "ta"
                      ? "தவறான பதில்."
                      : sessionLanguage === "te"
                        ? "తప్పు సమాధానం."
                        : "Not quite."}
                  </div>
                {/if}
              </div>
              {#if !lastCorrect}
                <div class="mb-2.5 ml-7 rounded-xl border-l-4 bg-white px-3 py-2.5" style="border-color:#22c55e;">
                  <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style="color:#15803d;">
                    {sessionLanguage === "ta"
                      ? "சரியான விடை"
                      : sessionLanguage === "te"
                        ? "సరైన సమాధానం"
                        : "Correct answer"}
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
                  {sessionLanguage === "ta"
                    ? "ஏன்? "
                    : sessionLanguage === "te"
                      ? "ఎందుకు? "
                      : "Why? "}{currentQ?.explain ?? ""}
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
