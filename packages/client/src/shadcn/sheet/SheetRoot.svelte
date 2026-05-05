<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";

  type Props = Omit<DialogPrimitive.RootProps, "children"> & {
    children?: Snippet;
  };

  let {
    open = $bindable(false),
    children,
    ...rest
  }: Props = $props();
</script>

<DialogPrimitive.Root bind:open {...rest}>
  {@render children?.()}
</DialogPrimitive.Root>