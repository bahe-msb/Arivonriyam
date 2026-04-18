import dotenv from "dotenv";

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  port: toNumber(process.env.PORT, 9012),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "gemma4:latest",
  whisperModelSize: process.env.WHISPER_MODEL_SIZE || "large-v2",
  pythonBin: process.env.PYTHON_BIN || "python3",
  ragCollection: process.env.RAG_COLLECTION || "arivondum_textbooks_v1",
  ragEmbeddingModel:
    process.env.RAG_EMBEDDING_MODEL ||
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
} as const;
