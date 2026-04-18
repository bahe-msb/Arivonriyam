export type VoiceStage = "idle" | "listening" | "processing" | "done" | "error";

export interface VoicePipelineResponse {
  transcription: string;
  translatedText?: string;
  output: string;
  meta?: {
    model?: string;
    filename?: string;
    size?: number;
  };
}
