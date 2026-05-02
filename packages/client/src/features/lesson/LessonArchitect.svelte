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
  import { Button, Card, Input, Select } from "@shadcn";

  import { Block, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { cn } from "@utils";

  type SubjectOption = { id: string; label: string };
  type BlueprintBlock = { phase: string; title: string; durationMin: number; body: string };
  type Blueprint = { title: string; blocks: BlueprintBlock[] };

  let cls = $state(3);
  let subject = $state("");
  let chapter = $state("");
  let duration = $state("45m");

  let subjects = $state<SubjectOption[]>([]);
  let chapters = $state<string[]>([]);
  let subjectsLoading = $state(false);
  let chaptersLoading = $state(false);

  let blueprint = $state<Blueprint | null>(null);
  let generating = $state(false);
  let error = $state("");

  let saving = $state(false);
  let saveSuccess = $state(false);
  let showConflictDialog = $state(false);
  let conflictChapter = $state("");

  const durations = ["30m", "40m", "45m", "50m"];
  const className = $derived(`class_${cls}`);
  const subjectLabel = $derived(subjects.find((s) => s.id === subject)?.label ?? "");
  const durationMin = $derived(parseInt(duration, 10));
  const hasChips = $derived(chapters.length > 0);

  const phaseToTone = (phase: string): "cobalt" | "saffron" =>
    ["warm_up", "wrap_up", "check"].includes(phase) ? "saffron" : "cobalt";

  async function loadSubjects(target: string): Promise<void> {
    subjectsLoading = true;
    error = "";
    try {
      const res = await fetch(`/api/lesson/subjects?class=${encodeURIComponent(target)}`);
      const data = await res.json();
      subjects = Array.isArray(data.subjects) ? data.subjects : [];
      if (!subjects.find((s) => s.id === subject)) {
        subject = subjects[0]?.id ?? "";
      }
    } catch {
      subjects = [];
    } finally {
      subjectsLoading = false;
    }
  }

  async function loadChapters(targetClass: string, targetSubject: string): Promise<void> {
    if (!targetSubject) {
      chapters = [];
      chapter = "";
      return;
    }
    chaptersLoading = true;
    try {
      const res = await fetch(
        `/api/lesson/chapters?class=${encodeURIComponent(targetClass)}` +
          `&subject=${encodeURIComponent(targetSubject)}`,
      );
      const data = await res.json();
      chapters = Array.isArray(data.chapters) ? data.chapters : [];
      if (!chapters.includes(chapter)) {
        chapter = chapters[0] ?? "";
      }
    } catch {
      chapters = [];
    } finally {
      chaptersLoading = false;
    }
  }

  async function generate(): Promise<void> {
    if (!subject || !chapter.trim()) return;
    generating = true;
    error = "";
    saveSuccess = false;
    try {
      const res = await fetch("/api/lesson/blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class: className, subject, chapter, durationMin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Generation failed.");
      blueprint = data.blueprint as Blueprint;
    } catch (e) {
      error = e instanceof Error ? e.message : "Generation failed.";
    } finally {
      generating = false;
    }
  }

  function exportBlueprint(): void {
    if (!blueprint) return;
    const lines = [
      "LESSON BLUEPRINT",
      "================",
      `${subjectLabel} · Class ${cls} · ${duration}`,
      `Chapter: ${blueprint.title}`,
      `Date: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
      "",
      ...blueprint.blocks.flatMap((b) => [
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
    a.download = `lesson-class${cls}-${subject}-${blueprint.title.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doSave(overwrite: boolean): Promise<void> {
    if (!blueprint) return;
    saving = true;
    showConflictDialog = false;
    try {
      const res = await fetch("/api/lesson/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class: className, subject, subjectLabel, chapter, durationMin, blueprint, overwrite }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflict) {
        conflictChapter = data.existingChapter ?? chapter;
        showConflictDialog = true;
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "Save failed.");
      saveSuccess = true;
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not save plan.";
    } finally {
      saving = false;
    }
  }

  $effect(() => { void loadSubjects(className); });
  $effect(() => { void loadChapters(className, subject); });
</script>

<!-- Conflict / overwrite dialog -->
{#if showConflictDialog}
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
  >
    <div class="bg-white mx-4 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
      <div class="text-ink mb-1.5 text-[17px] font-semibold">Replace today's plan?</div>
      <div class="text-text-secondary mb-5 text-[13px] leading-relaxed">
        Class {cls} already has a saved plan for today
        {#if conflictChapter}(<b>{conflictChapter}</b>){/if}.
        Do you want to replace it?
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" onclick={() => (showConflictDialog = false)}>Cancel</Button>
        <Button variant="primary" onclick={() => doSave(true)}>Replace</Button>
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
      <Button variant="secondary" onclick={exportBlueprint} disabled={!blueprint}>
        <Download class="size-3.5" /> Export
      </Button>
      <Button
        variant="primary"
        onclick={() => doSave(false)}
        disabled={!blueprint || saving || saveSuccess}
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
              onclick={() => (cls = c.id)}
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
            <Select.Root type="single" bind:value={subject}>
              <Select.Trigger>
                {#if subjectsLoading}Loading…
                {:else if subjects.length === 0}No subjects
                {:else}{subjectLabel || "Pick a subject"}{/if}
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
            <Select.Root type="single" bind:value={duration}>
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
        {:else if hasChips}
          <div class="flex flex-wrap gap-1.5">
            {#each chapters as ch (ch)}
              <button
                type="button"
                onclick={() => (chapter = ch)}
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
        {:else}
          <!-- No chapters from manifest: allow manual entry -->
          <div class="text-text-secondary mb-2 text-[12px]">
            No chapters found in the vector store. Type a chapter name manually.
          </div>
          <Input bind:value={chapter} placeholder="Chapter name…" />
        {/if}
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
              {subjectLabel || "Subject"} · Class {cls} · {duration}
            </div>
            <div
              class="text-ink mt-1.5 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] md:text-[26px]"
            >
              {blueprint?.title || chapter || "Your lesson title"}
            </div>
            <div class="mt-2.5 flex flex-wrap gap-2">
              {#if subjectLabel}
                <Pill tone="saffron">{subjectLabel} · Class {cls}</Pill>
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
