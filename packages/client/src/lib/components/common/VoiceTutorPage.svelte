<script lang="ts">
  import { onDestroy } from "svelte";
  import { uploadVoiceFile } from "$lib/services";
  import type { VoiceStage } from "$lib/types";
  import VoiceRecorderPanel from "$lib/components/common/VoiceRecorderPanel.svelte";
  import VoiceResultPanel from "$lib/components/common/VoiceResultPanel.svelte";

  interface SpeechRecognitionResultLike {
    isFinal: boolean;
    0: { transcript: string };
  }

  interface SpeechRecognitionEventLike {
    resultIndex: number;
    results: SpeechRecognitionResultLike[];
  }

  interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: (() => void) | null;
    start: () => void;
    stop: () => void;
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognitionLike;
  }

  let isRecording = $state(false);
  let loading = $state(false);
  let stage = $state<VoiceStage>("idle");
  let error = $state("");
  let transcription = $state("");
  let translatedText = $state("");
  let answer = $state("");
  let liveSpeech = $state("");
  let finalSpeech = $state("");

  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let currentController: AbortController | null = null;
  let speechRecognition: SpeechRecognitionLike | null = null;

  const stageLabel: Record<VoiceStage, string> = {
    idle: "Ready - tap the mic to begin",
    listening: "Listening...",
    processing: "Transcribing and generating answer...",
    done: "Done",
    error: "Something went wrong",
  };

  const resetOutput = (): void => {
    transcription = "";
    translatedText = "";
    answer = "";
    error = "";
    liveSpeech = "";
    finalSpeech = "";
  };

  const setupLiveSpeech = (): void => {
    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      return;
    }

    speechRecognition = new SpeechRecognitionCtor();
    speechRecognition.lang = "en-IN";
    speechRecognition.interimResults = true;
    speechRecognition.continuous = true;

    speechRecognition.onresult = (event) => {
      let interim = "";
      let finalPart = "";

      for (let idx = event.resultIndex; idx < event.results.length; idx += 1) {
        const result = event.results[idx];
        const text = result[0]?.transcript || "";
        if (result.isFinal) {
          finalPart += `${text} `;
        } else {
          interim += `${text} `;
        }
      }

      if (finalPart.trim()) {
        finalSpeech = `${finalSpeech} ${finalPart}`.trim();
      }

      liveSpeech = `${finalSpeech} ${interim}`.trim();
    };

    speechRecognition.onerror = () => {
      speechRecognition = null;
    };

    speechRecognition.start();
  };

  const stopTracks = (): void => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    mediaRecorder = null;
  };

  async function toggleRecording(): Promise<void> {
    if (loading) return;
    if (isRecording) {
      await stopAndSend();
      return;
    }

    resetOutput();
    stage = "listening";
    chunks = [];

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
    mediaRecorder.start();
    setupLiveSpeech();
    isRecording = true;
  }

  async function stopAndSend(): Promise<void> {
    if (!mediaRecorder || !isRecording) return;

    loading = true;
    stage = "processing";

    const audioBlob = await new Promise<Blob>((resolve) => {
      mediaRecorder!.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
      mediaRecorder!.stop();
    });

    speechRecognition?.stop();
    speechRecognition = null;

    isRecording = false;
    stopTracks();

    try {
      currentController = new AbortController();
      const data = await uploadVoiceFile(audioBlob, currentController.signal);
      transcription = data.transcription || "";
      translatedText = data.translatedText || "";
      answer = data.output || "";
      stage = "done";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not reach backend service.";
      stage = "error";
    } finally {
      loading = false;
      currentController = null;
      chunks = [];
    }
  }

  function clearSession(): void {
    if (loading || isRecording) return;
    resetOutput();
    stage = "idle";
  }

  onDestroy(() => {
    currentController?.abort();
    speechRecognition?.stop();
    stopTracks();
  });
</script>

<div class="bg-surface-container-lowest h-full overflow-y-auto pb-20 md:pb-0">
  <div class="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
    <header>
      <h1 class="font-headline text-on-surface mb-1 text-2xl font-bold tracking-tight">Ask Ari</h1>
      <p class="text-on-surface-variant font-body text-sm">
        Speak your question in Tamil. Ari responds in seconds.
      </p>
    </header>

    <VoiceRecorderPanel
      {stage}
      {isRecording}
      {loading}
      statusLabel={stageLabel[stage]}
      onToggle={toggleRecording}
      onClear={clearSession}
      onCancel={() => currentController?.abort()}
    />

    {#if isRecording || liveSpeech}
      <section class="bg-surface-container-low border-outline-variant/15 rounded-xl border p-4">
        <p class="text-on-surface-variant text-xs font-semibold uppercase tracking-wide">
          Live Speech
        </p>
        <p class="text-on-surface mt-2 text-sm leading-relaxed">
          {liveSpeech || "Listening to your speech..."}
        </p>
      </section>
    {/if}

    <VoiceResultPanel {transcription} {translatedText} {answer} {error} />
  </div>
</div>
