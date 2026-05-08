/**
 * RAG repository — all retrieval goes through Python subprocesses.
 *
 * retrieveTextbookChunks  chapter-scoped retrieval  → lesson blueprint
 * summarizeTopic          topic-wide 3-5 min intro  → Socratic session
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INGESTION_DIR = path.resolve(__dirname, "../../../ingestion");

export type SubjectName = string;

export interface RetrieverChunk {
  text: string;
  score: number;
  grade: string;
  subject: string;
  chapter: string;
  page: number;
  language: string;
  source_file: string;
  tables_html?: string[];
  images_base64?: string[];
}

export interface TopicSummary {
  intro: string;
  content: string;
  key_points: string[];
  bridge: string;
  word_count: number;
  chunks_used: number;
  images_base64?: string[];
  exercise_chunks?: Array<{ text: string; page: number }>;
}

// ── shared subprocess helper ──────────────────────────────────────────────────
function runPython(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("uv", ["run", "python", "src/main.py", ...args], {
      cwd: INGESTION_DIR,
    });

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // Forward Python logs (stderr) to Node stderr so they appear in server output
    proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`[rag] python exited with code ${code}`);
      }
      resolve(stdout);
    });
    proc.on("error", (err) => {
      console.error("[rag] spawn error:", err.message);
      resolve("");
    });
  });
}

/** Parse the last JSON line from subprocess stdout (diagnostic lines come first). */
function parseJsonLine<T>(stdout: string): T | null {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("[") || l.startsWith("{"))
    .at(-1);
  if (!line) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Chapter-scoped semantic retrieval — used by lesson-plan blueprint.
 * Falls back to [] if ChromaDB or Python is unavailable.
 */
export async function retrieveTextbookChunks(
  grade: string,
  subject: SubjectName,
  chapter: string,
  topK = 8,
): Promise<RetrieverChunk[]> {
  const stdout = await runPython([
    "retrieve",
    "--class",
    grade,
    "--subject",
    subject,
    "--chapter",
    chapter,
    "--top-k",
    String(topK),
  ]);

  return parseJsonLine<RetrieverChunk[]>(stdout) ?? [];
}

export async function retrieveTopicChunks(
  grade: string,
  subject: SubjectName,
  topic: string,
  topK = 6,
): Promise<RetrieverChunk[]> {
  const stdout = await runPython([
    "retrieve-topic",
    "--class",
    grade,
    "--subject",
    subject,
    "--topic",
    topic,
    "--top-k",
    String(topK),
  ]);

  return parseJsonLine<RetrieverChunk[]>(stdout) ?? [];
}

/**
 * Topic-wide summarization (~3–5 min teacher intro).
 * Returns null if the Python subprocess fails or returns nothing.
 */
export async function summarizeTopic(
  grade: string,
  subject: SubjectName,
  topic: string,
  source = "curriculum",
  lang = "ta",
  topK = 12,
): Promise<TopicSummary | null> {
  const stdout = await runPython([
    "summarize",
    "--class",
    grade,
    "--subject",
    subject,
    "--topic",
    topic,
    "--source",
    source,
    "--lang",
    lang,
    "--top-k",
    String(topK),
  ]);

  return parseJsonLine<TopicSummary>(stdout);
}
