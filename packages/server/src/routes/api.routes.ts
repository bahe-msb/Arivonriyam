import { Router } from "express";
import { getHealth, getTestStt, postTestAsk, postVoiceFile } from "../controllers";
import { upload } from "../middleware";

/** Registers API endpoints on an Express router. */
export function createApiRouter(): Router {
  const router = Router();

  router.get("/health", getHealth);
  router.post("/api/voice-file", upload.single("audio"), postVoiceFile);
  router.post("/api/test/ask", postTestAsk);
  router.get("/api/test/stt", getTestStt);

  return router;
}
