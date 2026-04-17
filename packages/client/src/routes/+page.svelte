<script lang="ts">
  const subjects = [
    "Advanced Mathematics",
    "World History",
    "Literature",
    "Physics",
    "Tamil Language",
    "Biology",
    "Chemistry",
  ];
  const grades = ["Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];

  let subject = $state("Advanced Mathematics");
  let gradeLevel = $state("Grade 10");
  let topicFocus = $state("");
  let isGenerating = $state(false);

  async function generateBlueprint() {
    if (isGenerating) return;
    isGenerating = true;
    await new Promise((r) => setTimeout(r, 1800));
    isGenerating = false;
  }
</script>

<main class="flex flex-col md:flex-row h-full overflow-hidden bg-surface">
  <!-- ════════════════════════════════════════
       LEFT PANEL — Input (40%)
  ════════════════════════════════════════ -->
  <section
    class="w-full md:w-2/5 h-full bg-surface-container-low flex flex-col p-6 md:p-10 lg:p-12 border-r border-outline-variant/15 overflow-y-auto pb-20 md:pb-0"
  >
    <header class="mb-8">
      <h2 class="text-3xl font-headline font-bold text-on-surface tracking-tight mb-2">
        Lesson Architect
      </h2>
      <p class="text-on-surface-variant font-body text-sm leading-relaxed">
        Speak or define your parameters to generate a structured lesson plan instantly.
      </p>
    </header>

    <div class="space-y-6 grow flex flex-col">
      <!-- Subject & Grade -->
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1">
          <label
            for="subject"
            class="font-label text-xs font-semibold text-on-surface-variant uppercase tracking-wider"
            >Subject</label
          >
          <div class="relative">
            <select
              id="subject"
              bind:value={subject}
              class="w-full appearance-none bg-surface-container-high border-none rounded-lg py-3 px-4 text-on-surface font-body text-sm focus:ring-1 focus:ring-primary focus:outline-none shadow-sm transition-all cursor-pointer"
            >
              {#each subjects as s}<option>{s}</option>{/each}
            </select>
            <span
              class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-lg"
              >expand_more</span
            >
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label
            for="grade"
            class="font-label text-xs font-semibold text-on-surface-variant uppercase tracking-wider"
            >Grade Level</label
          >
          <div class="relative">
            <select
              id="grade"
              bind:value={gradeLevel}
              class="w-full appearance-none bg-surface-container-high border-none rounded-lg py-3 px-4 text-on-surface font-body text-sm focus:ring-1 focus:ring-primary focus:outline-none shadow-sm transition-all cursor-pointer"
            >
              {#each grades as g}<option>{g}</option>{/each}
            </select>
            <span
              class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-lg"
              >expand_more</span
            >
          </div>
        </div>
      </div>

      <!-- Topic Focus -->
      <div class="flex flex-col gap-1">
        <label
          for="topic"
          class="font-label text-xs font-semibold text-on-surface-variant uppercase tracking-wider"
          >Topic Focus</label
        >
        <input
          id="topic"
          type="text"
          bind:value={topicFocus}
          placeholder="e.g., Introduction to Calculus limits..."
          class="w-full bg-surface-container-high border-none rounded-lg py-3 px-4 text-on-surface font-body text-sm placeholder:text-outline focus:ring-1 focus:ring-primary focus:outline-none shadow-sm transition-all"
        />
      </div>

      <!-- ── Voice Centerpiece ── -->
      <div class="grow flex flex-col items-center justify-center py-10 gap-5">
        <button
          class="relative group w-32 h-32 rounded-xl flex items-center justify-center bg-surface-container-lowest shadow-[0_8px_24px_rgba(28,28,24,0.05)] border border-outline-variant/15 hover:shadow-[0_14px_36px_rgba(28,51,192,0.12)] hover:-translate-y-0.5 transition-all duration-300"
        >
          <!-- Hover ripples -->
          <div
            class="absolute inset-0 rounded-xl border border-primary/20 scale-[1.15] opacity-0 group-hover:opacity-100 transition-all duration-500"
          ></div>
          <div
            class="absolute inset-0 rounded-xl border border-primary/10 scale-[1.3] opacity-0 group-hover:opacity-100 transition-all duration-700 delay-100"
          ></div>
          <!-- Inner button -->
          <div
            class="w-24 h-24 rounded-xl bg-gradient-primary flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          >
            <span
              class="material-symbols-outlined text-on-primary text-4xl"
              style="font-variation-settings:'FILL' 1;">mic</span
            >
          </div>
        </button>

        <div class="text-center">
          <h3 class="font-headline text-lg font-semibold text-on-surface mb-1">Tap to dictate</h3>
          <p class="text-on-surface-variant font-body text-sm max-w-65 leading-relaxed">
            "Design a 45-minute lesson on the French Revolution focusing on causes and initial
            uprisings."
          </p>
        </div>
      </div>

      <!-- Generate CTA -->
      <button
        onclick={generateBlueprint}
        disabled={isGenerating}
        class="w-full py-4 rounded-lg bg-gradient-primary text-on-primary font-label font-semibold text-sm tracking-wide shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-auto"
      >
        {#if isGenerating}
          <span class="material-symbols-outlined text-lg animate-spin">refresh</span>
          Generating Blueprint…
        {:else}
          <span class="material-symbols-outlined text-lg">magic_button</span>
          Generate Blueprint
        {/if}
      </button>
    </div>
  </section>

  <!-- ════════════════════════════════════════
       RIGHT PANEL — Lesson Canvas (60%)
  ════════════════════════════════════════ -->
  <section class="w-full md:w-3/5 h-full bg-surface-container-lowest flex flex-col relative">
    <!-- Toolbar -->
    <div
      class="h-16 shrink-0 border-b border-outline-variant/15 flex items-center justify-between px-6 bg-surface/80 backdrop-blur-md z-10"
    >
      <div class="flex items-center gap-2">
        <span
          class="px-3 py-1 bg-secondary-fixed rounded-md text-on-secondary-fixed font-label text-xs font-semibold tracking-wide"
          >Draft</span
        >
        <span class="text-on-surface-variant text-sm font-body">Unsaved Changes</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-md transition-colors"
          title="Copy"
        >
          <span class="material-symbols-outlined text-xl">content_copy</span>
        </button>
        <button
          class="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-md transition-colors"
          title="Download"
        >
          <span class="material-symbols-outlined text-xl">download</span>
        </button>
        <button
          class="ml-1 px-4 py-2 bg-surface-container-highest text-on-surface rounded-md font-label text-sm font-semibold hover:bg-surface-dim transition-colors"
          >Save</button
        >
      </div>
    </div>

    <!-- Notebook Canvas -->
    <div
      class="flex-1 overflow-y-auto pb-24 px-8 md:px-14 lg:px-20 bg-notebook-lines"
      style="background-color: #fcf9f3;"
    >
      <div class="max-w-2xl mx-auto space-y-10 pt-10">
        <!-- Lesson Header -->
        <div class="border-b-2 border-on-surface pb-6">
          <h1
            class="text-4xl font-headline font-bold text-on-surface tracking-tight mb-4 leading-tight"
          >
            Introduction to Differential Calculus: Limits
          </h1>
          <div class="flex flex-wrap gap-4 text-sm font-body text-on-surface-variant">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-base">schedule</span>45 Minutes
            </div>
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-base">school</span>Grade 11
            </div>
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-base">category</span>Advanced Mathematics
            </div>
          </div>
        </div>

        <!-- Section 1 — Learning Objective -->
        <section
          class="bg-surface-container-lowest p-8 rounded-xl shadow-[0_8px_24px_rgba(28,28,24,0.03)] border border-outline-variant/15 relative"
        >
          <div
            class="absolute -left-3 top-8 w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline text-xs font-bold shadow-sm"
          >
            1
          </div>
          <h3 class="text-xl font-headline font-bold text-on-surface mb-4 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">target</span>
            Learning Objective
          </h3>
          <p class="text-on-surface-variant font-body leading-relaxed text-base">
            By the end of this lesson, students will be able to intuitively understand the concept
            of a limit, evaluate limits graphically and numerically, and apply basic limit laws to
            algebraic functions.
          </p>
        </section>

        <!-- Section 2 — Core Activities -->
        <section
          class="bg-surface-container-lowest p-8 rounded-xl shadow-[0_8px_24px_rgba(28,28,24,0.03)] border border-outline-variant/15 relative"
        >
          <div
            class="absolute -left-3 top-8 w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline text-xs font-bold shadow-sm"
          >
            2
          </div>
          <h3
            class="text-xl font-headline font-bold text-on-surface mb-6 flex items-center gap-2"
          >
            <span class="material-symbols-outlined text-primary">local_activity</span>
            Core Activities
          </h3>

          <div class="space-y-0">
            <!-- Activity 1 -->
            <div class="flex gap-4">
              <div class="flex flex-col items-center pt-1 w-8 shrink-0">
                <span class="text-xs font-label font-bold text-secondary tabular-nums">10m</span>
                <div class="w-px flex-1 bg-outline-variant/30 mt-2"></div>
              </div>
              <div class="pb-6 flex-1">
                <h4 class="font-headline font-semibold text-on-surface text-base mb-1.5">
                  The Zeno's Paradox Hook
                </h4>
                <p class="text-on-surface-variant font-body text-sm leading-relaxed">
                  Introduce Zeno's Dichotomy Paradox (walking halfway to a wall). Discuss how an
                  infinite number of steps can result in a finite distance. Use this to intuitively
                  define approaching a value.
                </p>
              </div>
            </div>

            <!-- Activity 2 -->
            <div class="flex gap-4">
              <div class="flex flex-col items-center pt-1 w-8 shrink-0">
                <span class="text-xs font-label font-bold text-secondary tabular-nums">20m</span>
                <div class="w-px flex-1 bg-outline-variant/30 mt-2"></div>
              </div>
              <div class="pb-6 flex-1">
                <h4 class="font-headline font-semibold text-on-surface text-base mb-1.5">
                  Graphical &amp; Numerical Exploration
                </h4>
                <p class="text-on-surface-variant font-body text-sm leading-relaxed mb-3">
                  Use graphing software (Desmos) to show functions with holes, jumps, and
                  asymptotes. Guide students to evaluate limit behavior from both left and right
                  sides.
                </p>
                <div
                  class="bg-surface-container px-4 py-3 rounded-md border border-outline-variant/15"
                >
                  <p class="font-body text-xs text-on-surface-variant">
                    <strong class="text-on-surface">Resource:</strong> Desmos Interactive Graph
                    Activity #4A
                  </p>
                </div>
              </div>
            </div>

            <!-- Activity 3 -->
            <div class="flex gap-4">
              <div class="flex flex-col items-center pt-1 w-8 shrink-0">
                <span class="text-xs font-label font-bold text-secondary tabular-nums">15m</span>
              </div>
              <div class="flex-1">
                <h4 class="font-headline font-semibold text-on-surface text-base mb-1.5">
                  Algebraic Evaluation
                </h4>
                <p class="text-on-surface-variant font-body text-sm leading-relaxed">
                  Introduce direct substitution and the limit laws. Work through 3 example problems
                  on the board, progressively increasing in difficulty (polynomial, rational with
                  factoring).
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- Section 3 — Assessment -->
        <section
          class="bg-surface-container-lowest p-8 rounded-xl shadow-[0_8px_24px_rgba(28,28,24,0.03)] border border-outline-variant/15 relative"
        >
          <div
            class="absolute -left-3 top-8 w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline text-xs font-bold shadow-sm"
          >
            3
          </div>
          <h3 class="text-xl font-headline font-bold text-on-surface mb-4 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">fact_check</span>
            Assessment &amp; Exit Ticket
          </h3>
          <p class="text-on-surface-variant font-body text-sm leading-relaxed mb-4">
            Students will complete a 3-question exit ticket requiring them to:
          </p>
          <ul class="space-y-2 ml-1">
            {#each [
              "Evaluate a limit graphically given a piecewise function.",
              "Calculate a limit algebraically requiring factoring.",
              "Explain in one sentence why a specific limit does not exist (DNE).",
            ] as item}
              <li class="flex items-start gap-2 text-on-surface-variant font-body text-sm">
                <span class="material-symbols-outlined text-primary text-base mt-0.5 shrink-0"
                  >check_small</span
                >
                {item}
              </li>
            {/each}
          </ul>
        </section>
      </div>
    </div>

    <!-- Bottom fade -->
    <div
      class="absolute bottom-0 w-full h-20 bg-linear-to-t from-surface-container-lowest to-transparent pointer-events-none"
    ></div>
  </section>
</main>
