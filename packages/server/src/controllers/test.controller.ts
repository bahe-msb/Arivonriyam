import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import { type SubjectName } from "../repositories";
import { transcribeFromPath } from "../repositories";
import { askPrompt } from "../services";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedSubjects: ReadonlyArray<SubjectName> = ["english"];

/** Runs a simple text-to-LLM request for manual testing. */
export async function postTestAsk(req: Request, res: Response): Promise<void> {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const grade = typeof req.body?.grade === "string" ? req.body.grade.trim() : "1";
  const subject =
    typeof req.body?.subject === "string" ? req.body.subject.trim().toLowerCase() : "english";

  if (!prompt) {
    res.status(400).json({ error: "prompt must be a non-empty string" });
    return;
  }

  if (!allowedSubjects.includes(subject as SubjectName)) {
    res.status(400).json({ error: "subject must be english" });
    return;
  }

  try {
    const output = await askPrompt(prompt, grade, subject as SubjectName);
    res.json({ input: prompt, output, meta: { grade, subject } });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }
    res.status(500).json({ error: "Failed to generate response from Ollama", stage: "unknown" });
  }
}

/** Runs transcription on bundled English sample for manual smoke checks. */
export async function getTestStt(_req: Request, res: Response): Promise<void> {
  const audioPath = path.resolve(__dirname, "../../whisper.cpp/samples/jfk.wav");

  try {
    const transcription = await transcribeFromPath(audioPath);
    res.json({ transcription });
  } catch {
    res.status(500).json({ error: "Failed to transcribe audio" });
  }
}
