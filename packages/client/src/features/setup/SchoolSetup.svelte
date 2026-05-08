<script lang="ts">
  import {
    School,
    MapPin,
    User,
    BadgeCheck,
    Plus,
    X,
    Save,
    CheckCircle2,
    Users,
  } from "lucide-svelte";
  import { Button, Card, Input, Tabs } from "@shadcn";
  import { Page, PageHeader, Pill } from "@components";
  import { CLASSES } from "@mocks";
  import { schoolConfig, pickEmoji } from "@stores";

  // --- School info ---
  let schoolName = $state(schoolConfig.config.school_name);
  let location   = $state(schoolConfig.config.location);
  let stateName  = $state(schoolConfig.config.state);
  let teacherName = $state(schoolConfig.config.teacher_name);
  let teacherId   = $state(schoolConfig.config.teacher_id);
  let savingInfo  = $state(false);
  let infoSaved   = $state(false);

  // Sync when store loads
  $effect(() => {
    if (schoolConfig.loaded) {
      schoolName  = schoolConfig.config.school_name;
      location    = schoolConfig.config.location;
      stateName   = schoolConfig.config.state;
      teacherName = schoolConfig.config.teacher_name;
      teacherId   = schoolConfig.config.teacher_id;
    }
  });

  async function saveInfo(): Promise<void> {
    savingInfo = true;
    await schoolConfig.saveConfig({
      school_name: schoolName.trim(),
      location: location.trim(),
      state: stateName.trim(),
      teacher_name: teacherName.trim(),
      teacher_id: teacherId.trim(),
    });
    savingInfo = false;
    infoSaved = true;
    setTimeout(() => { infoSaved = false; }, 2500);
  }

  // --- Students ---
  let activeClassId = $state<number | null>(null);
  let draft         = $state("");
  let savingStudents = $state(false);
  let studentsSaved  = $state(false);

  // Working copy: classId → [{name, emoji}]
  let workingRoster = $state<Record<number, Array<{ name: string; emoji: string }>>>({});

  $effect(() => {
    if (schoolConfig.loaded) {
      const fresh: Record<number, Array<{ name: string; emoji: string }>> = {};
      for (const cls of CLASSES) {
        fresh[cls.id] = (schoolConfig.studentsByClass[cls.id] ?? []).map((s) => ({
          name: s.name,
          emoji: s.emoji,
        }));
      }
      workingRoster = fresh;
    }
  });

  const activeStudents = $derived(workingRoster[activeClassId ?? -1] ?? []);
  const activeCls      = $derived(CLASSES.find((c) => c.id === activeClassId));

  function addStudent(): void {
    if (!activeClassId || !draft.trim()) return;
    const existing = workingRoster[activeClassId] ?? [];
    workingRoster = {
      ...workingRoster,
      [activeClassId]: [
        ...existing,
        { name: draft.trim(), emoji: pickEmoji(existing.length) },
      ],
    };
    draft = "";
  }

  function removeStudent(index: number): void {
    if (!activeClassId) return;
    const updated = (workingRoster[activeClassId] ?? []).filter((_, i) => i !== index);
    workingRoster = { ...workingRoster, [activeClassId]: updated };
  }

  async function saveStudents(): Promise<void> {
    if (!activeClassId) return;
    savingStudents = true;
    await schoolConfig.saveStudents(activeClassId, workingRoster[activeClassId] ?? []);
    savingStudents = false;
    studentsSaved = true;
    setTimeout(() => { studentsSaved = false; }, 2500);
  }
</script>

