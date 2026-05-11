<script lang="ts">
  import { goto } from "$app/navigation";
  import { BookOpen, CheckCircle2, Clock, Download, Sparkles, Sprout } from "lucide-svelte";
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
  let selectedPlanKey = $state("");

  const sortedPlans = $derived(
    Object.entries(plans).sort(([left], [right]) => left.localeCompare(right)),
  );
  const selectedPlan = $derived(
    selectedPlanKey ? plans[selectedPlanKey] ?? null : sortedPlans[0]?.[1] ?? null,
  );
  const activePlanKey = $derived(selectedPlanKey || sortedPlans[0]?.[0] || "");
  const activeClassMeta = $derived(
    CLASSES.find((candidate) => `class_${candidate.id}` === activePlanKey) ?? null,
  );

  const phaseToTone = (phase: string): "cobalt" | "saffron" =>
    ["warm_up", "wrap_up", "check"].includes(phase) ? "saffron" : "cobalt";

  function exportSelectedPlan(): void {
    if (!selectedPlan) return;

    const classLabel = activeClassMeta?.name ?? activePlanKey.replace("class_", "Class ");
    const lines = [
      "LESSON BLUEPRINT",
      "================",
      `${selectedPlan.subjectLabel || selectedPlan.subject} · ${classLabel} · ${selectedPlan.durationMin}m`,
      `Chapter: ${selectedPlan.blueprint.title}`,
      `Saved: ${new Date(selectedPlan.savedAt).toLocaleString("en-IN")}`,
      "",
      ...selectedPlan.blueprint.blocks.flatMap((block) => [
        `[ ${block.phase.toUpperCase().replace("_", "-")} ]${block.durationMin > 0 ? `  ${block.durationMin} min` : ""}`,
        block.title,
        block.body,
        "",
      ]),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activePlanKey}-${selectedPlan.subject}-${selectedPlan.blueprint.title.replace(/\s+/g, "-").toLowerCase()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadPlans(): Promise<void> {
    try {
      const res = await fetch("/api/lesson/plan/today");
      const data = await res.json();
      plans = (data.plans ?? {}) as Record<string, PlanEntry>;
      selectedPlanKey = Object.keys(plans).sort((left, right) => left.localeCompare(right))[0] ?? "";
    } catch {
      plans = {};
      selectedPlanKey = "";
    } finally {
      loading = false;
    }
  }

  void loadPlans();
</script>

<Page class="flex h-full min-h-0 flex-col overflow-hidden">
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
    <div class="text-text-secondary grid flex-1 place-items-center text-center text-[13px]">Loading…</div>
  {:else if Object.keys(plans).length === 0}
    <div
      class="border-border-default flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed py-20 text-center"
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
    <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(240px,0.78fr)_minmax(0,1fr)] gap-5 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-1">
      <Card class="flex min-h-0 flex-col overflow-hidden p-0">
        <div class="border-border-default shrink-0 border-b px-5 pt-5 pb-4">
          <div class="label-eyebrow mb-1">Saved plans</div>
          <div class="text-ink text-[17px] font-semibold">Today's classes</div>
          <div class="text-text-secondary mt-1 text-[13px]">
            Pick a class on the left to open its blueprint on the right.
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          <div class="space-y-2.5">
            {#each sortedPlans as [clsKey, plan] (clsKey)}
              {@const clsMeta = CLASSES.find((candidate) => `class_${candidate.id}` === clsKey)}
              {@const selected = activePlanKey === clsKey}
              <button
                type="button"
                onclick={() => (selectedPlanKey = clsKey)}
                class="w-full cursor-pointer rounded-2xl border px-4 py-3 text-left transition-colors"
                style={selected
                  ? `border-color:${clsMeta?.color ?? '#6B94E7'}; background:${clsMeta?.color ?? '#6B94E7'}14; box-shadow:0 8px 24px -18px ${clsMeta?.color ?? '#6B94E7'};`
                  : 'border-color:var(--border-default); background:white;'}
              >
                <div class="flex items-start gap-3">
                  <div
                    class="grid size-10 shrink-0 place-items-center rounded-xl text-[15px] font-bold"
                    style="background:{clsMeta?.color ?? '#888'}22; color:{clsMeta?.color ?? '#888'};"
                  >
                    {clsMeta?.id ?? "?"}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <div class="text-ink text-[14px] font-semibold">{clsMeta?.name ?? clsKey}</div>
                      {#if selected}
                        <CheckCircle2 class="size-3.5" style="color:{clsMeta?.color ?? '#6B94E7'};" />
                      {/if}
                    </div>
                    <div class="text-text-secondary mt-0.5 truncate text-[12px]">
                      {plan.subjectLabel || plan.subject}
                    </div>
                    <div class="text-text-secondary mt-1 truncate text-[12px] font-medium">
                      {plan.blueprint.title}
                    </div>
                  </div>
                  <Pill tone="cobalt">
                    <Clock class="size-2.5" />
                    {plan.durationMin}m
                  </Pill>
                </div>
              </button>
            {/each}
          </div>
        </div>
      </Card>

      <Card
        class="flex min-h-0 flex-col overflow-hidden p-0"
        style="background: repeating-linear-gradient(to bottom, var(--ivory) 0 30px, #F3EFE6 30px 31px);"
      >
        {#if selectedPlan}
          <div class="bg-ivory border-border-default shrink-0 border-b px-6 pt-6 pb-4.5 md:px-8">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="label-eyebrow">
                  {selectedPlan.subjectLabel || selectedPlan.subject} · {activeClassMeta?.name ?? activePlanKey} · {selectedPlan.durationMin}m
                </div>
                <div class="text-ink mt-1.5 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] md:text-[26px]">
                  {selectedPlan.blueprint.title}
                </div>
                <div class="mt-2.5 flex flex-wrap gap-2">
                  <Pill tone="saffron">{selectedPlan.subjectLabel || selectedPlan.subject}</Pill>
                  <Pill tone="cobalt">{selectedPlan.blueprint.blocks.length} phases</Pill>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onclick={exportSelectedPlan}>
                  <Download class="size-3.5" /> Download
                </Button>
                <div class="bg-saffron-50 border-saffron-100 grid size-15 place-items-center rounded-2xl border">
                  <Sprout class="size-7 text-saffron-600" />
                </div>
              </div>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto overscroll-contain px-6 py-6 md:px-8">
            {#each selectedPlan.blueprint.blocks as block (block.phase)}
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
    </div>
  {/if}
</Page>
