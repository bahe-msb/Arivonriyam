<script lang="ts">
  import { goto } from "$app/navigation";
  import { ArrowRight, Check, X, Mic } from "lucide-svelte";
  import { Button, Textarea } from "@shadcn";

  import { Page, PageHeader, Pill, Tablet } from "@components";
  import { SOCRATIC_QUESTIONS, STUDENTS_BY_CLASS } from "@mocks";

  const students = STUDENTS_BY_CLASS[3];

  type Answer = { studentIdx: number; correct: boolean };

  let qIdx = $state(0);
  let answered = $state<Answer[]>([]);
  let typing = $state("");
  let phase = $state<"ask" | "feedback">("ask");
  let lastCorrect = $state(true);

  const currentQ = $derived(SOCRATIC_QUESTIONS[qIdx % SOCRATIC_QUESTIONS.length]);
  const activeStudent = $derived(students[currentQ.student]);

  const failCounts = $derived(
    students.map((_, si) => answered.filter((a) => a.studentIdx === si && !a.correct).length),
  );

  function submit(correct: boolean): void {
    lastCorrect = correct;
    answered = [...answered, { studentIdx: currentQ.student, correct }];
    phase = "feedback";
  }

  function next(): void {
    phase = "ask";
    typing = "";
    qIdx += 1;
  }
</script>

<Page maxWidth={1100}>
  <PageHeader
    eyebrow="Tablet view · Socratic mode · Class 3"
    title="Turn by turn, one voice at a time"
  >
    {#snippet actions()}
      <Pill tone="cobalt">Question {(qIdx % 4) + 1} of ∞ (cyclic)</Pill>
      <Button variant="secondary" onclick={() => goto("/alert")}>
        See teacher alert <ArrowRight class="size-[14px]" />
      </Button>
    {/snippet}
  </PageHeader>

  <Tablet width={960}>
    <div class="grid h-full grid-cols-1 md:grid-cols-[1fr_200px]">
      <!-- Question area -->
      <div class="bg-ivory flex min-h-[480px] flex-col p-6 md:p-11">
        <div
          class="bg-saffron-50 border-saffron-100 mb-6.5 inline-flex items-center gap-2.5 self-start rounded-full border px-3.5 py-2"
        >
          <span class="text-[18px]">{activeStudent.emoji}</span>
          <span class="text-saffron-700 text-[13.5px] font-semibold">
            {activeStudent.name}, it's your turn.
          </span>
          <span class="ta text-saffron-600 text-[11px]">· உங்கள் முறை</span>
        </div>

        <div
          class="text-ink max-w-[620px] flex-1 text-[22px] leading-[1.4] font-medium tracking-[-0.01em] md:text-[26px]"
          style="text-wrap: pretty;"
        >
          {currentQ.q}
        </div>

        {#if phase === "ask"}
          <div class="mt-6">
            <div class="label-eyebrow mb-2">Your answer</div>
            <Textarea
              bind:value={typing}
              placeholder="Tell us in your own words, {activeStudent.name}…"
              class="min-h-[76px] bg-white text-[15px]"
            />
            <div class="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
              <div class="flex items-center gap-1.5">
                <Button variant="secondary">
                  <Mic class="size-[14px]" /> Speak answer
                </Button>
                <Button variant="ghost" onclick={() => submit(false)}>Skip</Button>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => submit(false)}
                  title="Demo: mark as incorrect"
                >
                  <X class="size-3" /> Demo: wrong
                </Button>
                <Button variant="primary" onclick={() => submit(true)}>
                  <Check class="size-[14px]" /> Submit
                </Button>
              </div>
            </div>
          </div>
        {:else}
          <div
            class="mt-6 rounded-xl border p-4.5"
            class:bg-success-50={lastCorrect}
            class:bg-warn-50={!lastCorrect}
            style={lastCorrect ? "border-color: #BDE3C6;" : "border-color: #F5D9AE;"}
          >
            <div class="mb-1.5 flex items-center gap-2.5">
              <span class="text-[20px]">{lastCorrect ? "🌼" : "🌿"}</span>
              <div
                class="text-[14px] font-semibold"
                class:text-success-600={lastCorrect}
                class:text-warn-500={!lastCorrect}
              >
                {lastCorrect
                  ? `Beautifully put, ${activeStudent.name}.`
                  : `Close, ${activeStudent.name} — let's think again.`}
              </div>
            </div>
            <div class="text-text-body pl-7.5 text-[13.5px] leading-[1.55]">
              {#if lastCorrect}
                Yes — without sunlight the plant can't make its food. Its leaves would turn pale and
                it would slowly wilt.
              {:else}
                Think about what plants do with sunlight. Is a dark cupboard giving them enough of
                it?
              {/if}
            </div>
            <div class="mt-3.5 pl-7.5">
              <Button variant="primary" onclick={next}>
                Next turn · {students[(currentQ.student + 1) % 4].name}
                <ArrowRight class="size-[14px]" />
              </Button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Right rail — vertical student boxes -->
      <div
        class="border-border-default flex flex-col gap-2.5 border-t bg-[#F3EFE6] p-3.5 md:border-t-0 md:border-l"
      >
        <div class="label-eyebrow mb-1 text-center text-[10px]">The circle</div>
        {#each students as s, i (s.id)}
          {@const isActive = i === currentQ.student && phase === "ask"}
          {@const fails = failCounts[i]}
          {@const answeredCount = answered.filter((a) => a.studentIdx === i).length}
          <div
            class="relative rounded-xl p-3 transition-all duration-200
                   {isActive
              ? 'border-saffron-500 border-2 bg-white shadow-[0_8px_20px_-10px_rgba(199,119,0,0.5)]'
              : 'border-border-default border bg-white/50'}"
          >
            <div class="flex items-center gap-2.5">
              <div
                class="grid size-8.5 place-items-center rounded-xl text-[18px]
                       {isActive ? 'bg-saffron-50' : 'bg-gray-50'}"
              >
                {s.emoji}
              </div>
              <div class="min-w-0 flex-1">
                <div
                  class="text-[13px] font-semibold
                         {isActive ? 'text-saffron-700' : 'text-ink'}"
                >
                  {s.name}
                </div>
                <div class="text-text-secondary text-[11px]">
                  {answeredCount} answered
                  {#if fails >= 2}
                    <span class="text-danger-500 font-semibold">· {fails}✕</span>
                  {/if}
                </div>
              </div>
            </div>
            {#if isActive}
              <div class="text-saffron-700 mt-2 text-[11px] font-semibold tracking-[0.02em]">
                ◉ Listening to you
              </div>
            {/if}
            {#if fails >= 3}
              <div
                class="bg-danger-500 absolute -top-1.5 -right-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
              >
                Flagged
              </div>
            {/if}
          </div>
        {/each}
        <div class="mt-auto rounded-lg bg-white/50 p-2.5">
          <div class="text-text-secondary text-center text-[11px]">
            After everyone, we cycle again.
          </div>
        </div>
      </div>
    </div>
  </Tablet>
</Page>
