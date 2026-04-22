<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<ul class={cn("m-0 flex list-none flex-col gap-0.5 p-0", className)}>
  {@render children?.()}
</ul>
