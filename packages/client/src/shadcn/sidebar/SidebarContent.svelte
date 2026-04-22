<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<div class={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-2 py-1", className)}>
  {@render children?.()}
</div>
