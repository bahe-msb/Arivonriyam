<script lang="ts">
  import { goto } from "$app/navigation";
  import { ArrowLeft, ArrowRight, Plus, X } from "lucide-svelte";
  import { Button, Card, Input } from "@shadcn";

  import { ModeToggle, Page, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";

  interface Topic {
    t: string;
    mode: string;
  }

  let active = $state(3);
  let draft = $state("");

  let topics = $state<Record<number, Topic[]>>({
    1: [{ t: "Vowels அ to ஈ", mode: "summary+qa" }],
    2: [
      { t: "Counting 1–20", mode: "qa" },
      { t: "Addition with fingers", mode: "summary" },
    ],
    3: [
      { t: "Plants around us", mode: "summary+qa" },
      { t: "Parts of a plant", mode: "qa" },
    ],
    4: [{ t: "Simple present tense", mode: "qa" }],
    5: [{ t: "Indian freedom struggle — Intro", mode: "summary+qa" }],
  });

  function add(): void {
    if (!draft.trim()) return;
    topics[active] = [...(topics[active] ?? []), { t: draft.trim(), mode: "summary+qa" }];
    draft = "";
  }

  function remove(idx: number): void {
    topics[active] = (topics[active] ?? []).filter((_, i) => i !== idx);
  }

  function setMode(idx: number, m: string): void {
    topics[active] = (topics[active] ?? []).map((x, i) => (i === idx ? { ...x, mode: m } : x));
  }

  const activeCls = $derived(CLASSES.find((c) => c.id === active)!);
</script>

<Page>
  <PageHeader
    eyebrow="Morning ritual · Step 2 of 2"
    title="What should AI reteach today?"
    subtitle="Pick topics you've already taught. AI will summarise, then ask Socratic questions — one child at a time."
  >
    {#snippet actions()}
      <Button variant="secondary" onclick={() => goto("/lesson")}>
        <ArrowLeft class="size-[14px]" /> Back to plan
      </Button>
      <Button variant="primary" onclick={() => goto("/handoff")}>
        Continue to handoff <ArrowRight class="size-[14px]" />
      </Button>
    {/snippet}
  </PageHeader>

  <div class="grid grid-cols-1 gap-5 md:grid-cols-[260px_1fr]">
    <!-- Class rail -->
    <Card class="h-fit p-2.5">
      {#each CLASSES as c (c.id)}
        {@const count = (topics[c.id] ?? []).length}
        {@const sel = c.id === active}
        <button
          type="button"
          onclick={() => (active = c.id)}
          class="mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-3 text-left transition-colors
                 {sel
            ? 'bg-cobalt-25 border-cobalt-50 border'
            : 'border border-transparent bg-transparent hover:bg-gray-50'}"
        >
          <span
            class="grid size-7.5 place-items-center rounded-lg text-[13px] font-bold"
            style="background: {c.color}22; color: {c.color};"
          >
            {c.id}
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-medium">{c.name}</div>
            <div class="text-text-secondary text-[11px]">
              {count}
              {count === 1 ? "topic" : "topics"}
            </div>
          </div>
          {#if count > 0}
            <span
              class="bg-saffron-500 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
            >
              {count}
            </span>
          {/if}
        </button>
      {/each}
    </Card>

    <!-- Topic list -->
    <div>
      <Card class="mb-4 p-5">
        <div class="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-[17px] font-semibold">
              {activeCls.name} reteach list
            </div>
            <div class="text-text-secondary ta text-[11px]">
              {activeCls.ta} · {activeCls.students} learners
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 sm:flex-nowrap">
          <Input
            bind:value={draft}
            placeholder="e.g. Parts of a plant, counting in tens…"
            onkeydown={(e: KeyboardEvent) => e.key === "Enter" && add()}
          />
          <Button variant="primary" onclick={add}>
            <Plus class="size-[14px]" /> Add
          </Button>
        </div>
        <div class="text-text-secondary mt-2.5 text-[11px]">
          Tip: add the exact phrasing you used at the board. The AI retrieves from the NCERT
          textbooks on your laptop (RAG).
        </div>
      </Card>

      <div class="flex flex-col gap-2.5">
        {#each topics[active] ?? [] as top, i (top.t + i)}
          <Card class="p-4">
            <div class="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <div class="text-[14px] font-medium">{top.t}</div>
                <div class="mt-2 flex gap-1.5">
                  <ModeToggle value={top.mode} onChange={(m) => setMode(i, m)} />
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <Pill tone="cobalt">Retrieved from Ch 7, p 42</Pill>
                <Button
                  variant="ghost"
                  size="icon"
                  onclick={() => remove(i)}
                  aria-label="Remove topic"
                >
                  <X class="size-[14px]" />
                </Button>
              </div>
            </div>
          </Card>
        {:else}
          <Card class="p-9 text-center text-text-tertiary">
            No reteach topics yet. Add what you'd like AI to cover for
            {activeCls.name}.
          </Card>
        {/each}
      </div>
    </div>
  </div>
</Page>
