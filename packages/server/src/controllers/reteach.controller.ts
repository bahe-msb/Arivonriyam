import type { Request, Response } from "express";
import { getPgPool } from "../lib/pgdb";

type ReteachTopic = {
  id: string;
  subject: string;
  topic: string;
  source: "standard" | "custom";
};

type ReteachState = {
  topicsByClass: Record<string, ReteachTopic[]>;
  selectedTopicIdsByClass: Record<string, string>;
  completedTopicIds: string[];
};

const EMPTY_RETEACH_STATE: ReteachState = {
  topicsByClass: {},
  selectedTopicIdsByClass: {},
  completedTopicIds: [],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(value: unknown, fallback: string): string {
  if (typeof value === "string" && DATE_RE.test(value)) return value;
  return fallback;
}

function isReteachTopic(value: unknown): value is ReteachTopic {
  if (!value || typeof value !== "object") return false;

  const topic = value as Partial<ReteachTopic>;
  return (
    typeof topic.id === "string" &&
    typeof topic.subject === "string" &&
    typeof topic.topic === "string" &&
    (topic.source === "standard" || topic.source === "custom")
  );
}

function normalizeTopicsByClass(value: unknown): Record<string, ReteachTopic[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, ReteachTopic[]> = {};
  for (const [classId, topics] of Object.entries(value)) {
    if (!Array.isArray(topics)) continue;
    normalized[classId] = topics.filter(isReteachTopic);
  }

  return normalized;
}

function normalizeSelectedTopicIdsByClass(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [classId, topicId] of Object.entries(value)) {
    if (typeof topicId !== "string" || topicId.trim().length === 0) continue;
    normalized[classId] = topicId;
  }

  return normalized;
}

function normalizeCompletedTopicIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (topicId): topicId is string => typeof topicId === "string" && topicId.trim().length > 0,
  );
}

function normalizeReteachState(value: unknown): ReteachState {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_RETEACH_STATE };
  }

  const state = value as Partial<ReteachState>;
  return {
    topicsByClass: normalizeTopicsByClass(state.topicsByClass),
    selectedTopicIdsByClass: normalizeSelectedTopicIdsByClass(state.selectedTopicIdsByClass),
    completedTopicIds: normalizeCompletedTopicIds(state.completedTopicIds),
  };
}

export async function getReteachState(req: Request, res: Response): Promise<void> {
  const date = parseDate(req.query.date, todayKey());
  const pool = getPgPool();
  const result = await pool.query<{
    topics_by_class: unknown;
    selected_topic_ids_by_class: unknown;
    completed_topic_ids: unknown;
  }>(
    `SELECT topics_by_class, selected_topic_ids_by_class, completed_topic_ids
       FROM reteach_state_daily
      WHERE session_date = $1::date`,
    [date],
  );

  const row = result.rows[0];
  if (!row) {
    res.json({ date, readOnly: date !== todayKey(), ...EMPTY_RETEACH_STATE });
    return;
  }

  res.json({
    date,
    readOnly: date !== todayKey(),
    ...normalizeReteachState({
      topicsByClass: row.topics_by_class,
      selectedTopicIdsByClass: row.selected_topic_ids_by_class,
      completedTopicIds: row.completed_topic_ids,
    }),
  });
}

export async function postReteachState(req: Request, res: Response): Promise<void> {
  const today = todayKey();
  const date = parseDate(req.body?.date, today);
  if (date !== today) {
    res.status(409).json({ ok: false, error: "Past-day reteach state is read-only." });
    return;
  }

  const next = normalizeReteachState(req.body);
  const pool = getPgPool();

  await pool.query(
    `INSERT INTO reteach_state_daily (
       session_date,
       topics_by_class,
       selected_topic_ids_by_class,
       completed_topic_ids,
       updated_at
     )
     VALUES ($1::date, $2::jsonb, $3::jsonb, $4::jsonb, NOW())
     ON CONFLICT (session_date) DO UPDATE SET
       topics_by_class = EXCLUDED.topics_by_class,
       selected_topic_ids_by_class = EXCLUDED.selected_topic_ids_by_class,
       completed_topic_ids = EXCLUDED.completed_topic_ids,
       updated_at = NOW()`,
    [
      today,
      JSON.stringify(next.topicsByClass),
      JSON.stringify(next.selectedTopicIdsByClass),
      JSON.stringify(next.completedTopicIds),
    ],
  );

  res.json({ ok: true, date: today, readOnly: false, state: next });
}
