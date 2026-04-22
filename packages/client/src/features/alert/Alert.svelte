<script lang="ts">
  import { goto } from "$app/navigation";
  import { Heart, RefreshCw, BookOpen, Check } from "lucide-svelte";
  import { Button, Card } from "@shadcn";

  import { Page, PageHeader, Pill } from "@components";
  import { cn } from "@utils";

  const stuck = [
    {
      q: "If we kept a plant inside a dark cupboard for a week, what happens?",
      a: '"It will be cold."',
      why: "Missed the link between sunlight and food.",
    },
    {
      q: "Why do sunflowers turn towards the sun?",
      a: '"Because the sun is bright."',
      why: "Didn't reach the idea of gathering light.",
    },
    {
      q: "Why are leaves green?",
      a: "(no answer)",
      why: "Skipped — likely unsure.",
    },
  ];

  const weekScores = [40, 55, 70, 65, 45, 30, 25];
  const days = ["M", "T", "W", "T", "F", "S", "S"];

  function barColor(v: number): string {
    if (v < 40) return "bg-danger-500";
    if (v < 60) return "bg-warn-500";
    return "bg-success-500";
  }
</script>

<Page maxWidth={1100}>
  <PageHeader
    eyebrow="Alert · Class 3 · Arjun"
    eyebrowTone="danger"
    title="Arjun has stumbled three times. He needs you."
    subtitle="Arivonriyam doesn't interrupt — it just waits beside you until it matters."
  >
    {#snippet actions()}
      <Button variant="secondary" onclick={() => goto("/student/socratic")}>
        Back to tablet view
      </Button>
    {/snippet}
  </PageHeader>

  <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
    <!-- Student panel -->
    <Card class="p-6">
      <div class="flex items-start gap-3.5">
        <div
          class="bg-clay-50 border-clay-100 grid size-16 place-items-center rounded-2xl border text-[34px]"
        >
          🦚
        </div>
        <div>
          <div class="text-[20px] font-semibold">Arjun · Class 3</div>
          <div class="text-text-secondary ta text-[11px]">வகுப்பு ௩ · 9 years</div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <Pill tone="danger">3 in a row missed</Pill>
            <Pill tone="default">Topic: Plants around us</Pill>
          </div>
        </div>
      </div>

      <div class="border-border-default my-5 border-t"></div>

      <div class="label-eyebrow mb-2.5">Where he got stuck</div>
      <div class="flex flex-col gap-2.5">
        {#each stuck as x (x.q)}
          <div class="bg-danger-50 rounded-lg border border-[#F5C6C6] p-3.5">
            <div class="text-ink text-[13px] font-medium">{x.q}</div>
            <div class="text-text-secondary mt-1 text-[12.5px] italic">
              Arjun said: {x.a}
            </div>
            <div class="text-danger-500 mt-1.5 text-[11px]">◆ {x.why}</div>
          </div>
        {/each}
      </div>
    </Card>

    <!-- Action panel -->
    <div class="flex flex-col gap-4">
      <Card class="bg-clay-50 border-clay-100 p-5">
        <div class="mb-1.5 text-[14px] font-semibold">What to try, teacher-to-teacher</div>
        <div class="text-text-body text-[13px] leading-[1.6]">
          He understands that plants look different in the dark — but not
          <i>why</i>. Try the paper-leaf trick: cover one leaf of a tulsi plant with paper for two
          days. Let him peel it off and name what he sees. Then ask the same question again. Let him
          answer his classmates, not the tablet.
        </div>
      </Card>

      <Card class="p-5">
        <div class="label-eyebrow mb-2.5">Actions</div>
        <div class="flex flex-col gap-2">
          <Button variant="primary" class="justify-start">
            <Heart class="size-[14px]" /> Sit with Arjun for 10 minutes
          </Button>
          <Button variant="secondary" class="justify-start">
            <RefreshCw class="size-[14px]" /> Pause Socratic for Class 3, show summary again
          </Button>
          <Button variant="secondary" class="justify-start">
            <BookOpen class="size-[14px]" /> Add "photosynthesis — simple" to tomorrow's reteach
          </Button>
          <Button variant="ghost" class="justify-start">
            <Check class="size-[14px]" /> Mark handled · keep tablet running
          </Button>
        </div>
      </Card>

      <Card class="p-4">
        <div class="label-eyebrow mb-2">Arjun this week</div>
        <div class="flex h-15 items-end gap-1">
          {#each weekScores as v, i (i)}
            <div class="flex flex-1 flex-col items-center gap-1">
              <div class={cn("w-[70%] rounded-t-[4px]", barColor(v))} style="height: {v}%;"></div>
              <div class="text-text-secondary text-[11px]">{days[i]}</div>
            </div>
          {/each}
        </div>
        <div class="text-text-secondary mt-2 text-[11px]">Understanding score, last 7 lessons.</div>
      </Card>
    </div>
  </div>
</Page>
