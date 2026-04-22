<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cn } from "@utils";

  type Props = {
    value?: string;
    class?: string;
  } & Omit<HTMLInputAttributes, "class" | "value">;

  let { value = $bindable(""), class: className, ...rest }: Props = $props();
</script>

<input
  bind:value
  class={cn(
    "text-text-primary w-full bg-white px-3 py-2.5 text-[13px]",
    "border-border-default rounded-md border outline-none",
    "transition-[border-color,box-shadow] duration-150",
    "focus:border-cobalt-500 focus:ring-cobalt-500/15 focus:ring-[3px]",
    "placeholder:text-text-tertiary",
    "disabled:bg-gray-50 disabled:opacity-60",
    className,
  )}
  {...rest}
/>
