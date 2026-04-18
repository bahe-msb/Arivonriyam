import type { Request, Response } from "express";
import { logError, logInfo } from "../lib/logging";
import { processVoiceFile } from "../services";
import { createRequestId } from "../utils";

/** Handles voice upload endpoint and returns transcription plus AI output. */
export async function postVoiceFile(req: Request, res: Response): Promise<void> {
  const requestId = createRequestId();

  if (!req.file) {
    res.status(400).json({ error: "Please upload an audio file using field name 'audio'." });
    return;
  }

  logInfo(requestId, "upload", "Audio file received", {
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });

  try {
    const result = await processVoiceFile(req.file, requestId);
    res.json({
      transcription: result.transcription,
      output: result.output,
      meta: {
        requestId,
        model: result.model,
        filename: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    logError(requestId, "pipeline", "/api/voice-file failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}
