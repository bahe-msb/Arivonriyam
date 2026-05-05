<script lang="ts">
  import { goto } from "$app/navigation";
  import {
    AlertTriangle,
    ArrowRight,
    BookOpen,
    CheckCircle2,
    Filter,
    Heart,
    Lightbulb,
    RefreshCw,
    Sparkles,
    Users,
  } from "lucide-svelte";
  import { Button, Card, Sheet } from "@shadcn";

  import { Page, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { activeClass, sessionAlerts, type SessionAlertRecord } from "@stores";

  type AlertSuggestion = {
    gapSummary: string;
    focusAreas: string[];
    teacherActions: string[];
    encouragement: string;
  };

  type AlertSuggestionResponse = Partial<AlertSuggestion> & {
    error?: string;
  };

  const classOptions = $derived(
    CLASSES.map((cls) => ({
      ...cls,
      count: sessionAlerts.countForClass(cls.id),
    })),
  );
  const totalAlerts = $derived(sessionAlerts.count());

  let selectedClassId = $state(activeClass.id);
  let selectedRecordId = $state<string | null>(null);
  let detailSheetOpen = $state(false);
  let suggestionCache = $state<Record<string, AlertSuggestion>>({});
  let suggestionErrors = $state<Record<string, string>>({});
  let suggestionLoadingId = $state<string | null>(null);

  const filteredAlerts = $derived(sessionAlerts.getByClass(selectedClassId));
  const activeRecord = $derived(
    filteredAlerts.find((record) => record.id === selectedRecordId) ?? null,
  );
  const activeSuggestion = $derived(
    activeRecord
      ? suggestionCache[activeRecord.id] ?? fallbackSuggestion(activeRecord)
      : null,
  );
  const activeSuggestionError = $derived(
    activeRecord ? suggestionErrors[activeRecord.id] ?? "" : "",
  );
  const activeClassInfo = $derived(CLASSES.find((cls) => cls.id === selectedClassId));
  const totalMissesForClass = $derived(
    filteredAlerts.reduce((sum, record) => sum + record.incorrectCount, 0),
  );
  const averageScoreForClass = $derived(
    filteredAlerts.length > 0
      ? Math.round(filteredAlerts.reduce((sum, record) => sum + record.score, 0) / filteredAlerts.length)
      : 0,
  );

  function selectClass(classId: number): void {
    selectedClassId = classId;
    selectedRecordId = null;
    detailSheetOpen = false;
    activeClass.set(classId);
  }

  function selectRecord(recordId: string): void {
    selectedRecordId = recordId;
    detailSheetOpen = true;
  }

  function focusFromMiss(record: SessionAlertRecord, index: number): string {
    const miss = record.missedQuestions[index];
    if (!miss) return `core ${record.topic} facts`;

    const seed = miss.explain || miss.question || record.topic;
    const cleaned = seed
      .replace(/correct answer:\s*/i, "")
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
    return words.length > 0 ? words.join(" ") : `core ${record.topic} facts`;
  }

  function fallbackSuggestion(record: SessionAlertRecord): AlertSuggestion {
    const focusAreas = record.missedQuestions
      .map((_, idx) => focusFromMiss(record, idx))
      .filter(
        (item, idx, arr) =>
          arr.findIndex((value) => value.toLowerCase() === item.toLowerCase()) === idx,
      )
      .slice(0, 3);

    const resolvedFocusAreas =
      focusAreas.length > 0
        ? focusAreas
        : [`core ${record.topic} facts`, `${record.subject} examples`, "matching the right option"];

    return {
      gapSummary: `${record.studentName} is missing a few key ${record.topic} ideas and needs a slower recap before the next MCQ round. The main issue is linking the question back to the lesson fact and example.`,
      focusAreas: resolvedFocusAreas,
      teacherActions: [
        `Re-teach ${record.topic} with one concrete ${record.subject} example from class or home before asking again.`,
        `Ask ${record.studentName} to say the correct answer back in their own words after each correction.`,
        `Give two short practice questions on ${resolvedFocusAreas[0]} before restarting a full question round.`,
      ],
      encouragement: `Start with one easy win so ${record.studentName} feels confident before the harder questions return.`,
    };
  }

  function normalizeSuggestion(
    response: AlertSuggestionResponse,
    record: SessionAlertRecord,
  ): AlertSuggestion {
    const fallback = fallbackSuggestion(record);
    const focusAreas = Array.isArray(response.focusAreas)
      ? response.focusAreas
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const teacherActions = Array.isArray(response.teacherActions)
      ? response.teacherActions
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return {
      gapSummary:
        typeof response.gapSummary === "string" && response.gapSummary.trim()
          ? response.gapSummary.trim()
          : fallback.gapSummary,
      focusAreas: focusAreas.length > 0 ? focusAreas : fallback.focusAreas,
      teacherActions: teacherActions.length > 0 ? teacherActions : fallback.teacherActions,
      encouragement:
        typeof response.encouragement === "string" && response.encouragement.trim()
          ? response.encouragement.trim()
          : fallback.encouragement,
    };
  }

  async function loadSuggestion(record: SessionAlertRecord): Promise<void> {
    suggestionLoadingId = record.id;
    suggestionErrors = { ...suggestionErrors, [record.id]: "" };

    try {
      const response = await fetch("/api/socratic/alerts/suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          className: record.className,
          studentName: record.studentName,
          topic: record.topic,
          subject: record.subject,
          totalQuestions: record.totalQuestions,
          incorrectCount: record.incorrectCount,
          missedQuestions: record.missedQuestions,
        }),
      });

      if (!response.ok) {
        throw new Error(`Suggestion request failed with ${response.status}`);
      }

      const data = (await response.json()) as AlertSuggestionResponse;
      suggestionCache = {
        ...suggestionCache,
        [record.id]: normalizeSuggestion(data, record),
      };
    } catch {
      suggestionCache = {
        ...suggestionCache,
        [record.id]: fallbackSuggestion(record),
      };
      suggestionErrors = {
        ...suggestionErrors,
        [record.id]: "AI suggestion is unavailable right now. Showing a local support plan instead.",
      };
    } finally {
      if (suggestionLoadingId === record.id) {
        suggestionLoadingId = null;
      }
    }
  }

  $effect(() => {
    const classesWithAlerts = classOptions.filter((cls) => cls.count > 0);

    if (classesWithAlerts.length === 0) {
      selectedRecordId = null;
      return;
    }

    if (!classesWithAlerts.some((cls) => cls.id === selectedClassId)) {
      const preferred = classesWithAlerts.find((cls) => cls.id === activeClass.id) ?? classesWithAlerts[0];
      selectedClassId = preferred.id;
    }
  });

  $effect(() => {
    if (filteredAlerts.length === 0) {
      selectedRecordId = null;
      detailSheetOpen = false;
      return;
    }

    if (selectedRecordId && !filteredAlerts.some((record) => record.id === selectedRecordId)) {
      selectedRecordId = null;
      detailSheetOpen = false;
    }
  });

  $effect(() => {
    if (!detailSheetOpen && selectedRecordId !== null) {
      selectedRecordId = null;
    }
  });

