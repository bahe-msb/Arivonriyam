<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = SelectPrimitive.ContentProps & {
    class?: string;
    children?: Snippet;
  };

  let {
    class: className,
    children,
    sideOffset = 4,
    ref = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<SelectPrimitive.Portal>
  <SelectPrimitive.Content
    bind:ref
    {sideOffset}
    class={cn(
      "z-50 min-w-[var(--bits-select-anchor-width)] overflow-hidden",
      "border-border-default rounded-md border bg-white shadow-lg",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...rest}
  >
    <SelectPrimitive.Viewport class="p-1">
      {@render children?.()}
    </SelectPrimitive.Viewport>
  </SelectPrimitive.Content>
</SelectPrimitive.Portal>
