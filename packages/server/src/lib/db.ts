/**
 * Shared SQLite database — packages/data/arivonriyam.db
 *
 * Python (ingestion) writes:  ingestion_log, manifest
 * Node.js (server)   writes:  plans
 * Node.js (server)   reads:   plans, manifest
 *
 * better-sqlite3 is synchronous; no async/await needed for DB calls.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// packages/server/src/lib/ → ../../../  =  packages/
const DB_DIR  = path.resolve(__dirname, "../../..", "data");
const DB_PATH = path.join(DB_DIR, "arivonriyam.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // plans table — owned by Node.js
  _db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date_key      TEXT    NOT NULL,
      class_name    TEXT    NOT NULL,
      subject       TEXT    NOT NULL,
      subject_label TEXT    NOT NULL DEFAULT '',
      chapter       TEXT    NOT NULL,
      duration_min  INTEGER NOT NULL DEFAULT 0,
      blueprint     TEXT    NOT NULL,
      saved_at      TEXT    NOT NULL,
      UNIQUE(date_key, class_name)
    );
    CREATE INDEX IF NOT EXISTS idx_plans_date ON plans(date_key);

    -- manifest table — written by Python ingestion, read here
    CREATE TABLE IF NOT EXISTS manifest (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name    TEXT NOT NULL,
      subject       TEXT NOT NULL,
      chapter       TEXT NOT NULL,
      chapter_order INTEGER DEFAULT 0,
      UNIQUE(class_name, subject, chapter)
    );
    CREATE INDEX IF NOT EXISTS idx_manifest_lookup ON manifest(class_name, subject);
  `);

  return _db;
}
