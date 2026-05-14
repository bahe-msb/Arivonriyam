<script lang="ts">
  import { Card } from "@shadcn";
  import { schoolConfig } from "@stores";

  type ClassRow = {
    class_id: number;
    class_name: string;
    student_names?: string[];
    students_present: number;
    reteach_sessions: number;
    struggling_count: number;
    avg_score: number;
    completion_pct: number;
  };

  type PerformanceData = {
    byClass: ClassRow[];
    totals: { total_students: number; total_reteach: number; avg_score: number };
  };

  type Props = { date: string; data: PerformanceData | null };
  let { date, data }: Props = $props();

  const cfg = $derived(schoolConfig.config);
  const schoolName = $derived(cfg.school_name.trim() || "School");
  const locationLine = $derived(
    [cfg.location.trim(), cfg.state.trim()].filter((value) => value.length > 0).join(", "),
  );
  const rows = $derived(data?.byClass ?? []);
  const total = $derived(data?.totals.total_students ?? 0);
  const totalReteach = $derived(data?.totals.total_reteach ?? 0);
  const strugglingClasses = $derived(rows.filter((r) => r.struggling_count > 0));

  function formatStudentNames(row: ClassRow): string {
    const names = row.student_names?.filter((name) => name.trim().length > 0) ?? [];
    return names.length > 0 ? names.join(", ") : "—";
  }
</script>

<Card
  class="border-clay-100 bg-[#FBF8F0] p-10 md:px-18 md:py-14"
  style="background-image: repeating-linear-gradient(0deg, transparent 0 31px, rgba(122,72,0,0.05) 31px 32px); font-family: 'Inter', serif;"
>
  <div class="mb-6 pb-4.5 text-center" style="border-bottom: 2px double var(--saffron-700);">
    <div class="text-saffron-700 text-[11px] font-semibold tracking-[0.24em] uppercase">
      Daily Report
    </div>
    <div class="text-ink mt-1 text-[22px] font-bold">{schoolName}</div>
    {#if locationLine}
      <div class="text-text-secondary mt-0.5 text-[13px] font-medium">{locationLine}</div>
    {/if}
    <div class="text-text-secondary mt-1 text-[15px] font-medium italic">{date}</div>
  </div>

  <div class="mb-5 flex flex-wrap justify-between gap-2 gap-y-1.5 text-[12.5px]">
    <div>
      <b>School:</b>
      {schoolName}
    </div>
    {#if locationLine}
      <div><b>Location:</b> {locationLine}</div>
    {/if}
    <div><b>Date:</b> {date}</div>
    <div><b>Teacher-in-charge:</b> {cfg.teacher_name || "—"}</div>
  </div>

  <p class="text-text-body text-[13.5px] leading-[1.8]">
    On this day,
    {#if total > 0}
      <b>{total} children</b> engaged in Socratic sessions across {rows.length} class{rows.length === 1 ? "" : "es"}.
      {totalReteach} reteach session{totalReteach === 1 ? "" : "s"} {totalReteach === 1 ? "was" : "were"} conducted using the on-device educational assistant.
      {#if strugglingClasses.length > 0}
        {#each strugglingClasses as r (r.class_id)}
          {r.struggling_count} student{r.struggling_count === 1 ? "" : "s"} in {r.class_name} require{r.struggling_count === 1 ? "s" : ""} follow-up attention.
        {/each}
      {:else}
        All learners are progressing as expected.
      {/if}
    {:else}
      no Socratic sessions were recorded. Detailed per-class figures will appear here after sessions are completed.
    {/if}
    Detailed per-class figures follow.
  </p>

  <div class="overflow-x-auto">
    <table class="mt-5 w-full border-collapse text-[12.5px]">
      <thead>
        <tr class="border-saffron-700 border-b-[1.5px]">
          {#each ["Class", "Students", "Present", "Reteach", "Avg Score", "Completion", "Remarks"] as h (h)}
            <th class="px-2 py-2.5 text-left text-[11px] font-bold tracking-[0.06em] uppercase">
              {h}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if rows.length === 0}
          <tr>
            <td colspan="7" class="px-2 py-4 text-center text-[12px] text-text-secondary">
              No session data yet for this date.
            </td>
          </tr>
        {:else}
          {#each rows as r (r.class_id)}
            <tr class="border-clay-100 border-b">
              <td class="px-2 py-2.5">{r.class_name || `Class ${r.class_id}`}</td>
              <td class="px-2 py-2.5 text-[11.5px] leading-5">{formatStudentNames(r)}</td>
              <td class="px-2 py-2.5">{r.students_present}</td>
              <td class="px-2 py-2.5">{r.reteach_sessions}</td>
              <td class="px-2 py-2.5">{r.avg_score}%</td>
              <td class="px-2 py-2.5">{r.completion_pct}%</td>
              <td class="px-2 py-2.5">
                {r.struggling_count > 0 ? "Follow-up required" : "Satisfactory"}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <div class="mt-12 flex flex-wrap items-end justify-between gap-4">
    <div>
      <div class="border-ink h-7.5 w-55 border-b"></div>
      <div class="mt-1.5 text-[11px]">
        Teacher-in-charge · {cfg.teacher_name || "—"}
      </div>
      {#if cfg.teacher_id}
        <div class="mono text-text-secondary text-[11px]">{cfg.teacher_id}</div>
      {/if}
    </div>
    <div
      class="grid size-22 place-items-center rounded-full text-center text-[9px] font-bold tracking-widest opacity-60"
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
