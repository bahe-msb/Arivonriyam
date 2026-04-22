<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    maxWidth?: number;
    class?: string;
    children?: Snippet;
  };
  let { maxWidth = 1280, class: className, children }: Props = $props();
</script>

<div
  class={cn("mx-auto w-full px-4 py-5 md:px-8 md:pt-7 md:pb-15", className)}
  style="max-width: {maxWidth}px;"
>
  {@render children?.()}
</div>
