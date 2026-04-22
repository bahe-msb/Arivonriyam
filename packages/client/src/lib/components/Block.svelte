<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    n: number;
    title: string;
    tone?: "cobalt" | "saffron";
    icon?: Snippet;
    children?: Snippet;
  };
  let { n, title, tone = "cobalt", icon, children }: Props = $props();

  const circleBg = $derived(tone === "cobalt" ? "bg-cobalt-500" : "bg-saffron-500");
  const iconColor = $derived(tone === "cobalt" ? "text-cobalt-500" : "text-saffron-500");
</script>

<div class="mb-5 grid grid-cols-[44px_1fr] gap-3.5">
  <div>
    <div
      class={cn(
        "grid size-7 place-items-center rounded-full text-xs font-semibold text-white",
        circleBg,
      )}
    >
      {n}
    </div>
  </div>
  <div class="border-border-default rounded-xl border bg-white px-4.5 py-3.5">
    <div class="mb-1.5 flex items-center gap-2">
      {#if icon}
        <span class={cn("inline-flex items-center", iconColor)}>
          {@render icon()}
        </span>
      {/if}
      <div class="text-sm font-semibold">{title}</div>
    </div>
    <div class="text-text-body text-[13.5px] leading-[1.55]">
      {@render children?.()}
    </div>
  </div>
</div>
