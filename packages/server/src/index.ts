import express from 'express';

const app = express();
const PORT = 9012;

// Middleware — lets Express read JSON request bodies
app.use(express.json());

// Health check — always good to have
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Ollama route
app.post('/api/ask', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt must be a non-empty string' });
    return;
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  const stream = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4:latest',
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
  for await (let chunk of stream.body as any) {
    let text = new TextDecoder().decode(chunk);
    let json = JSON.parse(text);
    res.write(json.response);

    if (json.done) break;
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
