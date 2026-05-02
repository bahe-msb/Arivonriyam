import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LessonBlueprint } from "../services/lesson.service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, "../../data/saved_plans.json");

export interface PlanEntry {
  className: string;
  subject: string;
  subjectLabel: string;
  chapter: string;
  durationMin: number;
  blueprint: LessonBlueprint;
  savedAt: string;
}

type DateKey = string;
type ClassKey = string;
type Store = Record<DateKey, Record<ClassKey, PlanEntry>>;

const todayKey = (): string => new Date().toISOString().slice(0, 10);

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function getPlanForToday(className: string): Promise<PlanEntry | null> {
  const store = await readStore();
  return store[todayKey()]?.[className] ?? null;
}

export async function savePlanForToday(className: string, entry: PlanEntry): Promise<void> {
  const store = await readStore();
  const today = todayKey();
  if (!store[today]) store[today] = {};
  store[today][className] = entry;
  await writeStore(store);
}

export async function getAllTodayPlans(): Promise<Record<ClassKey, PlanEntry>> {
  const store = await readStore();
  return store[todayKey()] ?? {};
}
