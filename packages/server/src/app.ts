import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleKnownErrors, handleUnexpectedErrors } from "./middleware";
import { createApiRouter } from "./routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_BUILD = path.resolve(__dirname, "../../client/build");

/** Builds and configures the Express app instance. */
export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(createApiRouter());
  app.use(handleKnownErrors);

  app.use(express.static(CLIENT_BUILD));
  app.use((_req, res) => {
    res.sendFile(path.join(CLIENT_BUILD, "index.html"));
  });

  app.use(handleUnexpectedErrors);
  return app;
}
