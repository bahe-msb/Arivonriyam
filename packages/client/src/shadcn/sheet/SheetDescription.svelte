<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = Omit<DialogPrimitive.DescriptionProps, "child"> & {
    class?: string;
    children?: Snippet;
  };

  let {
    class: className,
    children,
    ref = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<DialogPrimitive.Description
  bind:ref
  class={cn("text-sm leading-[1.6] text-text-secondary", className)}
  {...rest}
>
  {@render children?.()}
</DialogPrimitive.Description>