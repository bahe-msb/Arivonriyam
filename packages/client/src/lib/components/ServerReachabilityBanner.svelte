<script lang="ts">
  import { reachability } from "@stores";

  const showBanner = $derived(!$reachability.online || !$reachability.serverReachable);
</script>

{#if showBanner}
  <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
    <p
      role="status"
      aria-live="polite"
      class="inline-flex items-center rounded-full border border-[#7b2222] bg-[#451515]/95 px-4 py-2 text-sm font-medium text-[#ffd7d7] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)] backdrop-blur-sm"
    >
      Server not reachable
    </p>
  </div>
{/if}