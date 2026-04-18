import { TranscribeAudio } from "../stt";

/** Runs whisper transcription for a local audio file path. */
export async function transcribeFromPath(audioPath: string): Promise<string> {
  return TranscribeAudio(audioPath);
}
