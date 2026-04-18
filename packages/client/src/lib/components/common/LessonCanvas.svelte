<section class="bg-surface-container-lowest relative flex h-full w-full flex-col md:w-3/5">
  <!-- Toolbar -->
  <div
    class="border-outline-variant/15 bg-surface/80 z-10 flex h-16 shrink-0 items-center justify-between border-b px-6 backdrop-blur-md"
  >
    <div class="flex items-center gap-2">
      <span
        class="bg-secondary-fixed text-on-secondary-fixed font-label rounded-md px-3 py-1 text-xs font-semibold tracking-wide"
        >Draft</span
      >
      <span class="text-on-surface-variant font-body text-sm">Unsaved Changes</span>
    </div>
    <div class="flex items-center gap-1">
      <button
        class="text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-md p-2 transition-colors"
        title="Copy"
      >
        <span class="material-symbols-outlined text-xl">content_copy</span>
      </button>
      <button
        class="text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-md p-2 transition-colors"
        title="Download"
      >
        <span class="material-symbols-outlined text-xl">download</span>
      </button>
      <button
        class="bg-surface-container-highest text-on-surface font-label hover:bg-surface-dim ml-1 rounded-md px-4 py-2 text-sm font-semibold transition-colors"
        >Save</button
      >
    </div>
  </div>

  <!-- Notebook Canvas -->
  <div
    class="bg-notebook-lines flex-1 overflow-y-auto px-8 pb-24 md:px-14 lg:px-20"
    style="background-color: #fcf9f3;"
  >
    <div class="mx-auto max-w-2xl space-y-10 pt-10">
      <!-- Lesson Header -->
      <div class="border-on-surface border-b-2 pb-6">
        <h1
          class="font-headline text-on-surface mb-4 text-4xl leading-tight font-bold tracking-tight"
        >
          Introduction to Differential Calculus: Limits
        </h1>
        <div class="font-body text-on-surface-variant flex flex-wrap gap-4 text-sm">
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
        class="bg-surface-container-lowest border-outline-variant/15 relative rounded-xl border p-8 shadow-[0_8px_24px_rgba(28,28,24,0.03)]"
      >
        <div
          class="bg-primary-container text-on-primary font-headline absolute top-8 -left-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shadow-sm"
        >
          1
        </div>
        <h3 class="font-headline text-on-surface mb-4 flex items-center gap-2 text-xl font-bold">
          <span class="material-symbols-outlined text-primary">target</span>
          Learning Objective
        </h3>
        <p class="text-on-surface-variant font-body text-base leading-relaxed">
          By the end of this lesson, students will be able to intuitively understand the concept of
          a limit, evaluate limits graphically and numerically, and apply basic limit laws to
          algebraic functions.
        </p>
      </section>

      <!-- Section 2 — Core Activities -->
      <section
        class="bg-surface-container-lowest border-outline-variant/15 relative rounded-xl border p-8 shadow-[0_8px_24px_rgba(28,28,24,0.03)]"
      >
        <div
          class="bg-primary-container text-on-primary font-headline absolute top-8 -left-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shadow-sm"
        >
          2
        </div>
        <h3 class="font-headline text-on-surface mb-6 flex items-center gap-2 text-xl font-bold">
          <span class="material-symbols-outlined text-primary">local_activity</span>
          Core Activities
        </h3>

        <div class="space-y-0">
          <!-- Activity 1 -->
          <div class="flex gap-4">
            <div class="flex w-8 shrink-0 flex-col items-center pt-1">
              <span class="font-label text-secondary text-xs font-bold tabular-nums">10m</span>
              <div class="bg-outline-variant/30 mt-2 w-px flex-1"></div>
            </div>
            <div class="flex-1 pb-6">
              <h4 class="font-headline text-on-surface mb-1.5 text-base font-semibold">
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
            <div class="flex w-8 shrink-0 flex-col items-center pt-1">
              <span class="font-label text-secondary text-xs font-bold tabular-nums">20m</span>
              <div class="bg-outline-variant/30 mt-2 w-px flex-1"></div>
            </div>
            <div class="flex-1 pb-6">
              <h4 class="font-headline text-on-surface mb-1.5 text-base font-semibold">
                Graphical &amp; Numerical Exploration
              </h4>
              <p class="text-on-surface-variant font-body mb-3 text-sm leading-relaxed">
                Use graphing software (Desmos) to show functions with holes, jumps, and asymptotes.
                Guide students to evaluate limit behavior from both left and right sides.
              </p>
              <div
                class="bg-surface-container border-outline-variant/15 rounded-md border px-4 py-3"
              >
                <p class="font-body text-on-surface-variant text-xs">
                  <strong class="text-on-surface">Resource:</strong> Desmos Interactive Graph Activity
                  #4A
                </p>
              </div>
            </div>
          </div>

          <!-- Activity 3 -->
          <div class="flex gap-4">
            <div class="flex w-8 shrink-0 flex-col items-center pt-1">
              <span class="font-label text-secondary text-xs font-bold tabular-nums">15m</span>
            </div>
            <div class="flex-1">
              <h4 class="font-headline text-on-surface mb-1.5 text-base font-semibold">
                Algebraic Evaluation
              </h4>
              <p class="text-on-surface-variant font-body text-sm leading-relaxed">
                Introduce direct substitution and the limit laws. Work through 3 example problems on
                the board, progressively increasing in difficulty (polynomial, rational with
                factoring).
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 3 — Assessment -->
      <section
        class="bg-surface-container-lowest border-outline-variant/15 relative rounded-xl border p-8 shadow-[0_8px_24px_rgba(28,28,24,0.03)]"
      >
        <div
          class="bg-primary-container text-on-primary font-headline absolute top-8 -left-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shadow-sm"
        >
          3
        </div>
        <h3 class="font-headline text-on-surface mb-4 flex items-center gap-2 text-xl font-bold">
          <span class="material-symbols-outlined text-primary">fact_check</span>
          Assessment &amp; Exit Ticket
        </h3>
        <p class="text-on-surface-variant font-body mb-4 text-sm leading-relaxed">
          Students will complete a 3-question exit ticket requiring them to:
        </p>
        <ul class="ml-1 space-y-2">
          {#each ["Evaluate a limit graphically given a piecewise function.", "Calculate a limit algebraically requiring factoring.", "Explain in one sentence why a specific limit does not exist (DNE)."] as item}
            <li class="text-on-surface-variant font-body flex items-start gap-2 text-sm">
              <span class="material-symbols-outlined text-primary mt-0.5 shrink-0 text-base"
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
    class="from-surface-container-lowest pointer-events-none absolute bottom-0 h-20 w-full bg-linear-to-t to-transparent"
  ></div>
</section>
