<script lang="ts">
  import { Popover as PopoverPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = PopoverPrimitive.ContentProps & { class?: string; children?: Snippet };

  let {
    class: className,
    sideOffset = 6,
    align = "start",
    children,
    ref = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<PopoverPrimitive.Portal>
  <PopoverPrimitive.Content
    bind:ref
    {sideOffset}
    {align}
    class={cn(
      "z-50 rounded-xl border border-border-default bg-white p-2 shadow-[0_20px_45px_rgba(15,23,42,0.18)] outline-none data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
      className,
    )}
    {...rest}
  >
    {@render children?.()}
  </PopoverPrimitive.Content>
</PopoverPrimitive.Portal>
