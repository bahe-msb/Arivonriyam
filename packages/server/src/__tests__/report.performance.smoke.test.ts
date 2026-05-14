import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const query = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.includes("group by class_id, class_name, subject")) {
      return {
        rows: [
          {
            class_id: 4,
            class_name: "Class 4",
            subject: "Mathematics",
            students_present: 2,
            reteach_sessions: 1,
            struggling_count: 1,
            avg_score: 72,
            completion_pct: 67,
          },
        ],
      };
    }

    if (normalized.includes("group by class_id, class_name order by class_id")) {
      return {
        rows: [
          {
            class_id: 4,
            class_name: "Class 4",
            student_names: ["Meena", "Ravi"],
            students_present: 2,
            reteach_sessions: 1,
            struggling_count: 1,
            avg_score: 72,
            completion_pct: 67,
          },
        ],
      };
    }

    if (normalized.startsWith("select count(distinct student_id)::int as total_students")) {
      return {
        rows: [
          {
            total_students: 2,
            total_reteach: 1,
            avg_score: 72,
          },
        ],
      };
    }

    throw new Error(`Unexpected query in report smoke test: ${normalized}`);
  });

  return { query };
});

vi.mock("../lib/pgdb", () => ({
  getPgPool: () => ({ query: store.query }),
}));

const { createApp } = await import("../app");

describe("report performance smoke", () => {
  beforeEach(() => {
    store.query.mockClear();
  });

  it("returns class rows with student names for the daily report", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/report/performance")
      .query({ period: "day", date: "2026-05-14" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      period: "day",
      date: "2026-05-14",
      totals: {
        total_students: 2,
        total_reteach: 1,
        avg_score: 72,
      },
    });
    expect(response.body.byClass).toHaveLength(1);
    expect(response.body.byClass[0]).toMatchObject({
      class_id: 4,
      class_name: "Class 4",
      students_present: 2,
      reteach_sessions: 1,
      avg_score: 72,
      completion_pct: 67,
    });
    expect(response.body.byClass[0].student_names).toEqual(["Meena", "Ravi"]);
  });
});
