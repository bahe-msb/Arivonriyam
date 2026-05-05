<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    class?: string;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, "class">;

  let { class: className, children, ...rest }: Props = $props();
</script>

<div class={cn("flex flex-col gap-1.5 text-left", className)} {...rest}>
  {@render children?.()}
</div>