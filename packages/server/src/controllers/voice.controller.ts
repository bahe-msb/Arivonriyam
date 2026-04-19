import type { Request, Response } from "express";
import { logError, logInfo } from "../lib/logging";
import { type SubjectName } from "../repositories";
import { processVoiceFile } from "../services";
import { createRequestId } from "../utils";

const allowedSubjects: ReadonlyArray<SubjectName> = ["english"];

/** Handles voice upload endpoint and returns transcription plus AI output. */
export async function postVoiceFile(req: Request, res: Response): Promise<void> {
  const requestId = createRequestId();
  const grade = typeof req.body?.grade === "string" ? req.body.grade.trim() : "1";
  const subject =
    typeof req.body?.subject === "string" ? req.body.subject.trim().toLowerCase() : "english";

  if (!req.file) {
    res.status(400).json({ error: "Please upload an audio file using field name 'audio'." });
    return;
  }

  if (!allowedSubjects.includes(subject as SubjectName)) {
    res.status(400).json({ error: "subject must be english" });
    return;
  }

  logInfo(requestId, "upload", "Audio file received", {
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });

  try {
    const result = await processVoiceFile(req.file, requestId, grade, subject as SubjectName);
    res.json({
      transcription: result.transcription,
      output: result.output,
      meta: {
        requestId,
        model: result.model,
        grade,
        subject,
        filename: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    logError(requestId, "pipeline", "/api/student/conservation failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}
