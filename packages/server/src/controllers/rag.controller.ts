import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import { logError, logInfo } from "../lib/logging";
import { type SubjectName } from "../repositories";
import { askWithRag } from "../services";
import { createRequestId } from "../utils";

const allowedSubjects: ReadonlyArray<SubjectName> = ["tamil", "maths", "science"];

/** Handles textbook RAG tutoring requests for a specific grade and subject. */
export async function postRagAsk(req: Request, res: Response): Promise<void> {
  const requestId = createRequestId();
  const grade = typeof req.body?.grade === "string" ? req.body.grade.trim() : "";
  const subject =
    typeof req.body?.subject === "string" ? req.body.subject.trim().toLowerCase() : "";
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";

  if (!grade || !query || !allowedSubjects.includes(subject as SubjectName)) {
    res.status(400).json({ error: "grade, subject(tamil|maths|science), and query are required" });
    return;
  }

  logInfo(requestId, "rag", "RAG query received", { grade, subject, queryLength: query.length });

  try {
    const result = await askWithRag(grade, subject as SubjectName, query);
    res.json({
      output: result.output,
      context: result.usedContext,
      meta: { requestId, model: result.model, grade, subject },
    });
  } catch (error) {
    logError(requestId, "rag", "RAG request failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });

    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }

    res.status(500).json({ error: "RAG pipeline failed", stage: "rag" });
  }
}
