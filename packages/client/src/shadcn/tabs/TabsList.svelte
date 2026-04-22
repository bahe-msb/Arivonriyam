<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = TabsPrimitive.ListProps & { class?: string; children?: Snippet };

  let { class: className, children, ref = $bindable(null), ...rest }: Props = $props();
</script>

<TabsPrimitive.List
  bind:ref
  class={cn(
    "inline-flex items-center gap-1 rounded-lg p-0.5",
    "border-border-default border bg-gray-50",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</TabsPrimitive.List>
