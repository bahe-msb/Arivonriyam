<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = TabsPrimitive.TriggerProps & { class?: string; children?: Snippet };

  let { class: className, children, value, ref = $bindable(null), ...rest }: Props = $props();
</script>

<TabsPrimitive.Trigger
  bind:ref
  {value}
  class={cn(
    "cursor-pointer rounded-md px-3.5 py-1.5 text-xs font-medium",
    "text-text-secondary transition-colors duration-150",
    "data-[state=active]:text-cobalt-600 data-[state=active]:bg-white data-[state=active]:shadow-sm",
    "focus-visible:ring-cobalt-500/30 focus-visible:ring-2 focus-visible:outline-none",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</TabsPrimitive.Trigger>
