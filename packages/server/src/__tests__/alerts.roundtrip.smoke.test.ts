import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AlertRow = {
  id: string;
  session_id: string;
  class_id: number;
  class_name: string;
  student_id: string;
  student_name: string;
  student_emoji: string;
  topic: string;
  subject: string;
  total_questions: number;
  correct_count: number;
  incorrect_count: number;
  score: number;
  missed_questions: unknown[];
  session_date: string;
  created_at: string;
};

const store = vi.hoisted(() => {
  const rows: AlertRow[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("delete from session_alerts where session_id = $1")) {
      const sessionId = String(params[0] ?? "");
      for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
        if (rows[idx].session_id === sessionId) rows.splice(idx, 1);
      }
      return { rows: [] };
    }

    if (normalized.startsWith("insert into session_alerts")) {
      const record: AlertRow = {
        id: String(params[0]),
        session_id: String(params[1]),
        class_id: Number(params[2]),
        class_name: String(params[3]),
        student_id: String(params[4]),
        student_name: String(params[5]),
        student_emoji: String(params[6]),
        topic: String(params[7]),
        subject: String(params[8]),
        total_questions: Number(params[9]),
        correct_count: Number(params[10]),
        incorrect_count: Number(params[11]),
        score: Number(params[12]),
        missed_questions:
          typeof params[13] === "string" ? (JSON.parse(String(params[13])) as unknown[]) : [],
        session_date: String(params[14]),
        created_at: new Date().toISOString(),
      };

      const existingIndex = rows.findIndex((row) => row.id === record.id);
      if (existingIndex >= 0) rows[existingIndex] = record;
      else rows.push(record);
      return { rows: [] };
    }

    if (normalized.startsWith("select * from session_alerts where session_date = $1")) {
      const date = String(params[0] ?? "");
      const filtered = rows
        .filter((row) => row.session_date === date)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { rows: filtered };
    }

    throw new Error(`Unexpected query in smoke test: ${normalized}`);
  });

  return { rows, query };
});

vi.mock("../lib/pgdb", () => ({
  getPgPool: () => ({ query: store.query }),
}));

const { createApp } = await import("../app");

describe("alerts session smoke", () => {
  beforeEach(() => {
    store.rows.length = 0;
    store.query.mockClear();
  });

  it("writes an alerts session and reads the same record back", async () => {
    const payload = {
      sessionId: "session-smoke-1",
      records: [
        {
          id: "alert-1",
          sessionId: "session-smoke-1",
          classId: 4,
          className: "Class 4",
          studentId: "stu-1",
          studentName: "Ravi",
          studentEmoji: "🧒",
          topic: "Fractions",
          subject: "Mathematics",
          totalQuestions: 6,
          correctCount: 3,
          incorrectCount: 3,
          score: 50,
          missedQuestions: [
            {
              question: "What is 1/2 + 1/2?",
              selectedOption: "1/2",
              correctOption: "1",
              explain: "Two halves make one whole.",
            },
          ],
        },
      ],
    };

    const app = createApp();
    const postResponse = await request(app).post("/api/alerts/session").send(payload);

    expect(postResponse.status).toBe(200);
    expect(postResponse.body).toEqual({ ok: true, count: 1 });

    const today = new Date().toISOString().split("T")[0];
    const getResponse = await request(app).get("/api/alerts").query({ date: today });

    expect(getResponse.status).toBe(200);
    expect(Array.isArray(getResponse.body.alerts)).toBe(true);
    expect(getResponse.body.alerts).toHaveLength(1);
    expect(getResponse.body.alerts[0]).toMatchObject({
      id: "alert-1",
      session_id: "session-smoke-1",
      class_name: "Class 4",
      student_name: "Ravi",
      topic: "Fractions",
      subject: "Mathematics",
      score: 50,
    });
    expect(Array.isArray(getResponse.body.alerts[0].missed_questions)).toBe(true);
    expect(getResponse.body.alerts[0].missed_questions).toHaveLength(1);
  });
});
