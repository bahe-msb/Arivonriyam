<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<li class={cn("relative", className)}>
  {@render children?.()}
</li>
