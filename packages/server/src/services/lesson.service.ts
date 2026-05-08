import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../lib/errors";
import { getPgPool } from "../lib/pgdb";
import { generateLlmJson, retrieveTextbookChunks, type RetrieverChunk } from "../repositories";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/server/src/services/ → ../../../  =  packages/
const PDF_DIR = path.resolve(__dirname, "../../..", "ingestion/data/pdfs");

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

const titleCase = (slug: string): string =>
  slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ")
    .trim();

const isSafe = (v: string): boolean => /^[a-z0-9_-]+$/i.test(v);

// ── manifest queries (PostgreSQL, async) ─────────────────────────────────────

/**
 * Subjects available for a class — queries the PostgreSQL manifest table.
 * Falls back to PDF folder scan if the manifest has no rows yet.
 */
export async function listSubjects(className: string): Promise<SubjectOption[]> {
  if (!isSafe(className)) throw new AppError("Invalid class name.", 400, "lesson");

  try {
    const { rows } = await getPgPool().query<{ subject: string }>(
      "SELECT DISTINCT subject FROM manifest WHERE class_name = $1 ORDER BY subject",
      [className],
    );
    if (rows.length > 0) {
      return rows.map((r) => ({ id: r.subject, label: titleCase(r.subject) }));
    }
  } catch {
    // fall through to PDF scan
  }

  // Fallback: scan the PDF folder so subjects appear before ingestion runs.
  const classDir = path.join(PDF_DIR, className);
  try {
    return fs
      .readdirSync(classDir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((f) => {
        const id = path.basename(f, path.extname(f));
        return { id, label: titleCase(id) };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

/** Chapter titles for (class, subject) — read from the PostgreSQL manifest. */
export async function listChapters(className: string, subject: string): Promise<string[]> {
  if (!isSafe(className) || !isSafe(subject)) {
    throw new AppError("Invalid class or subject.", 400, "lesson");
  }

  const { rows } = await getPgPool().query<{ chapter: string }>(
    "SELECT chapter FROM manifest WHERE class_name = $1 AND subject = $2 ORDER BY chapter_order",
    [className, subject],
  );
  return rows.map((r) => r.chapter);
}

// ── blueprint generation ──────────────────────────────────────────────────────

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
    "You are a lesson plan formatter. Structure the excerpts into 6 teaching phases.",
    "You have no knowledge of your own — use ONLY the excerpts below.",
    "",
    "RULES:",
    "1. Every sentence in every body MUST come from the excerpts.",
    "2. Do NOT add facts, examples, or context not present in the excerpts.",
    "3. Questions in 'check' must only ask about content in the excerpts.",
    "",
    `Class: ${titleCase(className)}  |  Subject: ${titleCase(subject)}  |  Chapter: ${chapter}`,
    `Total duration: ${durationMin} minutes`,
    "",
    "TEXTBOOK EXCERPTS:",
    "==================",
    excerpts,
    "==================",
    "",
    "Produce exactly 6 blocks. Sum of durationMin must equal total duration.",
    "",
    '1. "objective"  durationMin:0    one sentence — what students will learn',
    '2. "warm_up"    5–8 min          recall question from excerpts',
    '3. "teach"      8–12 min         core content using only excerpt wording',
    '4. "practice"   8–12 min         task directly about excerpt content',
    '5. "check"      3–5 min          2–3 oral questions answered in excerpts',
    '6. "wrap_up"    2–4 min          one-sentence summary from excerpts',
    "",
    "Return ONLY this JSON (no prose, no markdown fences):",
    `{"title":"...","blocks":[`,
    `  {"phase":"objective","title":"...","durationMin":0,"body":"..."},`,
    `  {"phase":"warm_up","title":"...","durationMin":0,"body":"..."},`,
    `  {"phase":"teach","title":"...","durationMin":0,"body":"..."},`,
    `  {"phase":"practice","title":"...","durationMin":0,"body":"..."},`,
    `  {"phase":"check","title":"...","durationMin":0,"body":"..."},`,
    `  {"phase":"wrap_up","title":"...","durationMin":0,"body":"..."}`,
    "]}",
  ].join("\n");
};

export async function buildBlueprint(input: {
  className: string;
  subject: string;
  chapter: string;
  durationMin: number;
}): Promise<LessonBlueprint> {
  const { className, subject, chapter, durationMin } = input;

  if (!chapter.trim()) throw new AppError("Chapter is required.", 400, "lesson");
  if (!Number.isFinite(durationMin) || durationMin < 10 || durationMin > 120) {
    throw new AppError("Duration must be between 10 and 120 minutes.", 400, "lesson");
  }

  const chunks = await retrieveTextbookChunks(className, subject, chapter, 8);
  if (chunks.length === 0) {
    throw new AppError(
      "No textbook content found for this chapter. Run ingestion first.",
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
      .filter((b) => b && typeof b.body === "string")
      .map((b) => ({
        phase: typeof b.phase === "string" ? b.phase : "teach",
        title: typeof b.title === "string" ? b.title : "Activity",
        durationMin: Number.isFinite(b.durationMin) ? Number(b.durationMin) : 0,
        body: b.body,
      })),
  };
}
