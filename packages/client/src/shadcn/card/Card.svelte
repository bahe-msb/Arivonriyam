<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    class?: string;
    hover?: boolean;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, "class">;

  let { class: className, hover = false, children, ...rest }: Props = $props();
</script>

<div
  class={cn(
    "border-border-default rounded-xl border bg-white shadow-[0_1px_4px_0_rgba(13,17,29,0.12)]",
    hover &&
      "transition-all duration-150 hover:-translate-y-px hover:shadow-[0_4px_7px_0_rgba(0,0,0,0.16)]",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
