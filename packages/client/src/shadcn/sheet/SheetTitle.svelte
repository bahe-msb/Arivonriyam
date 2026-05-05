<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = Omit<DialogPrimitive.TitleProps, "child"> & {
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

<DialogPrimitive.Title bind:ref class={cn("text-lg font-semibold text-text-primary", className)} {...rest}>
  {@render children?.()}
</DialogPrimitive.Title>