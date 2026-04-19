import { env } from "../config";
import {
  generateLlmResponse,
  type RetrieverChunk,
  retrieveTextbookChunks,
  type SubjectName,
} from "../repositories";

export interface RagAnswerResult {
  output: string;
  usedContext: RetrieverChunk[];
  model: string;
}

const MIN_CONFIDENCE = 0.2;

const buildPrompt = (
  grade: string,
  subject: SubjectName,
  query: string,
  context: RetrieverChunk[],
): string => {
  const contextBlock = context
    .map(
      (chunk, index) => `[${index + 1}] page=${chunk.page} chapter=${chunk.chapter}\n${chunk.text}`,
    )
    .join("\n\n");

  return [
    "You are a primary school teacher responding in English.",
    "Use only the provided textbook context.",
    "Do not guess or add external facts.",
    "Instead of giving the full answer directly, ask one guiding question.",
    `Grade: ${grade}`,
    `Subject: ${subject}`,
    "Textbook chunks:",
    contextBlock,
    "Student question:",
    query,
  ].join("\n");
};

/** Runs retrieval-augmented answer generation for class and subject scoped tutoring. */
export async function askWithRag(
  grade: string,
  subject: SubjectName,
  query: string,
): Promise<RagAnswerResult> {
  const chunks = await retrieveTextbookChunks(grade, subject, query, 3);

  if (!chunks.length || chunks[0].score < MIN_CONFIDENCE) {
    return {
      output:
        "I could not find enough relevant textbook context for this question. Please ask again with a simpler, more specific chapter/topic reference.",
      usedContext: chunks,
      model: env.ollamaModel,
    };
  }

  const prompt = buildPrompt(grade, subject, query, chunks);
  const output = await generateLlmResponse(prompt);
  return { output, usedContext: chunks, model: env.ollamaModel };
}
