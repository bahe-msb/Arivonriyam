<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<div class={cn("mt-auto flex flex-col gap-2 border-t border-white/10 p-3", className)}>
  {@render children?.()}
</div>
