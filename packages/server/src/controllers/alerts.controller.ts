import type { Request, Response } from "express";
import { getPgPool } from "../lib/pgdb";

export async function getAlerts(req: Request, res: Response): Promise<void> {
  const date =
    typeof req.query.date === "string"
      ? req.query.date
      : new Date().toISOString().split("T")[0];

  const pool = getPgPool();
  const result = await pool.query(
    "SELECT * FROM session_alerts WHERE session_date = $1 ORDER BY created_at DESC",
    [date],
  );
  res.json({ alerts: result.rows, date });
}

export async function postAlertsSession(req: Request, res: Response): Promise<void> {
  const { sessionId, records } = req.body as {
    sessionId: string;
    records: Array<{
      id: string;
      sessionId: string;
      classId: number;
      className: string;
      studentId: string;
      studentName: string;
      studentEmoji: string;
      topic: string;
      subject: string;
      totalQuestions: number;
      correctCount: number;
      incorrectCount: number;
      score: number;
      missedQuestions: unknown[];
    }>;
  };

  if (!sessionId || !Array.isArray(records)) {
    res.status(400).json({ error: "sessionId and records array required" });
    return;
  }

  const pool = getPgPool();
  const today = new Date().toISOString().split("T")[0];

  await pool.query("DELETE FROM session_alerts WHERE session_id = $1", [sessionId]);

  for (const r of records) {
    await pool.query(
      `INSERT INTO session_alerts
         (id, session_id, class_id, class_name, student_id, student_name, student_emoji,
          topic, subject, total_questions, correct_count, incorrect_count, score,
          missed_questions, session_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         session_id      = EXCLUDED.session_id,
         correct_count   = EXCLUDED.correct_count,
         incorrect_count = EXCLUDED.incorrect_count,
         score           = EXCLUDED.score,
         missed_questions = EXCLUDED.missed_questions`,
      [
        r.id, r.sessionId, r.classId, r.className,
        r.studentId, r.studentName, r.studentEmoji,
        r.topic, r.subject, r.totalQuestions,
        r.correctCount, r.incorrectCount, r.score,
        JSON.stringify(r.missedQuestions ?? []), today,
      ],
    );
  }

  res.json({ ok: true, count: records.length });
}
