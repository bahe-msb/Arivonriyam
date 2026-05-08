<script lang="ts">
  import Brand from "./Brand.svelte";
  import OfflineChip from "./OfflineChip.svelte";
  import UserChip from "./UserChip.svelte";
  import { Sidebar } from "@shadcn";
  import { schoolConfig } from "@stores";

  function initials(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .filter(Boolean)
      .slice(0, 2)
      .join("");
  }

  const teacherName = $derived(schoolConfig.config.teacher_name || "Teacher");
  const schoolName  = $derived(schoolConfig.config.school_name || "Arivonriyam");
  const teacherInitials = $derived(initials(teacherName));
  const roleLabel = $derived(
    schoolConfig.config.location
      ? `Teacher · ${schoolName}, ${schoolConfig.config.location}`
      : `Teacher · ${schoolName}`,
  );
</script>

<header
  class="bg-bg-top-bar flex h-14 shrink-0 items-center gap-3 border-b border-[#1a1d2c]
         px-4 text-white md:px-5"
>
  <div class="md:hidden">
    <Sidebar.Trigger />
  </div>
  <Brand />
  <div class="ml-auto flex items-center gap-3">
    <div class="hidden sm:block">
      <OfflineChip />
    </div>
    <UserChip name={teacherName} role={roleLabel} initials={teacherInitials} />
  </div>
</header>
