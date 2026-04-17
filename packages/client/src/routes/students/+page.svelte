<script lang="ts">
  import { browser } from "$app/environment";
  import { onDestroy } from "svelte";

  type VoicePipelineResponse = {
    transcription: string;
    translatedText?: string;
    output: string;
    meta?: { model?: string; filename?: string; size?: number };
  };

  const TARGET_SAMPLE_RATE = 16000;

  let isRecording = $state(false);
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processorNode: ScriptProcessorNode | null = null;
  let sinkGainNode: GainNode | null = null;
  let chunks: Float32Array[] = [];
  let totalFrames = 0;

  let transcription = $state("");
  let translatedText = $state("");
  let answer = $state("");
  let loading = $state(false);
  let stage = $state<"idle" | "listening" | "processing" | "done" | "error">("idle");
  let error = $state("");
  let currentController: AbortController | null = null;

  function mergeChunks(inputChunks: Float32Array[], length: number): Float32Array {
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of inputChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
    if (sourceRate === TARGET_SAMPLE_RATE) return input;
    const ratio = sourceRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    let outputIndex = 0;
    let inputIndex = 0;
    while (outputIndex < outputLength) {
      const nextInputIndex = Math.round((outputIndex + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let i = inputIndex; i < nextInputIndex && i < input.length; i++) {
        sum += input[i] ?? 0;
        count++;
      }
      output[outputIndex] = count > 0 ? sum / count : 0;
      outputIndex++;
      inputIndex = nextInputIndex;
    }
    return output;
  }

  function writeString(view: DataView, offset: number, value: string) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }

  function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const bps = 2;
    const buf = new ArrayBuffer(44 + samples.length * bps);
    const v = new DataView(buf);
    writeString(v, 0, "RIFF");
    v.setUint32(4, 36 + samples.length * bps, true);
    writeString(v, 8, "WAVE");
    writeString(v, 12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * bps, true);
    v.setUint16(32, bps, true);
    v.setUint16(34, 16, true);
    writeString(v, 36, "data");
    v.setUint32(40, samples.length * bps, true);
    floatTo16BitPCM(v, 44, samples);
    return new Blob([buf], { type: "audio/wav" });
  }

  async function cleanupRecorder() {
    processorNode?.disconnect();
    if (processorNode) processorNode.onaudioprocess = null;
    processorNode = null;
    sinkGainNode?.disconnect();
    sinkGainNode = null;
    sourceNode?.disconnect();
    sourceNode = null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
  }

  async function startRecording() {
    if (!browser || isRecording || loading) return;
    error = "";
    transcription = "";
    translatedText = "";
    answer = "";
    stage = "listening";
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: TARGET_SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
      });
      audioContext = new AudioContext();
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      sinkGainNode = audioContext.createGain();
      sinkGainNode.gain.value = 0;
      chunks = [];
      totalFrames = 0;
      processorNode.onaudioprocess = (e) => {
        const block = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(block);
        totalFrames += block.length;
      };
      sourceNode.connect(processorNode);
      processorNode.connect(sinkGainNode);
      sinkGainNode.connect(audioContext.destination);
      isRecording = true;
    } catch {
      error = "Microphone access failed. Please allow mic permission and try again.";
      stage = "error";
      await cleanupRecorder();
      isRecording = false;
    }
  }

  async function stopAndProcess() {
    if (!isRecording || loading) return;
    loading = true;
    stage = "processing";
    try {
      const rawPcm = mergeChunks(chunks, totalFrames);
      const sourceRate = audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
      await cleanupRecorder();
      isRecording = false;
      chunks = [];
      totalFrames = 0;
      if (!rawPcm.length) {
        error = "No voice captured. Please speak and try again.";
        stage = "error";
        return;
      }
      const wav = encodeWav(downsampleTo16k(rawPcm, sourceRate), TARGET_SAMPLE_RATE);
      currentController = new AbortController();
      const fd = new FormData();
      fd.append("audio", new File([wav], "recording.wav", { type: "audio/wav" }));
      const res = await fetch("/api/voice-file", { method: "POST", body: fd, signal: currentController.signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        error = body.error ?? `Request failed (${res.status})`;
        stage = "error";
        return;
      }
      const data = (await res.json()) as VoicePipelineResponse;
      transcription = data.transcription ?? "";
      translatedText = data.translatedText ?? "";
      answer = data.output ?? "";
      stage = "done";
    } catch (e) {
      error = e instanceof DOMException && e.name === "AbortError"
        ? "Request cancelled."
        : "Could not reach the backend. Ensure the server is running on port 9012.";
      stage = "error";
    } finally {
      await cleanupRecorder();
      isRecording = false;
      loading = false;
      currentController = null;
    }
  }

  function clearSession() {
    if (loading || isRecording) return;
    transcription = "";
    translatedText = "";
    answer = "";
    error = "";
    stage = "idle";
  }

  onDestroy(() => {
    currentController?.abort();
    void cleanupRecorder();
  });

  const stageLabel: Record<typeof stage, string> = {
    idle: "Ready — tap the mic to begin",
    listening: "Listening…",
    processing: "Transcribing & generating answer…",
    done: "Done",
    error: "Something went wrong",
  };
</script>

<!-- ════════════════════════════════════════
     STUDENTS — Voice AI Tutor
════════════════════════════════════════ -->
<div class="h-full overflow-y-auto bg-surface-container-lowest pb-20 md:pb-0">
  <div class="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-8">

    <!-- Page Header -->
    <header>
      <div class="flex items-center gap-3 mb-1">
        <div class="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-on-primary text-base" style="font-variation-settings:'FILL' 1;">auto_awesome</span>
        </div>
        <h1 class="text-2xl font-headline font-bold text-on-surface tracking-tight">Ask Ari</h1>
      </div>
      <p class="text-on-surface-variant font-body text-sm leading-relaxed ml-11">
        Speak your question in Tamil. Ari will transcribe, translate, and answer it.
      </p>
    </header>

    <!-- ── Voice Interface Card ── -->
    <div class="bg-surface-container-low rounded-xl p-8 border border-outline-variant/15 shadow-[0_4px_20px_rgba(28,28,24,0.04)]">
      <!-- Mic Button -->
      <div class="flex flex-col items-center gap-6">
        <div class="relative">
          <!-- Pulse rings when recording -->
          {#if isRecording}
            <div class="absolute inset-0 rounded-xl border-2 border-primary/40 scale-[1.18] animate-ping"></div>
            <div class="absolute inset-0 rounded-xl border border-primary/20 scale-[1.35]"></div>
          {/if}

          <button
            onclick={isRecording ? stopAndProcess : startRecording}
            disabled={loading}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            class="relative w-28 h-28 rounded-xl flex items-center justify-center transition-all duration-300 shadow-[0_8px_28px_rgba(28,28,24,0.08)] active:scale-95 disabled:opacity-60
              {isRecording
                ? 'bg-error'
                : 'bg-gradient-primary hover:shadow-[0_12px_36px_rgba(28,51,192,0.25)] hover:-translate-y-0.5'}"
          >
            <span
              class="material-symbols-outlined text-on-primary text-5xl"
              style="font-variation-settings:'FILL' 1;"
            >
              {isRecording ? "stop" : "mic"}
            </span>
          </button>
        </div>

        <!-- Status -->
        <div class="text-center">
          <p class="font-label text-sm font-semibold
            {stage === 'listening' ? 'text-primary' : stage === 'error' ? 'text-error' : stage === 'done' ? 'text-secondary' : 'text-on-surface-variant'}">
            {stageLabel[stage]}
          </p>
          {#if loading}
            <div class="mt-2 flex items-center justify-center gap-1.5">
              {#each [0, 1, 2] as i}
                <div
                  class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                  style="animation-delay: {i * 150}ms"
                ></div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Action row -->
        {#if stage !== "idle"}
          <div class="flex items-center gap-2">
            {#if loading}
              <button
                onclick={() => currentController?.abort()}
                class="px-4 py-2 rounded-md border border-error/30 text-error font-label text-xs font-semibold hover:bg-error-container transition-colors"
              >
                Cancel
              </button>
            {:else}
              <button
                onclick={clearSession}
                class="px-4 py-2 rounded-md bg-surface-container-high text-on-surface-variant font-label text-xs font-semibold hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              >
                Clear
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- ── Error ── -->
    {#if error}
      <div class="flex items-start gap-3 px-4 py-3 bg-error-container rounded-lg border border-error/15">
        <span class="material-symbols-outlined text-error text-lg shrink-0 mt-0.5" style="font-variation-settings:'FILL' 1;">error</span>
        <p class="text-on-error-container font-body text-sm">{error}</p>
      </div>
    {/if}

    <!-- ── Response Cards ── -->
    {#if transcription || answer}
      <div class="flex flex-col gap-4">
        {#if transcription}
          <div class="bg-surface-container-low rounded-xl p-6 border border-outline-variant/15">
            <div class="flex items-center gap-2 mb-3">
              <span class="material-symbols-outlined text-on-surface-variant text-base">record_voice_over</span>
              <span class="font-label text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Transcription</span>
            </div>
            <p class="font-body text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{transcription}</p>
          </div>
        {/if}

        {#if translatedText}
          <div class="bg-surface-container-low rounded-xl p-6 border border-outline-variant/15">
            <div class="flex items-center gap-2 mb-3">
              <span class="material-symbols-outlined text-on-surface-variant text-base">translate</span>
              <span class="font-label text-xs font-semibold text-on-surface-variant uppercase tracking-wider">English Translation</span>
            </div>
            <p class="font-body text-sm text-on-surface-variant leading-relaxed">{translatedText}</p>
          </div>
        {/if}

        {#if answer}
          <div class="bg-primary/5 rounded-xl p-6 border border-primary/15">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-5 h-5 rounded bg-gradient-primary flex items-center justify-center">
                <span class="material-symbols-outlined text-on-primary text-xs" style="font-variation-settings:'FILL' 1;">auto_awesome</span>
              </div>
              <span class="font-label text-xs font-semibold text-primary uppercase tracking-wider">Ari's Answer</span>
            </div>
            <p class="font-body text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{answer}</p>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Idle hint -->
    {#if stage === "idle"}
      <div class="text-center py-4">
        <p class="font-body text-xs text-on-surface-variant/60 leading-relaxed">
          Speak clearly in Tamil — Ari understands your questions and answers in English.
        </p>
      </div>
    {/if}

  </div>
</div>
