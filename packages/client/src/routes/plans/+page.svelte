<script lang="ts">
  import { goto } from "$app/navigation";
  import { BookOpen, ChevronDown, ChevronUp, Clock, Sparkles } from "lucide-svelte";
  import { Button, Card } from "@shadcn";
  import { Block, Page, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";

  type BlueprintBlock = { phase: string; title: string; durationMin: number; body: string };
  type Blueprint = { title: string; blocks: BlueprintBlock[] };
  type PlanEntry = {
    className: string;
    subject: string;
    subjectLabel: string;
    chapter: string;
    durationMin: number;
    blueprint: Blueprint;
    savedAt: string;
  };

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  let plans = $state<Record<string, PlanEntry>>({});
  let loading = $state(true);
  let expanded = $state<Record<string, boolean>>({});

  const phaseToTone = (phase: string): "cobalt" | "saffron" =>
    ["warm_up", "wrap_up", "check"].includes(phase) ? "saffron" : "cobalt";

  async function loadPlans(): Promise<void> {
    try {
      const res = await fetch("/api/lesson/plan/today");
      const data = await res.json();
      plans = (data.plans ?? {}) as Record<string, PlanEntry>;
    } catch {
      plans = {};
    } finally {
      loading = false;
    }
  }

  function toggleExpand(cls: string): void {
    expanded[cls] = !expanded[cls];
  }

  void loadPlans();
</script>

<Page>
  <PageHeader
    eyebrow={today}
    title="Today's Saved Plans"
    subtitle="All lesson blueprints saved for today, one per class."
  >
    {#snippet actions()}
      <Button variant="primary" onclick={() => goto("/lesson")}>
        <Sparkles class="size-3.5" /> New blueprint
      </Button>
    {/snippet}
  </PageHeader>

  {#if loading}
    <div class="text-text-secondary py-20 text-center text-[13px]">Loading…</div>
  {:else if Object.keys(plans).length === 0}
    <div
      class="border-border-default flex flex-col items-center gap-4 rounded-2xl border border-dashed py-20 text-center"
    >
      <BookOpen class="text-text-secondary size-8 opacity-40" />
      <div>
        <div class="text-ink text-[16px] font-semibold">No plans saved yet</div>
        <div class="text-text-secondary mt-1 text-[13px]">
          Generate and save a blueprint from the Lesson Architect.
        </div>
      </div>
      <Button variant="secondary" onclick={() => goto("/lesson")}>
        <Sparkles class="size-3.5" /> Go to Lesson Architect
      </Button>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each Object.entries(plans).sort(([a], [b]) => a.localeCompare(b)) as [clsKey, plan] (clsKey)}
        {@const clsMeta = CLASSES.find((c) => `class_${c.id}` === clsKey)}
        <Card class="overflow-hidden p-0">
          <!-- Card header -->
          <div class="p-4 pb-3.5">
            <div class="mb-3 flex items-start gap-3">
              <div
                class="grid size-10 shrink-0 place-items-center rounded-xl text-[15px] font-bold"
                style="background: {clsMeta?.color ?? '#888'}22; color: {clsMeta?.color ?? '#888'};"
              >
                {clsMeta?.id ?? "?"}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-ink text-[14px] font-semibold">{clsMeta?.name ?? clsKey}</div>
                <div class="text-text-secondary truncate text-[12px]">
                  {plan.subjectLabel || plan.subject}
                </div>
              </div>
              <Pill tone="cobalt">
                <Clock class="size-[10px]" />
                {plan.durationMin}m
              </Pill>
            </div>
            <div class="label-eyebrow mb-0.5">Chapter</div>
            <div class="text-ink text-[14px] font-medium leading-snug">{plan.blueprint.title}</div>
          </div>

          <!-- Toggle blueprint -->
          <button
            type="button"
            onclick={() => toggleExpand(clsKey)}
            class="border-border-default text-text-secondary flex w-full items-center justify-between border-t px-4 py-2.5 text-[12px] font-medium transition-colors hover:bg-gray-50"
          >
            <span>{plan.blueprint.blocks.length} phases</span>
            {#if expanded[clsKey]}
              <ChevronUp class="size-3.5" />
            {:else}
              <ChevronDown class="size-3.5" />
            {/if}
          </button>

          {#if expanded[clsKey]}
            <div
              class="px-4 py-4"
              style="background: repeating-linear-gradient(to bottom, var(--ivory) 0 30px, #F3EFE6 30px 31px);"
            >
              {#each plan.blueprint.blocks as block (block.phase)}
                <Block
                  phase={block.phase}
                  title={block.title}
                  durationMin={block.durationMin}
                  tone={phaseToTone(block.phase)}
                >
                  {block.body}
                </Block>
              {/each}
            </div>
          {/if}
        </Card>
      {/each}
    </div>
  {/if}
</Page>
