<script lang="ts">
  import { goto } from "$app/navigation";
  import { ArrowRight, Mic, RotateCcw, BookOpen, Pencil, Phone } from "lucide-svelte";
  import { Button } from "@shadcn";
  import { Pill } from "@components";
  import { SOCRATIC_QUESTIONS, STUDENTS_BY_CLASS, CLASSES } from "@mocks";
  import { activeClass, reteachTopics } from "@stores";

  const cls = $derived(CLASSES.find((c) => c.id === activeClass.id));
  const students = $derived(STUDENTS_BY_CLASS[activeClass.id] ?? STUDENTS_BY_CLASS[3]);
  const topic = $derived(reteachTopics.selectedTopic);

  type Phase = "start" | "summarizing" | "session";
  let phase = $state<Phase>("start");

  let qIdx = $state(0);
  let answered = $state<{ studentIdx: number; correct: boolean }[]>([]);
  let answerPhase = $state<"ask" | "feedback">("ask");
  let lastCorrect = $state(true);
  let selectedCard = $state<number | null>(null);
  let showHint = $state(false);

  let summaryLines = $state<string[]>([]);
  let summaryIdx = $state(0);
  let summaryLoading = $state(false);

  const currentQ = $derived(SOCRATIC_QUESTIONS[qIdx % SOCRATIC_QUESTIONS.length]);
  const activeStudent = $derived(students[currentQ?.student ?? 0]);
  const nextStudent = $derived(students[((currentQ?.student ?? 0) + 1) % students.length]);
  const correctCount = $derived(answered.filter((a) => a.correct).length);
  const roundNum = $derived(Math.floor(qIdx / students.length) + 1);
  const progressStep = $derived((qIdx % 4) + 1);

  const failCounts = $derived(
    students.map((_, si) => answered.filter((a) => a.studentIdx === si && !a.correct).length),
  );

  function getBestVoice(): SpeechSynthesisVoice | null {
    if (typeof speechSynthesis === "undefined") return null;
    const voices = speechSynthesis.getVoices();
    // Prefer natural-sounding voices; order matters
    const preferred = ["Samantha", "Google US English", "Karen", "Moira", "Allison", "Alex"];
    for (const name of preferred) {
      const v = voices.find((v) => v.name.includes(name) && v.lang.startsWith("en"));
      if (v) return v;
    }
    return (
      voices.find((v) => v.lang === "en-US" && !v.name.toLowerCase().includes("google")) ??
      voices.find((v) => v.lang === "en-US") ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null
    );
  }

  function speak(text: string, onEnd?: () => void): void {
    if (typeof speechSynthesis === "undefined") {
      onEnd?.();
      return;
    }
    speechSynthesis.cancel();
    // Small delay lets voices initialise on first load
    setTimeout(() => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = 0.85;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      const voice = getBestVoice();
      if (voice) utter.voice = voice;
      if (onEnd) utter.onend = () => onEnd();
      speechSynthesis.speak(utter);
    }, 80);
  }

  function cancelSpeech(): void {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  function revealLine(idx: number): void {
    if (idx >= summaryLines.length) {
      setTimeout(() => {
        phase = "session";
        if (activeStudent) speak(`${activeStudent.name}, it's your turn.`);
      }, 900);
      return;
    }
    summaryIdx = idx;
    speak(summaryLines[idx], () => setTimeout(() => revealLine(idx + 1), 450));
  }

  function fallbackLines(): string[] {
    return [
      `Today we are revisiting "${topic?.topic ?? "this topic"}".`,
      `This is part of your ${topic?.subject ?? "Science"} subject — key ideas you learned earlier.`,
      "Listen carefully. I will ask each of you one question.",
    ];
  }

  async function fetchSummary(): Promise<void> {
    summaryLoading = true;
    try {
      const res = await fetch("/api/socratic/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic?.topic ?? "this topic",
          subject: topic?.subject ?? "Science",
          source: topic?.source ?? "standard",
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { lines: string[] };
        summaryLines = data.lines?.length > 0 ? data.lines : fallbackLines();
      } else {
        summaryLines = fallbackLines();
      }
    } catch {
      summaryLines = fallbackLines();
    }
    summaryLoading = false;
  }

  async function startSession(): Promise<void> {
    phase = "summarizing";
    summaryIdx = 0;
    cancelSpeech();
    await fetchSummary();
    revealLine(0);
  }

  function startOver(): void {
    cancelSpeech();
    phase = "start";
    qIdx = 0;
    answered = [];
    answerPhase = "ask";
    summaryIdx = 0;
    summaryLines = [];
    selectedCard = null;
    showHint = false;
  }

  function submit(correct: boolean): void {
    lastCorrect = correct;
    answered = [...answered, { studentIdx: currentQ.student, correct }];
    answerPhase = "feedback";
    if (correct) speak(`Beautifully put, ${activeStudent?.name}. That is exactly right!`);
    else speak(`Good thinking, ${activeStudent?.name}. Let us explore this a little more.`);
  }

  function next(): void {
    cancelSpeech();
    answerPhase = "ask";
    selectedCard = null;
    showHint = false;
    qIdx += 1;
    const ns = students[SOCRATIC_QUESTIONS[qIdx % SOCRATIC_QUESTIONS.length]?.student ?? 0];
    if (ns) setTimeout(() => speak(`${ns.name}, it's your turn.`), 300);
  }

  function repeatQuestion(): void {
    if (phase === "session" && currentQ) speak(currentQ.q);
  }

  const accent = $derived(cls?.color ?? "#6B94E7");
</script>

<!-- ═══════════════════════════════════════════════════
     DESKTOP (md+): full viewport layout
     ═══════════════════════════════════════════════════ -->
<div class="hidden md:flex h-full flex-col overflow-hidden px-8 py-5 gap-4">

  <!-- Teacher header above tablet -->
  <div class="mb-2 flex shrink-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      <div class="label-eyebrow text-saffron-600">
        Student view · Socratic mode · {cls?.name ?? "Class"}
      </div>
      <div class="page-title mt-1">Turn by turn, one voice at a time</div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Pill tone="cobalt">Question {progressStep} of 4</Pill>
      <Button variant="secondary" onclick={() => goto("/alert")}>
        See teacher alert <ArrowRight class="size-3.5" />
      </Button>
    </div>
  </div>

  <!-- Tablet shell -->
  <div
    class="min-h-0 flex-1 rounded-[28px] p-3.5"
    style="background:#0b0d14; box-shadow:0 40px 80px -30px rgba(13,17,29,0.45),0 0 0 1px #1b1d28 inset;"
  >
    <div class="flex h-full w-full flex-col overflow-hidden rounded-2xl" style="background:var(--ivory);">

      <!-- ── Tablet header bar ── -->
      <div
        class="flex shrink-0 items-center gap-3 border-b px-5 py-3"
        style="border-color:var(--border-default);"
      >
        <!-- Class badge -->
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
            Lesson {roundNum} · {topic?.subject ?? "Science"} · {cls?.name ?? "Class 3"}
          </div>
        </div>
        <!-- Progress pills -->
        <div class="flex shrink-0 items-center gap-2">
          <div class="flex items-center gap-1">
            {#each [0, 1, 2, 3] as i (i)}
              <div
                class="rounded-full transition-all duration-300"
                style="height:8px; width:{i < progressStep ? '20px' : '8px'}; background:{i < progressStep ? accent : '#e5e1d8'};"
              ></div>
            {/each}
          </div>
          <span class="text-[12px] font-medium tabular-nums" style="color:var(--text-secondary);">
            {progressStep} / 4
          </span>
        </div>
      </div>

      <!-- ── Main 3-column area ── -->
      <div class="grid min-h-0 flex-1 grid-cols-[1fr_262px_188px]">

        <!-- ── Left: question / start / summary ── -->
        <div class="flex flex-col overflow-hidden">

          {#if phase === "start"}
            <!-- Start state: topic info + begin button -->
            <div class="flex flex-1 flex-col items-center justify-center gap-5 px-10 py-10 text-center">
              <div
                class="flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-medium"
                style="background:{accent}18; color:{accent};"
              >
                {#if topic?.source === "custom"}<Pencil class="size-3" />{:else}<BookOpen class="size-3" />{/if}
                {topic?.subject ?? "Science"}
              </div>
              <div
                class="max-w-120 text-[28px] font-semibold leading-tight tracking-tight"
                style="color:var(--ink); text-wrap:balance;"
              >
                {topic?.topic ?? "Today's reteach"}
              </div>
              <div class="text-[14px]" style="color:var(--text-secondary);">
                AI reads a short summary first, then asks each student one question.
              </div>
              <button
                type="button"
                onclick={startSession}
                class="mt-1 flex cursor-pointer items-center gap-3 rounded-2xl px-10 py-4 text-[17px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style="background:{accent}; box-shadow:0 14px 36px -10px {accent}66;"
              >
                Begin session <ArrowRight class="size-5" />
              </button>
              <button
                type="button"
                onclick={() => goto("/student/topic")}
                class="cursor-pointer text-[11px] underline underline-offset-2"
                style="color:var(--text-tertiary);"
              >
                ← Choose a different topic
              </button>
            </div>

          {:else if phase === "summarizing"}
            <!-- Summary streaming -->
            <div class="flex flex-1 flex-col justify-center gap-5 px-10 py-8">
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
                {summaryLoading ? "AI is thinking…" : "AI is reading the summary…"}
              </div>
              <div class="max-w-145">
                {#if summaryLoading}
                  <div class="text-[16px]" style="color:var(--text-secondary);">
                    <span class="animate-pulse">…</span>
                  </div>
                {:else}
                  {#each summaryLines.slice(0, summaryIdx + 1) as line, i (i)}
                    <div
                      class="mb-3 text-[20px] font-medium leading-relaxed transition-opacity duration-500"
                      style="color:var(--ink); opacity:{summaryIdx - i > 0 ? 0.38 : 1};"
                    >
                      {line}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>

          {:else}
            <!-- Session: student turn + question + answer -->
            <div class="flex flex-1 flex-col overflow-y-auto p-7 pb-5">

              <!-- Student chip -->
              <div
                class="bg-saffron-50 border-saffron-100 mb-6 inline-flex shrink-0 items-center gap-2.5 self-start rounded-full border px-3.5 py-2"
              >
                <span class="text-[18px]">{activeStudent?.emoji ?? "👤"}</span>
                <span class="text-saffron-700 text-[13.5px] font-semibold">
                  {activeStudent?.name ?? "Student"}, it's your turn.
                </span>
                <span class="text-saffron-600 text-[11px]">· உங்கள் முறை</span>
              </div>

              <!-- Question text -->
              <div
                class="text-ink max-w-155 flex-1 text-[22px] font-medium leading-[1.42] tracking-[-0.01em] md:text-[25px]"
                style="text-wrap:pretty;"
              >
                {currentQ?.q}
              </div>

              <!-- Hint toggle -->
              {#if !showHint}
                <button
                  type="button"
                  onclick={() => (showHint = true)}
                  class="mt-4 flex cursor-pointer items-center gap-1.5 self-start text-[12px] transition-opacity hover:opacity-70"
                  style="color:var(--text-tertiary);"
                >
                  <span class="text-[13px]">✨</span> Need a hint?
                </button>
              {:else}
                <div
                  class="mt-4 rounded-xl px-4 py-3 text-[13px]"
                  style="background:{accent}10; color:{accent}; border:1px solid {accent}30;"
                >
                  💡 {currentQ?.expect ?? "Think about what plants use sunlight for."}
                </div>
              {/if}

              {#if answerPhase === "ask"}
                <!-- Mic area -->
                <div
                  class="mt-5 flex shrink-0 items-center gap-4 rounded-2xl p-4"
                  style="border:2px dashed #5bc5b8; background:#f0fdfc;"
                >
                  <button
                    type="button"
                    class="relative grid size-[72px] shrink-0 cursor-pointer place-items-center rounded-full transition-all hover:scale-105 active:scale-95"
                    style="background:linear-gradient(135deg,#2dd4bf,#0891b2); box-shadow:0 10px 30px -8px #2dd4bf88;"
                  >
                    <Mic class="size-7 text-white" />
                  </button>
                  <div class="flex-1">
                    <div class="text-[14.5px] font-semibold" style="color:var(--ink);">
                      Tap and speak your answer
                    </div>
                    <div class="mt-0.5 text-[12.5px]" style="color:var(--text-secondary);">
                      Say it in Tamil or English — in your own words, {activeStudent?.name ?? "friend"}.
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      type="button"
                      onclick={() => submit(false)}
                      class="cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5"
                      style="color:var(--text-tertiary);"
                    >
                      Demo: wrong
                    </button>
                    <button
                      type="button"
                      onclick={() => submit(true)}
                      class="cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5"
                      style="color:{accent};"
                    >
                      Demo: correct
                    </button>
                  </div>
                </div>

              {:else}
                <!-- Feedback -->
                <div
                  class="mt-5 shrink-0 rounded-2xl border p-5"
                  style="{lastCorrect
                    ? 'background:#f0fdf4;border-color:#bbf7d0;'
                    : 'background:#fffbeb;border-color:#fde68a;'}"
                >
                  <div class="mb-2 flex items-center gap-2.5">
                    <span class="text-[22px]">{lastCorrect ? "🌼" : "🌿"}</span>
                    <div
                      class="text-[14px] font-semibold"
                      style="color:{lastCorrect ? '#166534' : '#92400e'};"
                    >
                      {lastCorrect
                        ? `Beautifully put, ${activeStudent?.name}.`
                        : `Close, ${activeStudent?.name} — let's think again.`}
                    </div>
                  </div>
                  <div class="pl-9 text-[13.5px] leading-[1.6]" style="color:var(--text-body);">
                    {lastCorrect
                      ? "Yes — without sunlight the plant can't make food. Leaves turn pale and it slowly wilts."
                      : "Think about what plants do with sunlight. Is a dark cupboard giving them enough?"}
                  </div>
                  <div class="mt-3.5 pl-9">
                    <button
                      type="button"
                      onclick={next}
                      class="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                      style="background:{accent};"
                    >
                      Next · {nextStudent?.name ?? "next"}
                      <ArrowRight class="size-3.5" />
                    </button>
                  </div>
                </div>
              {/if}

            </div>
          {/if}
        </div>

        <!-- ── Middle: Remember panel ── -->
        <div
          class="flex flex-col overflow-hidden border-l"
          style="border-color:var(--border-default); background:#fdfcf8;"
        >
          {#if phase === "session"}
            <div class="flex h-full flex-col overflow-hidden p-4">
              <div
                class="mb-1 shrink-0 text-[9.5px] font-semibold uppercase tracking-widest"
                style="color:#6B94E7;"
              >
                Remember — From This Morning
              </div>
              <div class="mb-3 shrink-0 text-[13px] font-semibold" style="color:var(--ink);">
                {currentQ?.rememberTitle ?? "Key concepts"}
              </div>
              <!-- Concept cards -->
              <div class="flex flex-1 flex-col gap-2 overflow-y-auto">
                {#each currentQ?.remember ?? [] as card, i (i)}
                  <button
                    type="button"
                    onclick={() => (selectedCard = selectedCard === i ? null : i)}
                    class="flex cursor-pointer items-start gap-2.5 rounded-xl p-3 text-left transition-all"
                    style="{selectedCard === i
                      ? `background:white; border:1.5px solid ${accent}; box-shadow:0 2px 10px -4px ${accent}44;`
                      : 'background:white; border:1px solid var(--border-default);'}"
                  >
                    <div
                      class="grid size-8 shrink-0 place-items-center rounded-lg text-[16px]"
                      style="background:{accent}14;"
                    >
                      {card.emoji}
                    </div>
                    <div class="min-w-0">
                      <div class="text-[12.5px] font-semibold" style="color:var(--ink);">{card.title}</div>
                      <div class="text-[11px] leading-[1.5]" style="color:var(--text-secondary);">
                        {card.detail}
                      </div>
                    </div>
                  </button>
                {/each}
              </div>
              <!-- Listen again -->
              <div
                class="mt-3 shrink-0 rounded-xl p-3"
                style="background:#eff6ff; border:1px solid #bfdbfe;"
              >
                <div class="mb-2 text-[11px] font-semibold" style="color:#1e40af;">Listen again</div>
                <div class="flex items-center gap-2">
                  <Mic class="size-3.5 shrink-0" style="color:#3b82f6;" />
                  <div class="flex flex-1 items-end gap-[2px]">
                    {#each [5, 9, 14, 8, 12, 6, 15, 10, 7, 13, 9, 11] as h, i (i)}
                      <div
                        class="rounded-sm"
                        style="width:3px; height:{h}px; background:#3b82f6; opacity:0.6;"
                      ></div>
                    {/each}
                  </div>
                  <span class="tabular-nums text-[10px]" style="color:#3b82f6;">0:42</span>
                </div>
              </div>
            </div>
          {:else}
            <!-- Placeholder when not in session -->
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <div class="text-[28px]">📖</div>
              <div class="text-[12px]" style="color:var(--text-tertiary);">
                Concept cards appear here when the session starts
              </div>
            </div>
          {/if}
        </div>

        <!-- ── Right: THE CIRCLE ── -->
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

          <!-- Next student indicator -->
          <div
            class="shrink-0 border-t p-3"
            style="border-color:var(--border-default); background:rgba(255,255,255,0.5);"
          >
            {#if phase === "session"}
              <div class="mb-1 text-[9px] uppercase tracking-widest" style="color:var(--text-tertiary);">
                Next
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[16px]">{nextStudent?.emoji ?? "👤"}</span>
                <span class="text-[12px] font-semibold" style="color:var(--ink);">
                  {nextStudent?.name ?? "—"}
                </span>
              </div>
            {:else}
              <div class="text-center text-[10px]" style="color:var(--text-secondary);">
                After all {students.length}, we cycle again.
              </div>
            {/if}
          </div>
        </div>

      </div>
      <!-- end 3-col grid -->

      <!-- ── Bottom bar ── -->
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
            Round <strong style="color:var(--ink);">{roundNum}</strong> of Socratic turns
          </span>
        </div>
        <div class="flex-1"></div>
        <button
          type="button"
          onclick={repeatQuestion}
          class="flex cursor-pointer items-center gap-1.5 text-[12px] transition-opacity hover:opacity-60"
          style="color:var(--text-secondary);"
        >
          <RotateCcw class="size-3" /> Repeat question
        </button>
        <button
          type="button"
          onclick={() => goto("/alert")}
          class="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium transition-opacity hover:opacity-70"
          style="color:#ef4444;"
        >
          <Phone class="size-3" /> Call teacher
        </button>
      </div>

    </div>
    <!-- end inner tablet -->
  </div>
  <!-- end tablet shell -->

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
        {#if topic?.source === "custom"}<Pencil class="size-3.5" />{:else}<BookOpen class="size-3.5" />{/if}
        {topic?.subject ?? "Science"}
      </div>
      <div
        class="text-[30px] font-semibold leading-tight tracking-tight text-white"
        style="text-wrap:balance;"
      >
        {topic?.topic ?? "Today's reteach"}
      </div>
      <div class="text-[16px]" style="color:rgba(255,255,255,0.4);">
        AI reads a summary, then one question per child.
      </div>
      <button
        type="button"
        onclick={startSession}
        class="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl px-12 py-4 text-[18px] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
        style="background:{accent}; box-shadow:0 16px 40px -12px {accent}88;"
      >
        Begin <ArrowRight class="size-5" />
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
        {summaryLoading ? "AI is thinking…" : "AI is reading the summary…"}
      </div>
      <div class="w-full max-w-sm text-center">
        {#if summaryLoading}
          <div class="text-[16px] text-white" style="opacity:0.5;">
            <span class="animate-pulse">…</span>
          </div>
        {:else}
          {#each summaryLines.slice(0, summaryIdx + 1) as line, i (i)}
            <div
              class="mb-4 text-[18px] font-medium leading-relaxed text-white"
              style="opacity:{summaryIdx - i > 0 ? 0.45 : 1};"
            >
              {line}
            </div>
          {/each}
        {/if}
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
        <!-- Student chip -->
        <div
          class="bg-saffron-50 border-saffron-100 mb-5 inline-flex items-center gap-2.5 self-start rounded-full border px-3.5 py-2"
        >
          <span class="text-[18px]">{activeStudent?.emoji}</span>
          <span class="text-saffron-700 text-[13px] font-semibold">
            {activeStudent?.name}, it's your turn.
          </span>
        </div>

        <div
          class="text-ink flex-1 text-[20px] font-medium leading-[1.45] tracking-tight"
          style="text-wrap:pretty;"
        >
          {currentQ?.q}
        </div>

        {#if answerPhase === "ask"}
          <div class="mt-5">
            <div
              class="flex items-center gap-3 rounded-2xl p-4"
              style="border:2px dashed #5bc5b8; background:#f0fdfc;"
            >
              <button
                type="button"
                class="grid size-[60px] shrink-0 cursor-pointer place-items-center rounded-full transition-all hover:scale-105 active:scale-95"
                style="background:linear-gradient(135deg,#2dd4bf,#0891b2); box-shadow:0 8px 24px -6px #2dd4bf88;"
              >
                <Mic class="size-6 text-white" />
              </button>
              <div class="flex-1">
                <div class="text-[13px] font-semibold" style="color:var(--ink);">
                  Tap and speak
                </div>
                <div class="text-[11px]" style="color:var(--text-secondary);">
                  Tamil or English, {activeStudent?.name}.
                </div>
              </div>
            </div>
            <div class="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onclick={() => submit(false)}
                class="cursor-pointer rounded-xl px-3 py-2 text-[12px]"
                style="color:var(--text-tertiary);"
              >
                Demo: wrong
              </button>
              <button
                type="button"
                onclick={() => submit(true)}
                class="flex cursor-pointer items-center gap-1.5 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white"
                style="background:{accent};"
              >
                Demo: correct
              </button>
            </div>
          </div>
        {:else}
          <div
            class="mt-5 rounded-2xl border p-4"
            style="{lastCorrect
              ? 'background:#f0fdf4;border-color:#bbf7d0;'
              : 'background:#fffbeb;border-color:#fde68a;'}"
          >
            <div class="mb-2 flex items-center gap-2">
              <span class="text-[20px]">{lastCorrect ? "🌼" : "🌿"}</span>
              <div
                class="text-[14px] font-semibold"
                style="color:{lastCorrect ? '#166534' : '#92400e'};"
              >
                {lastCorrect ? `Beautifully put, ${activeStudent?.name}.` : `Close — let's think again.`}
              </div>
            </div>
            <div class="pl-8 text-[13px] leading-[1.6]" style="color:var(--text-body);">
              {lastCorrect
                ? "Yes — without sunlight the plant can't make food. Leaves turn pale and wilt."
                : "Think about what plants do with sunlight. Is a dark cupboard giving them enough?"}
            </div>
            <div class="mt-3 pl-8">
              <button
                type="button"
                onclick={next}
                class="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white"
                style="background:{accent};"
              >
                Next · {nextStudent?.name}
                <ArrowRight class="size-3.5" />
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Mobile student strip -->
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
  {/if}

</div>
