<script lang="ts">
  import {
    Sparkles,
    Lock,
    Download,
    Mic,
    Target,
    Leaf,
    LayoutPanelTop,
    Tablet as TabletIcon,
    Heart,
  } from "lucide-svelte";
  import { Button, Card, Textarea, Select } from "@shadcn";

  import { Block, Page, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { cn } from "@utils";

  let cls = $state(3);
  let subject = $state("Science");
  let topic = $state("Plants around us");
  let intention = $state("");
  let duration = $state("45m");
  let recording = $state(false);

  const subjects = ["Tamil", "Maths", "Science", "English", "Social"];
  const durations = ["30m", "40m", "45m", "50m"];
</script>

<Page maxWidth={1400}>
  <PageHeader
    eyebrow="Morning ritual · Step 1 of 2"
    title="Lesson Architect"
    subtitle="Speak or type your intent. The local AI drafts a 45-minute blueprint for each grade."
  >
    {#snippet actions()}
      <Pill tone="default"><Lock class="size-3" /> Draft · unsaved</Pill>
      <Button variant="secondary">
        <Download class="size-[14px]" /> Export
      </Button>
      <Button variant="primary">Save plan</Button>
    {/snippet}
  </PageHeader>

  <div class="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
    <!-- Left: Input -->
    <Card class="p-5">
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

      <div class="mb-3.5 grid grid-cols-2 gap-3">
        <div>
          <div class="label-eyebrow mb-1.5">Subject</div>
          <Select.Root type="single" bind:value={subject}>
            <Select.Trigger>
              {subject}
            </Select.Trigger>
            <Select.Content>
              {#each subjects as s (s)}
                <Select.Item value={s} label={s}>{s}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div>
          <div class="label-eyebrow mb-1.5">Duration</div>
          <Select.Root type="single" bind:value={duration}>
            <Select.Trigger>
              {duration}
            </Select.Trigger>
            <Select.Content>
              {#each durations as d (d)}
                <Select.Item value={d} label={d}>{d}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>

      <div class="label-eyebrow mb-1.5">Topic focus</div>
      <Textarea bind:value={topic} rows={3} />

      <div class="label-eyebrow mt-4 mb-1.5">Your intention (optional)</div>
      <Textarea
        bind:value={intention}
        rows={3}
        placeholder="e.g. Spend more time on examples from our village — mango, neem, paddy."
      />

      <div
        class="bg-clay-50 border-saffron-300 mt-4 rounded-xl
               border border-dashed p-4 text-center"
      >
        <button
          type="button"
          onclick={() => (recording = !recording)}
          class={cn(
            "mx-auto grid size-13 cursor-pointer place-items-center rounded-full text-white transition-all duration-200",
            recording
              ? "bg-danger-500 shadow-[0_0_0_6px_rgba(221,22,22,0.18)]"
              : "bg-cobalt-500 shadow-[0_6px_18px_-6px_rgba(44,102,221,0.5)]",
          )}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          <Mic class="size-5" />
        </button>
        <div class="mt-2.5 text-[13px] font-medium">
          {recording ? "Listening…" : "Tap to dictate in Tamil or English"}
        </div>
        <div class="text-text-secondary mt-1 text-[11px]">
          Powered by whisper.cpp · On your laptop
        </div>
      </div>

      <Button variant="primary" size="lg" class="mt-4 w-full">
        <Sparkles class="size-[15px]" /> Generate blueprint
      </Button>
    </Card>

    <!-- Right: Output -->
    <Card
      class="overflow-hidden p-0"
      style="background: repeating-linear-gradient(to bottom, var(--ivory) 0 30px, #F3EFE6 30px 31px);"
    >
      <div class="bg-ivory border-border-default border-b px-6 pt-6 pb-4.5 md:px-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="label-eyebrow">Science · Class 3 · 45 min</div>
            <div
              class="text-ink mt-1.5 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] md:text-[26px]"
            >
              Plants around us
            </div>
            <div class="mt-2.5 flex flex-wrap gap-2">
              <Pill tone="saffron">NCERT EVS-III · Ch 7</Pill>
              <Pill tone="cobalt">4 learners</Pill>
            </div>
          </div>
          <div
            class="bg-saffron-50 border-saffron-100 grid size-15 shrink-0 place-items-center rounded-2xl border"
          >
            <span class="text-[28px]">🌱</span>
          </div>
        </div>
      </div>

      <div class="px-6 py-6 md:px-8">
        <Block n={1} title="Learning objective" tone="cobalt">
          {#snippet icon()}<Target class="size-[15px]" />{/snippet}
          By the end of this lesson, children will name five plants found near their home or school, identify
          the parts of a plant (root, stem, leaf, flower, fruit), and explain in their own words why plants
          need sunlight, water, and soil.
        </Block>
        <Block n={2} title="Anchor activity · 10m" tone="saffron">
          {#snippet icon()}<Leaf class="size-[15px]" />{/snippet}
          <b>The schoolyard walk.</b> Lead children outside. Ask each child to bring back one leaf. Let
          them describe its shape, smell, and colour before you name the plant.
        </Block>
        <Block n={3} title="At the blackboard · 20m" tone="cobalt">
          {#snippet icon()}<LayoutPanelTop class="size-[15px]" />{/snippet}
          Draw a simple plant. Label together: <i>root, stem, leaf, flower, fruit.</i>
          Ask:
          <span class="text-saffron-700 font-medium">
            "If the root is like a straw, what is it drinking?"
          </span>
        </Block>
        <Block n={4} title="Tablet time · 10m" tone="saffron">
          {#snippet icon()}<TabletIcon class="size-[15px]" />{/snippet}
          Hand Class 3 the tablet. AI will reteach
          <b>"What plants need to grow"</b> in Socratic mode, one question per child in a cycle. You are
          free to sit with Class 5 during this window.
        </Block>
        <Block n={5} title="Close with warmth · 5m" tone="cobalt">
          {#snippet icon()}<Heart class="size-[15px]" />{/snippet}
          Each child names <i>one</i> plant they will look at on their way home. Say their answer back
          to them.
        </Block>
      </div>
    </Card>
  </div>
</Page>
