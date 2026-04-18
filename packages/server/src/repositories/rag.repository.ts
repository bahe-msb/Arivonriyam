import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { env } from "../config";
import { AppError } from "../lib/errors";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "../../python");
const RETRIEVER_SCRIPT = path.join(PYTHON_DIR, "retriever.py");
const DATA_ROOT = path.resolve(__dirname, "../../data");
const PROJECT_VENV_PYTHON = path.resolve(__dirname, "../../../../.venv/bin/python");

export type SubjectName = "tamil" | "maths" | "science";

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

interface RetrieverPayload {
  ok: boolean;
  query: string;
  results: RetrieverChunk[];
}

const resolvePythonBin = (): string => {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }

  if (existsSync(PROJECT_VENV_PYTHON)) {
    return PROJECT_VENV_PYTHON;
  }

  return env.pythonBin;
};

/** Calls Python retriever and returns relevant chunks for grade and subject. */
export async function retrieveTextbookChunks(
  grade: string,
  subject: SubjectName,
  query: string,
  topK = 3,
): Promise<RetrieverChunk[]> {
  const args = [
    RETRIEVER_SCRIPT,
    "--data-root",
    DATA_ROOT,
    "--collection",
    env.ragCollection,
    "--embedding-model",
    env.ragEmbeddingModel,
    "--grade",
    grade,
    "--subject",
    subject,
    "--query",
    query,
    "--top-k",
    String(topK),
  ];

  console.log("[RAG] Running retriever with args:", args.join(" "));

  try {
    const pythonBin = resolvePythonBin();
    const { stdout } = await execFileAsync(pythonBin, args, { cwd: PYTHON_DIR });
    console.log("[RAG] Retriever output:", stdout);
    const payload = JSON.parse(stdout) as RetrieverPayload;
    return Array.isArray(payload.results) ? payload.results : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown retriever error";
    throw new AppError(
      `RAG retrieval failed: ${message}. Run 'make rag-install' and ensure retriever uses project .venv.`,
      503,
      "rag",
    );
  }
}
