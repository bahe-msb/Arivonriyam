import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import { transcribeFromPath } from "../repositories";
import { askPrompt } from "../services";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Runs a simple text-to-LLM request for manual testing. */
export async function postTestAsk(req: Request, res: Response): Promise<void> {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt must be a non-empty string" });
    return;
  }

  try {
    const output = await askPrompt(prompt);
    res.json({ input: prompt, output });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }
    res.status(500).json({ error: "Failed to generate response from Ollama", stage: "unknown" });
  }
}

/** Runs transcription on bundled tamil sample for manual smoke checks. */
export async function getTestStt(_req: Request, res: Response): Promise<void> {
  const audioPath = path.resolve(__dirname, "../../whisper.cpp/samples/tamil.wav");

  try {
    const transcription = await transcribeFromPath(audioPath);
    res.json({ transcription });
  } catch {
    res.status(500).json({ error: "Failed to transcribe audio" });
  }
}
