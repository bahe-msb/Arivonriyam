<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { ArrowLeft, Plus, X, Send, BookOpen, Pencil } from "lucide-svelte";
  import { Button, Card, Input } from "@shadcn";
  import { DateNav, Page, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { reteachTopics } from "@stores";

  void reteachTopics.load();

  type SubjectOption = { id: string; label: string };

  let activeClass = $state<number | null>(null);
  let activeSubject = $state<string | null>(null);

  let subjects = $state<SubjectOption[]>([]);
  let subjectsLoading = $state(false);

  let standardDraft = $state("");
  let customDraft = $state("");

  function uid(): string {
    return Math.random().toString(36).slice(2);
  }

  const activeCls = $derived(CLASSES.find((c) => c.id === activeClass));
  const classTopics = $derived(reteachTopics.get(activeClass ?? -1));
  const subjectTopics = $derived(classTopics.filter((t) => t.subject === activeSubject));
  const totalCount = $derived(classTopics.length);
  const canAdd = $derived(totalCount < 3);
  const canSend = $derived(CLASSES.some((c) => reteachTopics.hasTopics(c.id)));
  const readOnly = $derived(reteachTopics.readOnly);
  const canEdit = $derived(canAdd && !readOnly);

  async function loadSubjects(classId: number): Promise<void> {
    subjectsLoading = true;
    subjects = [];
    try {
      const className = `class_${classId}`;
      const res = await fetch(`/api/lesson/subjects?class=${encodeURIComponent(className)}`);
      const data = await res.json();
      subjects = Array.isArray(data.subjects) ? data.subjects : [];
    } catch {
      subjects = [];
    } finally {
      subjectsLoading = false;
    }
  }

  function selectClass(id: number): void {
    if (activeClass !== id) {
      activeClass = id;
      activeSubject = null;
      standardDraft = "";
      customDraft = "";
      void loadSubjects(id);
    }
  }

  function selectSubject(s: string): void {
    activeSubject = s;
    standardDraft = "";
    customDraft = "";
  }

  function addTopic(topic: string, source: "standard" | "custom"): void {
    if (!topic.trim() || !activeClass || !activeSubject || !canAdd || readOnly) return;
    reteachTopics.add(activeClass, {
      id: uid(),
      subject: activeSubject,
      topic: topic.trim(),
      source,
    });
    if (source === "standard") standardDraft = "";
    else customDraft = "";
  }
</script>

<Page>
  <PageHeader
    eyebrow="Morning ritual · Step 2 of 2"
    title="What should AI reteach today?"
    subtitle="Select a class, pick a subject, then add up to 3 topics per class (textbook topic or custom web topic). AI summary and MCQs follow the uploaded textbook PDF language, including Tamil and English."
  >
    {#snippet actions()}
      <div class="flex flex-wrap items-center justify-end gap-2">
        <DateNav
          label="Day"
          value={reteachTopics.currentDate}
          onChange={(d) => void reteachTopics.setDate(d)}
        />
        <div class="flex items-center gap-2">
          <Button variant="secondary" onclick={() => goto(resolve("/lesson"))}>
            <ArrowLeft class="size-3.5" /> Back to plan
          </Button>
          <Button variant="primary" disabled={!canSend} onclick={() => goto(resolve("/handoff"))}>
            Send to handoff <Send class="size-3.5" />
          </Button>
        </div>
      </div>
    {/snippet}
  </PageHeader>

  {#if readOnly}
    <div class="mb-4 rounded-2xl border border-[#f3d49a] bg-[#fff8ea] px-4 py-2.5 text-[12px] text-[#9a6708]">
      Viewing past day — read only. Switch to Today to add or remove topics.
    </div>
  {/if}

  <div class="grid grid-cols-[160px_200px_1fr] items-start gap-4">
    <!-- Col 1: Classes -->
    <Card class="p-2">
      <div class="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        Classes
      </div>
      {#each CLASSES as c (c.id)}
        {@const count = reteachTopics.get(c.id).length}
        {@const sel = c.id === activeClass}
        <button
          type="button"
          onclick={() => selectClass(c.id)}
          class="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors
                 {sel
            ? 'bg-cobalt-25 border-cobalt-50 border'
            : 'border border-transparent hover:bg-gray-50'}"
        >
          <span
            class="grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold"
            style="background: {c.color}22; color: {c.color};"
          >
            {c.id}
          </span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[12px] font-medium">{c.name}</div>
            {#if count > 0}
              <div class="text-[10px] text-text-secondary">{count}/3</div>
            {/if}
          </div>
        </button>
      {/each}
    </Card>

    <!-- Col 2: Subjects from PDF folder -->
    <Card class="p-2 {!activeClass ? 'opacity-40 pointer-events-none' : ''}">
      <div class="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        Subjects
      </div>
      {#if !activeClass}
        <div class="py-5 text-center text-[11px] text-text-tertiary">Select a class first</div>
      {:else if subjectsLoading}
        <div class="py-5 text-center text-[11px] text-text-secondary">Loading…</div>
      {:else if subjects.length === 0}
        <div class="py-5 text-center text-[11px] text-text-tertiary">No subjects found</div>
      {:else}
        {#each subjects as s (s.id)}
          {@const subCount = reteachTopics.get(activeClass).filter((t) => t.subject === s.id).length}
          {@const sel = s.id === activeSubject}
          <button
            type="button"
            onclick={() => selectSubject(s.id)}
            class="mb-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors
                   {sel
              ? 'bg-cobalt-25 border-cobalt-50 border'
              : 'border border-transparent hover:bg-gray-50'}"
          >
            <span class="truncate text-[12px] font-medium">{s.label}</span>
            {#if subCount > 0}
              <span
                class="grid size-4.5 shrink-0 place-items-center rounded-full bg-saffron-500 text-[9px] font-bold text-white"
              >
                {subCount}
              </span>
            {/if}
          </button>
        {/each}
      {/if}
    </Card>

    <!-- Col 3: Topic input — vertical split (two columns side by side) -->
    {#if activeClass && activeSubject}
      {@const subjectLabel = subjects.find((s) => s.id === activeSubject)?.label ?? activeSubject}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[15px] font-semibold">{activeCls?.name} · {subjectLabel}</div>
            <div class="text-[11px] text-text-secondary">
              {totalCount}/3 topics for {activeCls?.name}
            </div>
          </div>
          {#if !canAdd}
            <Pill tone="cobalt">3/3 limit reached</Pill>
          {/if}
        </div>

        <!-- Two vertical halves -->
        <div class="grid grid-cols-2 gap-3">
          <!-- Left: Standard topic (from what was taught in class) -->
          <Card class="flex flex-col gap-3 p-4">
            <div class="flex items-center gap-1.5">
              <BookOpen class="size-3.5 text-text-secondary" />
              <div class="text-[13px] font-semibold">Topic from class (textbook)</div>
            </div>
            <div class="text-[11px] text-text-secondary">
              Type the exact topic you taught. AI retrieves from class textbook chunks (RAG), gives a short summary, then MCQ questions.
            </div>
            <div class="rounded-2xl border border-[#d7e7ff] bg-[#eef6ff] px-3 py-2 text-[11px] leading-[1.55] text-[#2f67c8]">
              Output language follows the textbook PDF for this subject, so Tamil PDFs stay in Tamil and English PDFs stay in English.
            </div>
            <div class="flex gap-2">
              <Input
                bind:value={standardDraft}
                placeholder="e.g. Parts of a plant"
                disabled={!canEdit}
                onkeydown={(e: KeyboardEvent) => e.key === "Enter" && addTopic(standardDraft, "standard")}
              />
              <Button
                variant="primary"
                onclick={() => addTopic(standardDraft, "standard")}
                disabled={!canEdit || !standardDraft.trim()}
              >
                <Plus class="size-3.5" />
              </Button>
            </div>

            <!-- Topics added from standard -->
            {#each subjectTopics.filter((t) => t.source === "standard") as t (t.id)}
              <div class="flex items-center gap-2 rounded-lg border border-border-default bg-gray-50 px-3 py-2">
                <div class="min-w-0 flex-1 text-[12px] font-medium">{t.topic}</div>
                {#if !readOnly}
                  <Button
                    variant="ghost"
                    size="icon"
                    onclick={() => reteachTopics.remove(activeClass!, t.id)}
                    aria-label="Remove"
                  >
                    <X class="size-3.25" />
                  </Button>
                {/if}
              </div>
            {/each}
          </Card>

          <!-- Right: Custom topic (teacher's own instruction) -->
          <Card class="flex flex-col gap-3 p-4">
            <div class="flex items-center gap-1.5">
              <Pencil class="size-3.5 text-text-secondary" />
              <div class="text-[13px] font-semibold">Custom topic (class-level)</div>
            </div>
            <div class="text-[11px] text-text-secondary">
              Add a topic beyond the textbook. AI uses web notes and explains only at the selected class level (up to Class 5), then asks MCQs.
            </div>
            <div class="rounded-2xl border border-[#f3d49a] bg-[#fff8ea] px-3 py-2 text-[11px] leading-[1.55] text-[#9a6708]">
              Custom topics also follow the class textbook language preference when AI builds the summary and MCQs.
            </div>
            <div class="flex gap-2">
              <Input
                bind:value={customDraft}
                placeholder="e.g. Narrate a story about…"
                disabled={!canEdit}
                onkeydown={(e: KeyboardEvent) => e.key === "Enter" && addTopic(customDraft, "custom")}
              />
              <Button
                variant="primary"
                onclick={() => addTopic(customDraft, "custom")}
                disabled={!canEdit || !customDraft.trim()}
              >
                <Plus class="size-3.5" />
              </Button>
            </div>

            <!-- Topics added as custom -->
            {#each subjectTopics.filter((t) => t.source === "custom") as t (t.id)}
              <div class="flex items-center gap-2 rounded-lg border border-cobalt-100 bg-cobalt-25 px-3 py-2">
                <div class="min-w-0 flex-1 text-[12px] font-medium">{t.topic}</div>
                {#if !readOnly}
                  <Button
                    variant="ghost"
                    size="icon"
                    onclick={() => reteachTopics.remove(activeClass!, t.id)}
                    aria-label="Remove"
                  >
                    <X class="size-3.25" />
                  </Button>
                {/if}
              </div>
            {/each}
          </Card>
        </div>
      </div>
    {:else}
      <Card class="flex h-36 items-center justify-center text-center">
        <div class="text-[13px] text-text-tertiary">
          {activeClass ? "Select a subject to add topics" : "Select a class to start"}
        </div>
      </Card>
    {/if}
  </div>
</Page>
