<script lang="ts">
  import { Card } from "@shadcn";
  import type { ReportRow } from "@mocks";

  type Props = { date: string; rows: ReportRow[] };
  let { date, rows }: Props = $props();

  const total = $derived(rows.reduce((s, r) => s + r.students, 0));
</script>

<Card
  class="border-clay-100 bg-[#FBF8F0] p-10 md:px-18 md:py-14"
  style="background-image: repeating-linear-gradient(0deg, transparent 0 31px, rgba(122,72,0,0.05) 31px 32px); font-family: 'Inter', serif;"
>
  <div class="mb-6 pb-4.5 text-center" style="border-bottom: 2px double var(--saffron-700);">
    <div class="text-saffron-700 text-[11px] font-semibold tracking-[0.24em] uppercase">
      Government of Tamil Nadu
    </div>
    <div class="ta text-ink mt-1 text-[22px] font-bold">தினசரி கற்றல் அறிக்கை</div>
    <div class="text-text-secondary mt-0.5 text-[16px] font-medium italic">
      Daily Learning Record
    </div>
  </div>

  <div class="mb-5 flex flex-wrap justify-between gap-2 text-[12.5px]">
    <div>
      <b>School:</b> Govt. Primary School, Thenkarai · Block: Alanganallur
    </div>
    <div><b>Date:</b> {date}</div>
  </div>

  <p class="text-text-body text-[13.5px] leading-[1.8]">
    On this day, <b>{total} children</b> attended across five grades under one classroom. Five
    lessons were delivered at the blackboard and eleven reteach sessions were conducted using the
    on-device educational assistant. Of the
    {total} learners, <b>one child (Arjun, Class 3)</b> requires follow-up attention on the topic of photosynthesis.
    All other learners are progressing as expected. Detailed per-class figures follow.
  </p>

  <div class="overflow-x-auto">
    <table class="mt-5 w-full border-collapse text-[12.5px]">
      <thead>
        <tr class="border-saffron-700 border-b-[1.5px]">
          {#each ["Class", "Present", "Lessons", "Reteach", "Completion", "Remarks"] as h (h)}
            <th class="px-2 py-2.5 text-left text-[11px] font-bold tracking-[0.06em] uppercase">
              {h}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.cls)}
          <tr class="border-clay-100 border-b">
            <td class="px-2 py-2.5">Class {r.cls}</td>
            <td class="px-2 py-2.5">{r.students}</td>
            <td class="px-2 py-2.5">{r.taught}</td>
            <td class="px-2 py-2.5">{r.retaught}</td>
            <td class="px-2 py-2.5">{r.completed}%</td>
            <td class="px-2 py-2.5">
              {r.struggling > 0 ? "Follow-up required" : "Satisfactory"}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="mt-12 flex flex-wrap items-end justify-between gap-4">
    <div>
      <div class="border-ink h-[30px] w-[220px] border-b"></div>
      <div class="mt-1.5 text-[11px]">Teacher-in-charge · Kavitha R.</div>
      <div class="mono text-text-secondary text-[11px]">TNEID-2014-30592</div>
    </div>
    <div
      class="grid size-22 place-items-center rounded-full text-center text-[9px] font-bold tracking-[0.1em] opacity-60"
      style="border: 2px solid var(--saffron-700); color: var(--saffron-700);"
    >
      <div>
        <div>VERIFIED</div>
        <div class="my-1 text-[18px]">◈</div>
        <div>ARIVONRIYAM</div>
      </div>
    </div>
  </div>
</Card>
