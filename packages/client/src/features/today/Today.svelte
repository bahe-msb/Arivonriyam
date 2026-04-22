<script lang="ts">
  import { goto } from "$app/navigation";
  import { Sparkles, BookOpen, Clock, Users } from "lucide-svelte";
  import { Button, Card } from "@shadcn";

  import { Page, Pill, StatusPill, Stat } from "@components";
  import { CLASSES, TODAY_PLAN, TODAYS_RHYTHM } from "@mocks";
  import { activeClass } from "@stores";

  const now = new Date();
  const time = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  function openClass(clsId: number): void {
    activeClass.set(clsId);
    void goto("/handoff");
  }

  const toneDot: Record<string, string> = {
    live: "bg-cobalt-500",
    done: "bg-success-500",
    next: "bg-saffron-500",
    planned: "bg-gray-300",
  };
</script>

<Page>
  <div
    class="border-clay-100 relative mb-6 overflow-hidden rounded-2xl border p-7 md:p-8"
    style="background: linear-gradient(180deg, var(--clay-50) 0%, #fff 100%);"
  >
    <svg
      width="220"
      height="220"
      viewBox="0 0 220 220"
      class="pointer-events-none absolute -top-8 -right-8 hidden opacity-[0.08] md:block"
    >
      <g fill="none" stroke="#C77700" stroke-width="1">
        {#each Array.from({ length: 8 }) as _, i}
          <circle cx="110" cy="110" r={20 + i * 12} />
        {/each}
        {#each Array.from({ length: 12 }) as _, i}
          <line
            x1="110"
            y1="110"
            x2={110 + Math.cos((i * Math.PI) / 6) * 110}
            y2={110 + Math.sin((i * Math.PI) / 6) * 110}
          />
        {/each}
      </g>
    </svg>
    <div class="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div>
        <div class="text-saffron-600 mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
          <span class="ta text-[13px] font-normal normal-case">வணக்கம் கவிதா அவர்களே</span>
          <span class="mx-2 opacity-40">·</span>
          <span class="font-normal tracking-normal normal-case">{date} · {time}</span>
        </div>
        <div
          class="text-ink max-w-[620px] text-[22px] leading-[1.15] font-semibold tracking-[-0.02em] md:text-[30px]"
        >
          One classroom. Five grades.<br />
          <span class="text-saffron-600"> You don't have to hold them all alone today. </span>
        </div>
        <div class="mt-4 flex flex-wrap gap-2.5">
          <Button variant="primary" size="lg" onclick={() => goto("/lesson")}>
            <Sparkles class="size-4" /> Generate today's plan
          </Button>
          <Button variant="secondary" size="lg" onclick={() => goto("/reteach")}>
            <BookOpen class="size-4" /> Set up reteach topics
          </Button>
        </div>
      </div>
      <div class="flex gap-6 pt-1">
        <Stat n="24" label="Students present" />
        <Stat n="3/5" label="Plans ready" />
        <Stat n="1" label="Needs attention" warn />
      </div>
    </div>
  </div>

  <!-- Classes header -->
  <div class="mb-3.5 flex flex-wrap items-center justify-between gap-2">
    <div>
      <div class="text-text-primary text-[20px] font-semibold tracking-[-0.015em]">
        Your classroom, at a glance
      </div>
      <div class="page-subtitle">Tap a class to hand off its tablet.</div>
    </div>
    <Pill tone="cobalt">
      <Clock class="size-[11px]" />
      Period 3 · 10:40–11:25
    </Pill>
  </div>

  <!-- Class cards -->
  <div
    class="grid grid-cols-2
           gap-3.5 sm:grid-cols-3 lg:grid-cols-5"
  >
    {#each CLASSES as cls (cls.id)}
      {@const plan = TODAY_PLAN[cls.id]}
      <Card hover class="cursor-pointer p-4">
        <button type="button" class="w-full text-left" onclick={() => openClass(cls.id)}>
          <div class="mb-3.5 flex items-center justify-between">
            <div
              class="font-tamil grid size-9 place-items-center rounded-xl text-[15px] font-bold"
              style="background: {cls.color}22; color: {cls.color};"
            >
              {cls.id}
            </div>
            <StatusPill status={plan.status} />
          </div>
          <div class="text-ink text-[15px] font-semibold">{cls.name}</div>
          <div class="ta text-text-secondary mt-0.5 text-[11px]">{cls.ta}</div>
          <div class="border-border-default my-3.5 border-t"></div>
          <div class="label-eyebrow text-[10px]">{plan.subject}</div>
          <div class="mt-0.5 text-[13px] leading-[1.35] font-medium">
            {plan.topic}
          </div>
          <div class="mt-3 flex items-center justify-between">
            <span class="text-text-secondary inline-flex items-center gap-1 text-[11px]">
              <Users class="size-[11px]" />
              {cls.students} students
            </span>
            <span class="text-text-secondary text-[11px]">{plan.mins}m</span>
          </div>
        </button>
      </Card>
    {/each}
  </div>

  <!-- Today's rhythm -->
  <div class="mt-7">
    <div class="mb-3 text-[18px] font-semibold">Today's rhythm</div>
    <Card class="p-5">
      <div class="grid grid-cols-[70px_1fr] gap-y-3.5 md:grid-cols-[90px_1fr]">
        {#each TODAYS_RHYTHM as row, i (i)}
          <div class="mono text-text-secondary pt-0.5 text-[12px]">{row.t}</div>
          <div class="flex flex-wrap items-start gap-2.5">
            <span class="mt-1.5 size-2 rounded-full {toneDot[row.tone]}"></span>
            <div class="min-w-[180px] flex-1">
              <div class="text-[13px] font-medium">{row.c}</div>
              <div class="text-text-secondary text-[12px]">{row.s}</div>
            </div>
            {#if row.tone === "live"}
              <Pill tone="cobalt">Live</Pill>
            {:else if row.tone === "next"}
              <Pill tone="saffron">Up next</Pill>
            {/if}
          </div>
        {/each}
      </div>
    </Card>
  </div>
</Page>
