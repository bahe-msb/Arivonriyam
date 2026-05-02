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
}

/**
 * Query the ChromaDB vector store (via the ingestion Python package) for
 * chunks relevant to a given chapter. Falls back to [] if ChromaDB is
 * unavailable or the chapter has not been ingested yet.
 */
export async function retrieveTextbookChunks(
  grade: string,
  subject: SubjectName,
  chapter: string,
  topK = 5,
): Promise<RetrieverChunk[]> {
  return new Promise((resolve) => {
    const proc = spawn(
      "uv",
      [
        "run",
        "python",
        "src/main.py",
        "retrieve",
        "--class",
        grade,
        "--subject",
        subject,
        "--chapter",
        chapter,
        "--top-k",
        String(topK),
      ],
      { cwd: INGESTION_DIR },
    );

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", () => {
      // stdout may have diagnostic lines before the JSON array; find the
      // last line that looks like a JSON array.
      const jsonLine = stdout
        .split("\n")
        .reverse()
        .find((l) => l.trim().startsWith("["));

      try {
        resolve(jsonLine ? (JSON.parse(jsonLine) as RetrieverChunk[]) : []);
      } catch {
        resolve([]);
      }
    });

    proc.on("error", () => resolve([]));
  });
}
