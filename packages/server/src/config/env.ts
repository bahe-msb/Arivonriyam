import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Supported speech-to-text languages. "auto" lets whisper detect per utterance,
// which is the right default for a Tamil + English + Telugu classroom app.
export const SUPPORTED_WHISPER_LANGUAGES = ["auto", "ta", "en", "te"] as const;
export type WhisperLanguage = (typeof SUPPORTED_WHISPER_LANGUAGES)[number];

const normalizeWhisperLanguage = (raw: string | undefined): WhisperLanguage => {
  const value = (raw ?? "").trim().toLowerCase();
  return (SUPPORTED_WHISPER_LANGUAGES as readonly string[]).includes(value)
    ? (value as WhisperLanguage)
    : "auto";
};

export const env = {
  port: toNumber(process.env.PORT, 9012),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "gemma4:latest",
  whisperModelSize: process.env.WHISPER_MODEL_SIZE || "large-v2",
  whisperLanguage: normalizeWhisperLanguage(process.env.WHISPER_LANGUAGE),
  ragCollection: process.env.RAG_COLLECTION || "arivonriyam_textbooks_v1",
  ragEmbeddingModel: process.env.RAG_EMBEDDING_MODEL || "BAAI/bge-small-en-v1.5",
} as const;
