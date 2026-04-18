<script lang="ts">
  interface Props {
    transcription: string;
    translatedText: string;
    answer: string;
    error: string;
  }

  const { transcription, translatedText, answer, error }: Props = $props();
</script>

{#if error}
  <div
    class="bg-error-container border-error/15 flex items-start gap-3 rounded-lg border px-4 py-3"
  >
    <span
      class="material-symbols-outlined text-error mt-0.5 shrink-0 text-lg"
      style="font-variation-settings:'FILL' 1;">error</span
    >
    <p class="text-on-error-container font-body text-sm">{error}</p>
  </div>
{/if}

{#if transcription || answer}
  <div class="flex flex-col gap-4">
    {#if transcription}
      <div class="bg-surface-container-low border-outline-variant/15 rounded-xl border p-6">
        <p
          class="font-label text-on-surface-variant mb-2 text-xs font-semibold tracking-wider uppercase"
        >
          Transcription
        </p>
        <p class="font-body text-on-surface text-sm leading-relaxed whitespace-pre-wrap">
          {transcription}
        </p>
      </div>
    {/if}

    {#if translatedText}
      <div class="bg-surface-container-low border-outline-variant/15 rounded-xl border p-6">
        <p
          class="font-label text-on-surface-variant mb-2 text-xs font-semibold tracking-wider uppercase"
        >
          English Translation
        </p>
        <p class="font-body text-on-surface-variant text-sm leading-relaxed">{translatedText}</p>
      </div>
    {/if}

    {#if answer}
      <div class="bg-primary/5 border-primary/15 rounded-xl border p-6">
        <p class="font-label text-primary mb-2 text-xs font-semibold tracking-wider uppercase">
          Ari's Answer
        </p>
        <p class="font-body text-on-surface text-sm leading-relaxed whitespace-pre-wrap">
          {answer}
        </p>
      </div>
    {/if}
  </div>
{/if}
