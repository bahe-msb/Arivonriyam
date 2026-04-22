<script lang="ts">
  import type { Snippet } from "svelte";
  import { setSidebarState } from "./sidebar-context.svelte";
  import { cn } from "@utils";

  type Props = {
    defaultOpen?: boolean;
    class?: string;
    children?: Snippet;
  };

  let { defaultOpen = true, class: className, children }: Props = $props();

  // svelte-ignore state_referenced_locally
  setSidebarState(defaultOpen);
</script>

<div
  class={cn(
    "group/sidebar-wrapper flex h-screen w-full overflow-hidden",
    "[--sidebar-width-icon:64px] [--sidebar-width:240px]",
    className,
  )}
>
  {@render children?.()}
</div>
