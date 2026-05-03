import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../lib/errors";
import { getDb } from "../lib/db";
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

// ── manifest queries (SQLite, synchronous) ────────────────────────────────────

/**
 * Subjects available for a class.
 * Primary source: SQLite manifest (populated after ingestion).
 * Fallback: PDF folder scan (so subjects show immediately when PDFs are placed,
 *           even before ingestion has been run).
 */
export function listSubjects(className: string): SubjectOption[] {
  if (!isSafe(className)) throw new AppError("Invalid class name.", 400, "lesson");

  // Try SQLite manifest first (has richer data post-ingestion).
  // If SQLite is unavailable (for example native bindings mismatch),
  // continue to PDF fallback instead of failing the subjects endpoint.
  try {
    const rows = getDb()
      .prepare("SELECT DISTINCT subject FROM manifest WHERE class_name = ? ORDER BY subject")
      .all(className) as { subject: string }[];

    if (rows.length > 0) {
      return rows.map((r) => ({ id: r.subject, label: titleCase(r.subject) }));
    }
  } catch {
    // Intentionally ignore manifest errors so class subjects can still be listed from PDFs.
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

/** Chapter titles for (class, subject) — read directly from the shared SQLite manifest. */
export function listChapters(className: string, subject: string): string[] {
  if (!isSafe(className) || !isSafe(subject)) {
    throw new AppError("Invalid class or subject.", 400, "lesson");
  }

  const rows = getDb()
    .prepare(
      "SELECT chapter FROM manifest WHERE class_name = ? AND subject = ? ORDER BY chapter_order",
    )
    .all(className, subject) as { chapter: string }[];

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
