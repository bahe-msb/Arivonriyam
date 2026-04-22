<script lang="ts">
  import type { Snippet } from "svelte";
  import { useSidebar } from "./sidebar-context.svelte";
  import { cn } from "@utils";

  type Props = {
    href?: string;
    isActive?: boolean;
    tooltip?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  };

  let { href, isActive = false, tooltip, class: className, onclick, children }: Props = $props();

  const sb = useSidebar();
  const showLabel = $derived(sb.open || sb.isMobile);
</script>

{#snippet content()}
  <span
    class={cn(
      "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 select-none",
      "text-[13.5px] font-medium transition-colors duration-150",
      "text-white/70 hover:bg-white/5 hover:text-white",
      isActive && "bg-cobalt-500 hover:bg-cobalt-500 text-white",
      !showLabel && "justify-center px-2",
      className,
    )}
    title={!showLabel ? tooltip : undefined}
  >
    {@render children?.()}
  </span>
{/snippet}

{#if href}
  <a {href} data-active={isActive} {onclick}>
    {@render content()}
  </a>
{:else}
  <button type="button" data-active={isActive} {onclick}>
    {@render content()}
  </button>
{/if}
