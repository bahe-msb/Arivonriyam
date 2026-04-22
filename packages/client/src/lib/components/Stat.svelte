<script lang="ts">
  import { cn } from "@utils";

  type Props = {
    n: string | number;
    label: string;
    warn?: boolean;
    align?: "left" | "right";
  };
  let { n, label, warn = false, align = "right" }: Props = $props();
</script>

<div class={cn("min-w-[80px]", align === "right" ? "text-right" : "text-left")}>
  <div
    class={cn("text-[26px] font-semibold tracking-[-0.02em]", warn ? "text-warn-500" : "text-ink")}
  >
    {n}
  </div>
  <div class="text-text-secondary mt-0.5 text-[11px]">{label}</div>
</div>
