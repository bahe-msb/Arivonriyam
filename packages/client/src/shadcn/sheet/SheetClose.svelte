<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = Omit<DialogPrimitive.CloseProps, "child"> & {
    class?: string;
    children?: Snippet;
  };

  let { class: className, children, ...rest }: Props = $props();
</script>

<DialogPrimitive.Close class={cn(className)} {...rest}>
  {@render children?.()}
</DialogPrimitive.Close>