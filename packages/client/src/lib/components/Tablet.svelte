<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    width?: number;
    class?: string;
    children?: Snippet;
  };
  let { width = 760, class: className, children }: Props = $props();
</script>

<div
  class={cn("tablet-frame mx-auto aspect-4/3 w-full max-w-full", className)}
  style="width: {width}px;"
>
  <div class="tablet-screen h-full w-full">
    {@render children?.()}
  </div>
</div>
