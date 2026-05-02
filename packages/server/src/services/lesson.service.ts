import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "../lib/errors";
import { generateLlmJson, retrieveTextbookChunks, type RetrieverChunk } from "../repositories";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Server reads from the ingestion package's data dir so the UI stays
// in sync with whatever main.py last ingested. Resolved at module
// load so the path is stable regardless of CWD.
const INGESTION_DATA_DIR = path.resolve(__dirname, "../../../ingestion/data");
const PDFS_DIR = path.join(INGESTION_DATA_DIR, "pdfs");
const MANIFEST_PATH = path.join(INGESTION_DATA_DIR, "manifest.json");

export interface SubjectOption {
  id: string;
  label: string;
}

export interface BlueprintBlock {
  phase: string;
  title: string;
  durationMin: number;
  body: string;
}

export interface LessonBlueprint {
  title: string;
  blocks: BlueprintBlock[];
}

interface Manifest {
  [className: string]: { [subject: string]: string[] };
}

const titleCase = (slug: string): string =>
  slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ")
    .trim();

const isSafeClassName = (value: string): boolean => /^[a-z0-9_-]+$/i.test(value);

/** List subjects available for a class by reading the PDF folder. */
export async function listSubjects(className: string): Promise<SubjectOption[]> {
  if (!isSafeClassName(className)) {
    throw new AppError("Invalid class name.", 400, "lesson");
  }

  const classDir = path.join(PDFS_DIR, className);
  let entries: string[];
  try {
    entries = await fs.readdir(classDir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => {
      const id = path.basename(name, path.extname(name));
      return { id, label: titleCase(id) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return {};
  }
}

/** Distinct chapter titles for a (class, subject) from the manifest. */
export async function listChapters(className: string, subject: string): Promise<string[]> {
  if (!isSafeClassName(className) || !isSafeClassName(subject)) {
    throw new AppError("Invalid class or subject.", 400, "lesson");
  }

  const manifest = await readManifest();
  return manifest[className]?.[subject] ?? [];
}

const buildBlueprintPrompt = (
  className: string,
  subject: string,
  chapter: string,
  durationMin: number,
  chunks: RetrieverChunk[],
): string => {
  const excerpts = chunks
    .map((c, i) => `[Excerpt ${i + 1}${c.chapter ? ` – ${c.chapter}` : ""}]\n${c.text.trim()}`)
    .join("\n\n");

  return [
    "You are a lesson plan formatter. Your only job is to structure the textbook",
    "excerpts below into 6 teaching phases. You have no knowledge of your own.",
    "",
    "STRICT RULES — violating any rule makes the output useless:",
    "1. Every sentence in every body field MUST come from the excerpts below.",
    "2. Do NOT add any fact, example, word, or context not present in the excerpts.",
    "3. Do NOT use your own training knowledge. Ignore everything you know about the topic.",
    "4. If an excerpt is too thin to fill a phase, quote it directly and keep the body short.",
    "5. Questions in the 'check' phase must only ask about content stated in the excerpts.",
    "",
    `Class: ${titleCase(className)}`,
    `Subject: ${titleCase(subject)}`,
    `Chapter: ${chapter}`,
    `Total duration: ${durationMin} minutes`,
    "",
    "TEXTBOOK EXCERPTS (your only allowed source):",
    "==============================================",
    excerpts,
    "==============================================",
    "",
    "Produce exactly these 6 blocks in order.",
    "The sum of durationMin values must equal the total duration exactly.",
    "",
    '1. phase "objective" — durationMin: 0    — one sentence stating what students will learn, derived from the excerpts.',
    '2. phase "warm_up"   — 5–8 min           — a recall question about something mentioned in the excerpts.',
    '3. phase "teach"     — 8–12 min          — explain the core content using only words and ideas from the excerpts.',
    '4. phase "practice"  — 8–12 min          — a task or exercise directly about the excerpt content.',
    '5. phase "check"     — 3–5 min           — 2–3 oral questions whose answers are found in the excerpts.',
    '6. phase "wrap_up"   — 2–4 min           — a one-sentence summary of what the excerpts teach.',
    "",
    "Each body: 2–4 short sentences a teacher can read at a glance.",
    "",
    "Return ONLY this JSON (no prose, no markdown fences):",
    "{",
    '  "title": "<chapter title from excerpts>",',
    '  "blocks": [',
    '    { "phase": "objective", "title": "...", "durationMin": 0,    "body": "..." },',
    '    { "phase": "warm_up",   "title": "...", "durationMin": <int>, "body": "..." },',
    '    { "phase": "teach",     "title": "...", "durationMin": <int>, "body": "..." },',
    '    { "phase": "practice",  "title": "...", "durationMin": <int>, "body": "..." },',
    '    { "phase": "check",     "title": "...", "durationMin": <int>, "body": "..." },',
    '    { "phase": "wrap_up",   "title": "...", "durationMin": <int>, "body": "..." }',
    "  ]",
    "}",
  ].join("\n");
};

/** Generate a lesson blueprint for the given class/subject/chapter. */
export async function buildBlueprint(input: {
  className: string;
  subject: string;
  chapter: string;
  durationMin: number;
}): Promise<LessonBlueprint> {
  const { className, subject, chapter, durationMin } = input;

  if (!chapter.trim()) {
    throw new AppError("Chapter is required.", 400, "lesson");
  }
  if (!Number.isFinite(durationMin) || durationMin < 10 || durationMin > 120) {
    throw new AppError("Duration must be between 10 and 120 minutes.", 400, "lesson");
  }

  const chunks = await retrieveTextbookChunks(className, subject, chapter, 8);
  if (chunks.length === 0) {
    throw new AppError(
      "No textbook content found for this chapter in the vector store. " +
        "Run the ingestion pipeline first, then try again.",
      422,
      "lesson",
    );
  }

  const prompt = buildBlueprintPrompt(className, subject, chapter, durationMin, chunks);
  const result = await generateLlmJson<LessonBlueprint>(prompt);

  if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) {
    throw new AppError("Model returned an empty blueprint.", 502, "lesson");
  }

  return {
    title: typeof result.title === "string" && result.title.trim() ? result.title : chapter,
    blocks: result.blocks
      .filter((block) => block && typeof block.body === "string")
      .map((block) => ({
        phase: typeof block.phase === "string" ? block.phase : "teach",
        title: typeof block.title === "string" ? block.title : "Activity",
        durationMin: Number.isFinite(block.durationMin) ? Number(block.durationMin) : 0,
        body: block.body,
      })),
  };
}
