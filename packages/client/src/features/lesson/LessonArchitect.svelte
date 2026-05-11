<script lang="ts">
  import {
    Sparkles,
    Download,
    Loader2,
    Sprout,
    Save,
    CheckCircle2,
    AlertCircle,
  } from "lucide-svelte";
  import { untrack } from "svelte";
  import { Button, Card, Input, Select } from "@shadcn";

  import { Block, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { cn } from "@utils";

  type SubjectOption = { id: string; label: string };
  type BlueprintBlock = { phase: string; title: string; durationMin: number; body: string };
  type Blueprint = { title: string; blocks: BlueprintBlock[] };
  type ClassSelection = { subject: string; duration: string };
  type BlueprintDraft = {
    classId: number;
    className: string;
    subject: string;
    subjectLabel: string;
    chapter: string;
    duration: string;
    durationMin: number;
    blueprint: Blueprint;
    saveSuccess: boolean;
  };
  type ConflictState = { selectionKey: string; classId: number; chapter: string };

  const DEFAULT_DURATION = "45m";

  let cls = $state(3);
  let subject = $state("");
  let chapter = $state("");
  let duration = $state(DEFAULT_DURATION);

  let subjects = $state<SubjectOption[]>([]);
  let chapters = $state<string[]>([]);
  let subjectsByClass = $state<Record<number, SubjectOption[]>>({});
  let classSelections = $state<Record<number, ClassSelection>>({});
  let chapterSelections = $state<Record<string, string>>({});
  let chaptersByLookup = $state<Record<string, string[]>>({});
  let draftsBySelection = $state<Record<string, BlueprintDraft>>({});
  let generatingBySelection = $state<Record<string, boolean>>({});
  let errorsBySelection = $state<Record<string, string>>({});
  let subjectsLoadingByClass = $state<Record<number, boolean>>({});
  let chaptersLoadingByLookup = $state<Record<string, boolean>>({});
  let savingSelectionKey = $state<string | null>(null);
  let conflict = $state<ConflictState | null>(null);

  const durations = ["30m", "40m", "45m", "50m"];
  const getClassName = (classId: number): string => `class_${classId}`;
  const getChapterLookupKey = (classId: number, targetSubject: string): string =>
    `${getClassName(classId)}::${targetSubject}`;
  const getSelectionKey = (
    classId: number,
    targetSubject: string,
    targetChapter: string,
    targetDuration: string,
  ): string => `${getClassName(classId)}::${targetSubject}::${targetChapter.trim()}::${targetDuration}`;

  const getClassSelection = (classId: number): ClassSelection =>
    classSelections[classId] ?? { subject: "", duration: DEFAULT_DURATION };

  function setClassSelection(classId: number, patch: Partial<ClassSelection>): ClassSelection {
    const current = getClassSelection(classId);
    const next = { ...current, ...patch };

    if (current.subject === next.subject && current.duration === next.duration) {
      return current;
    }

    classSelections = { ...classSelections, [classId]: next };
    return next;
  }

  const getChapterSelection = (classId: number, targetSubject: string): string =>
    chapterSelections[getChapterLookupKey(classId, targetSubject)] ?? "";

  function setChapterSelection(classId: number, targetSubject: string, value: string): void {
    if (!targetSubject) return;

    const lookupKey = getChapterLookupKey(classId, targetSubject);
    if ((chapterSelections[lookupKey] ?? "") === value) return;

    chapterSelections = {
      ...chapterSelections,
      [lookupKey]: value,
    };
  }

  const getCachedChapters = (classId: number, targetSubject: string): string[] =>
    chaptersByLookup[getChapterLookupKey(classId, targetSubject)] ?? [];

  function restoreClassState(classId: number): void {
    const nextSubjects = subjectsByClass[classId] ?? [];
    const nextSelection = getClassSelection(classId);
    const nextSubject = nextSelection.subject || nextSubjects[0]?.id || "";
    const nextChapters = getCachedChapters(classId, nextSubject);
    const nextChapter = getChapterSelection(classId, nextSubject) || nextChapters[0] || "";

    subjects = nextSubjects;
    subject = nextSubject;
    duration = nextSelection.duration;
    chapters = nextChapters;
    chapter = nextChapter;
  }

  function switchClass(nextClassId: number): void {
    if (nextClassId === cls) return;

    conflict = null;
    setClassSelection(cls, { subject, duration });
    setChapterSelection(cls, subject, chapter);

    cls = nextClassId;
    restoreClassState(nextClassId);
  }

  function setSubjectForCurrentClass(nextSubject: string): void {
    if (nextSubject === subject) return;

    conflict = null;
    setChapterSelection(cls, subject, chapter);
    subject = nextSubject;
    setClassSelection(cls, { subject: nextSubject, duration });

    const nextChapters = getCachedChapters(cls, nextSubject);
    chapters = nextChapters;
    chapter = getChapterSelection(cls, nextSubject) || nextChapters[0] || "";
  }

  function setDurationForCurrentClass(nextDuration: string): void {
    conflict = null;
    duration = nextDuration;
    setClassSelection(cls, { subject, duration: nextDuration });
  }

  function setChapterForCurrentClass(nextChapter: string): void {
    conflict = null;
    chapter = nextChapter;
    setChapterSelection(cls, subject, nextChapter);
  }

  const className = $derived(getClassName(cls));
  const chapterLookupKey = $derived(getChapterLookupKey(cls, subject));
  const currentSelectionKey = $derived(getSelectionKey(cls, subject, chapter, duration));
  const currentDraft = $derived(draftsBySelection[currentSelectionKey] ?? null);
  const blueprint = $derived(currentDraft?.blueprint ?? null);
  const subjectLabel = $derived(subjects.find((s) => s.id === subject)?.label ?? "");
  const activeSubjectLabel = $derived(currentDraft?.subjectLabel ?? subjectLabel);
  const durationMin = $derived(parseInt(duration, 10));
  const hasChips = $derived(chapters.length > 0);
  const subjectsLoading = $derived(subjectsLoadingByClass[cls] ?? false);
  const chaptersLoading = $derived(chaptersLoadingByLookup[chapterLookupKey] ?? false);
  const generating = $derived(generatingBySelection[currentSelectionKey] ?? false);
  const error = $derived(errorsBySelection[currentSelectionKey] ?? "");
  const saving = $derived(savingSelectionKey === currentSelectionKey);
  const saveSuccess = $derived(currentDraft?.saveSuccess ?? false);

  const phaseToTone = (phase: string): "cobalt" | "saffron" =>
    ["warm_up", "wrap_up", "check"].includes(phase) ? "saffron" : "cobalt";

  async function loadSubjects(targetClassId: number): Promise<void> {
    const targetClassName = getClassName(targetClassId);
    subjectsLoadingByClass = { ...subjectsLoadingByClass, [targetClassId]: true };
    try {
      const res = await fetch(`/api/lesson/subjects?class=${encodeURIComponent(targetClassName)}`);
      const data = await res.json();
      const nextSubjects = Array.isArray(data.subjects) ? data.subjects : [];
      subjectsByClass = { ...subjectsByClass, [targetClassId]: nextSubjects };

      const existingSelection = getClassSelection(targetClassId);
      const nextSubject =
        nextSubjects.find((option: SubjectOption) => option.id === existingSelection.subject)?.id ||
        nextSubjects[0]?.id ||
        "";

      setClassSelection(targetClassId, { subject: nextSubject });

      if (targetClassId === cls) {
        subjects = nextSubjects;
        if (subject !== nextSubject) {
          subject = nextSubject;
          const nextChapters = getCachedChapters(targetClassId, nextSubject);
          chapters = nextChapters;
          chapter = getChapterSelection(targetClassId, nextSubject) || nextChapters[0] || "";
        } else if (!nextSubject) {
          chapters = [];
          chapter = "";
        }
      }
    } catch {
      if (targetClassId === cls) {
        subjects = subjectsByClass[targetClassId] ?? [];
      }
    } finally {
      subjectsLoadingByClass = { ...subjectsLoadingByClass, [targetClassId]: false };
    }
  }

  async function loadChapters(targetClassId: number, targetSubject: string): Promise<void> {
    const lookupKey = getChapterLookupKey(targetClassId, targetSubject);
    if (!targetSubject) {
      chaptersByLookup = { ...chaptersByLookup, [lookupKey]: [] };
      if (targetClassId === cls) {
        chapters = [];
        chapter = "";
      }
      return;
    }

    chaptersLoadingByLookup = { ...chaptersLoadingByLookup, [lookupKey]: true };
    try {
      const res = await fetch(
        `/api/lesson/chapters?class=${encodeURIComponent(getClassName(targetClassId))}` +
          `&subject=${encodeURIComponent(targetSubject)}`,
      );
      const data = await res.json();
      const nextChapters = Array.isArray(data.chapters) ? data.chapters : [];
      chaptersByLookup = { ...chaptersByLookup, [lookupKey]: nextChapters };

      const existingChapter = getChapterSelection(targetClassId, targetSubject);
      const nextChapter =
        nextChapters.length === 0
          ? existingChapter
          : nextChapters.includes(existingChapter)
            ? existingChapter
            : nextChapters[0] || "";

      setChapterSelection(targetClassId, targetSubject, nextChapter);

      if (targetClassId === cls && targetSubject === subject) {
        chapters = nextChapters;
        if (chapter !== nextChapter) {
          chapter = nextChapter;
        }
      }
    } finally {
      chaptersLoadingByLookup = { ...chaptersLoadingByLookup, [lookupKey]: false };
    }
  }

  async function generate(): Promise<void> {
    if (!subject || !chapter.trim()) return;

    conflict = null;
    const selectionKey = getSelectionKey(cls, subject, chapter, duration);
    const selectedSubjectLabel = subjectLabel;

    generatingBySelection = { ...generatingBySelection, [selectionKey]: true };
    errorsBySelection = { ...errorsBySelection, [selectionKey]: "" };
    try {
      const res = await fetch("/api/lesson/blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class: className, subject, chapter, durationMin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Generation failed.");

      draftsBySelection = {
        ...draftsBySelection,
        [selectionKey]: {
          classId: cls,
          className,
          subject,
          subjectLabel: selectedSubjectLabel,
          chapter,
          duration,
          durationMin,
          blueprint: data.blueprint as Blueprint,
          saveSuccess: false,
        },
      };
    } catch (e) {
      errorsBySelection = {
        ...errorsBySelection,
        [selectionKey]: e instanceof Error ? e.message : "Generation failed.",
      };
    } finally {
      generatingBySelection = { ...generatingBySelection, [selectionKey]: false };
    }
  }

  function exportBlueprint(): void {
    if (!currentDraft) return;

    const lines = [
      "LESSON BLUEPRINT",
      "================",
      `${currentDraft.subjectLabel} · Class ${currentDraft.classId} · ${currentDraft.duration}`,
      `Chapter: ${currentDraft.blueprint.title}`,
      `Date: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
      "",
      ...currentDraft.blueprint.blocks.flatMap((b) => [
        `[ ${b.phase.toUpperCase().replace("_", "-")} ]${b.durationMin > 0 ? `  ${b.durationMin} min` : ""}`,
        b.title,
        b.body,
        "",
      ]),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lesson-class${currentDraft.classId}-${currentDraft.subject}-${currentDraft.blueprint.title.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doSave(overwrite: boolean, selectionKey = currentSelectionKey): Promise<void> {
    const draft = draftsBySelection[selectionKey];
    if (!draft) return;

    savingSelectionKey = selectionKey;
    conflict = null;
    try {
      const res = await fetch("/api/lesson/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class: draft.className,
          subject: draft.subject,
          subjectLabel: draft.subjectLabel,
          chapter: draft.chapter,
          durationMin: draft.durationMin,
          blueprint: draft.blueprint,
          overwrite,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflict) {
        conflict = {
          selectionKey,
          classId: draft.classId,
          chapter: data.existingChapter ?? draft.chapter,
        };
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "Save failed.");

      draftsBySelection = {
        ...draftsBySelection,
        [selectionKey]: {
          ...draft,
          saveSuccess: true,
        },
      };
    } catch (e) {
      errorsBySelection = {
        ...errorsBySelection,
        [selectionKey]: e instanceof Error ? e.message : "Could not save plan.",
      };
    } finally {
      savingSelectionKey = null;
    }
  }

  $effect(() => {
    const targetClassId = cls;
    void untrack(() => loadSubjects(targetClassId));
  });

  $effect(() => {
    const targetClassId = cls;
    const targetSubject = subject;
    void untrack(() => loadChapters(targetClassId, targetSubject));
  });
</script>

<!-- Conflict / overwrite dialog -->
{#if conflict}
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
  >
    <div class="bg-white mx-4 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
      <div class="text-ink mb-1.5 text-[17px] font-semibold">Replace today's plan?</div>
      <div class="text-text-secondary mb-5 text-[13px] leading-relaxed">
        Class {conflict.classId} already has a saved plan for today
        {#if conflict.chapter}(<b>{conflict.chapter}</b>){/if}.
        Do you want to replace it?
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" onclick={() => (conflict = null)}>Cancel</Button>
        <Button variant="primary" onclick={() => conflict && doSave(true, conflict.selectionKey)}>
          Replace
        </Button>
      </div>
    </div>
  </div>
{/if}

<div
  class="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden px-4 pt-5 md:px-8 md:pt-7"
  style="max-width: 1400px;"
>
  <PageHeader
    eyebrow="Morning ritual · Step 1 of 2"
    title="Lesson Architect"
    subtitle="Pick a class, subject, and chapter. The local AI drafts a blueprint sized to your period."
  >
    {#snippet actions()}
      {#if currentDraft}
        <Button variant="secondary" onclick={exportBlueprint}>
          <Download class="size-3.5" /> Export
        </Button>
      {/if}
      <Button
        variant="primary"
        onclick={() => doSave(false)}
        disabled={!currentDraft || saving || saveSuccess}
      >
        {#if saving}
          <Loader2 class="size-3.5 animate-spin" /> Saving…
        {:else if saveSuccess}
          <CheckCircle2 class="size-3.5" /> Saved
        {:else}
          <Save class="size-3.5" /> Save plan
        {/if}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="grid min-h-0 flex-1 grid-cols-1 gap-5 pb-5 md:pb-7 lg:grid-cols-[360px_1fr]">

    <!-- Left: Input panel -->
    <Card class="flex min-h-0 flex-col overflow-hidden p-0">

      <!-- Fixed top: class + subject/duration (never scrolls) -->
      <div class="shrink-0 px-5 pt-5 pb-4">
        <div class="label-eyebrow mb-2">Class</div>
        <div class="mb-4 flex flex-wrap gap-1.5">
          {#each CLASSES as c (c.id)}
            <button
              type="button"
              onclick={() => switchClass(c.id)}
              class="cursor-pointer rounded-full border px-3 py-1.5 text-[11px] transition-colors"
              style={cls === c.id
                ? `border-color: ${c.color}; background: ${c.color}1a; color: ${c.color}; font-weight: 600;`
                : "border-color: var(--border-default); background: #fff; color: var(--text-secondary); font-weight: 500;"}
            >
              {c.name}
            </button>
          {/each}
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <div class="label-eyebrow mb-1.5">Subject</div>
            <Select.Root type="single" value={subject} onValueChange={setSubjectForCurrentClass}>
              <Select.Trigger>
                {#if subjectsLoading}Loading…
                {:else if subjects.length === 0}No subjects
                {:else}{activeSubjectLabel || "Pick a subject"}{/if}
              </Select.Trigger>
              <Select.Content>
                {#each subjects as s (s.id)}
                  <Select.Item value={s.id} label={s.label}>{s.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div>
            <div class="label-eyebrow mb-1.5">Duration</div>
            <Select.Root type="single" value={duration} onValueChange={setDurationForCurrentClass}>
              <Select.Trigger>{duration}</Select.Trigger>
              <Select.Content>
                {#each durations as d (d)}
                  <Select.Item value={d} label={d}>{d}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      </div>

      <!-- Fixed: chapter section label -->
      <div class="border-border-default shrink-0 border-t px-5 pt-3.5 pb-1">
        <div class="label-eyebrow">Chapter</div>
      </div>

      <!-- Scrollable: chapter chips (only this part scrolls) -->
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {#if chaptersLoading}
          <div class="text-text-secondary text-[12px]">Loading chapters…</div>
        {:else if !subject}
          <div class="text-text-secondary text-[12px]">Pick a subject first.</div>
        {:else}
          <div class="text-text-secondary text-[12px]">No chapters found in the vector store.</div>
        {/if}

        {#if hasChips}
          <div class="mt-0 flex flex-wrap gap-1.5">
            {#each chapters as ch (ch)}
              <button
                type="button"
                onclick={() => setChapterForCurrentClass(ch)}
                class={cn(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  chapter === ch
                    ? "border-cobalt-500 bg-cobalt-25 text-cobalt-700 font-semibold"
                    : "border-border-default bg-white text-text-secondary",
                )}
              >
                {ch}
              </button>
            {/each}
          </div>
        {/if}

        <div class="mt-4 space-y-2.5">
          <div class="label-eyebrow">Paste chapter / topic text</div>
          <div class="text-text-secondary text-[12px] leading-relaxed">
            If the correct chapter is missing above, paste the chapter or topic text here. Blueprint generation will use this text for retrieval.
          </div>
          <Input
            value={chapter}
            oninput={(event) => setChapterForCurrentClass(event.currentTarget.value)}
            placeholder="Paste or type chapter / topic text…"
          />
        </div>
      </div>

      <!-- Fixed bottom: generate button -->
      <div class="border-border-default shrink-0 border-t px-5 py-4">
        <Button
          variant="primary"
          size="lg"
          class="w-full"
          onclick={generate}
          disabled={generating || !subject || !chapter.trim()}
        >
          {#if generating}
            <Loader2 class="size-3.75 animate-spin" /> Drafting blueprint…
          {:else}
            <Sparkles class="size-3.75" /> Generate blueprint
          {/if}
        </Button>
      </div>
    </Card>

    <!-- Right: Blueprint output -->
    <Card
      class="flex min-h-0 flex-col overflow-hidden p-0"
      style="background: repeating-linear-gradient(to bottom, var(--ivory) 0 30px, #F3EFE6 30px 31px);"
    >
      <div class="bg-ivory border-border-default shrink-0 border-b px-6 pt-6 pb-4.5 md:px-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="label-eyebrow">
              {activeSubjectLabel || "Subject"} · Class {cls} · {duration}
            </div>
            <div
              class="text-ink mt-1.5 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] md:text-[26px]"
            >
              {blueprint?.title || chapter || "Your lesson title"}
            </div>
            <div class="mt-2.5 flex flex-wrap gap-2">
              {#if activeSubjectLabel}
                <Pill tone="saffron">{activeSubjectLabel} · Class {cls}</Pill>
              {/if}
              {#if blueprint}
                <Pill tone="cobalt">{blueprint.blocks.length} phases</Pill>
              {/if}
              {#if saveSuccess}
                <Pill tone="default"><CheckCircle2 class="size-3" /> Saved for today</Pill>
              {/if}
            </div>
          </div>
          <div
            class="bg-saffron-50 border-saffron-100 grid size-15 shrink-0 place-items-center rounded-2xl border"
          >
            <Sprout class="size-7 text-saffron-600" />
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-6 md:px-8">
        {#if error}
          <!-- Error shown here in the blueprint area -->
          <div
            class="bg-danger-50 border-danger-200 mb-5 flex items-start gap-3 rounded-xl border p-4"
          >
            <AlertCircle class="text-danger-500 mt-0.5 size-4 shrink-0" />
            <div class="text-danger-700 text-[13px] leading-relaxed">{error}</div>
          </div>
        {/if}
        {#if generating}
          <div class="text-text-secondary grid place-items-center gap-2 py-16 text-center">
            <Loader2 class="size-6 animate-spin" />
            <div class="text-[13px]">Drafting your {duration} blueprint…</div>
          </div>
        {:else if !blueprint && !error}
          <div class="text-text-secondary py-16 text-center text-[13px]">
            Pick a class, subject, and chapter, then tap <b>Generate blueprint</b>.
          </div>
        {:else if blueprint}
          {#each blueprint.blocks as block (block.phase)}
            <Block
              phase={block.phase}
              title={block.title}
              durationMin={block.durationMin}
              tone={phaseToTone(block.phase)}
            >
              {block.body}
            </Block>
          {/each}
        {/if}
      </div>
    </Card>
  </div>
</div>
