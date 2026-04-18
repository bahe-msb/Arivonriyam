import { env } from "../config";
import { AppError } from "../lib/errors";

interface OllamaResponse {
  response?: string;
}

/** Sends a prompt to Ollama and returns trimmed model output. */
export async function generateLlmResponse(prompt: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.ollamaModel,
        prompt,
        stream: false,
      }),
    });
  } catch {
    throw new AppError(
      "Could not connect to Ollama. Ensure Ollama is running locally.",
      503,
      "ollama",
    );
  }

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
