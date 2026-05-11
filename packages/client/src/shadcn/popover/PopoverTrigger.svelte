<script lang="ts">
  import { Popover as PopoverPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = PopoverPrimitive.TriggerProps & { class?: string; children?: Snippet };

  let { class: className, children, ref = $bindable(null), ...rest }: Props = $props();
</script>

<PopoverPrimitive.Trigger bind:ref class={cn(className)} {...rest}>
  {@render children?.()}
</PopoverPrimitive.Trigger>
