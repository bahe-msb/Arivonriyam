<script lang="ts">
  import { Card } from "@shadcn";
  type Props = {
    n: string | number;
    label: string;
    detail?: string;
    accent?: boolean;
  };
  let { n, label, detail, accent = false }: Props = $props();
</script>

<Card class="p-5">
  <div
    class="text-[30px] font-semibold tracking-[-0.02em] {accent ? 'text-saffron-700' : 'text-ink'}"
  >
    {n}
  </div>
  <div class="mt-1 text-[13px] font-medium">{label}</div>
  {#if detail}
    <div class="text-text-secondary mt-0.5 text-[11px]">{detail}</div>
  {/if}
</Card>
