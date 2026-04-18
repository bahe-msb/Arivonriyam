<script lang="ts">
  import { page } from "$app/state";
  import * as Sidebar from "$lib/components/ui/sidebar";

  interface SidebarUserData {
    initial?: string;
    title?: string;
    subtitle?: string;
  }

  interface Props {
    sUserData?: SidebarUserData;
  }

  let { sUserData }: Props = $props();

  const navLinks = [
    { href: "/", icon: "menu_book", label: "Curriculum" },
    { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
    { href: "/students", icon: "group", label: "Students" },
    { href: "/reports", icon: "analytics", label: "Reports" },
  ];

  const mobileLinks = [
    { href: "/", icon: "menu_book", label: "Curriculum" },
    { href: "/students", icon: "school", label: "Students" },
    { href: "/reports", icon: "trending_up", label: "Progress" },
  ];
</script>

<Sidebar.Root
  class="bg-kolam-dots z-20 hidden h-full w-64 shrink-0 flex-col bg-slate-900 px-4 py-6 md:flex"
>
  <div class="mb-8 flex items-center gap-3 px-4">
    <div
      class="bg-gradient-primary font-headline flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl font-bold text-white"
    >
      {sUserData?.initial || "A"}
    </div>
    <div>
      <p class="font-headline text-lg leading-tight font-bold tracking-tight text-white">
        {sUserData?.title || "Arivonriyam"}
      </p>
      <p class="font-label text-xs text-slate-400">{sUserData?.subtitle || "Mission Control"}</p>
    </div>
  </div>

  <div class="flex grow flex-col gap-1">
    {#each navLinks as link}
      {@const active = page.url.pathname === link.href}
      <a
        href={link.href}
        class="font-label flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-all duration-200 {active
          ? 'bg-primary text-white shadow-[0_2px_12px_rgba(28,51,192,0.35)]'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'}"
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

  <a
    href="/settings"
    class="font-label flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-slate-400 transition-all duration-200 hover:bg-slate-800 hover:text-white"
  >
    <span class="material-symbols-outlined text-xl">settings</span>
    Settings
  </a>
</Sidebar.Root>

<nav
  class="bg-surface-container-low border-outline-variant/15 fixed right-0 bottom-0 left-0 z-50 flex h-16 items-center justify-around border-t md:hidden"
>
  {#each mobileLinks as item}
    {@const active = page.url.pathname === item.href}
    <a
      href={item.href}
      class="flex flex-col items-center justify-center gap-0.5 rounded-lg px-5 py-2 transition-colors {active
        ? 'text-primary'
        : 'text-on-surface-variant'}"
    >
      <span
        class="material-symbols-outlined text-xl"
        style={active ? "font-variation-settings:'FILL' 1;" : ""}
      >
        {item.icon}
      </span>
      <span class="font-label text-[10px] font-medium">{item.label}</span>
    </a>
  {/each}
</nav>
