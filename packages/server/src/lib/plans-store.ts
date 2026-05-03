import type { LessonBlueprint } from "../services/lesson.service";
import { getDb } from "./db";

export interface PlanEntry {
  className: string;
  subject: string;
  subjectLabel: string;
  chapter: string;
  durationMin: number;
  blueprint: LessonBlueprint;
  savedAt: string;
}

const todayKey = (): string => new Date().toISOString().slice(0, 10);

export function getPlanForToday(className: string): PlanEntry | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM plans WHERE date_key = ? AND class_name = ? LIMIT 1",
    )
    .get(todayKey(), className) as Record<string, unknown> | undefined;

  if (!row) return null;
  return rowToEntry(row);
}

export function savePlanForToday(className: string, entry: PlanEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO plans (date_key, class_name, subject, subject_label, chapter, duration_min, blueprint, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date_key, class_name) DO UPDATE SET
       subject       = excluded.subject,
       subject_label = excluded.subject_label,
       chapter       = excluded.chapter,
       duration_min  = excluded.duration_min,
       blueprint     = excluded.blueprint,
       saved_at      = excluded.saved_at`,
  ).run(
    todayKey(),
    className,
    entry.subject,
    entry.subjectLabel,
    entry.chapter,
    entry.durationMin,
    JSON.stringify(entry.blueprint),
    entry.savedAt,
  );
}

export function getAllTodayPlans(): Record<string, PlanEntry> {
  const rows = getDb()
    .prepare("SELECT * FROM plans WHERE date_key = ?")
    .all(todayKey()) as Record<string, unknown>[];

  const result: Record<string, PlanEntry> = {};
  for (const row of rows) {
    const entry = rowToEntry(row);
    result[entry.className] = entry;
  }
  return result;
}

function rowToEntry(row: Record<string, unknown>): PlanEntry {
  return {
    className:    String(row.class_name),
    subject:      String(row.subject),
    subjectLabel: String(row.subject_label ?? ""),
    chapter:      String(row.chapter),
    durationMin:  Number(row.duration_min),
    blueprint:    JSON.parse(String(row.blueprint)) as LessonBlueprint,
    savedAt:      String(row.saved_at),
  };
}
