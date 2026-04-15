import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { TranscribeAudio } from "./stt";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9012;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_BUILD = path.resolve(__dirname, "../../client/build");

// Middleware
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// STT - Test
app.get("/api/stt", (req, res) => {
  const audioPath = path.resolve(__dirname, "../../whisper.cpp/samples/tamil.wav");
  console.log("audioPath:", audioPath);
  TranscribeAudio(audioPath)
    .then((transcription) => res.json({ transcription }))
    .catch((error) => {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    });
});

// Ollama route
app.post("/api/ask", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt must be a non-empty string" });
    return;
  }

  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Transfer-Encoding", "chunked");

  const stream = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma4:latest",
      prompt,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 150,
        repeat_penalty: 1.1,
        top_p: 0.9,
      },
    }),
  });

  // Async iterable
  for await (const chunk of stream.body as AsyncIterable<Uint8Array>) {
    const text = new TextDecoder().decode(chunk);
    const json = JSON.parse(text) as { response: string; done: boolean };
    res.write(json.response);

    if (json.done) break;
  }
  res.end();
});

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
