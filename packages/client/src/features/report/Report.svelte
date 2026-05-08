<script lang="ts">
  import { Printer, Download, ChevronDown, ChevronUp } from "lucide-svelte";
  import { Button, Card, Tabs } from "@shadcn";

  import { Page, PageHeader, Pill, StatCard } from "@components";
  import { CLASSES } from "@mocks";
  import Gazette from "./Gazette.svelte";

  // ── Types ─────────────────────────────────────────────────────────
  type ClassSubjectRow = {
    class_id: number;
    class_name: string;
    subject: string;
    students_present: number;
    reteach_sessions: number;
    struggling_count: number;
    avg_score: number;
    completion_pct: number;
  };

  type ClassRow = {
    class_id: number;
    class_name: string;
    students_present: number;
    reteach_sessions: number;
    struggling_count: number;
    avg_score: number;
    completion_pct: number;
  };

  type Totals = {
    total_students: number;
    total_reteach: number;
    avg_score: number;
  };

  type PerformanceData = {
    period: string;
    date: string;
    byClassSubject: ClassSubjectRow[];
    byClass: ClassRow[];
    totals: Totals;
  };

  // ── Date ──────────────────────────────────────────────────────────
  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateKey = new Date().toISOString().split("T")[0];

  // ── Mode state ────────────────────────────────────────────────────
  let mode = $state<string>("dashboard");
  let period = $state<"day" | "week" | "month">("day");

  // ── Data fetching ─────────────────────────────────────────────────
  let data = $state<PerformanceData | null>(null);
  let loading = $state(false);

  async function loadData(p: string): Promise<void> {
    loading = true;
    try {
      const res = await fetch(`/api/report/performance?period=${p}&date=${dateKey}`);
      data = (await res.json()) as PerformanceData;
    } catch {
      data = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadData(period);
  });

  // ── Derived summary stats ─────────────────────────────────────────
  const totalStudents = $derived(data?.totals.total_students ?? 0);
  const totalReteach  = $derived(data?.totals.total_reteach ?? 0);
  const avgScore      = $derived(data?.totals.avg_score ?? 0);
  const classesTaught = $derived(data?.byClass.length ?? 0);

  // ── Per-class expanded state ──────────────────────────────────────
  let expandedClassId = $state<number | null>(null);

  function subjectsForClass(classId: number): ClassSubjectRow[] {
    return (data?.byClassSubject ?? []).filter((r) => r.class_id === classId);
  }

  // ── Heat map ──────────────────────────────────────────────────────
  const allSubjects = $derived(
    [...new Set((data?.byClassSubject ?? []).map((r) => r.subject))].sort(),
  );

  function heatCell(classId: number, subject: string): ClassSubjectRow | undefined {
    return (data?.byClassSubject ?? []).find(
      (r) => r.class_id === classId && r.subject === subject,
    );
  }

  function heatColor(score: number | undefined): string {
    if (score === undefined) return "#f3f4f6";
    if (score >= 85) return "#bbf7d0";
    if (score >= 70) return "#fef08a";
    return "#fecaca";
  }

  function heatTextColor(score: number | undefined): string {
    if (score === undefined) return "#9ca3af";
    if (score >= 85) return "#166534";
    if (score >= 70) return "#854d0e";
    return "#991b1b";
  }

  function barColor(v: number): string {
    if (v >= 85) return "bg-success-500";
    if (v >= 70) return "bg-cobalt-500";
    return "bg-warn-500";
  }

  // ── Print ─────────────────────────────────────────────────────────
  function printReport(): void {
    window.print();
  }
</script>

<style>
  @media print {
    :global(nav),
    :global(aside),
    :global([data-sidebar]),
    :global(header.topbar),
    :global(.no-print) {
      display: none !important;
    }
    :global(body) {
      background: white;
    }
  }
</style>

