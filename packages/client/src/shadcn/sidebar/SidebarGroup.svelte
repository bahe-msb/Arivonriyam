<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<div class={cn("flex flex-col gap-0.5 py-1", className)}>
  {@render children?.()}
</div>
