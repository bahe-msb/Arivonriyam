<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "@utils";

  type Props = { class?: string; children?: Snippet } & Omit<HTMLAttributes<HTMLElement>, "class">;

  let { class: className, children, ...rest }: Props = $props();
</script>

<main class={cn("bg-bg-secondary relative flex min-w-0 flex-1 flex-col", className)} {...rest}>
  {@render children?.()}
</main>
