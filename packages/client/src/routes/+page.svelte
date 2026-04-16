<script lang="ts">
  type VoiceFileResponse = {
    transcription: string;
    output: string;
    meta?: {
      model?: string;
      filename?: string;
      size?: number;
    };
  };

  let selectedFile = $state<File | null>(null);
  let transcription = $state("");
  let answer = $state("");
  let loading = $state(false);
  let stage = $state("Idle");
  let error = $state("");
  let currentController: AbortController | null = null;

  const ACCEPTED_AUDIO = [
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
    "audio/flac",
  ];

  function onFileChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    selectedFile = file;
    transcription = "";
    answer = "";
    error = "";
    stage = file ? "Ready" : "Idle";

    if (file && !ACCEPTED_AUDIO.includes(file.type)) {
      error = "Unsupported file type. Upload WAV, MP3, MP4/M4A, WebM, OGG, or FLAC audio.";
      selectedFile = null;
      stage = "Idle";
    }
  }

  function clearFile(): void {
    if (loading) return;
    selectedFile = null;
    transcription = "";
    answer = "";
    error = "";
    stage = "Idle";
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getErrorMessage(status: number, fallback: string): string {
    if (status === 400) return fallback || "Invalid request. Please upload a valid audio file.";
    if (status === 413) return "File is too large. Please upload a file under 25 MB.";
    if (status === 422) return fallback || "Speech could not be transcribed from this file.";
    if (status >= 500) return fallback || "Server failed while processing the audio.";
    return fallback || "Unexpected error while processing audio.";
  }

  function cancelRequest(): void {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
  }

  async function processAudioFile() {
    if (!selectedFile || loading) return;

    loading = true;
    stage = "Uploading";
    transcription = "";
    answer = "";
    error = "";
    currentController = new AbortController();

    try {
      const formData = new FormData();
      formData.append("audio", selectedFile);

      const res = await fetch("/api/voice-file", {
        method: "POST",
        body: formData,
        signal: currentController.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        error = getErrorMessage(res.status, body.error ?? "");
        stage = "Error";
        return;
      }

      stage = "Transcribing and generating";
      const data = (await res.json()) as VoiceFileResponse;
      transcription = data.transcription || "";
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
      loading = false;
      currentController = null;
    }
  }
</script>

<main class="bg-background text-foreground mx-auto min-h-screen max-w-2xl p-8">
  <h1 class="mb-2 text-2xl font-bold">Arivonriyam</h1>
  <p class="text-muted-foreground mb-8 text-sm">
    Upload an audio file. Backend will transcribe using whisper.cpp and send transcription to
    Ollama.
  </p>

  <div class="border-border bg-card mb-6 rounded-md border p-4">
    <label class="mb-2 block text-sm font-medium" for="audio-file">Audio File</label>
    <input
      id="audio-file"
      type="file"
      accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
      class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
      onchange={onFileChange}
      disabled={loading}
    />

    {#if selectedFile}
      <p class="text-muted-foreground mt-2 text-xs">
        {selectedFile.name} ({formatBytes(selectedFile.size)})
      </p>
    {/if}

    <p class="text-muted-foreground mt-2 text-xs">Max size: 25 MB</p>

    <div class="mt-4 flex gap-2">
      <button
        class="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        onclick={processAudioFile}
        disabled={loading || !selectedFile}
      >
        {loading ? "Processing..." : "Upload and Process"}
      </button>

      <button
        class="border-border rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        onclick={clearFile}
        disabled={loading}
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

  {#if answer}
    <div
      class="border-border bg-card text-card-foreground rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      <h2 class="mb-2 text-sm font-semibold">Ollama Response</h2>
      {answer}
    </div>
  {/if}
</main>
