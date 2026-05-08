<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { ArrowRight, BookOpen, Pencil } from "lucide-svelte";
  import { Button, Card } from "@shadcn";
  import { Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { activeClass, reteachTopics } from "@stores";
  import type { ReteachTopic } from "@stores";

  let pickedClassId = $state<number | null>(null);
  const cls = $derived(CLASSES.find((c) => c.id === pickedClassId));
  const topics = $derived(pickedClassId !== null ? reteachTopics.get(pickedClassId) : []);

  let picked = $state<ReteachTopic | null>(null);

  function selectClass(id: number): void {
    pickedClassId = id;
    // Restore previously selected topic for this class if it still exists
    const saved = reteachTopics.getSelectedTopic(id);
    picked = saved && reteachTopics.get(id).some((t) => t.id === saved.id) ? saved : null;
  }

  function select(t: ReteachTopic): void {
    picked = picked?.id === t.id ? null : t;
  }

  function proceed(): void {
    if (!picked || pickedClassId === null) return;
    activeClass.set(pickedClassId);
    reteachTopics.selectTopic(picked, pickedClassId);
    goto(resolve("/student/socratic"));
  }
</script>


<!-- Desktop: h-full fill viewport, full-width tablet frame -->
<div class="hidden md:flex h-full flex-col overflow-hidden px-8 py-5 gap-4">

  <!-- Page header -->
  <div class="mb-2 flex shrink-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      <div class="label-eyebrow text-saffron-600">Student view · {cls?.name ?? "Select a class"}</div>
      <div class="page-title mt-1">Topic Picker</div>
      <div class="page-subtitle">Select a class, then choose a topic. Summary and MCQs follow the uploaded textbook language.</div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Pill tone="success">
        <span class="bg-success-500 size-1.5 rounded-full animate-pulse"></span>
        Local AI ready
      </Pill>
      <Pill tone="cobalt">Tamil or English follows the textbook PDF</Pill>
      <Button variant="primary" disabled={!picked || pickedClassId === null} onclick={proceed}>
        Start session <ArrowRight class="size-3.5" />
      </Button>
    </div>
  </div>

  <!-- Class selector -->
  <div class="flex shrink-0 flex-wrap gap-2">
    {#each CLASSES as c (c.id)}
      <button
        type="button"
        onclick={() => selectClass(c.id)}
        class="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all"
        style="{pickedClassId === c.id
          ? `background:${c.color}18;border-color:${c.color};color:${c.color};`
          : 'background:white;border-color:var(--border-default);color:var(--text-secondary);'}"
      >
        <span class="inline-block size-2 rounded-full" style="background:{c.color};"></span>
        {c.name}
      </button>
    {/each}
  </div>

  <div
    class="min-h-0 flex-1 rounded-[28px] p-3.5"
    style="background:#0b0d14; box-shadow:0 40px 80px -30px rgba(13,17,29,0.45),0 0 0 1px #1b1d28 inset;"
  >
    <div class="h-full w-full overflow-hidden rounded-2xl" style="background:var(--ivory);">
      <div class="flex h-full flex-col">

        {#if pickedClassId === null}
          <!-- No class selected -->
          <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div class="text-5xl">🏫</div>
            <div class="text-[22px] font-semibold" style="color:var(--ink);">Select a class</div>
            <div class="text-[14px]" style="color:var(--text-secondary);">
              Choose a class above to see its reteach topics.
            </div>
            <div class="font-tamil text-[13px]" style="color:var(--text-tertiary);">
              வகுப்பை தேர்ந்தெடுக்கவும்.
            </div>
          </div>

        {:else if topics.length === 0}
          <!-- Empty state -->
          <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div class="text-5xl">📭</div>
            <div class="text-[22px] font-semibold" style="color:var(--ink);">No topics added yet</div>
            <div class="text-[14px]" style="color:var(--text-secondary);">
              Teacher has not yet added reteach topics for {cls?.name ?? "this class"}.
            </div>
            <div class="font-tamil text-[13px]" style="color:var(--text-tertiary);">
              ஆசிரியர் இன்னும் தலைப்புகளை சேர்க்கவில்லை.
            </div>
          </div>

        {:else}
          <!-- Class header row inside frame -->
          <div
            class="flex shrink-0 items-center justify-between border-b px-8 py-5"
            style="border-color:var(--border-default);"
          >
            <div class="flex items-center gap-3">
              {#if cls}
                <div
                  class="grid size-9 place-items-center rounded-xl text-[14px] font-bold text-white"
                  style="background:{cls.color};"
                >
                  {cls.id}
                </div>
                <div>
                  <div class="text-[14px] font-semibold" style="color:var(--ink);">{cls.name}</div>
                  <div class="font-tamil text-[11px]" style="color:var(--text-secondary);">{cls.ta}</div>
                </div>
              {/if}
            </div>
            <div class="text-[13px]" style="color:var(--text-secondary);">
              {topics.length} topic{topics.length !== 1 ? "s" : ""}
            </div>
          </div>

          <!-- Heading -->
          <div class="shrink-0 px-8 pb-6 pt-8 text-center">
            <div class="text-[28px] font-semibold leading-tight tracking-tight" style="color:var(--ink);">
              What would you like to learn again?
            </div>
            <div class="font-tamil mt-1.5 text-[15px]" style="color:var(--text-secondary);">
              எதை மறுபடியும் கற்க வேண்டும்?
            </div>
          </div>

          <!-- Topic picker -->
          <div
            class="flex min-h-0 flex-1 items-center gap-5 overflow-x-auto px-10 pb-6"
            style="scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:none;"
          >
            {#each topics as t (t.id)}
              {@const sel = picked?.id === t.id}
              {@const done = reteachTopics.isCompleted(t.id)}
              {@const accent = cls?.color ?? "#6B94E7"}
              <button
                type="button"
                onclick={() => select(t)}
                class="flex shrink-0 cursor-pointer flex-col rounded-3xl p-7 text-left transition-all duration-200 hover:-translate-y-1"
                style="
                  width:260px;
                  min-height:280px;
                  scroll-snap-align:center;
                  {sel
                    ? `background:${accent}12; border:2.5px solid ${accent}; box-shadow:0 16px 40px -14px ${accent}55,0 0 0 4px ${accent}14;`
                    : 'background:#ffffff; border:1.5px solid var(--border-default); box-shadow:0 2px 12px -4px rgba(0,0,0,0.06);'}
                "
              >
                <!-- Icon -->
                <div
                  class="mb-5 grid size-14 place-items-center rounded-2xl text-[30px]"
                  style="background:{sel ? accent + '15' : '#f5f4f0'};"
                >
                  {t.source === "custom" ? "✨" : "📖"}
                </div>

                <!-- Topic name -->
                <div
                  class="flex-1 text-[18px] font-semibold leading-snug"
                  style="color:var(--ink); text-wrap:pretty;"
                >
                  {t.topic}
                </div>

                <!-- Subject + type badge -->
                <div class="mt-4 flex items-center gap-1.5 flex-wrap">
                  <div
                    class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style="background:{sel ? accent + '15' : '#f0ede8'}; color:{sel ? accent : 'var(--text-secondary)'};"
                  >
                    {#if t.source === "custom"}
                      <Pencil class="size-2.75" /> Web summary · Class-level
                    {:else}
                      <BookOpen class="size-2.75" /> Textbook · {t.subject}
                    {/if}
                  </div>
                  {#if done}
                    <div class="flex items-center gap-1 rounded-full bg-[#eef9f2] px-2.5 py-1 text-[11px] font-semibold text-[#247a46]">
                      ✓ Done
                    </div>
                  {/if}
                </div>

                {#if sel}
                  <div class="mt-3 flex items-center gap-1.5 text-[12px] font-semibold" style="color:{accent};">
                    ✓ Selected
                    <span class="text-[10px] font-normal opacity-60">(tap to deselect)</span>
                  </div>
                {/if}
              </button>
            {/each}
            <!-- end spacer -->
            <div class="w-6 shrink-0"></div>
          </div>

          <!-- Scroll hint -->
          {#if topics.length > 3}
            <div class="shrink-0 pb-4 text-center text-[11px]" style="color:var(--text-tertiary);">
              ← scroll to see all {topics.length} topics →
            </div>
          {/if}
        {/if}

      </div>
    </div>
  </div>
</div>

<!-- Mobile/tablet: not available -->
<div class="md:hidden p-6">
  <Card class="p-9 text-center">
    <div class="text-[16px] font-semibold mb-2">Teacher view only</div>
    <div class="text-[13px] text-text-secondary">
      Topic Picker is shown on the teacher's screen. Students see the Socratic Q&amp;A session directly on their device.
    </div>
  </Card>
</div>
