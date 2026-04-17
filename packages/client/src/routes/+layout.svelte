<script lang="ts">
  import { page } from "$app/state";
  import "../app.css";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();

  const navLinks = [
    { href: "/", icon: "menu_book", label: "Curriculum" },
    { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
    { href: "/students", icon: "group", label: "Students" },
    { href: "/reports", icon: "analytics", label: "Reports" },
  ];
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

<div class="h-screen flex overflow-hidden">
  <!-- ─── Desktop Sidebar ─── -->
  <nav
    class="hidden md:flex flex-col h-full py-6 px-4 bg-slate-900 bg-kolam-dots w-64 shrink-0 z-20"
  >
    <!-- Logo -->
    <div class="flex items-center gap-3 mb-8 px-4">
      <div
        class="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center text-white font-headline font-bold text-xl shrink-0"
      >
        A
      </div>
      <div>
        <p class="text-lg font-bold text-white font-headline tracking-tight leading-tight">
          Arivonriyam
        </p>
        <p class="text-xs text-slate-400 font-label">Mission Control</p>
      </div>
    </div>

    <!-- Nav Links -->
    <div class="flex flex-col gap-1 grow">
      {#each navLinks as link}
        {@const active = page.url.pathname === link.href}
        <a
          href={link.href}
          class="flex items-center gap-3 px-4 py-3 rounded-md transition-all duration-200 font-label text-sm font-medium {active
            ? 'text-white bg-primary shadow-[0_2px_12px_rgba(28,51,192,0.35)]'
            : 'text-slate-400 hover:text-white hover:bg-slate-800'}"
        >
          <span
            class="material-symbols-outlined text-xl"
            style={active ? "font-variation-settings:'FILL' 1;" : ""}
          >
            {link.icon}
          </span>
          {link.label}
        </a>
      {/each}
    </div>

    <!-- Settings -->
    <a
      href="/settings"
      class="flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-all duration-200 font-label text-sm font-medium"
    >
      <span class="material-symbols-outlined text-xl">settings</span>
      Settings
    </a>
  </nav>

  <!-- ─── Content Column ─── -->
  <div class="flex-1 flex flex-col overflow-hidden min-w-0">
    <!-- Mobile Top Bar -->
    <header
      class="md:hidden shrink-0 flex justify-between items-center px-6 py-4 bg-surface-container-low border-b border-outline-variant/15 z-10"
    >
      <span class="text-xl font-bold text-on-surface tracking-tight font-headline"
        >Arivonriyam</span
      >
      <div class="flex items-center gap-2 text-primary">
        <span
          class="material-symbols-outlined hover:bg-surface-container transition-colors p-1.5 rounded-md cursor-pointer"
        >
          calendar_today
        </span>
      </div>
    </header>

    <!-- Page Slot -->
    <div class="flex-1 overflow-hidden">
      {@render children()}
    </div>
  </div>
</div>

<!-- ─── Mobile Bottom Nav ─── -->
<nav
  class="md:hidden fixed bottom-0 left-0 right-0 z-50 h-16 flex justify-around items-center bg-surface-container-low border-t border-outline-variant/15"
>
  {#each [{ href: "/", icon: "menu_book", label: "Curriculum" }, { href: "/students", icon: "school", label: "Students" }, { href: "/reports", icon: "trending_up", label: "Progress" }] as item}
    {@const active = page.url.pathname === item.href}
    <a
      href={item.href}
      class="flex flex-col items-center justify-center gap-0.5 px-5 py-2 rounded-lg transition-colors {active
        ? 'text-primary'
        : 'text-on-surface-variant'}"
    >
      <span
        class="material-symbols-outlined text-xl"
        style={active ? "font-variation-settings:'FILL' 1;" : ""}>{item.icon}</span
      >
      <span class="text-[10px] font-label font-medium">{item.label}</span>
    </a>
  {/each}
</nav>
