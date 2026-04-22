<script lang="ts">
  import { goto } from "$app/navigation";
  import { Wifi, Lock, Users, Tablet as TabletIcon, Check, ArrowRight, Heart } from "lucide-svelte";
  import { Button, Card } from "@shadcn";

  import { Page, PageHeader, Pill } from "@components";
  import { CLASSES, type ClassInfo } from "@mocks";
  import { activeClass } from "@stores";

  let handedOff = $state<number | null>(null);

  function doHandoff(cls: ClassInfo): void {
    handedOff = cls.id;
    activeClass.set(cls.id);
    setTimeout(() => goto("/student/topic"), 1200);
  }

  const topicsPreview: Record<number, string[]> = {
    1: ["Plants around us"],
    2: ["Plants around us"],
    3: ["Plants around us", "Parts of a plant"],
    4: ["Plants around us"],
    5: ["Plants around us"],
  };
</script>

<Page>
  <PageHeader
    eyebrow="Handoff"
    title="Pass the tablet to a class"
    subtitle="One tap locks the tablet to that class's reteach topics. Children can't wander into another class's screen."
  >
    {#snippet actions()}
      <Pill tone="success"><Wifi class="size-3" /> 4 tablets paired</Pill>
      <Pill tone="cobalt"><Lock class="size-3" /> Kiosk lock ready</Pill>
    {/snippet}
  </PageHeader>

  <div class="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
    {#each CLASSES as cls (cls.id)}
      {@const active = handedOff === cls.id}
      <Card hover class="overflow-hidden p-0 {active ? 'ring-cobalt-500 ring-2' : ''}">
        <div
          class="border-border-default border-b px-5 pt-5 pb-4"
          style="background: {cls.color}18;"
        >
          <div class="flex items-start justify-between">
            <div>
              <div class="text-[18px] font-semibold">{cls.name}</div>
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
          <div class="mb-3.5 flex flex-col gap-1.5">
            {#each topicsPreview[cls.id] ?? [] as t (t)}
              <div class="flex items-center gap-2">
                <span class="size-1 rounded-full" style="background: {cls.color};"></span>
                <span class="text-[13px]">{t}</span>
              </div>
            {/each}
          </div>
          <div class="flex items-center justify-between gap-2.5">
            <span class="text-text-secondary inline-flex items-center gap-1 text-[11px]">
              <Users class="size-[11px]" />
              {cls.students} learners
            </span>
            <span class="text-text-secondary inline-flex items-center gap-1 text-[11px]">
              <TabletIcon class="size-[11px]" /> Tablet {cls.id}
            </span>
          </div>
          <Button
            variant={active ? "warm" : "primary"}
            class="mt-3.5 w-full"
            onclick={() => doHandoff(cls)}
          >
            {#if active}
              <Check class="size-[14px]" /> Handed to {cls.name}…
            {:else}
              Hand tablet to {cls.name}
              <ArrowRight class="size-[14px]" />
            {/if}
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
        <div class="text-text-secondary mt-1 max-w-[640px] text-[12px] leading-[1.55]">
          While the tablet teaches one class, you have a full window to sit beside another.
          Arivonriyam will quietly flag any child who struggles — only after they have tried — so
          your attention goes where it matters.
        </div>
      </div>
    </div>
  </Card>
</Page>
