<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { ChevronDown } from "lucide-svelte";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = SelectPrimitive.TriggerProps & {
    class?: string;
    children?: Snippet;
  };

  let { class: className, children, ref = $bindable(null), ...rest }: Props = $props();
</script>

<SelectPrimitive.Trigger
  bind:ref
  class={cn(
    "flex w-full items-center justify-between px-3 py-2.5 text-[13px]",
    "text-text-primary border-border-default rounded-md border bg-white",
    "cursor-pointer transition-[border-color,box-shadow] duration-150 outline-none",
    "focus:border-cobalt-500 focus:ring-cobalt-500/15 focus:ring-[3px]",
    "data-[placeholder]:text-text-tertiary",
    className,
  )}
  {...rest}
>
  {@render children?.()}
  <ChevronDown class="text-text-tertiary ml-2 size-4 shrink-0" />
</SelectPrimitive.Trigger>
