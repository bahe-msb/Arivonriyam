import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../lib/errors";

/** Maps known errors to stable HTTP responses. */
export function handleKnownErrors(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Audio file is too large. Maximum size is 25 MB." });
    return;
  }

  if (error instanceof Error && error.message === "Only audio files are supported.") {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message, stage: error.stage });
    return;
  }

  next(error);
}

/** Fallback HTTP 500 error responder. */
export function handleUnexpectedErrors(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error("Unhandled server error", message);
  res.status(500).json({ error: "Internal server error", stage: "unknown" });
}
