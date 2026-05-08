<script lang="ts">
  import { page } from "$app/state";
  import { Sidebar } from "@shadcn";
  import { sessionAlerts } from "@stores";
  import {
    Home,
    Sparkles,
    BookOpen,
    CalendarCheck,
    Tablet as TabletIcon,
    AlertTriangle,
    FileText,
    Grid3x3,
    Mic,
    School,
    type Icon as IconType,
  } from "lucide-svelte";

  type NavEntry = {
    label: string;
    href: string;
    icon: typeof IconType;
    matchPrefix?: boolean;
  };

  const teaching: NavEntry[] = [
    { label: "Today", href: "/", icon: Home },
    { label: "Lesson Plan", href: "/lesson", icon: Sparkles },
    { label: "Saved Plans", href: "/plans", icon: CalendarCheck },
    { label: "Reteach", href: "/reteach", icon: BookOpen },
    { label: "Handoff", href: "/handoff", icon: TabletIcon },
  ];

  const care: NavEntry[] = [
    { label: "Alerts", href: "/alert", icon: AlertTriangle },
    { label: "Daily Report", href: "/report", icon: FileText },
  ];

  const student: NavEntry[] = [
    { label: "Topic Picker", href: "/student/topic", icon: Grid3x3 },
    { label: "Socratic Q&A", href: "/student/socratic", icon: Mic },
  ];

  const settings: NavEntry[] = [
    { label: "School Setup", href: "/setup", icon: School },
  ];

  const alertCount = $derived(sessionAlerts.count());

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === "/") return path === "/";
    return path === href || path.startsWith(href + "/");
  }
</script>

<Sidebar.Root>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Teaching</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {#each teaching as item (item.href + item.label)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              href={item.href}
              isActive={isActive(item.href)}
              tooltip={item.label}
            >
              <item.icon class="size-4.25 shrink-0 opacity-90" />
              <span class="truncate">{item.label}</span>
              {#if item.href === "/alert" && alertCount > 0}
                <span class="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[#fde7e7] px-1.5 py-0.5 text-[10px] font-semibold text-[#b42318]">
                  {alertCount}
                </span>
              {/if}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>

    <Sidebar.Group>
      <Sidebar.GroupLabel>Care</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {#each care as item (item.href + item.label)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              href={item.href}
              isActive={isActive(item.href)}
              tooltip={item.label}
            >
              <item.icon class="size-4.25 shrink-0 opacity-90" />
              <span class="truncate">{item.label}</span>
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>

    <Sidebar.Group>
      <Sidebar.GroupLabel>Student view</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {#each student as item (item.href + item.label)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              href={item.href}
              isActive={isActive(item.href)}
              tooltip={item.label}
            >
              <item.icon class="size-4.25 shrink-0 opacity-90" />
              <span class="truncate">{item.label}</span>
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>

    <Sidebar.Group>
      <Sidebar.GroupLabel>Settings</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {#each settings as item (item.href + item.label)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              href={item.href}
              isActive={isActive(item.href)}
              tooltip={item.label}
            >
              <item.icon class="size-4.25 shrink-0 opacity-90" />
              <span class="truncate">{item.label}</span>
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>
  </Sidebar.Content>
</Sidebar.Root>
