<script lang="ts">
  import { Menu } from "lucide-svelte";
  import { useSidebar } from "./sidebar-context.svelte";
  import { cn } from "@utils";

  type Props = { class?: string };
  let { class: className }: Props = $props();
  const sb = useSidebar();
</script>

<button
  type="button"
  aria-label="Toggle sidebar"
  onclick={sb.toggle}
  class={cn(
    "inline-flex size-9 items-center justify-center rounded-md",
    "text-white/80 transition-colors hover:bg-white/10",
    className,
  )}
>
  <Menu class="size-5" />
</button>
