import type { VoicePipelineResponse } from "$lib/types";

const encodeWav = (channelData: Float32Array, sampleRate: number): Blob => {
  const bytesPerSample = 2;
  const dataSize = channelData.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of channelData) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

const toWav = async (audioBlob: Blob): Promise<Blob> => {
  if (audioBlob.type === "audio/wav" || audioBlob.type === "audio/x-wav") {
    return audioBlob;
  }

  const context = new AudioContext();
  try {
    const audioBuffer = await context.decodeAudioData(await audioBlob.arrayBuffer());
    const wavBlob = encodeWav(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
    return wavBlob;
  } finally {
    await context.close();
  }
};

/** Uploads recorded audio to the backend voice endpoint. */
export async function uploadVoiceFile(
  audioBlob: Blob,
  signal?: AbortSignal,
): Promise<VoicePipelineResponse> {
  const wavBlob = await toWav(audioBlob);
  const payload = new FormData();
  payload.append("audio", new File([wavBlob], "recording.wav", { type: "audio/wav" }));

  const response = await fetch("/api/student/conservation", {
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
