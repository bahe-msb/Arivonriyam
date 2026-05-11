<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { Sparkles, BookOpen, Clock, Users, RefreshCw } from "lucide-svelte";
  import { Button, Card } from "@shadcn";

  import { Page, Pill, StatusPill, Stat } from "@components";
  import { CLASSES } from "@mocks";
  import { activeClass, reteachTopics, schoolConfig, sessionAlerts } from "@stores";
  import type { LessonStatus } from "@mocks";

  // ── Types ──────────────────────────────────────────────────────────
  interface PlanEntry {
    className: string;
    subject: string;
    subjectLabel: string;
    chapter: string;
    durationMin: number;
    savedAt: string;
  }

  interface ClassCard {
    subject: string;
    topic: string;
    mins: number;
    status: LessonStatus;
  }

  interface RhythmRow {
    c: string;
    s: string;
    tone: "done" | "live" | "next" | "planned";
  }

  // ── Date/time ─────────────────────────────────────────────────────
  const classKey = (clsId: number): string => `class_${clsId}`;

  let now = $state(new Date());
  const time = $derived(
    now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  );
  const date = $derived(
    now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }),
  );

  // ── State ─────────────────────────────────────────────────────────
  let plans = $state<Record<string, PlanEntry>>({});
  let plansLoading = $state(true);

  const school = $derived(schoolConfig.config);
  const studentsByClass = $derived(schoolConfig.studentsByClass);
  const alertRecords = $derived(sessionAlerts.records);
  const teacherGreeting = $derived(
    school.teacher_name.trim() ? `வணக்கம் ${school.teacher_name}` : "வணக்கம் ஆசிரியரே",
  );
  const schoolName = $derived(school.school_name.trim() || "Arivonriyam");
  const schoolContext = $derived(
    [school.location.trim(), school.state.trim()].filter((value) => value.length > 0).join(", "),
  );
  const heroMeta = $derived(
    [schoolName, schoolContext, date, time].filter((value) => value.length > 0).join(" · "),
  );
  const studentCounts = $derived(
    Object.fromEntries(
      CLASSES.map((cls) => [cls.id, studentsByClass[cls.id]?.length ?? cls.students]),
    ) as Record<number, number>,
  );

  // ── Fetch ─────────────────────────────────────────────────────────
  async function loadPlans(): Promise<void> {
    plansLoading = true;
    try {
      const response = await fetch("/api/lesson/plan/today");
      const data = (await response.json()) as { plans?: Record<string, PlanEntry> };
      plans = data.plans ?? {};
    } catch {
      plans = {};
    } finally {
      plansLoading = false;
    }
  }

  onMount(() => {
    void loadPlans();

    const timer = window.setInterval(() => {
      now = new Date();
    }, 60_000);

    return () => window.clearInterval(timer);
  });

  // ── Derived stats ─────────────────────────────────────────────────
  const loading = $derived(
    plansLoading || schoolConfig.loading || sessionAlerts.loading || reteachTopics.loading,
  );

  const plansReady = $derived(Object.keys(plans).length);

  const classesWithAlerts = $derived(new Set(alertRecords.map((record) => record.classId)));

  const studentsPresent = $derived(new Set(alertRecords.map((record) => record.studentId)).size);

  const studentsTracked = $derived(
    Object.values(studentCounts).reduce((sum, count) => sum + count, 0),
  );

  const sessionStatValue = $derived(
    studentsPresent > 0 ? String(studentsPresent) : studentsTracked > 0 ? String(studentsTracked) : "—",
  );

  const sessionStatLabel = $derived(
    studentsPresent > 0 ? "In sessions" : studentsTracked > 0 ? "In roster" : "In sessions",
  );

  const classesReadyForHandoff = $derived(
    CLASSES.filter((cls) => Boolean(reteachTopics.getSelectedTopic(cls.id))).length,
  );

  const needsAttention = $derived(
    [...classesWithAlerts].filter((clsId) => {
      const clsAlerts = sessionAlerts.getByClass(clsId);
      const avg = clsAlerts.reduce((sum, record) => sum + record.score, 0) / clsAlerts.length;
      return avg < 70;
    }).length,
  );

  function isLiveClass(clsId: number): boolean {
    return activeClass.id === clsId && Boolean(reteachTopics.getSelectedTopic(clsId));
  }

  function completedTopicCount(clsId: number): number {
    return reteachTopics.get(clsId).filter((topic) => reteachTopics.isCompleted(topic.id)).length;
  }

  // ── Per-class card data ───────────────────────────────────────────
  function classCardData(clsId: number): ClassCard {
    const plan = plans[classKey(clsId)];
    const selectedTopic = reteachTopics.getSelectedTopic(clsId);
    const topicCount = reteachTopics.get(clsId).length;
    const completedCount = completedTopicCount(clsId);
    const hasAlerts = classesWithAlerts.has(clsId);
    const status: LessonStatus = hasAlerts ? "done" : isLiveClass(clsId) ? "in-progress" : "planned";

    if (plan) {
      return {
        subject: plan.subjectLabel || plan.subject,
        topic: plan.chapter,
        mins: plan.durationMin || 45,
        status,
      };
    }

    if (selectedTopic) {
      return {
        subject: selectedTopic.subject,
        topic: selectedTopic.topic,
        mins: 0,
        status,
      };
    }

    if (topicCount > 0) {
      return {
        subject: "Reteach queue",
        topic: `${topicCount} topic${topicCount === 1 ? "" : "s"} prepared${completedCount > 0 ? ` · ${completedCount} done` : ""}`,
        mins: 0,
        status,
      };
    }

    return { subject: "—", topic: "No plan saved yet", mins: 0, status: "planned" };
  }

  // ── Today's rhythm ────────────────────────────────────────────────
  const rhythmRows = $derived<RhythmRow[]>(
    CLASSES.map((cls) => {
      const plan = plans[classKey(cls.id)];
      const selectedTopic = reteachTopics.getSelectedTopic(cls.id);
      const topicCount = reteachTopics.get(cls.id).length;
      const hasAlerts = classesWithAlerts.has(cls.id);
      let tone: RhythmRow["tone"] = "planned";

      if (hasAlerts) {
        tone = "done";
      } else if (isLiveClass(cls.id)) {
        tone = "live";
      } else if (selectedTopic) {
        tone = "next";
      }

      const subjectLabel =
        plan?.subjectLabel || plan?.subject || selectedTopic?.subject || (topicCount > 0 ? "Reteach" : "");

      const summary = plan
        ? plan.chapter
        : selectedTopic?.topic ||
          (topicCount > 0
            ? `${topicCount} topic${topicCount === 1 ? "" : "s"} ready for handoff`
            : "No plan saved");

      return {
        c: subjectLabel ? `${cls.name} · ${subjectLabel}` : cls.name,
        s: summary,
        tone,
      };
    }),
  );

  const totalPlans = CLASSES.length;
  const plansLabel = $derived(`${plansReady}/${totalPlans}`);

  // ── Navigation ────────────────────────────────────────────────────
  function openClass(clsId: number): void {
    activeClass.set(clsId);
    void goto("/handoff");
  }

  const toneDot: Record<string, string> = {
    live: "bg-cobalt-500",
    done: "bg-success-500",
    next: "bg-saffron-500",
    planned: "bg-gray-300",
  };
