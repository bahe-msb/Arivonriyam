import { env } from "../config";
import { AppError } from "../lib/errors";

interface OllamaResponse {
  response?: string;
}

interface OllamaCallOptions {
  timeoutMs?: number;
}

const DEFAULT_OLLAMA_TIMEOUT_MS = 45_000;

function resolveTimeoutMs(timeoutMs?: number): number {
  return Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : DEFAULT_OLLAMA_TIMEOUT_MS;
}

async function callOllama(
  body: Record<string, unknown>,
  options: OllamaCallOptions = {},
): Promise<string> {
  let response: Response;
  const controller = new AbortController();
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const baseUrl = env.ollamaBaseUrl.replace(/\/+$/, "");

  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: env.ollamaModel, stream: false, ...body }),
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(
        `Ollama did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
        504,
        "ollama",
      );
    }
    throw new AppError(
      "Could not connect to Ollama. Ensure Ollama is running locally.",
      503,
      "ollama",
    );
  }

  clearTimeout(timeout);

  if (!response.ok) {
    throw new AppError(
      `Ollama request failed: ${response.status} ${response.statusText}`,
      502,
      "ollama",
    );
  }

  const data = (await response.json()) as OllamaResponse;
  return data.response?.trim() || "";
}

/** Sends a prompt to Ollama and returns trimmed model output in Tamil (no language override). */
export async function generateTamilResponse(
  prompt: string,
  options?: OllamaCallOptions,
): Promise<string> {
  return callOllama({ prompt }, options);
}

/** Sends a prompt to Ollama and returns trimmed model output in Telugu (no language override). */
export async function generateTeluguResponse(
  prompt: string,
  options?: OllamaCallOptions,
): Promise<string> {
  return callOllama({ prompt }, options);
}

/** Sends a prompt to Ollama and returns trimmed model output. */
export async function generateLlmResponse(
  prompt: string,
  options?: OllamaCallOptions,
): Promise<string> {
  const englishOnlyPrompt = [
    "Respond only in English.",
    "Keep the response clear and concise for a primary-school student.",
    "",
    prompt,
  ].join("\n");

  return callOllama({ prompt: englishOnlyPrompt }, options);
}

/**
 * Sends a prompt to Ollama with ``format: "json"`` and parses the
 * response as JSON. The caller is responsible for telling the model
 * what shape to produce — this function only enforces parseability.
 */
export async function generateLlmJson<T>(prompt: string, options?: OllamaCallOptions): Promise<T> {
  const raw = await callOllama({ prompt, format: "json" }, options);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError("Model returned invalid JSON.", 502, "ollama");
  }
}