<Page>
  <Tabs.Root bind:value={mode}>
    <PageHeader
      eyebrow="End of day · automatically drafted"
      title="Daily report · {date}"
      subtitle="Submitted to the Block Education Officer each evening. Signed with your teacher ID."
    >
      {#snippet actions()}
        <Tabs.List class="no-print">
          <Tabs.Trigger value="dashboard">Dashboard</Tabs.Trigger>
          <Tabs.Trigger value="gazette">Gazette</Tabs.Trigger>
        </Tabs.List>
        <Button variant="secondary" class="no-print" onclick={printReport}>
          <Printer class="size-3.5" /> Print
        </Button>
        <Button variant="primary" class="no-print">
          <Download class="size-3.5" /> Submit to BEO
        </Button>
      {/snippet}
    </PageHeader>

    <Tabs.Content value="dashboard">

      <!-- Period selector -->
      <div class="no-print mb-4 flex items-center gap-2">
        {#each [{ key: "day", label: "Today" }, { key: "week", label: "This Week" }, { key: "month", label: "This Month" }] as opt (opt.key)}
          <button
            type="button"
            onclick={() => { period = opt.key as "day" | "week" | "month"; }}
            class="rounded-full border px-4 py-1.5 text-[12px] font-semibold transition-all
                   {period === opt.key
              ? 'border-[#2f67c8] bg-[#eef6ff] text-[#2f67c8]'
              : 'border-border-default bg-white text-text-secondary hover:bg-gray-50'}"
          >
            {opt.label}
          </button>
        {/each}
        {#if loading}
          <span class="text-[11px] text-text-secondary">Loading…</span>
        {/if}
      </div>

      {#if !loading && totalStudents === 0}
        <Card class="border-clay-100 bg-clay-50 p-8 text-center">
          <div class="text-[22px] font-semibold">No session data yet for this period</div>
          <div class="text-text-secondary mx-auto mt-2 max-w-sm text-[13px]">
            Complete a Socratic session and results will appear here automatically.
          </div>
        </Card>
      {:else}

        <!-- Summary stats -->
        <div class="mb-4.5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard n={totalStudents} label="Students engaged" detail="Socratic sessions" />
          <StatCard n={classesTaught} label="Classes active" detail="with session data" />
          <StatCard n={totalReteach} label="Reteach sessions" detail="AI-led, on tablets" />
          <StatCard n="{avgScore}%" label="Avg. score" detail="across all sessions" accent />
        </div>

        <!-- Per-class table with expandable subject rows -->
        <Card class="overflow-hidden p-0 mb-4.5">
          <div class="border-border-default border-b px-5 py-4.5">
            <div class="text-[15px] font-semibold">Per-class performance</div>
            <div class="text-text-secondary text-[11px]">Click a row to see subject breakdown.</div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-[13px]">
              <thead>
                <tr class="bg-bg-tertiary">
                  {#each ["Class", "Students", "Reteach", "Completion", "Avg Score", "Struggling", ""] as h, i (i)}
                    <th class="text-text-secondary px-4.5 py-3 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
                      {h}
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each CLASSES as cls (cls.id)}
                  {@const row = (data?.byClass ?? []).find((r) => r.class_id === cls.id)}
                  {@const expanded = expandedClassId === cls.id}
                  {@const subjects = subjectsForClass(cls.id)}

                  {#if row}
                    <!-- Class row -->
                    <tr
                      class="border-border-default border-t cursor-pointer hover:bg-gray-50"
                      onclick={() => { expandedClassId = expanded ? null : cls.id; }}
                    >
                      <td class="px-4.5 py-3.5">
                        <div class="flex items-center gap-2.5">
                          <span
                            class="grid size-6.5 place-items-center rounded-md text-[12px] font-bold"
                            style="background: {cls.color}22; color: {cls.color};"
                          >
                            {cls.id}
                          </span>
                          <div>
                            <div class="font-medium">{cls.name}</div>
                            <div class="ta text-text-secondary text-[11px]">{cls.ta}</div>
                          </div>
                        </div>
                      </td>
                      <td class="px-4.5 py-3.5">{row.students_present}</td>
                      <td class="px-4.5 py-3.5">{row.reteach_sessions}</td>
                      <td class="px-4.5 py-3.5">
                        <div class="flex min-w-35 items-center gap-2">
                          <div class="h-1.5 flex-1 overflow-hidden rounded-md bg-gray-100">
                            <div
                              class="h-full {barColor(row.completion_pct)}"
                              style="width: {row.completion_pct}%;"
                            ></div>
                          </div>
                          <span class="mono min-w-7.5 text-[11px]">{row.completion_pct}%</span>
                        </div>
                      </td>
                      <td class="px-4.5 py-3.5 font-semibold">{row.avg_score}%</td>
                      <td class="px-4.5 py-3.5">
                        {#if row.struggling_count > 0}
                          <Pill tone="danger">{row.struggling_count} flagged</Pill>
                        {:else}
                          <Pill tone="success">All steady</Pill>
                        {/if}
                      </td>
                      <td class="px-4.5 py-3.5 text-right">
                        {#if expanded}
                          <ChevronUp class="size-3.5 text-text-secondary" />
                        {:else}
                          <ChevronDown class="size-3.5 text-text-secondary" />
                        {/if}
                      </td>
                    </tr>

                    <!-- Expanded subject rows -->
                    {#if expanded && subjects.length > 0}
                      {#each subjects as sub (sub.subject)}
                        <tr class="border-border-default border-t bg-[#fafafa]">
                          <td class="py-2.5 pl-14 pr-4 text-[12px]">
                            <span class="text-text-secondary">↳</span>
                            <span class="ml-1.5 font-medium">{sub.subject}</span>
                          </td>
                          <td class="px-4.5 py-2.5 text-[12px]">{sub.students_present}</td>
                          <td class="px-4.5 py-2.5 text-[12px]">{sub.reteach_sessions}</td>
                          <td class="px-4.5 py-2.5">
                            <div class="flex min-w-30 items-center gap-2">
                              <div class="h-1 flex-1 overflow-hidden rounded-md bg-gray-100">
                                <div
                                  class="h-full {barColor(sub.completion_pct)}"
                                  style="width: {sub.completion_pct}%;"
                                ></div>
                              </div>
                              <span class="mono text-[11px]">{sub.completion_pct}%</span>
                            </div>
                          </td>
                          <td class="px-4.5 py-2.5 text-[12px] font-semibold">{sub.avg_score}%</td>
                          <td class="px-4.5 py-2.5">
                            {#if sub.struggling_count > 0}
                              <Pill tone="danger">{sub.struggling_count}</Pill>
                            {:else}
                              <Pill tone="success">—</Pill>
                            {/if}
                          </td>
                          <td></td>
                        </tr>
                      {/each}
                    {/if}
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        </Card>

        <!-- Heat map -->
        {#if allSubjects.length > 0}
          <Card class="p-5 mb-4.5">
            <div class="mb-3 text-[14px] font-semibold">Performance heat map</div>
            <div class="text-text-secondary mb-4 text-[11px]">
              Average score per class × subject. Green ≥ 85%, Yellow 70–84%, Red &lt; 70%.
            </div>

            <div class="overflow-x-auto">
              <table class="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th class="py-2 pr-3 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wide min-w-25">
                      Class
                    </th>
                    {#each allSubjects as subject (subject)}
                      <th class="px-2 py-2 text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                        {subject}
                      </th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each CLASSES as cls (cls.id)}
                    {@const hasData = allSubjects.some((s) => heatCell(cls.id, s) !== undefined)}
                    {#if hasData}
                      <tr class="border-t border-border-default">
                        <td class="py-2 pr-3">
                          <div class="flex items-center gap-2">
                            <span
                              class="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-bold"
                              style="background: {cls.color}22; color: {cls.color};"
                            >
                              {cls.id}
                            </span>
                            <span class="font-medium">{cls.name}</span>
                          </div>
                        </td>
                        {#each allSubjects as subject (subject)}
                          {@const cell = heatCell(cls.id, subject)}
                          <td class="px-2 py-2 text-center">
                            <div
                              class="mx-auto inline-flex min-w-15 flex-col items-center rounded-xl px-3 py-2"
                              style="background: {heatColor(cell?.avg_score)}; color: {heatTextColor(cell?.avg_score)};"
                            >
                              {#if cell}
                                <span class="text-[15px] font-bold">{cell.avg_score}%</span>
                                <span class="text-[9px] font-medium mt-0.5">{cell.students_present} students</span>
                              {:else}
                                <span class="text-[11px]">—</span>
                              {/if}
                            </div>
                          </td>
                        {/each}
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Legend -->
            <div class="mt-3 flex items-center gap-4 text-[11px] text-text-secondary">
              <div class="flex items-center gap-1.5">
                <span class="inline-block size-3 rounded-sm" style="background:#bbf7d0;"></span> ≥ 85%
              </div>
              <div class="flex items-center gap-1.5">
                <span class="inline-block size-3 rounded-sm" style="background:#fef08a;"></span> 70–84%
              </div>
              <div class="flex items-center gap-1.5">
                <span class="inline-block size-3 rounded-sm" style="background:#fecaca;"></span> &lt; 70%
              </div>
              <div class="flex items-center gap-1.5">
                <span class="inline-block size-3 rounded-sm" style="background:#f3f4f6;"></span> No data
              </div>
            </div>
          </Card>
        {/if}

      {/if}
    </Tabs.Content>

    <Tabs.Content value="gazette">
      <Gazette {date} data={data} />
    </Tabs.Content>
  </Tabs.Root>
</Page>
