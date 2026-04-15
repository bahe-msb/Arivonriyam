import { execFile } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WHISPER_ROOT = path.resolve(__dirname, "../../whisper.cpp");

const WHISPER_EXEC = path.join(WHISPER_ROOT, "build/bin/whisper-cli");
const WHISPER_MODEL = path.join(WHISPER_ROOT, "models/ggml-base.bin");

export async function TranscribeAudio(audioPath: string): Promise<string> {
  const { stdout } = await execFileAsync(WHISPER_EXEC, [
    "-m",
    WHISPER_MODEL,
    "-f",
    audioPath,
    "-l",
    "ta",
    "-tr",
    "oj",
  ]);
  console.log("Whisper output:", stdout.trim());
  return stdout.trim();
}
