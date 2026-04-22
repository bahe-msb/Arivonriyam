<script lang="ts">
  import { Printer, Download, ChevronDown } from "lucide-svelte";
  import { Button, Card, Textarea, Tabs } from "@shadcn";

  import { Page, PageHeader, Pill, StatCard } from "@components";
  import { REPORT_ROWS, getClass } from "@mocks";
  import Gazette from "./Gazette.svelte";

  let mode = $state<string>("dashboard");

  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const total = REPORT_ROWS.reduce((s, r) => s + r.students, 0);
  const taught = REPORT_ROWS.reduce((s, r) => s + r.taught, 0);
  const retaught = REPORT_ROWS.reduce((s, r) => s + r.retaught, 0);
  const avgComp = Math.round(REPORT_ROWS.reduce((s, r) => s + r.completed, 0) / REPORT_ROWS.length);

  function barColor(v: number): string {
    if (v >= 90) return "bg-success-500";
    if (v >= 80) return "bg-cobalt-500";
    return "bg-warn-500";
  }
</script>

<Page>
  <Tabs.Root bind:value={mode}>
    <PageHeader
      eyebrow="End of day · automatically drafted"
      title="Daily report · {date}"
      subtitle="Submitted to the Block Education Officer each evening. Signed with your teacher ID."
    >
      {#snippet actions()}
        <Tabs.List>
          <Tabs.Trigger value="dashboard">Dashboard</Tabs.Trigger>
          <Tabs.Trigger value="gazette">Gazette</Tabs.Trigger>
        </Tabs.List>
        <Button variant="secondary">
          <Printer class="size-[14px]" /> Print
        </Button>
        <Button variant="primary">
          <Download class="size-[14px]" /> Submit to BEO
        </Button>
      {/snippet}
    </PageHeader>

    <Tabs.Content value="dashboard">
      <div class="mb-4.5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard n={total} label="Students present" detail="out of 26" />
        <StatCard n={taught} label="Lessons taught" detail="across 5 grades" />
        <StatCard n={retaught} label="Reteach sessions" detail="AI-led, on tablets" />
        <StatCard n="{avgComp}%" label="Avg. completion" detail="↑ 4% vs yesterday" accent />
      </div>

      <Card class="overflow-hidden p-0">
        <div class="border-border-default border-b px-5 py-4.5">
          <div class="text-[15px] font-semibold">Per-class performance</div>
          <div class="text-text-secondary text-[11px]">Tap a row to drill into each child.</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[13px]">
            <thead>
              <tr class="bg-bg-tertiary">
                {#each ["Class", "Students", "Lessons", "Reteach", "Completion", "Struggling", ""] as h, i (i)}
                  <th
                    class="text-text-secondary px-4.5 py-3 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase"
                  >
                    {h}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each REPORT_ROWS as r (r.cls)}
                {@const cls = getClass(r.cls)!}
                <tr class="border-border-default border-t">
                  <td class="px-4.5 py-3.5">
                    <div class="flex items-center gap-2.5">
                      <span
                        class="grid size-6.5 place-items-center rounded-md text-[12px] font-bold"
                        style="background: {cls.color}22; color: {cls.color};"
                      >
                        {r.cls}
                      </span>
                      <div>
                        <div class="font-medium">{cls.name}</div>
                        <div class="ta text-text-secondary text-[11px]">
                          {cls.ta}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="px-4.5 py-3.5">{r.students}</td>
                  <td class="px-4.5 py-3.5">{r.taught}</td>
                  <td class="px-4.5 py-3.5">{r.retaught}</td>
                  <td class="px-4.5 py-3.5">
                    <div class="flex min-w-[140px] items-center gap-2">
                      <div class="h-1.5 flex-1 overflow-hidden rounded-md bg-gray-50">
                        <div
                          class="h-full {barColor(r.completed)}"
                          style="width: {r.completed}%;"
                        ></div>
                      </div>
                      <span class="mono min-w-[30px] text-[11px]">
                        {r.completed}%
                      </span>
                    </div>
                  </td>
                  <td class="px-4.5 py-3.5">
                    {#if r.struggling > 0}
                      <Pill tone="danger">{r.struggling} flagged</Pill>
                    {:else}
                      <Pill tone="success">All steady</Pill>
                    {/if}
                  </td>
                  <td class="px-4.5 py-3.5 text-right">
                    <Button variant="ghost" size="icon" aria-label="Drill into class">
                      <ChevronDown class="size-[14px]" />
                    </Button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Card>

      <div class="mt-4.5 grid grid-cols-1 gap-4.5 md:grid-cols-2">
        <Card class="p-5">
          <div class="label-eyebrow mb-2.5">Notes to the officer</div>
          <Textarea
            rows={4}
            value="Arjun (Class 3) needs individual attention tomorrow on photosynthesis. Requesting a second tablet next month — four learners share one currently."
          />
        </Card>
        <Card class="bg-clay-50 border-clay-100 p-5">
          <div class="mb-2.5 flex items-center gap-2.5">
            <div class="text-saffron-700 text-[16px]">🔒</div>
            <div class="text-[14px] font-semibold">Submission queue</div>
          </div>
          <div class="text-text-secondary text-[12px] leading-[1.6]">
            This report will stay on your laptop until the bus Wi-Fi arrives at 5:30 pm. Then it
            uploads automatically. You'll see a green tick on the dashboard.
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <Pill tone="warn">Waiting for network</Pill>
            <Pill tone="default">Last synced 2 days ago</Pill>
          </div>
        </Card>
      </div>
    </Tabs.Content>

    <Tabs.Content value="gazette">
      <Gazette {date} rows={REPORT_ROWS} />
    </Tabs.Content>
  </Tabs.Root>
</Page>
