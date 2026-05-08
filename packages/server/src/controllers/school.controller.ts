import type { Request, Response } from "express";
import { getPgPool } from "../lib/pgdb";

export async function getSchoolConfig(_req: Request, res: Response): Promise<void> {
  const pool = getPgPool();
  const result = await pool.query("SELECT * FROM school_config ORDER BY id DESC LIMIT 1");
  res.json(result.rows[0] ?? {});
}

export async function postSchoolConfig(req: Request, res: Response): Promise<void> {
  const { school_name = "", location = "", state = "", teacher_name = "", teacher_id = "" } =
    req.body as Record<string, string>;

  const pool = getPgPool();
  await pool.query("DELETE FROM school_config");
  const result = await pool.query(
    `INSERT INTO school_config (school_name, location, state, teacher_name, teacher_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
    [school_name, location, state, teacher_name, teacher_id],
  );
  res.json(result.rows[0]);
}

export async function getStudents(req: Request, res: Response): Promise<void> {
  const pool = getPgPool();
  const classId = req.query.class_id;

  const result =
    classId !== undefined
      ? await pool.query(
          "SELECT * FROM students WHERE class_id = $1 ORDER BY created_at",
          [classId],
        )
      : await pool.query("SELECT * FROM students ORDER BY class_id, created_at");

  res.json({ students: result.rows });
}

export async function postStudents(req: Request, res: Response): Promise<void> {
  const { class_id, students } = req.body as {
    class_id: number;
    students: Array<{ name: string; emoji?: string }>;
  };

  if (!class_id || !Array.isArray(students)) {
    res.status(400).json({ error: "class_id and students array required" });
    return;
  }

  const pool = getPgPool();
  await pool.query("DELETE FROM students WHERE class_id = $1", [class_id]);

  for (const student of students) {
    if (!student.name?.trim()) continue;
    await pool.query(
      "INSERT INTO students (class_id, name, emoji) VALUES ($1, $2, $3)",
      [class_id, student.name.trim(), student.emoji ?? "🧒"],
    );
  }

  const result = await pool.query(
    "SELECT * FROM students WHERE class_id = $1 ORDER BY created_at",
    [class_id],
  );
  res.json({ students: result.rows });
}
