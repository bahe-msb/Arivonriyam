import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = 9012;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_BUILD = path.resolve(__dirname, "../../client/build");

// Middleware
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
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

  const stream = await fetch("http://localhost:11434/api/generate", {
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
