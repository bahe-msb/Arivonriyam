# Arivonriyam (அறிவொன்றியம்)

A pnpm monorepo with a SvelteKit frontend and an Express + Ollama backend.

## Stack

| Layer    | Technology                              |
| -------- | --------------------------------------- |
| Frontend | SvelteKit v2, Svelte 5, Tailwind CSS v4 |
| UI       | shadcn-svelte                           |
| Backend  | Express v5, TypeScript, tsx             |
| AI       | Ollama (local LLM)                      |
| Tooling  | pnpm workspaces, ESLint, Prettier       |

## Project structure

```
.
├── packages/
│   ├── client/   # SvelteKit app
│   └── server/   # Express API
├── eslint.config.js
├── .prettierrc
└── package.json
```

## Development

Run both the client (Vite dev server) and server concurrently:

```sh
pnpm dev
```

- Client → `http://localhost:5173`
- Server → `http://localhost:9012`

Vite proxies `/api/*` to the Express server, so no CORS issues in dev.

Or run them separately:

```sh
pnpm dev:client   # SvelteKit Vite dev server
pnpm dev:server   # Express with tsx watch
```

## Production

Build the SvelteKit app and start the Express server — it serves the static build and handles all API routes:

```sh
pnpm build   # builds packages/client → packages/client/build/
pnpm start   # starts Express on :9012
```

Visit `http://localhost:9012`. Express serves the static SvelteKit SPA and falls back to `index.html` for client-side routing.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Ollama](https://ollama.com/) running locally on port `11434` with `gemma4:latest` pulled
