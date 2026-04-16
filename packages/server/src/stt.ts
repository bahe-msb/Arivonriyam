import { execFile } from "child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WHISPER_ROOT = path.resolve(__dirname, "../../whisper.cpp");

const WHISPER_EXEC = path.join(WHISPER_ROOT, "build/bin/whisper-cli");
const DEFAULT_MODEL_NAME = process.env.WHISPER_MODEL_SIZE || "base";

function getWhisperModelPath(modelName: string): string {
  if (modelName === "small") {
    return path.join(WHISPER_ROOT, "models/ggml-small.bin");
  }

  return path.join(WHISPER_ROOT, "models/ggml-base.bin");
}

export interface TranscribeOptions {
  sourceLanguage?: string;
  translateToEnglish?: boolean;
  modelName?: "base" | "small";
}

export async function transcribeAudio(
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<string> {
  const sourceLanguage = options.sourceLanguage ?? "ta";
  const translateToEnglish = options.translateToEnglish ?? true;
  const modelPath = getWhisperModelPath(
    options.modelName ?? (DEFAULT_MODEL_NAME as "base" | "small"),
  );

  // Fail fast with a clear message when whisper binaries or models are missing.
  await fs.access(WHISPER_EXEC);
  await fs.access(modelPath);

  const args = ["-m", modelPath, "-f", audioPath, "-l", sourceLanguage, "-nt"];

  if (translateToEnglish) {
    args.push("-tr");
  }

  const { stdout } = await execFileAsync(WHISPER_EXEC, args);
  return stdout.trim();
}

export async function TranscribeAudio(audioPath: string): Promise<string> {
  return transcribeAudio(audioPath);
}
