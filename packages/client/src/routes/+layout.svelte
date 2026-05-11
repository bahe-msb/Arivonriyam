<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { Sidebar } from "@shadcn";
  import { AppSidebar, ServerReachabilityBanner, TopBar } from "@components";
  import { reteachTopics, schoolConfig, sessionAlerts, startReachabilityMonitoring } from "@stores";
  import "../app.css";

  type Props = { children?: Snippet };
  let { children }: Props = $props();

  const STUDENT_ONLY_BREAKPOINT = 835;
  const STUDENT_ONLY_PATH = "/student/socratic";

  function isStudentOnlyDevice(): boolean {
    if (typeof window === "undefined") return false;

    const isPhoneLikeViewport = window.innerWidth < STUDENT_ONLY_BREAKPOINT;
    const isTouchTabletViewport =
      navigator.maxTouchPoints > 1 &&
      Math.min(window.innerWidth, window.innerHeight) <= STUDENT_ONLY_BREAKPOINT;

    return isPhoneLikeViewport || isTouchTabletViewport;
  }

  let isStudentOnlyViewport = $state(isStudentOnlyDevice());

  function syncViewport(): void {
    isStudentOnlyViewport = isStudentOnlyDevice();
  }

  onMount(() => {
    syncViewport();
    const stopReachabilityMonitoring = startReachabilityMonitoring();
    window.addEventListener("resize", syncViewport);
    void schoolConfig.load();
    void reteachTopics.load();
    void sessionAlerts.load();

    return () => {
      stopReachabilityMonitoring();
      window.removeEventListener("resize", syncViewport);
    };
  });

  $effect(() => {
    if (!isStudentOnlyViewport) return;

    const currentPath = page.url.pathname;
    if (currentPath !== STUDENT_ONLY_PATH) {
      void goto(resolve(STUDENT_ONLY_PATH), {
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

<ServerReachabilityBanner />
