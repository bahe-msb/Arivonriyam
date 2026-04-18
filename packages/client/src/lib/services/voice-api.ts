import type { VoicePipelineResponse } from "$lib/types";

/** Uploads recorded audio to the backend voice endpoint. */
export async function uploadVoiceFile(
  audioBlob: Blob,
  signal?: AbortSignal,
): Promise<VoicePipelineResponse> {
  const payload = new FormData();
  payload.append(
    "audio",
    new File([audioBlob], "recording.webm", { type: audioBlob.type || "audio/webm" }),
  );

  const response = await fetch("/api/voice-file", {
    method: "POST",
    body: payload,
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as VoicePipelineResponse;
}