</script>

<Page maxWidth={1280}>
  <PageHeader
    eyebrow="Alerts Desk"
    eyebrowTone="danger"
    title="Review class-specific struggles"
    subtitle="When a Socratic round ends, students who miss questions appear here with the exact subject, topic, and teacher next steps."
  >
    {#snippet actions()}
      <Button variant="secondary" onclick={() => goto("/student/topic")}>
        Back to topic picker
      </Button>
    {/snippet}
  </PageHeader>

  {#if totalAlerts === 0}
    <Card class="border-clay-100 bg-clay-50 p-8 text-center">
      <div class="text-saffron-500 mx-auto mb-4 grid size-14 place-items-center rounded-3xl bg-white shadow-sm">
        <CheckCircle2 class="size-6" />
      </div>
      <div class="text-[22px] font-semibold">No student alerts yet</div>
      <div class="text-text-secondary mx-auto mt-2 max-w-150 text-[14px] leading-[1.7]">
        Finish a Socratic session and any student who misses questions will appear here with their subject, topic, exact slips, and support ideas.
      </div>
    </Card>
  {:else}
    <div class="space-y-5">
      <div class="grid gap-4 md:grid-cols-3">
        <Card class="border-clay-100 bg-clay-50 p-5">
          <div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b45309]">
            <AlertTriangle class="size-4" /> Active students
          </div>
          <div class="text-[30px] font-semibold">{totalAlerts}</div>
          <div class="text-text-secondary mt-1 text-[12px]">Students currently needing a second look.</div>
        </Card>

        <Card class="border-[#d7e7ff] bg-[#eef6ff] p-5">
          <div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f67c8]">
            <Users class="size-4" /> {activeClassInfo?.name ?? "Class"}
          </div>
          <div class="text-[30px] font-semibold">{filteredAlerts.length}</div>
          <div class="text-text-secondary mt-1 text-[12px]">Students listed for the selected class filter.</div>
        </Card>

        <Card class="border-[#d8eddf] bg-[#eef9f2] p-5">
          <div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#247a46]">
            <Sparkles class="size-4" /> Misses and score
          </div>
          <div class="flex items-end gap-3">
            <div class="text-[30px] font-semibold">{totalMissesForClass}</div>
            <div class="pb-1 text-[13px] font-medium text-[#247a46]">misses · {averageScoreForClass}% average</div>
          </div>
          <div class="text-text-secondary mt-1 text-[12px]">Useful for deciding which class needs the next reteach slot.</div>
        </Card>
      </div>

      <Card class="overflow-hidden p-0">
        <div class="border-border-default border-b px-5 py-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div class="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">
                <Filter class="size-4" /> Class filter
              </div>
              <div class="text-[18px] font-semibold">Students who missed the Socratic round</div>
              <div class="text-text-secondary mt-1 text-[12px]">
                Choose a class to see which students struggled, and which subject or topic they missed.
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              {#each classOptions as cls (cls.id)}
                <button
                  type="button"
                  onclick={() => selectClass(cls.id)}
                  disabled={cls.count === 0}
                  class="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-45"
                  style="{selectedClassId === cls.id
                    ? `background:${cls.color}18;border-color:${cls.color};color:${cls.color};`
                    : 'background:white;border-color:var(--border-default);color:var(--text-secondary);'}"
                >
                  <span
                    class="inline-block size-2 rounded-full"
                    style="background:{cls.color};"
                  ></span>
                  {cls.name}
                  <span class="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px]">{cls.count}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full border-collapse text-left">
            <thead>
              <tr class="bg-[#faf7f0] text-[11px] uppercase tracking-[0.16em] text-[#7b7280]">
                <th class="px-5 py-3 font-semibold">Student</th>
                <th class="px-4 py-3 font-semibold">Subject</th>
                <th class="px-4 py-3 font-semibold">Topic missed</th>
                <th class="px-4 py-3 font-semibold">Missed</th>
                <th class="px-4 py-3 font-semibold">Score</th>
                <th class="px-4 py-3 font-semibold text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredAlerts as record (record.id)}
                <tr
                  role="button"
                  tabindex="0"
                  class="border-t cursor-pointer transition-colors hover:bg-[#fff8ea] focus-visible:bg-[#fff8ea] focus-visible:outline-none"
                  style="border-color:var(--border-default); background:{activeRecord?.id === record.id && detailSheetOpen ? '#fff8ea' : 'white'};"
                  onclick={() => selectRecord(record.id)}
                  onkeydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectRecord(record.id);
                    }
                  }}
                >
                  <td class="px-5 py-4 align-top">
                    <div class="flex items-start gap-3 rounded-2xl px-1 py-1 text-left">
                      <div class="grid size-10 place-items-center rounded-2xl bg-[#f7f3ea] text-[22px]">
                        {record.studentEmoji}
                      </div>
                      <div>
                        <div class="text-[14px] font-semibold">{record.studentName}</div>
                        <div class="text-text-secondary mt-1 text-[11px]">{record.className} · {record.totalQuestions} questions</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-4 align-top text-[13px] text-text-secondary">{record.subject}</td>
                  <td class="px-4 py-4 align-top text-[13px] font-medium">{record.topic}</td>
                  <td class="px-4 py-4 align-top">
                    <span class="inline-flex rounded-full bg-[#fde7e7] px-2.5 py-1 text-[11px] font-semibold text-[#b42318]">
                      {record.incorrectCount} / {record.totalQuestions}
                    </span>
                  </td>
                  <td class="px-4 py-4 align-top text-[13px] font-semibold">{record.score}%</td>
                  <td class="px-4 py-4 text-right align-top">
                    <span class="text-text-secondary inline-flex items-center gap-1 text-[12px] font-medium">
                      Open <ArrowRight class="size-3.5" />
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Card>

      <Sheet.Root bind:open={detailSheetOpen}>
        {#if activeRecord}
          <Sheet.Content side="right" class="w-full p-0 sm:max-w-2xl">
            <div class="h-full overflow-y-auto p-5 sm:p-6">
              <div class="space-y-5 pr-0 sm:pr-2">
                <Card class="border-clay-100 bg-clay-50 p-5">
                  <div class="flex items-start gap-3.5">
                    <div class="grid size-15 place-items-center rounded-3xl bg-white text-[34px] shadow-sm">
                      {activeRecord.studentEmoji}
                    </div>
                    <div class="min-w-0 flex-1 pr-8">
                      <Sheet.Header class="gap-0">
                        <Sheet.Title class="text-[22px] font-semibold">{activeRecord.studentName}</Sheet.Title>
                        <Sheet.Description class="mt-1 text-[12px]">
                          {activeRecord.className} · {activeRecord.subject} · {activeRecord.topic}
                        </Sheet.Description>
                      </Sheet.Header>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <Pill tone="danger">{activeRecord.incorrectCount} missed</Pill>
                        <Pill tone="default">{activeRecord.score}% score</Pill>
                      </div>
                    </div>
                  </div>

                  <div class="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" class="justify-start" onclick={() => void loadSuggestion(activeRecord)}>
                      <RefreshCw class="size-3.5" /> Improve with AI
                    </Button>
                    <Button variant="ghost" class="justify-start" onclick={() => goto("/student/topic")}>
                      <ArrowRight class="size-3.5" /> Return to topic picker
                    </Button>
                  </div>
                </Card>

                <Card class="p-5">
                  <div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">
                    <BookOpen class="size-4" /> What the student lacked
                  </div>
                  <div class="space-y-3">
                    {#each activeRecord.missedQuestions as miss (miss.id)}
                      <div class="rounded-2xl border border-[#f1d5c2] bg-[#fff8f2] p-4">
                        <div class="text-[13px] font-semibold leading-[1.55]">{miss.question}</div>
                        <div class="mt-2 text-[12px] text-[#7b7280]">
                          Student chose: <span class="font-medium text-[#9a3412]">{miss.selectedOption}</span>
                        </div>
                        <div class="mt-1 text-[12px] text-[#7b7280]">
                          Correct answer: <span class="font-medium text-[#166534]">{miss.correctOption}</span>
                        </div>
                        <div class="mt-2 rounded-xl bg-white px-3 py-2 text-[12px] leading-[1.6] text-text-body">
                          {miss.explain}
                        </div>
                      </div>
                    {/each}
                  </div>
                </Card>

                <Card class="p-5">
                  <div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">
                    <Lightbulb class="size-4" /> AI support plan
                  </div>

                  {#if activeSuggestion}
                    {#if activeSuggestionError}
                      <div class="mb-3 rounded-2xl border border-[#f3d49a] bg-[#fff8ea] px-3.5 py-3 text-[12px] text-[#9a6708]">
                        {activeSuggestionError}
                      </div>
                    {/if}

                    {#if suggestionLoadingId === activeRecord.id}
                      <div class="mb-3 rounded-2xl border border-[#d7e7ff] bg-[#eef6ff] px-3.5 py-3 text-[12px] text-[#2f67c8]">
                        AI is refining the teacher note. The local support plan is already shown below.
                      </div>
                    {/if}

                    <div class="rounded-2xl border border-[#d7e7ff] bg-[#eef6ff] p-4">
                      <div class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f67c8]">
                        <Sparkles class="size-4" /> Gap summary
                      </div>
                      <div class="text-[13px] leading-[1.7] text-text-body">{activeSuggestion.gapSummary}</div>
                    </div>

                    <div class="mt-4">
                      <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">Focus areas</div>
                      <div class="flex flex-wrap gap-2">
                        {#each activeSuggestion.focusAreas as area (`${activeRecord.id}-${area}`)}
                          <span class="rounded-full bg-[#fff1d6] px-3 py-1.5 text-[11px] font-semibold text-[#b87907]">
                            {area}
                          </span>
                        {/each}
                      </div>
                    </div>

                    <div class="mt-4">
                      <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">What to do next</div>
                      <div class="space-y-2.5">
                        {#each activeSuggestion.teacherActions as action (`${activeRecord.id}-step-${action}`)}
                          <div class="flex items-start gap-2.5 rounded-2xl border border-[#d8eddf] bg-[#eef9f2] px-3.5 py-3">
                            <div class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white text-[#247a46]">
                              <CheckCircle2 class="size-3.5" />
                            </div>
                            <div class="text-[13px] leading-[1.65] text-text-body">{action}</div>
                          </div>
                        {/each}
                      </div>
                    </div>

                    <div class="mt-4 rounded-2xl border border-[#f3d49a] bg-[#fff8ea] px-4 py-3">
                      <div class="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a6708]">
                        <Heart class="size-4" /> A line for the child
                      </div>
                      <div class="text-[13px] leading-[1.65] text-text-body">{activeSuggestion.encouragement}</div>
                    </div>
                  {/if}
                </Card>
              </div>
            </div>
          </Sheet.Content>
        {/if}
      </Sheet.Root>
    </div>
  {/if}
</Page>
