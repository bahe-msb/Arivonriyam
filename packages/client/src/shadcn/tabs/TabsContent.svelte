<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = TabsPrimitive.ContentProps & { class?: string; children?: Snippet };

  let { class: className, children, value, ref = $bindable(null), ...rest }: Props = $props();
</script>

<TabsPrimitive.Content bind:ref {value} class={cn("outline-none", className)} {...rest}>
  {@render children?.()}
</TabsPrimitive.Content>
