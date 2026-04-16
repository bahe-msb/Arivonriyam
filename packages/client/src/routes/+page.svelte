<script lang="ts">
  import { browser } from "$app/environment";
  import { onDestroy } from "svelte";

  type VoicePipelineResponse = {
    transcription: string;
    translatedText?: string;
    output: string;
    meta?: {
      model?: string;
      filename?: string;
      size?: number;
    };
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
  let promptEcho = $state("");
  let loading = $state(false);
  let stage = $state("Idle");
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
      for (let i = inputIndex; i < nextInputIndex && i < input.length; i += 1) {
        sum += input[i] ?? 0;
        count += 1;
      }

      output[outputIndex] = count > 0 ? sum / count : 0;
      outputIndex += 1;
      inputIndex = nextInputIndex;
    }

    return output;
  }

  function writeString(view: DataView, offset: number, value: string): void {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
    for (let i = 0; i < input.length; i += 1, offset += 2) {
      const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
  }

  function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const bytesPerSample = 2;
    const frameSize = bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * frameSize, true);
    view.setUint16(32, frameSize, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);
    floatTo16BitPCM(view, 44, samples);

    return new Blob([buffer], { type: "audio/wav" });
  }

  async function cleanupRecorder(): Promise<void> {
    if (processorNode) {
      processorNode.disconnect();
      processorNode.onaudioprocess = null;
      processorNode = null;
    }

    if (sinkGainNode) {
      sinkGainNode.disconnect();
      sinkGainNode = null;
    }

    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
  }

  function cancelRequest(): void {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
  }

  async function startRecording(): Promise<void> {
    if (!browser || isRecording || loading) return;

    try {
      error = "";
      transcription = "";
      translatedText = "";
      answer = "";
      promptEcho = "";
      stage = "Requesting microphone";

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioContext = new AudioContext();
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      sinkGainNode = audioContext.createGain();
      sinkGainNode.gain.value = 0;

      chunks = [];
      totalFrames = 0;

      processorNode.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const block = new Float32Array(input.length);
        block.set(input);
        chunks.push(block);
        totalFrames += block.length;
      };

      sourceNode.connect(processorNode);
      processorNode.connect(sinkGainNode);
      sinkGainNode.connect(audioContext.destination);

      isRecording = true;
      stage = "Listening";
    } catch (caughtError) {
      console.error(caughtError);
      error = "Microphone access failed. Please allow mic permission and try again.";
      stage = "Error";
      await cleanupRecorder();
      isRecording = false;
    }
  }

  async function stopAndProcessRecording(): Promise<void> {
    if (!isRecording || loading) return;

    loading = true;
    stage = "Finalizing audio";

    try {
      const rawPcm = mergeChunks(chunks, totalFrames);
      const sourceRate = audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;

      await cleanupRecorder();
      isRecording = false;
      chunks = [];
      totalFrames = 0;

      if (!rawPcm.length) {
        error = "No voice captured. Please speak and try again.";
        stage = "Error";
        return;
      }

      const pcm16k = downsampleTo16k(rawPcm, sourceRate);
      const wavBlob = encodeWav(pcm16k, TARGET_SAMPLE_RATE);

      stage = "Uploading audio";
      currentController = new AbortController();

      const formData = new FormData();
      formData.append("audio", new File([wavBlob], "mic-recording.wav", { type: "audio/wav" }));

      const res = await fetch("/api/voice-file", {
        method: "POST",
        body: formData,
        signal: currentController.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; stage?: string };
        error = body.error || `Request failed with status ${res.status}`;
        stage = "Error";
        return;
      }

      stage = "Transcribing and generating";
      const data = (await res.json()) as VoicePipelineResponse;
      transcription = data.transcription || "";
      translatedText = data.translatedText || "";
      promptEcho = data.translatedText || data.transcription || "";
      answer = data.output || "";
      stage = "Completed";
    } catch (caughtError) {
      if (caughtError instanceof DOMException && caughtError.name === "AbortError") {
        error = "Request cancelled.";
      } else {
        error = "Could not reach the backend. Ensure the server is running on port 9012.";
      }
      stage = "Error";
    } finally {
      await cleanupRecorder();
      isRecording = false;
      loading = false;
      currentController = null;
    }
  }

  function clearSession(): void {
    if (loading || isRecording) return;
    transcription = "";
    translatedText = "";
    answer = "";
    promptEcho = "";
    error = "";
    stage = "Idle";
  }

  onDestroy(() => {
    cancelRequest();
    void cleanupRecorder();
  });
</script>

<main class="bg-background text-foreground mx-auto min-h-screen max-w-2xl p-8">
  <h1 class="mb-2 text-2xl font-bold">Arivonriyam</h1>
  <p class="text-muted-foreground mb-8 text-sm">
    Click Start, speak in Tamil, click Stop. Audio is transcribed by whisper.cpp and sent to Ollama.
  </p>

  <div class="border-border bg-card mb-6 rounded-md border p-4">
    <div class="mt-4 flex gap-2">
      <button
        class="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        onclick={startRecording}
        disabled={loading || isRecording}
      >
        Start Mic
      </button>

      <button
        class="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        onclick={stopAndProcessRecording}
        disabled={loading || !isRecording}
      >
        {loading ? "Processing..." : "Stop and Process"}
      </button>

      <button
        class="border-border rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        onclick={clearSession}
        disabled={loading || isRecording}
      >
        Clear
      </button>

      <button
        class="border-destructive text-destructive rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        onclick={cancelRequest}
        disabled={!loading}
      >
        Cancel
      </button>
    </div>

    <p class="text-muted-foreground mt-2 text-xs">
      Input format: 16kHz mono WAV (captured in browser)
    </p>
    <p class="text-muted-foreground mt-3 text-xs">Status: {stage}</p>
  </div>

  {#if error}
    <p
      class="border-destructive bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm"
    >
      {error}
    </p>
  {/if}

  {#if transcription}
    <div
      class="border-border bg-card text-card-foreground mb-4 rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      <h2 class="mb-2 text-sm font-semibold">Transcription (whisper.cpp)</h2>
      {transcription}
    </div>
  {/if}

  {#if promptEcho}
    <div
      class="border-border bg-card text-card-foreground mb-4 rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      <h2 class="mb-2 text-sm font-semibold">English Translation Sent To Ollama</h2>
      {promptEcho}
    </div>
  {/if}

  {#if translatedText}
    <div
      class="border-border bg-card text-card-foreground mb-4 rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      <h2 class="mb-2 text-sm font-semibold">Tamil To English Translation</h2>
      {translatedText}
    </div>
  {/if}

  {#if answer}
    <div
      class="border-border bg-card text-card-foreground rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      <h2 class="mb-2 text-sm font-semibold">Ollama Response</h2>
      {answer}
    </div>
  {/if}
</main>
