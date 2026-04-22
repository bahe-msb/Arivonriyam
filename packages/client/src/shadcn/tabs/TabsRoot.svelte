<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = TabsPrimitive.RootProps & {
    class?: string;
    children?: Snippet;
  };

  let {
    value = $bindable(),
    class: className,
    children,
    ref = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<TabsPrimitive.Root bind:value bind:ref class={cn(className)} {...rest}>
  {@render children?.()}
</TabsPrimitive.Root>
