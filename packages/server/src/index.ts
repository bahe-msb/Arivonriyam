import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { TranscribeAudio } from "./stt";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9012;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = "gemma4:latest";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const knownAudioExtensions = new Set([".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac"]);
    const hasKnownAudioExt = knownAudioExtensions.has(ext);
    const mimeLooksAudio = file.mimetype.startsWith("audio/");
    const mimeIsGeneric =
      file.mimetype === "application/octet-stream" ||
      file.mimetype === "" ||
      file.mimetype === "application/x-unknown-content-type";

    if (mimeLooksAudio || (mimeIsGeneric && hasKnownAudioExt)) {
      callback(null, true);
      return;
    }
    callback(new Error("Only audio files are supported."));
  },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_BUILD = path.resolve(__dirname, "../../client/build");

// Middleware
app.use(express.json());

function createRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

function color(text: string, ansiColor: string): string {
  return `${ansiColor}${text}${ANSI.reset}`;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return Object.entries(meta)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
}

function printLog(
  level: "INFO" | "ERROR",
  requestId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const levelColor = level === "ERROR" ? ANSI.red : ANSI.green;
  const stageColor =
    stage === "upload"
      ? ANSI.cyan
      : stage === "stt"
        ? ANSI.yellow
        : stage === "ollama"
          ? ANSI.green
          : ANSI.cyan;

  const prefix = [
    color(timestamp, ANSI.dim),
    color(`[${level}]`, levelColor),
    color(`[${requestId}]`, ANSI.cyan),
    color(`[${stage}]`, stageColor),
  ].join(" ");

  const metaText = formatMeta(meta);
  const line = metaText ? `${prefix} ${message} | ${metaText}` : `${prefix} ${message}`;

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  console.log(line);
}

function logInfo(
  requestId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  printLog("INFO", requestId, stage, message, meta);
}

function logError(
  requestId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  printLog("ERROR", requestId, stage, message, meta);
}

class AppError extends Error {
  status: number;
  stage: string;

  constructor(message: string, status: number, stage: string) {
    super(message);
    this.status = status;
    this.stage = stage;
  }
}

function sanitizeFileExtension(fileName: string): string {
  const ext = path
    .extname(fileName || "")
    .toLowerCase()
    .replace(".", "");
  return ext.replace(/[^a-z0-9]/g, "") || "wav";
}

async function saveUploadedAudioToTemp(file: Express.Multer.File): Promise<string> {
  const extension = sanitizeFileExtension(file.originalname);
  const tempPath = path.join(
    os.tmpdir(),
    `arivonriyam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
  );
  await fs.writeFile(tempPath, file.buffer);
  return tempPath;
}

async function generateOllamaResponse(prompt: string, requestId?: string): Promise<string> {
  try {
    if (requestId) {
      logInfo(requestId, "ollama", "Sending prompt to Ollama", {
        model: OLLAMA_MODEL,
        promptLength: prompt.length,
      });
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      if (requestId) {
        logError(requestId, "ollama", "Ollama returned a non-success status", {
          status: response.status,
          statusText: response.statusText,
        });
      }

      throw new AppError(
        `Ollama request failed: ${response.status} ${response.statusText}`,
        502,
        "ollama",
      );
    }

    const data = (await response.json()) as { response?: string };
    const output = data.response?.trim() || "";

    if (requestId) {
      logInfo(requestId, "ollama", "Ollama response received", {
        outputLength: output.length,
      });
    }

    return output;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (requestId) {
      logError(requestId, "ollama", "Failed to connect to Ollama", {
        error: error instanceof Error ? error.message : "unknown error",
      });
    }

    throw new AppError(
      "Could not connect to Ollama. Ensure Ollama is running locally.",
      503,
      "ollama",
    );
  }
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/voice-file", upload.single("audio"), async (req, res) => {
  let tempAudioPath: string | null = null;
  const requestId = createRequestId();

  try {
    if (!req.file) {
      res.status(400).json({ error: "Please upload an audio file using field name 'audio'." });
      return;
    }

    logInfo(requestId, "upload", "Audio file received", {
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    // As in multer we are using multer.memoryStorage(), the uploaded file is available in req.file.buffer
    // We need to save it to a temp file for whisper.cpp to process it.
    tempAudioPath = await saveUploadedAudioToTemp(req.file);
    logInfo(requestId, "upload", "Temporary audio file created");

    let transcription = "";
    try {
      logInfo(requestId, "stt", "Starting whisper transcription");
      transcription = await TranscribeAudio(tempAudioPath);
    } catch {
      throw new AppError(
        "Whisper transcription failed. Verify whisper.cpp build and model files are available.",
        500,
        "stt",
      );
    }

    logInfo(requestId, "stt", "Whisper transcription completed", {
      textLength: transcription.length,
      preview: transcription.slice(0, 140),
    });

    if (!transcription) {
      res
        .status(422)
        .json({ error: "Could not transcribe speech from this audio file.", stage: "stt" });
      return;
    }

    const output = await generateOllamaResponse(transcription, requestId);
    logInfo(requestId, "pipeline", "Voice pipeline completed successfully");

    res.json({
      transcription,
      output,
      meta: {
        requestId,
        model: OLLAMA_MODEL,
        filename: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    logError(requestId, "pipeline", "/api/voice-file failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });

    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }
    res.status(500).json({ error: "Failed to process uploaded audio", stage: "unknown" });
  } finally {
    if (tempAudioPath) {
      // removing the temp audio file after processing to avoid filling up disk space. We use force:true to avoid errors if the file is already removed or doesn't exist.
      await fs.rm(tempAudioPath, { force: true });
    }
  }
});

// TEST - Text prompt route for quick manual tests.
app.post("/api/test/ask", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt must be a non-empty string" });
    return;
  }

  try {
    const output = await generateOllamaResponse(prompt);
    res.json({ input: prompt, output });
  } catch (error) {
    console.error("/api/test/ask failed:", error);
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, stage: error.stage });
      return;
    }
    res.status(500).json({ error: "Failed to generate response from Ollama", stage: "unknown" });
  }
});

// STT - Test
app.get("/api/test/stt", (req, res) => {
  const audioPath = path.resolve(__dirname, "../../whisper.cpp/samples/tamil.wav");
  TranscribeAudio(audioPath)
    .then((transcription) => res.json({ transcription }))
    .catch((error) => {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    });
});

// Centralized handler for upload errors such as size limits.
app.use(
  (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Audio file is too large. Maximum size is 25 MB." });
      return;
    }

    if (error instanceof Error && error.message === "Only audio files are supported.") {
      res.status(400).json({ error: error.message });
      return;
    }

    next(error);
  },
);

// Serve SvelteKit static build
app.use(express.static(CLIENT_BUILD));

// SPA fallback
app.use((_req, res) => {
  res.sendFile(path.join(CLIENT_BUILD, "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
});
