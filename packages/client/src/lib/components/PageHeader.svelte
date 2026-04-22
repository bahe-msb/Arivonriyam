<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    eyebrow?: string;
    eyebrowTone?: "saffron" | "danger";
    title: string;
    subtitle?: string;
    actions?: Snippet;
  };
  let { eyebrow, eyebrowTone = "saffron", title, subtitle, actions }: Props = $props();

  const eyebrowColor = $derived(eyebrowTone === "danger" ? "text-danger-500" : "text-saffron-600");
</script>

<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
  <div>
    {#if eyebrow}
      <div class="label-eyebrow {eyebrowColor}">
        {eyebrow}
      </div>
    {/if}
    <div class="page-title mt-1">{title}</div>
    {#if subtitle}
      <div class="page-subtitle">{subtitle}</div>
    {/if}
  </div>
  {#if actions}
    <div class="flex flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