</script>

<Page>
  <!-- Hero banner -->
  <div
    class="border-clay-100 relative mb-6 overflow-hidden rounded-2xl border p-7 md:p-8"
    style="background: linear-gradient(180deg, var(--clay-50) 0%, #fff 100%);"
  >
    <svg
      width="220"
      height="220"
      viewBox="0 0 220 220"
      class="pointer-events-none absolute -top-8 -right-8 hidden opacity-[0.08] md:block"
    >
      <g fill="none" stroke="#C77700" stroke-width="1">
        {#each Array.from({ length: 8 }) as _, i}
          <circle cx="110" cy="110" r={20 + i * 12} />
        {/each}
        {#each Array.from({ length: 12 }) as _, i}
          <line
            x1="110"
            y1="110"
            x2={110 + Math.cos((i * Math.PI) / 6) * 110}
            y2={110 + Math.sin((i * Math.PI) / 6) * 110}
          />
        {/each}
      </g>
    </svg>
    <div class="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div>
        <div class="text-saffron-600 mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
          <span class="ta text-[13px] font-normal normal-case">{teacherGreeting}</span>
          <span class="mx-2 opacity-40">·</span>
          <span class="font-normal tracking-normal normal-case">{heroMeta}</span>
        </div>
        <div
          class="text-ink max-w-[620px] text-[22px] leading-[1.15] font-semibold tracking-[-0.02em] md:text-[30px]"
        >
          One classroom. Five grades.<br />
          <span class="text-saffron-600"> You don't have to hold them all alone today. </span>
        </div>
        <div class="mt-4 flex flex-wrap gap-2.5">
          <Button variant="primary" size="lg" onclick={() => goto("/lesson")}>
            <Sparkles class="size-4" /> Generate today's plan
          </Button>
          <Button variant="secondary" size="lg" onclick={() => goto("/reteach")}>
            <BookOpen class="size-4" /> Set up reteach topics
          </Button>
        </div>
      </div>
      <div class="flex gap-6 pt-1">
        {#if loading}
          <div class="flex items-center gap-2 text-[12px] text-text-secondary">
            <RefreshCw class="size-3.5 animate-spin" /> Loading…
          </div>
        {:else}
          <Stat n={sessionStatValue} label={sessionStatLabel} />
          <Stat n={plansLabel} label="Plans ready" />
          <Stat n={String(needsAttention)} label="Needs attention" warn={needsAttention > 0} />
        {/if}
      </div>
    </div>
  </div>

  <!-- Classes header -->
  <div class="mb-3.5 flex flex-wrap items-center justify-between gap-2">
    <div>
      <div class="text-text-primary text-[20px] font-semibold tracking-[-0.015em]">
        Your classroom, at a glance
      </div>
      <div class="page-subtitle">Tap a class to hand off its tablet.</div>
    </div>
    <div class="flex items-center gap-2">
      {#if !loading && plansReady === 0}
        <Pill tone="default">
          <Clock class="size-[11px]" />
          No plans saved yet
        </Pill>
      {:else}
        <Pill tone="cobalt">
          <Clock class="size-[11px]" />
          {plansReady} of {totalPlans} classes planned
        </Pill>
      {/if}
      {#if !loading && classesReadyForHandoff > 0}
        <Pill tone="saffron">
          <BookOpen class="size-[11px]" />
          {classesReadyForHandoff} class{classesReadyForHandoff === 1 ? "" : "es"} ready for handoff
        </Pill>
      {/if}
    </div>
  </div>

  <!-- Class cards -->
  <div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
    {#each CLASSES as cls (cls.id)}
      {@const card = classCardData(cls.id)}
      <Card hover class="cursor-pointer p-4">
        <button type="button" class="w-full text-left" onclick={() => openClass(cls.id)}>
          <div class="mb-3.5 flex items-center justify-between">
            <div
              class="font-tamil grid size-9 place-items-center rounded-xl text-[15px] font-bold"
              style="background: {cls.color}22; color: {cls.color};"
            >
              {cls.id}
            </div>
            <StatusPill status={card.status} />
          </div>
          <div class="text-ink text-[15px] font-semibold">{cls.name}</div>
          <div class="ta text-text-secondary mt-0.5 text-[11px]">{cls.ta}</div>
          <div class="border-border-default my-3.5 border-t"></div>
          {#if loading}
            <div class="h-3 w-16 animate-pulse rounded bg-gray-100"></div>
            <div class="mt-1.5 h-4 w-full animate-pulse rounded bg-gray-100"></div>
          {:else}
            <div class="label-eyebrow text-[10px]">{card.subject}</div>
            <div class="mt-0.5 text-[13px] leading-[1.35] font-medium">{card.topic}</div>
          {/if}
          <div class="mt-3 flex items-center justify-between">
            <span class="text-text-secondary inline-flex items-center gap-1 text-[11px]">
              <Users class="size-[11px]" />
              {studentCounts[cls.id]} students
            </span>
            {#if !loading && card.mins > 0}
              <span class="text-text-secondary text-[11px]">{card.mins}m</span>
            {/if}
          </div>
        </button>
      </Card>
    {/each}
  </div>

  <!-- Today's rhythm -->
  <div class="mt-7">
    <div class="mb-3 text-[18px] font-semibold">Today's rhythm</div>
    <Card class="p-5">
      {#if loading}
        <div class="space-y-3">
          {#each Array.from({ length: 5 }) as _, i (i)}
            <div class="flex gap-4">
              <div class="h-4 w-12 animate-pulse rounded bg-gray-100"></div>
              <div class="h-4 flex-1 animate-pulse rounded bg-gray-100"></div>
            </div>
          {/each}
        </div>
      {:else if plansReady === 0}
        <div class="py-4 text-center text-[13px] text-text-secondary">
          No plans saved today. Generate a plan to see the daily rhythm.
        </div>
      {:else}
        <div class="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3.5">
          {#each rhythmRows as row, i (i)}
            {@const cls = CLASSES[i]}
            <div class="flex items-center gap-2">
              <span
                class="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-bold"
                style="background:{cls.color}22; color:{cls.color};"
              >
                {cls.id}
              </span>
            </div>
            <div class="flex flex-wrap items-start gap-2.5">
              <span class="mt-1.5 size-2 rounded-full {toneDot[row.tone]}"></span>
              <div class="min-w-[180px] flex-1">
                <div class="text-[13px] font-medium">{row.c}</div>
                <div class="text-text-secondary text-[12px]">{row.s}</div>
              </div>
              {#if row.tone === "done"}
                <Pill tone="success">Done</Pill>
              {:else if row.tone === "live"}
                <Pill tone="cobalt">Live</Pill>
              {:else if row.tone === "next"}
                <Pill tone="saffron">Up next</Pill>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
</Page>
