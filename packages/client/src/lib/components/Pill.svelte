<script lang="ts" module>
  export type PillTone = "default" | "cobalt" | "saffron" | "success" | "warn" | "danger";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = { tone?: PillTone; class?: string; children?: Snippet };
  let { tone = "default", class: className, children }: Props = $props();

  const tones: Record<PillTone, string> = {
    default: "bg-gray-50 text-text-secondary border-border-default",
    cobalt: "bg-cobalt-25 text-cobalt-700 border-cobalt-50",
    saffron: "bg-saffron-50 text-saffron-700 border-saffron-100",
    success: "bg-success-50 text-success-600 border-[#BDE3C6]",
    warn: "bg-warn-50 text-warn-500 border-[#F5D9AE]",
    danger: "bg-danger-50 text-danger-500 border-[#F5C6C6]",
  };
</script>

<span
  class={cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px]",
    "border text-[11px] font-medium",
    tones[tone],
    className,
  )}
>
  {@render children?.()}
</span>
