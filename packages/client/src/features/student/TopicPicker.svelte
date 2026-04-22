<script lang="ts">
  import { goto } from "$app/navigation";
  import { ArrowRight, Clock } from "lucide-svelte";
  import { Button } from "@shadcn";
  import { Page, PageHeader, Pill, Tablet } from "@components";

  let picked = $state<string | null>(null);

  const topics = [
    { id: "plants", t: "Plants around us", emoji: "🌱", color: "#8FB89A", mins: 6 },
    { id: "parts", t: "Parts of a plant", emoji: "🍃", color: "#6B94E7", mins: 5 },
  ];
</script>

<Page maxWidth={980}>
  <PageHeader
    eyebrow="Tablet view · Class 3"
    title="Student tablet"
    subtitle="This is what children see after handoff."
  >
    {#snippet actions()}
      <Button variant="secondary" onclick={() => goto("/student/socratic")}>
        Preview Socratic <ArrowRight class="size-[14px]" />
      </Button>
    {/snippet}
  </PageHeader>

  <Tablet>
    <div class="flex h-full flex-col p-7">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div
            class="font-tamil grid size-8.5 place-items-center rounded-xl text-[14px] font-bold"
            style="background: #8FB89A22; color: #2F8A4F;"
          >
            ௩
          </div>
          <div>
            <div class="text-[13px] font-semibold">Class 3 · Science</div>
            <div class="ta text-text-secondary text-[11px]">வகுப்பு மூன்று</div>
          </div>
        </div>
        <Pill tone="success">
          <span class="bg-success-500 size-1.5 rounded-full"></span>
          Local AI ready
        </Pill>
      </div>

      <div class="mt-8 text-center">
        <div
          class="text-ink text-[26px] leading-tight font-semibold tracking-[-0.02em] md:text-[34px]"
        >
          What would you like to learn again?
        </div>
        <div class="ta text-text-secondary mt-1.5 text-[16px]">எதை மறுபடியும் கற்க வேண்டும்?</div>
      </div>

      <div class="mx-auto mt-10 grid w-full max-w-[620px] grid-cols-1 gap-4.5 sm:grid-cols-2">
        {#each topics as top (top.id)}
          {@const sel = picked === top.id}
          <button
            type="button"
            onclick={() => (picked = top.id)}
            class="cursor-pointer rounded-2xl p-5.5 text-left transition-all duration-150"
            style={sel
              ? `background: ${top.color}18; border: 2px solid ${top.color}; transform: translateY(-2px); box-shadow: 0 12px 24px -12px ${top.color}66;`
              : "background: #fff; border: 1px solid var(--border-default); box-shadow: var(--shadow-card);"}
          >
            <div class="mb-3 text-[40px]">{top.emoji}</div>
            <div class="text-ink text-[18px] font-semibold">{top.t}</div>
            <div class="text-text-secondary mt-1.5 inline-flex items-center gap-1 text-[11px]">
              <Clock class="size-[11px]" /> about {top.mins} minutes together
            </div>
          </button>
        {/each}
      </div>

      <div class="mt-auto">
        <Button
          variant="primary"
          size="lg"
          class="mt-7 w-full"
          disabled={!picked}
          onclick={() => goto("/student/socratic")}
        >
          Start together <ArrowRight class="size-[14px]" />
        </Button>
        <div class="text-text-secondary mt-2.5 text-center text-[11px]">
          First we'll read the lesson together · then one question each, taking turns.
        </div>
      </div>
    </div>
  </Tablet>
</Page>
