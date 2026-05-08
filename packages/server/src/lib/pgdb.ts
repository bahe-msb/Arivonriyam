import pg from "pg";

const dsn = process.env.PG_DSN ?? "postgresql://localhost/arivonriyam_rag";

let _pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: dsn });
  }
  return _pool;
}

export async function initPgDb(): Promise<void> {
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_config (
      id          SERIAL PRIMARY KEY,
      school_name TEXT NOT NULL DEFAULT '',
      location    TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT '',
      teacher_name TEXT NOT NULL DEFAULT '',
      teacher_id  TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      class_id   INTEGER NOT NULL,
      name       TEXT NOT NULL,
      emoji      TEXT NOT NULL DEFAULT '🧒',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);

    CREATE TABLE IF NOT EXISTS session_alerts (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL,
      class_id         INTEGER NOT NULL,
      class_name       TEXT NOT NULL,
      student_id       TEXT NOT NULL,
      student_name     TEXT NOT NULL,
      student_emoji    TEXT NOT NULL,
      topic            TEXT NOT NULL,
      subject          TEXT NOT NULL,
      total_questions  INTEGER NOT NULL,
      correct_count    INTEGER NOT NULL,
      incorrect_count  INTEGER NOT NULL,
      score            INTEGER NOT NULL,
      missed_questions JSONB NOT NULL DEFAULT '[]',
      session_date     DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_session_alerts_date       ON session_alerts(session_date);
    CREATE INDEX IF NOT EXISTS idx_session_alerts_class_date ON session_alerts(class_id, session_date);
  `);
}
