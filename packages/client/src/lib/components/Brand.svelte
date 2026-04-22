<script lang="ts">
  type Props = { compact?: boolean };
  let { compact = false }: Props = $props();
</script>

<div class="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
  <div
    class="from-saffron-500 to-saffron-700 font-tamil grid size-7 place-items-center rounded-lg
           bg-gradient-to-br text-sm font-bold
           text-white
           shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
  >
    அ
  </div>
  {#if !compact}
    <div class="flex items-baseline gap-1.5">
      <span class="font-tamil text-sm font-semibold">அறிவொன்றியம்</span>
      <span class="text-xs font-normal text-white/55">Arivonriyam</span>
    </div>
  {/if}
</div>
