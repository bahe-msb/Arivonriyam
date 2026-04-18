<script lang="ts">
  interface Props {
    subject: string;
    gradeLevel: string;
    topicFocus: string;
    subjects: string[];
    grades: string[];
    isGenerating: boolean;
    onSubjectChange: (value: string) => void;
    onGradeLevelChange: (value: string) => void;
    onTopicFocusChange: (value: string) => void;
    onGenerate: () => void;
  }

  const {
    subject,
    gradeLevel,
    topicFocus,
    subjects,
    grades,
    isGenerating,
    onSubjectChange,
    onGradeLevelChange,
    onTopicFocusChange,
    onGenerate,
  }: Props = $props();
</script>

<section
  class="bg-surface-container-low border-outline-variant/15 h-full w-full border-r p-6 md:w-2/5 md:p-10"
>
  <header class="mb-8">
    <h2 class="font-headline text-on-surface mb-2 text-3xl font-bold">Lesson Architect</h2>
    <p class="text-on-surface-variant text-sm">
      Define your inputs and generate a lesson blueprint.
    </p>
  </header>

  <div class="space-y-5">
    <div class="grid grid-cols-2 gap-4">
      <label class="text-on-surface-variant text-xs font-semibold tracking-wider uppercase">
        Subject
        <select
          class="bg-surface-container-high mt-2 w-full rounded-lg p-3"
          value={subject}
          onchange={(event) => onSubjectChange((event.currentTarget as HTMLSelectElement).value)}
        >
          {#each subjects as s}<option>{s}</option>{/each}
        </select>
      </label>

      <label class="text-on-surface-variant text-xs font-semibold tracking-wider uppercase">
        Grade
        <select
          class="bg-surface-container-high mt-2 w-full rounded-lg p-3"
          value={gradeLevel}
          onchange={(event) => onGradeLevelChange((event.currentTarget as HTMLSelectElement).value)}
        >
          {#each grades as g}<option>{g}</option>{/each}
        </select>
      </label>
    </div>

    <label class="text-on-surface-variant block text-xs font-semibold tracking-wider uppercase">
      Topic Focus
      <input
        class="bg-surface-container-high mt-2 w-full rounded-lg p-3"
        value={topicFocus}
        placeholder="Introduction to calculus limits"
        oninput={(event) => onTopicFocusChange((event.currentTarget as HTMLInputElement).value)}
      />
    </label>

    <button
      onclick={onGenerate}
      disabled={isGenerating}
      class="bg-gradient-primary text-on-primary w-full rounded-lg py-3 font-semibold disabled:opacity-70"
    >
      {isGenerating ? "Generating Blueprint..." : "Generate Blueprint"}
    </button>
  </div>
</section>
