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
  console.log("temp", os.tmpdir());
  const tempPath = path.join(
    os.tmpdir(),
    `arivonriyam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
  );
  await fs.writeFile(tempPath, file.buffer);
  return tempPath;
}

async function generateOllamaResponse(prompt: string): Promise<string> {
  try {
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
      throw new AppError(
        `Ollama request failed: ${response.status} ${response.statusText}`,
        502,
        "ollama",
      );
    }

    const data = (await response.json()) as { response?: string };
    return data.response?.trim() || "";
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
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

  try {
    if (!req.file) {
      res.status(400).json({ error: "Please upload an audio file using field name 'audio'." });
      return;
    }
    // As in multer we are using multer.memoryStorage(), the uploaded file is available in req.file.buffer
    // We need to save it to a temp file for whisper.cpp to process it.
    tempAudioPath = await saveUploadedAudioToTemp(req.file);
    let transcription = "";
    try {
      transcription = await TranscribeAudio(tempAudioPath);
    } catch {
      throw new AppError(
        "Whisper transcription failed. Verify whisper.cpp build and model files are available.",
        500,
        "stt",
      );
    }

    if (!transcription) {
      res
        .status(422)
        .json({ error: "Could not transcribe speech from this audio file.", stage: "stt" });
      return;
    }
    console.log("Transcription:", transcription);
    const output = await generateOllamaResponse(transcription);
    res.json({
      transcription,
      output,
      meta: {
        model: OLLAMA_MODEL,
        filename: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error("/api/voice-file failed:", error);
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
  console.log("audioPath:", audioPath);
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
