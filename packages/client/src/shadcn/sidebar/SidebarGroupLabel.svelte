<script lang="ts">
  import type { Snippet } from "svelte";
  import { useSidebar } from "./sidebar-context.svelte";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
  const sb = useSidebar();
</script>

{#if sb.open || sb.isMobile}
  <div
    class={cn(
      "px-3 pt-3 pb-1.5 text-[10.5px] font-medium tracking-[0.12em] text-white/40 uppercase",
      className,
    )}
  >
    {@render children?.()}
  </div>
{/if}
