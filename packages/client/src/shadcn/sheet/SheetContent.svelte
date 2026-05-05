<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { X } from "lucide-svelte";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Side = "top" | "right" | "bottom" | "left";

  const sideClasses: Record<Side, string> = {
    top: "inset-x-0 top-0 border-b data-[state=closed]:-translate-y-full data-[state=open]:translate-y-0",
    right:
      "inset-y-0 right-0 h-dvh w-full max-w-[calc(100vw-1rem)] border-l data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 sm:max-w-lg",
    bottom:
      "inset-x-0 bottom-0 border-t data-[state=closed]:translate-y-full data-[state=open]:translate-y-0",
    left:
      "inset-y-0 left-0 h-dvh w-full max-w-[calc(100vw-1rem)] border-r data-[state=closed]:-translate-x-full data-[state=open]:translate-x-0 sm:max-w-lg",
  };

  type Props = Omit<DialogPrimitive.ContentProps, "child"> & {
    class?: string;
    children?: Snippet;
    overlayClass?: string;
    showClose?: boolean;
    side?: Side;
  };

  let {
    class: className,
    children,
    overlayClass,
    showClose = true,
    side = "right",
    ref = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<DialogPrimitive.Portal>
  <DialogPrimitive.Overlay
    class={cn(
      "fixed inset-0 z-50 bg-black/45 transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
      overlayClass,
    )}
  />

  <DialogPrimitive.Content
    bind:ref
    class={cn(
      "fixed z-50 flex flex-col gap-4 overflow-hidden border-border-default bg-white p-6 shadow-[0_20px_45px_rgba(15,23,42,0.18)] transition-transform duration-200 data-[state=closed]:duration-150 data-[state=open]:duration-200",
      sideClasses[side],
      className,
    )}
    {...rest}
  >
    {@render children?.()}

    {#if showClose}
      <DialogPrimitive.Close
        class="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-full border border-border-default bg-white text-text-secondary transition-colors hover:bg-clay-50 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-400"
      >
        <X class="size-4" />
        <span class="sr-only">Close</span>
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>