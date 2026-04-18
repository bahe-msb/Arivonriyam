import { Router } from "express";
import { getHealth, getTestStt, postTestAsk, postVoiceFile } from "../controllers";
import { upload } from "../middleware";

/** Registers API endpoints on an Express router. */
export function createApiRouter(): Router {
  const router = Router();

  // Project Specific endpoints
  router.get("/health", getHealth);
  router.post("/api/student/conservation", upload.single("audio"), postVoiceFile);

  // Test endpoints
  router.post("/api/test/ask", postTestAsk);
  router.get("/api/test/stt", getTestStt);

  return router;
}
