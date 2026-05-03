import type { Request, Response } from "express";

import { AppError } from "../lib/errors";
import { logError, logInfo } from "../lib/logging";
import { getAllTodayPlans, getPlanForToday, savePlanForToday } from "../lib/plans-store";
import { buildBlueprint, listChapters, listSubjects } from "../services";
import { createRequestId } from "../utils";

const requireString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const handleError = (res: Response, error: unknown, fallback: string, stage: string): void => {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message, stage: error.stage });
    return;
  }
  res.status(500).json({ error: fallback, stage });
};

/** Returns subjects available for a class, derived from the PDF folder. */
export async function getLessonSubjects(req: Request, res: Response): Promise<void> {
  const className = requireString(req.query.class);
  if (!className) {
    res.status(400).json({ error: "class is required" });
    return;
  }

  try {
    const subjects = listSubjects(className);
    res.json({ subjects });
  } catch (error) {
    handleError(res, error, "Failed to list subjects.", "lesson");
  }
}

/** Returns chapters for a (class, subject) from the ingestion manifest. */
export async function getLessonChapters(req: Request, res: Response): Promise<void> {
  const className = requireString(req.query.class);
  const subject = requireString(req.query.subject);
  if (!className || !subject) {
    res.status(400).json({ error: "class and subject are required" });
    return;
  }

  try {
    const chapters = listChapters(className, subject);
    res.json({ chapters });
  } catch (error) {
    handleError(res, error, "Failed to list chapters.", "lesson");
  }
}

/** Generates a lesson blueprint for the given class/subject/chapter. */
export async function postLessonBlueprint(req: Request, res: Response): Promise<void> {
  const requestId = createRequestId();
  const className = requireString(req.body?.class);
  const subject = requireString(req.body?.subject);
  const chapter = requireString(req.body?.chapter);
  const durationMin = Number(req.body?.durationMin);

  if (!className || !subject || !chapter) {
    res.status(400).json({ error: "class, subject, and chapter are required" });
    return;
  }

  logInfo(requestId, "lesson", "Blueprint requested", {
    className,
    subject,
    chapter,
    durationMin,
  });

  try {
    const blueprint = await buildBlueprint({ className, subject, chapter, durationMin });
    res.json({ blueprint, meta: { requestId, class: className, subject, chapter, durationMin } });
  } catch (error) {
    logError(requestId, "lesson", "Blueprint generation failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    handleError(res, error, "Failed to generate blueprint.", "lesson");
  }
}

/** Returns all saved lesson plans for today. */
export async function getTodayPlans(_req: Request, res: Response): Promise<void> {
  try {
    const plans = await getAllTodayPlans();
    res.json({ plans });
  } catch (error) {
    handleError(res, error, "Failed to load today's plans.", "lesson");
  }
}

/** Saves a blueprint for a class. Returns a conflict flag if one already exists today. */
export async function postSavePlan(req: Request, res: Response): Promise<void> {
  const className = requireString(req.body?.class);
  const subject = requireString(req.body?.subject);
  const subjectLabel = requireString(req.body?.subjectLabel);
  const chapter = requireString(req.body?.chapter);
  const durationMin = Number(req.body?.durationMin);
  const blueprint = req.body?.blueprint;
  const overwrite = Boolean(req.body?.overwrite);

  if (!className || !subject || !chapter || !blueprint) {
    res.status(400).json({ error: "class, subject, chapter, and blueprint are required" });
    return;
  }

  try {
    const existing = await getPlanForToday(className);
    if (existing && !overwrite) {
      res.status(409).json({ conflict: true, existingChapter: existing.chapter });
      return;
    }

    await savePlanForToday(className, {
      className,
      subject,
      subjectLabel,
      chapter,
      durationMin,
      blueprint,
      savedAt: new Date().toISOString(),
    });

    res.json({ saved: true });
  } catch (error) {
    handleError(res, error, "Failed to save plan.", "lesson");
  }
}
