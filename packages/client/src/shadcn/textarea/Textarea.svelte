<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { cn } from "@utils";

  type Props = {
    value?: string;
    class?: string;
  } & Omit<HTMLTextareaAttributes, "class" | "value">;

  let { value = $bindable(""), class: className, ...rest }: Props = $props();
</script>

<textarea
  bind:value
  class={cn(
    "text-text-primary w-full bg-white px-3 py-2.5 text-[13px]",
    "border-border-default min-h-[90px] resize-y rounded-md border outline-none",
    "transition-[border-color,box-shadow] duration-150",
    "focus:border-cobalt-500 focus:ring-cobalt-500/15 focus:ring-[3px]",
    "placeholder:text-text-tertiary",
    className,
  )}
  {...rest}
></textarea>
