<script lang="ts">
  import { LessonCanvas, LessonInputPanel } from "$lib/components";

  const subjects = [
    "Tamil",
    "English",
    "Mathematics",
    "Science",
    "Social Studies",
    "Computer Science",
  ];

  const grades = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"];

  let subject = $state("Mathematics");
  let gradeLevel = $state("Grade 1");
  let topicFocus = $state("");
  let isGenerating = $state(false);

  async function generateBlueprint(): Promise<void> {
    if (isGenerating) return;
    isGenerating = true;
    // Simulate generation delay
    await new Promise((resolve) => setTimeout(resolve, 900));
    isGenerating = false;
  }
</script>

<main class="bg-surface flex h-full flex-col overflow-hidden md:flex-row">
  <LessonInputPanel
    {subject}
    {gradeLevel}
    {topicFocus}
    {subjects}
    {grades}
    {isGenerating}
    onSubjectChange={(value) => (subject = value)}
    onGradeLevelChange={(value) => (gradeLevel = value)}
    onTopicFocusChange={(value) => (topicFocus = value)}
    onGenerate={generateBlueprint}
  />
  <LessonCanvas />
</main>
