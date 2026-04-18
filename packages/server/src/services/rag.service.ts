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
    "நீங்கள் தமிழ் நடையில் பேசும் ஆரம்பப்பள்ளி ஆசிரியர்.",
    "கொடுக்கப்பட்ட பாடப்புத்தகத் தகவலை மட்டும் பயன்படுத்துங்கள்.",
    "ஊகித்து தகவல் சொல்ல வேண்டாம்.",
    "முழு விடை நேரடியாக சொல்லாமல் ஒரு வழிகாட்டும் கேள்வி கேளுங்கள்.",
    `வகுப்பு: ${grade}`,
    `பாடம்: ${subject}`,
    "புத்தகத் துணுக்குகள்:",
    contextBlock,
    "மாணவர் கேள்வி:",
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
        "இந்தக் கேள்விக்கான போதுமான பகுதி எனக்கு கிடைக்கவில்லை. கேள்வியை கொஞ்சம் எளிதாக, குறிப்பாக பாடப்பகுதி பெயருடன் கேட்க முடியுமா?",
      usedContext: chunks,
      model: env.ollamaModel,
    };
  }

  const prompt = buildPrompt(grade, subject, query, chunks);
  const output = await generateLlmResponse(prompt);
  return { output, usedContext: chunks, model: env.ollamaModel };
}
