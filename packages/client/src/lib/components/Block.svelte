<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    phase?: string;
    title: string;
    durationMin?: number;
    tone?: "cobalt" | "saffron";
    children?: Snippet;
  };
  let { phase, title, durationMin = 0, tone = "cobalt", children }: Props = $props();

  const phaseLabels: Record<string, string> = {
    objective: "Objective",
    warm_up: "Warm-Up",
    teach: "Teach",
    practice: "Practice",
    check: "Check",
    wrap_up: "Wrap-Up",
  };

  const label = $derived(phase ? (phaseLabels[phase] ?? phase) : "");

  const accentBar = $derived(tone === "cobalt" ? "bg-cobalt-400" : "bg-saffron-400");
  const chipCls = $derived(
    tone === "cobalt"
      ? "bg-cobalt-50 text-cobalt-600 border-cobalt-100"
      : "bg-saffron-50 text-saffron-700 border-saffron-100",
  );
</script>

<div class="mb-3.5 flex gap-3">
  <div class={cn("w-0.5 shrink-0 rounded-full", accentBar)}></div>
  <div class="flex-1 overflow-hidden rounded-xl border border-border-default bg-white px-4 pt-3 pb-3.5">
    <div class="mb-1.5 flex items-center gap-2">
      {#if label}
        <span
          class={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em]",
            chipCls,
          )}
        >
          {label}
        </span>
      {/if}
      {#if durationMin > 0}
        <span class="text-text-secondary ml-auto shrink-0 text-[11px] font-medium tabular-nums">
          {durationMin}m
        </span>
      {/if}
    </div>
    <div class="text-sm font-semibold text-ink">{title}</div>
    <div class="text-text-body mt-1 text-[13.5px] leading-[1.55]">
      {@render children?.()}
    </div>
  </div>
</div>
