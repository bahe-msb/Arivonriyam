<script lang="ts">
  import { Download, ChevronDown, ChevronUp } from "lucide-svelte";
  import { Button, Card, Tabs } from "@shadcn";

  import { DateNav, Page, PageHeader, Pill, StatCard } from "@components";
  import { CLASSES } from "@mocks";
  import { schoolConfig } from "@stores";
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
    student_names?: string[];
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
  function todayKey(): string {
    return new Date().toISOString().split("T")[0];
  }
  let dateKey = $state<string>(todayKey());
  const date = $derived(
    new Date(dateKey + "T00:00:00").toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );

  // ── Mode state ────────────────────────────────────────────────────
  let mode = $state<string>("dashboard");
  let period = $state<"day" | "week" | "month">("day");

  // ── Data fetching ─────────────────────────────────────────────────
  let data = $state<PerformanceData | null>(null);
  let loading = $state(false);
  let downloading = $state(false);

  async function loadData(p: string, d: string): Promise<void> {
    loading = true;
    try {
      const res = await fetch(`/api/report/performance?period=${p}&date=${d}`);
      data = (await res.json()) as PerformanceData;
    } catch {
      data = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadData(period, dateKey);
  });

  // ── Derived summary stats ─────────────────────────────────────────
  const totalStudents = $derived(data?.totals.total_students ?? 0);
  const totalReteach  = $derived(data?.totals.total_reteach ?? 0);
  const avgScore      = $derived(data?.totals.avg_score ?? 0);
  const classesTaught = $derived(data?.byClass.length ?? 0);
  const schoolName    = $derived(schoolConfig.config.school_name.trim() || "school");

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

  function studentNamesForRow(row: ClassRow): string[] {
    return row.student_names?.filter((name): name is string => name.trim().length > 0) ?? [];
  }

  function formatStudentNames(row: ClassRow): string {
    const names = studentNamesForRow(row);
    return names.length > 0 ? names.join(", ") : "—";
  }

  function remarkForRow(row: ClassRow): string {
    return row.struggling_count > 0 ? "Follow-up required" : "Satisfactory";
  }

  function slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function buildSummaryText(): string {
    const rows = data?.byClass ?? [];
    const totals = data?.totals;
    const totalStudents = totals?.total_students ?? 0;
    const totalReteach = totals?.total_reteach ?? 0;
    const strugglingClasses = rows.filter((row) => row.struggling_count > 0);

    if (totalStudents === 0) {
      return "No Socratic sessions were recorded. Detailed per-class figures will appear here after sessions are completed.";
    }

    const classText = `${rows.length} class${rows.length === 1 ? "" : "es"}`;
    const reteachText = `${totalReteach} reteach session${totalReteach === 1 ? "" : "s"} ${totalReteach === 1 ? "was" : "were"} conducted using the on-device educational assistant.`;
    const strugglingText =
      strugglingClasses.length > 0
        ? strugglingClasses
            .map((row) => {
              const className = row.class_name || `Class ${row.class_id}`;
              return `${row.struggling_count} student${row.struggling_count === 1 ? "" : "s"} in ${className} require${row.struggling_count === 1 ? "s" : ""} follow-up attention.`;
            })
            .join(" ")
        : "All learners are progressing as expected.";

    return `On this day, ${totalStudents} children engaged in Socratic sessions across ${classText}. ${reteachText} ${strugglingText} Detailed per-class figures follow.`;
  }

  async function downloadReport(): Promise<void> {
    if (loading || downloading) return;

    downloading = true;

    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const config = schoolConfig.config;
      const cleanSchoolName = config.school_name.trim() || "School";
      const teacherName = config.teacher_name.trim() || "—";
      const teacherId = config.teacher_id.trim();
      const location = [config.location.trim(), config.state.trim()].filter(Boolean).join(", ");
      const rows = data?.byClass ?? [];

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 42;
      let cursorY = 54;

      doc.setFont("times", "bold");
      doc.setFontSize(11);
      doc.setTextColor(161, 90, 0);
      doc.text("DAILY REPORT", pageWidth / 2, cursorY, { align: "center" });

      cursorY += 22;
      doc.setFontSize(22);
      doc.setTextColor(45, 36, 24);
      doc.text(cleanSchoolName, pageWidth / 2, cursorY, { align: "center" });

      cursorY += 18;
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      doc.setTextColor(110, 91, 67);
      doc.text(date, pageWidth / 2, cursorY, { align: "center" });

      cursorY += 18;
      doc.setDrawColor(161, 90, 0);
      doc.setLineWidth(1);
      doc.line(marginX, cursorY, pageWidth - marginX, cursorY);

      cursorY += 24;
      doc.setFont("times", "normal");
      doc.setFontSize(11.5);
      doc.setTextColor(45, 36, 24);

      const metadataLines = [
        `School: ${cleanSchoolName}`,
        location ? `Location: ${location}` : "",
        `Teacher-in-charge: ${teacherName}`,
      ].filter((line) => line.length > 0);

      for (const line of metadataLines) {
        doc.text(line, marginX, cursorY);
        cursorY += 16;
      }

      cursorY += 6;
      const summaryLines = doc.splitTextToSize(buildSummaryText(), pageWidth - marginX * 2);
      doc.text(summaryLines, marginX, cursorY);
      cursorY += summaryLines.length * 15 + 16;

      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [["Class", "Students", "Present", "Reteach", "Avg Score", "Completion", "Remarks"]],
        body:
          rows.length > 0
            ? rows.map((row) => [
                row.class_name || `Class ${row.class_id}`,
                formatStudentNames(row),
                String(row.students_present),
                String(row.reteach_sessions),
                `${row.avg_score}%`,
                `${row.completion_pct}%`,
                remarkForRow(row),
              ])
            : [["—", "—", "—", "—", "—", "—", "No session data yet for this date."]],
        theme: "grid",
        styles: {
          font: "times",
          fontSize: 10,
          cellPadding: 6,
          lineColor: [234, 223, 200],
          lineWidth: 0.5,
          textColor: [45, 36, 24],
          overflow: "linebreak",
          valign: "middle",
        },
        headStyles: {
          fillColor: [251, 248, 240],
          textColor: [161, 90, 0],
          lineColor: [161, 90, 0],
          lineWidth: 1,
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 52 },
          1: { cellWidth: 150 },
          2: { cellWidth: 44, halign: "center" },
          3: { cellWidth: 48, halign: "center" },
          4: { cellWidth: 56, halign: "center" },
          5: { cellWidth: 60, halign: "center" },
          6: { cellWidth: 101 },
        },
      });

      let footerY =
        (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
        cursorY;

      footerY += 34;
      if (footerY > pageHeight - 90) {
        doc.addPage();
        footerY = 72;
      }

      doc.setDrawColor(45, 36, 24);
      doc.setLineWidth(0.8);
      doc.line(marginX, footerY, marginX + 200, footerY);

      doc.setFont("times", "normal");
      doc.setFontSize(11);
      doc.setTextColor(45, 36, 24);
      doc.text(`Teacher-in-charge · ${teacherName}`, marginX, footerY + 16);

      if (teacherId) {
        doc.setFontSize(9.5);
        doc.setTextColor(110, 91, 67);
        doc.text(`Teacher ID: ${teacherId}`, marginX, footerY + 31);
      }

      const sealX = pageWidth - marginX - 34;
      const sealY = footerY + 6;
      doc.setDrawColor(161, 90, 0);
      doc.circle(sealX, sealY, 30);
      doc.setFont("times", "bold");
      doc.setFontSize(8);
      doc.setTextColor(161, 90, 0);
      doc.text("VERIFIED", sealX, sealY - 6, { align: "center" });
      doc.setFontSize(7);
      doc.text("ARIVONRIYAM", sealX, sealY + 10, { align: "center" });

      doc.save(`${slugify(schoolName) || "school"}-daily-report-${dateKey}.pdf`);
    } finally {
      downloading = false;
    }
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
      subtitle="Review the dashboard or download the formatted daily report with live classroom metrics."
    >
      {#snippet actions()}
        <div class="no-print">
          <DateNav label="Day" value={dateKey} onChange={(d) => (dateKey = d)} />
        </div>
        <Tabs.List class="no-print">
          <Tabs.Trigger value="dashboard">Dashboard</Tabs.Trigger>
          <Tabs.Trigger value="gazette">Daily Report</Tabs.Trigger>
        </Tabs.List>
        <Button variant="primary" class="no-print" onclick={downloadReport} disabled={loading || downloading}>
          <Download class="size-3.5" /> {downloading ? "Preparing PDF..." : "Download PDF"}
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