<Page>
  <PageHeader
    eyebrow="One-time setup"
    title="School & Student Setup"
    subtitle="Enter your school details and the student roster for each class. These names are used in alerts, the daily report, and Socratic Q&A."
  />

  <Tabs.Root value="school">
    <Tabs.List class="mb-5">
      <Tabs.Trigger value="school">School & Teacher</Tabs.Trigger>
      <Tabs.Trigger value="students">Student Roster</Tabs.Trigger>
    </Tabs.List>

    <!-- ── Tab 1: School Info ─────────────────────────────────────── -->
    <Tabs.Content value="school">
      <div class="max-w-xl space-y-4">
        <Card class="p-6 space-y-4">
          <div class="mb-1 text-[13px] font-semibold">School details</div>

          <div class="space-y-3">
            <div class="grid grid-cols-[24px_1fr] items-center gap-3">
              <School class="size-4 text-text-secondary" />
              <Input
                bind:value={schoolName}
                placeholder="School name (e.g. Govt. Primary School, Thenkarai)"
              />
            </div>
            <div class="grid grid-cols-[24px_1fr] items-center gap-3">
              <MapPin class="size-4 text-text-secondary" />
              <Input bind:value={location} placeholder="Block / Taluk / District" />
            </div>
            <div class="grid grid-cols-[24px_1fr] items-center gap-3">
              <MapPin class="size-4 text-text-secondary opacity-0" />
              <Input bind:value={stateName} placeholder="State (e.g. Tamil Nadu)" />
            </div>
          </div>

          <div class="mt-2 border-t pt-4">
            <div class="mb-1 text-[13px] font-semibold">Teacher details</div>
            <div class="mt-3 space-y-3">
              <div class="grid grid-cols-[24px_1fr] items-center gap-3">
                <User class="size-4 text-text-secondary" />
                <Input bind:value={teacherName} placeholder="Teacher name (e.g. Kavitha R.)" />
              </div>
              <div class="grid grid-cols-[24px_1fr] items-center gap-3">
                <BadgeCheck class="size-4 text-text-secondary" />
                <Input bind:value={teacherId} placeholder="Teacher ID (e.g. TNEID-2014-30592)" />
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              onclick={() => void saveInfo()}
              disabled={savingInfo || !schoolName.trim() || !teacherName.trim()}
            >
              {#if savingInfo}
                Saving…
              {:else}
                <Save class="size-3.5" /> Save school info
              {/if}
            </Button>
            {#if infoSaved}
              <span class="flex items-center gap-1.5 text-[12px] font-medium text-[#247a46]">
                <CheckCircle2 class="size-4" /> Saved
              </span>
            {/if}
          </div>
        </Card>

        {#if schoolConfig.config.school_name}
          <Card class="border-[#d8eddf] bg-[#eef9f2] p-4">
            <div class="text-[12px] font-semibold text-[#247a46] mb-1">Currently saved</div>
            <div class="text-[13px] font-medium">{schoolConfig.config.school_name}</div>
            <div class="text-[12px] text-text-secondary mt-0.5">
              {schoolConfig.config.location} · {schoolConfig.config.state}
            </div>
            <div class="text-[12px] text-text-secondary mt-1">
              Teacher: {schoolConfig.config.teacher_name}
              {#if schoolConfig.config.teacher_id}
                · <span class="mono">{schoolConfig.config.teacher_id}</span>
              {/if}
            </div>
          </Card>
        {/if}
      </div>
    </Tabs.Content>

    <!-- ── Tab 2: Student Roster ──────────────────────────────────── -->
    <Tabs.Content value="students">
      <div class="grid grid-cols-[160px_1fr] items-start gap-4">

        <!-- Col 1: Class selector -->
        <Card class="p-2">
          <div class="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            Classes
          </div>
          {#each CLASSES as cls (cls.id)}
            {@const count = (workingRoster[cls.id] ?? []).length}
            {@const sel = cls.id === activeClassId}
            <button
              type="button"
              onclick={() => { activeClassId = cls.id; draft = ""; }}
              class="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors
                     {sel
                ? 'bg-cobalt-25 border-cobalt-50 border'
                : 'border border-transparent hover:bg-gray-50'}"
            >
              <span
                class="grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold"
                style="background: {cls.color}22; color: {cls.color};"
              >
                {cls.id}
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] font-medium">{cls.name}</div>
                {#if count > 0}
                  <div class="text-[10px] text-text-secondary">{count} students</div>
                {/if}
              </div>
            </button>
          {/each}
        </Card>

        <!-- Col 2: Student entry -->
        {#if activeClassId}
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[15px] font-semibold">{activeCls?.name} · Students</div>
                <div class="text-[11px] text-text-secondary">
                  {activeStudents.length} student{activeStudents.length === 1 ? "" : "s"} enrolled
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  variant="primary"
                  onclick={() => void saveStudents()}
                  disabled={savingStudents}
                >
                  {#if savingStudents}
                    Saving…
                  {:else}
                    <Save class="size-3.5" /> Save roster
                  {/if}
                </Button>
                {#if studentsSaved}
                  <span class="flex items-center gap-1.5 text-[12px] font-medium text-[#247a46]">
                    <CheckCircle2 class="size-4" /> Saved
                  </span>
                {/if}
              </div>
            </div>

            <Card class="p-4 space-y-3">
              <!-- Add student input -->
              <div class="flex gap-2">
                <Input
                  bind:value={draft}
                  placeholder="Student name (e.g. Meena)"
                  onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") addStudent(); }}
                />
                <Button
                  variant="primary"
                  onclick={addStudent}
                  disabled={!draft.trim()}
                >
                  <Plus class="size-3.5" />
                </Button>
              </div>

              <!-- Student list -->
              {#if activeStudents.length === 0}
                <div class="flex flex-col items-center gap-2 py-8 text-center">
                  <Users class="size-8 text-text-tertiary" />
                  <div class="text-[13px] text-text-secondary">No students yet. Add names above.</div>
                </div>
              {:else}
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {#each activeStudents as student, idx (idx)}
                    <div
                      class="flex items-center gap-2.5 rounded-2xl border border-border-default bg-gray-50 px-3 py-2.5"
                    >
                      <div class="grid size-8 shrink-0 place-items-center rounded-xl bg-white text-[18px] shadow-sm">
                        {student.emoji}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[13px] font-medium">{student.name}</div>
                      </div>
                      <button
                        type="button"
                        onclick={() => removeStudent(idx)}
                        class="shrink-0 text-text-tertiary hover:text-[#b42318] transition-colors"
                        aria-label="Remove {student.name}"
                      >
                        <X class="size-3.5" />
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </Card>

            <div class="rounded-2xl border border-[#d7e7ff] bg-[#eef6ff] px-3.5 py-3 text-[12px] leading-[1.6] text-[#2f67c8]">
              Student names are used in Alerts, Daily Reports, and Socratic Q&A sessions for personalised call-outs.
              You only need to set this up once. You can update any time.
            </div>
          </div>
        {:else}
          <Card class="flex h-40 items-center justify-center text-center">
            <div class="text-[13px] text-text-tertiary">Select a class to manage its student roster</div>
          </Card>
        {/if}
      </div>
    </Tabs.Content>
  </Tabs.Root>
</Page>
