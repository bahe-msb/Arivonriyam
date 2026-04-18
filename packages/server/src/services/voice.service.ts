import { env } from "../config";
import { AppError } from "../lib/errors";
import { logInfo } from "../lib/logging";
import { type SubjectName, transcribeFromPath } from "../repositories";
import { askWithRag } from "./rag.service";
import { removeTempAudio, saveUploadedAudioToTemp } from "../utils";

export interface VoicePipelineResult {
  transcription: string;
  output: string;
  model: string;
}

/** Runs upload -> whisper -> llm pipeline for a voice file. */
export async function processVoiceFile(
  file: Express.Multer.File,
  requestId: string,
  grade: string,
  subject: SubjectName,
): Promise<VoicePipelineResult> {
  const tempAudioPath = await saveUploadedAudioToTemp(file);

  try {
    logInfo(requestId, "upload", "Temporary audio file created");
    const transcription = await transcribeFromPath(tempAudioPath);

    if (!transcription) {
      throw new AppError("Could not transcribe speech from this audio file.", 422, "stt");
    }

    logInfo(requestId, "stt", "Whisper transcription completed", {
      textLength: transcription.length,
      preview: transcription.slice(0, 140),
    });

    const ragResult = await askWithRag(grade, subject, transcription);
    return { transcription, output: ragResult.output, model: ragResult.model };
  } finally {
    await removeTempAudio(tempAudioPath);
  }
}

/** Sends a direct text prompt to LLM for testing routes. */
export async function askPrompt(
  prompt: string,
  grade: string,
  subject: SubjectName,
): Promise<string> {
  const result = await askWithRag(grade, subject, prompt);
  return result.output;
}
