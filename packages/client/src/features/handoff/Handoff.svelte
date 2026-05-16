<script lang="ts">
  import { goto } from "$app/navigation";
  import { Lock, Users, Tablet as TabletIcon, ArrowRight, Heart, AlertCircle } from "lucide-svelte";
  import { Button, Card } from "@shadcn";

  import { DateNav, Page, PageHeader, Pill } from "@components";
  import { CLASSES, type ClassInfo } from "@mocks";
  import { activeClass, reteachTopics, schoolConfig } from "@stores";

  void reteachTopics.load();
  void schoolConfig.load();
  const readOnly = $derived(reteachTopics.readOnly);

  // Only classes that actually exist in this school's roster render. The
  // visual presets (color/Tamil name) for grade-levels 1-5 still come from
  // the CLASSES mock — but the student count is the live roster size, and
  // a class with zero students never shows.
  const classList = $derived.by<ClassInfo[]>(() => {
    const byClass = schoolConfig.studentsByClass;
    return CLASSES
      .map((preset) => {
        const roster = byClass[preset.id] ?? [];
        return { ...preset, students: roster.length };
      })
      .filter((cls) => cls.students > 0);
  });

  const activeHandoff = $derived.by(() => {
    const cls = classList.find((candidate) => candidate.id === activeClass.id);
    if (!cls) return null;

    const selectedTopic = reteachTopics.getSelectedTopic(cls.id);
    if (!selectedTopic || reteachTopics.isCompleted(selectedTopic.id)) return null;

    return {
      cls,
      topic: selectedTopic.topic,
    };
  });

  function doHandoff(cls: ClassInfo): void {
    if (readOnly) return;
    activeClass.set(cls.id);
    goto(`/student/topic?class=${cls.id}`);
  }
</script>

<Page>
  <PageHeader
    eyebrow="Handoff"
    title="Pass the tablet to a class"
    subtitle="One tap locks the tablet to that class's reteach topics. Children can't wander into another class's screen."
  >
    {#snippet actions()}
      <DateNav
        label="Day"
        value={reteachTopics.currentDate}
        onChange={(d) => void reteachTopics.setDate(d)}
      />
      {#if activeHandoff}
        <Pill tone="cobalt">
          <Lock class="size-3" />
          Active handoff: {activeHandoff.cls.name}
        </Pill>
      {:else}
        <Pill tone="default">
          <Lock class="size-3" />
          No active tablet handoff
        </Pill>
      {/if}
    {/snippet}
  </PageHeader>

  {#if readOnly}
    <div class="mb-4 rounded-2xl border border-[#f3d49a] bg-[#fff8ea] px-4 py-2.5 text-[12px] text-[#9a6708]">
      Viewing past day — tablet handoff is disabled. Switch to Today to send a tablet.
    </div>
  {/if}

  {#if classList.length === 0}
    <Card class="border-clay-100 bg-clay-50 p-8 text-center">
      <div class="text-[16px] font-semibold">No classes set up yet</div>
      <div class="text-text-secondary mx-auto mt-1.5 max-w-md text-[12px]">
        Add students to at least one class from the school setup screen, and the handoff cards will appear here.
      </div>
    </Card>
  {/if}

  <div class="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
    {#each classList as cls (cls.id)}
      {@const topics = reteachTopics.get(cls.id)}
      {@const hasTopics = topics.length > 0}
      {@const isActive = activeHandoff?.cls.id === cls.id}
      <Card
        hover
        class="overflow-hidden p-0 transition-all"
        style={isActive
          ? `box-shadow:0 18px 42px -24px ${cls.color}, 0 0 0 2px ${cls.color};`
          : ""}
      >
        <div
          class="border-border-default border-b px-5 pt-5 pb-4"
          style="background: {cls.color}{isActive ? '24' : '18'};"
        >
          <div class="flex items-start justify-between">
            <div>
              <div class="flex items-center gap-2">
                <div class="text-[18px] font-semibold">{cls.name}</div>
                {#if isActive}
                  <Pill tone="cobalt"><Lock class="size-2.75" /> Active</Pill>
                {/if}
              </div>
              <div class="text-text-secondary ta text-[12px]">{cls.ta}</div>
            </div>
            <div
              class="font-tamil grid size-11 shrink-0 place-items-center rounded-xl text-[18px] font-bold text-white"
              style="background: {cls.color};"
            >
              {cls.id}
            </div>
          </div>
        </div>
        <div class="p-5">
          <div class="label-eyebrow mb-2">Today's reteach</div>
          {#if hasTopics}
            <div class="mb-3.5 flex flex-col gap-1.5">
              {#each topics as t (t.id)}
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 size-1.5 shrink-0 rounded-full" style="background: {cls.color};"></span>
                  <span class="text-[13px]">{t.topic}</span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="mb-3.5 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
              <AlertCircle class="mt-0.5 size-3.5 shrink-0 text-text-tertiary" />
              <span class="text-[12px] text-text-secondary">
                Teacher has not yet added reteach topics for {cls.name}.
              </span>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2.5">
            <span class="text-text-secondary inline-flex items-center gap-1 text-[11px]">
              <Users class="size-2.75" />
              {cls.students} learners
            </span>
            <span class="text-text-secondary inline-flex items-center gap-1 text-[11px]">
              <TabletIcon class="size-2.75" />
              Tablet {cls.id}{isActive ? " · Active" : ""}
            </span>
          </div>
          <Button
            variant="primary"
            class="mt-3.5 w-full"
            disabled={!hasTopics || readOnly}
            onclick={() => doHandoff(cls)}
          >
            {isActive ? "Resume active tablet" : `Hand tablet to ${cls.name}`}
            <ArrowRight class="size-3.5" />
          </Button>
        </div>
      </Card>
    {/each}
  </div>

  <Card class="bg-clay-50 border-clay-100 mt-5 p-5">
    <div class="flex items-start gap-3.5">
      <div class="bg-saffron-500 grid size-9 shrink-0 place-items-center rounded-xl text-white">
        <Heart class="size-4" />
      </div>
      <div>
        <div class="text-[14px] font-semibold">The teacher stays free.</div>
        <div class="text-text-secondary mt-1 max-w-160 text-[12px] leading-[1.55]">
          While the tablet teaches one class, you have a full window to sit beside another.
          Arivonriyam will quietly flag any child who struggles — only after they have tried — so
          your attention goes where it matters.
        </div>
      </div>
    </div>
  </Card>
</Page>
