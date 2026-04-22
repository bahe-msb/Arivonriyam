<script lang="ts">
  import type { Snippet } from "svelte";
  import { useSidebar } from "./sidebar-context.svelte";
  import { cn } from "@utils";

  type Props = {
    class?: string;
    collapsible?: "icon" | "none";
    children?: Snippet;
  };

  let { class: className, collapsible = "icon", children }: Props = $props();
  const sb = useSidebar();
</script>

{#if sb.isMobile}
  <!-- Mobile drawer -->
  {#if sb.openMobile}
    <div
      role="presentation"
      class="fixed inset-0 z-40 bg-black/40"
      onclick={() => (sb.openMobile = false)}
      onkeydown={(e) => e.key === "Escape" && (sb.openMobile = false)}
    ></div>
    <aside
      class={cn(
        "fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width)]",
        "bg-bg-sidebar flex flex-col text-white",
        "animate-in slide-in-from-left duration-200",
        className,
      )}
      data-state="expanded"
    >
      {@render children?.()}
    </aside>
  {/if}
{:else}
  <aside
    data-state={sb.state}
    data-collapsible={collapsible}
    class={cn(
      "bg-bg-sidebar relative flex shrink-0 flex-col text-white",
      "transition-[width] duration-200 ease-in-out",
      sb.open
        ? "w-[var(--sidebar-width)]"
        : collapsible === "icon"
          ? "w-[var(--sidebar-width-icon)]"
          : "w-0 overflow-hidden",
      className,
    )}
  >
    {@render children?.()}
  </aside>
{/if}
