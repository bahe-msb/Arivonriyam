import type { Request, Response } from "express";
import { getPgPool } from "../lib/pgdb";

export async function getReportPerformance(req: Request, res: Response): Promise<void> {
  const period = typeof req.query.period === "string" ? req.query.period : "day";
  const date =
    typeof req.query.date === "string"
      ? req.query.date
      : new Date().toISOString().split("T")[0];

  const pool = getPgPool();

  // Build date range from period
  let startExpr: string;
  if (period === "week") {
    startExpr = `date_trunc('week', $1::date)`;
  } else if (period === "month") {
    startExpr = `date_trunc('month', $1::date)`;
  } else {
    startExpr = `$1::date`;
  }

  const byClassSubject = await pool.query(
    `SELECT
       class_id,
       class_name,
       subject,
       COUNT(DISTINCT student_id)::int                                AS students_present,
       COUNT(DISTINCT session_id)::int                                AS reteach_sessions,
       COUNT(CASE WHEN score < 60 THEN 1 END)::int                    AS struggling_count,
       ROUND(AVG(score))::int                                         AS avg_score,
       ROUND(AVG(correct_count::float / NULLIF(total_questions,0) * 100))::int AS completion_pct
     FROM session_alerts
     WHERE session_date >= ${startExpr} AND session_date <= $1::date
     GROUP BY class_id, class_name, subject
     ORDER BY class_id, subject`,
    [date],
  );

  const byClass = await pool.query(
    `SELECT
       class_id,
       class_name,
       COUNT(DISTINCT student_id)::int                                AS students_present,
       COUNT(DISTINCT session_id)::int                                AS reteach_sessions,
       COUNT(CASE WHEN score < 60 THEN 1 END)::int                    AS struggling_count,
       ROUND(AVG(score))::int                                         AS avg_score,
       ROUND(AVG(correct_count::float / NULLIF(total_questions,0) * 100))::int AS completion_pct
     FROM session_alerts
     WHERE session_date >= ${startExpr} AND session_date <= $1::date
     GROUP BY class_id, class_name
     ORDER BY class_id`,
    [date],
  );

  const totals = await pool.query(
    `SELECT
       COUNT(DISTINCT student_id)::int  AS total_students,
       COUNT(DISTINCT session_id)::int  AS total_reteach,
       ROUND(AVG(score))::int           AS avg_score
     FROM session_alerts
     WHERE session_date >= ${startExpr} AND session_date <= $1::date`,
    [date],
  );

  res.json({
    period,
    date,
    byClassSubject: byClassSubject.rows,
    byClass: byClass.rows,
    totals: totals.rows[0] ?? { total_students: 0, total_reteach: 0, avg_score: 0 },
  });
}
