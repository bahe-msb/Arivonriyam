<script lang="ts">
  import type { VoiceStage } from "$lib/types";

  interface Props {
    stage: VoiceStage;
    isRecording: boolean;
    loading: boolean;
    statusLabel: string;
    onToggle: () => void;
    onClear: () => void;
    onCancel: () => void;
  }

  const { stage, isRecording, loading, statusLabel, onToggle, onClear, onCancel }: Props = $props();
</script>

<div
  class="bg-surface-container-low border-outline-variant/15 rounded-xl border p-8 shadow-[0_4px_20px_rgba(28,28,24,0.04)]"
>
  <div class="flex flex-col items-center gap-6">
    <button
      onclick={onToggle}
      disabled={loading}
      aria-label={isRecording ? "Stop recording" : "Start recording"}
      class="flex h-28 w-28 items-center justify-center rounded-xl shadow-[0_8px_28px_rgba(28,28,24,0.08)] transition-all duration-300 active:scale-95 disabled:opacity-60 {isRecording
        ? 'bg-error'
        : 'bg-gradient-primary hover:shadow-[0_12px_36px_rgba(28,51,192,0.25)]'}"
    >
      <span
        class="material-symbols-outlined text-on-primary text-5xl"
        style="font-variation-settings:'FILL' 1;"
      >
        {isRecording ? "stop" : "mic"}
      </span>
    </button>

    <div class="text-center">
      <p
        class="font-label text-sm font-semibold {stage === 'listening'
          ? 'text-primary'
          : stage === 'error'
            ? 'text-error'
            : stage === 'done'
              ? 'text-secondary'
              : 'text-on-surface-variant'}"
      >
        {statusLabel}
      </p>
    </div>

    {#if stage !== "idle"}
      <div class="flex items-center gap-2">
        {#if loading}
          <button
            onclick={onCancel}
            class="border-error/30 text-error font-label hover:bg-error-container rounded-md border px-4 py-2 text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
        {:else}
          <button
            onclick={onClear}
            class="bg-surface-container-high text-on-surface-variant font-label hover:text-on-surface rounded-md px-4 py-2 text-xs font-semibold transition-colors"
          >
            Clear
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
