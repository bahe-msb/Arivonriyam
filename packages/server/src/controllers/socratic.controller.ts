import type { Request, Response } from "express";
import { generateTamilResponse } from "../repositories";
import { AppError } from "../lib/errors";

export async function postSocraticSummarize(req: Request, res: Response): Promise<void> {
  const { topic, subject, source } = req.body as {
    topic?: string;
    subject?: string;
    source?: string;
  };

  if (!topic || !subject) {
    res.status(400).json({ error: "topic and subject are required" });
    return;
  }

  const sourceNote =
    source === "custom"
      ? "This is a special teacher-created activity."
      : "This is from the standard school curriculum.";

  const prompt = [
    `You are an AI teaching assistant in a primary school.`,
    `The class is revisiting the topic "${topic}" (subject: ${subject}).`,
    sourceNote,
    ``,
    `Write exactly 3 short sentences in English that:`,
    `1. Welcome students and tell them what topic they are revisiting today.`,
    `2. Explain in one simple sentence what this topic is about.`,
    `3. Encourage them to listen carefully because questions will follow.`,
    ``,
    `Each sentence on a new line. No numbering. No bullet points. Plain sentences only.`,
  ].join("\n");

  try {
    const raw = await generateTamilResponse(prompt);
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 4);
    res.json({ lines: lines.length > 0 ? lines : [] });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }
    res.status(500).json({ error: "Failed to generate summary", lines: [] });
  }
}
