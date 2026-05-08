import type { LessonBlueprint } from "../services/lesson.service";
import { getPgPool } from "./pgdb";

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

let _initialized = false;

async function ensureTable(): Promise<void> {
  if (_initialized) return;
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id            SERIAL PRIMARY KEY,
      date_key      TEXT    NOT NULL,
      class_name    TEXT    NOT NULL,
      subject       TEXT    NOT NULL,
      subject_label TEXT    NOT NULL DEFAULT '',
      chapter       TEXT    NOT NULL,
      duration_min  INTEGER NOT NULL DEFAULT 0,
      blueprint     JSONB   NOT NULL,
      saved_at      TEXT    NOT NULL,
      UNIQUE(date_key, class_name)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_plans_date ON plans(date_key)
  `);
  _initialized = true;
}

export async function getPlanForToday(className: string): Promise<PlanEntry | null> {
  await ensureTable();
  const pool = getPgPool();
  const { rows } = await pool.query(
    "SELECT * FROM plans WHERE date_key = $1 AND class_name = $2 LIMIT 1",
    [todayKey(), className],
  );
  if (rows.length === 0) return null;
  return rowToEntry(rows[0]);
}

export async function savePlanForToday(className: string, entry: PlanEntry): Promise<void> {
  await ensureTable();
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO plans (date_key, class_name, subject, subject_label, chapter, duration_min, blueprint, saved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(date_key, class_name) DO UPDATE SET
       subject       = EXCLUDED.subject,
       subject_label = EXCLUDED.subject_label,
       chapter       = EXCLUDED.chapter,
       duration_min  = EXCLUDED.duration_min,
       blueprint     = EXCLUDED.blueprint,
       saved_at      = EXCLUDED.saved_at`,
    [
      todayKey(),
      className,
      entry.subject,
      entry.subjectLabel,
      entry.chapter,
      entry.durationMin,
      JSON.stringify(entry.blueprint),
      entry.savedAt,
    ],
  );
}

export async function getAllTodayPlans(): Promise<Record<string, PlanEntry>> {
  await ensureTable();
  const pool = getPgPool();
  const { rows } = await pool.query("SELECT * FROM plans WHERE date_key = $1", [todayKey()]);

  const result: Record<string, PlanEntry> = {};
  for (const row of rows) {
    const entry = rowToEntry(row);
    result[entry.className] = entry;
  }
  return result;
}

function rowToEntry(row: Record<string, unknown>): PlanEntry {
  const blueprintRaw = row.blueprint;
  const blueprint =
    typeof blueprintRaw === "string"
      ? (JSON.parse(blueprintRaw) as LessonBlueprint)
      : (blueprintRaw as LessonBlueprint);

  return {
    className: String(row.class_name),
    subject: String(row.subject),
    subjectLabel: String(row.subject_label ?? ""),
    chapter: String(row.chapter),
    durationMin: Number(row.duration_min),
    blueprint,
    savedAt: String(row.saved_at),
  };
}
