<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { Sidebar } from "@shadcn";
  import { AppSidebar, TopBar } from "@components";
  import "../app.css";

  type Props = { children?: Snippet };
  let { children }: Props = $props();

  const STUDENT_ONLY_BREAKPOINT = 768;
  const STUDENT_ONLY_PATH = "/student/socratic";

  let isStudentOnlyViewport = $state(
    typeof window !== "undefined" && window.innerWidth < STUDENT_ONLY_BREAKPOINT,
  );

  function syncViewport(): void {
    if (typeof window === "undefined") return;
    isStudentOnlyViewport = window.innerWidth < STUDENT_ONLY_BREAKPOINT;
  }

  onMount(() => {
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  });

  $effect(() => {
    if (!isStudentOnlyViewport) return;

    const currentPath = page.url.pathname;
    if (currentPath !== STUDENT_ONLY_PATH) {
      void goto(STUDENT_ONLY_PATH, {
        replaceState: true,
        noScroll: true,
        keepFocus: true,
      });
    }
  });
</script>

{#if isStudentOnlyViewport}
  <div class="flex min-h-screen w-full flex-col overflow-hidden bg-[#0b0d14]">
    {@render children?.()}
  </div>
{:else}
  <Sidebar.Provider>
    <div class="flex h-full w-full flex-col overflow-hidden">
      <TopBar />
      <div class="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar />
        <Sidebar.Inset>
          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {@render children?.()}
          </div>
        </Sidebar.Inset>
      </div>
    </div>
  </Sidebar.Provider>
{/if}
