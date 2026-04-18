<script lang="ts">
  import { AppSidebar } from "$lib/components";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import "../app.css";
  import favicon from "$lib/assets/favicon.svg";

  interface SidebarUserData {
    initial?: string;
    title?: string;
    subtitle?: string;
  }

  interface Props {
    children?: import("svelte").Snippet;
    sUserData?: SidebarUserData;
  }

  let { children, sUserData }: Props = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Public+Sans:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
  <link
    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
    rel="stylesheet"
  />
</svelte:head>

<div class="flex h-screen overflow-hidden">
  <AppSidebar {sUserData} />

  <Sidebar.Inset class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <!-- Mobile Top Bar -->
    <header
      class="bg-surface-container-low border-outline-variant/15 z-10 flex shrink-0 items-center justify-between border-b px-6 py-4 md:hidden"
    >
      <span class="text-on-surface font-headline text-xl font-bold tracking-tight">Arivonriyam</span
      >
      <div class="text-primary flex items-center gap-2">
        <span
          class="material-symbols-outlined hover:bg-surface-container cursor-pointer rounded-md p-1.5 transition-colors"
        >
          calendar_today
        </span>
      </div>
    </header>

    <section class="flex-1 overflow-hidden">
      {@render children?.()}
    </section>
  </Sidebar.Inset>
</div>
