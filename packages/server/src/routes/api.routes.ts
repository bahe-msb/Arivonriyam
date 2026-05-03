import { Router } from "express";
import {
  getHealth,
  getLessonChapters,
  getLessonSubjects,
  getTodayPlans,
  getTestStt,
  postLessonBlueprint,
  postSavePlan,
  postSocraticSummarize,
  postTestAsk,
  postVoiceFile,
} from "../controllers";
import { upload } from "../middleware";

/** Registers API endpoints on an Express router. */
export function createApiRouter(): Router {
  const router = Router();

  // Project Specific endpoints
  router.get("/health", getHealth);
  router.post("/api/student/conservation", upload.single("audio"), postVoiceFile);
  router.post("/api/socratic/summarize", postSocraticSummarize);

  // Lesson plan endpoints
  router.get("/api/lesson/subjects", getLessonSubjects);
  router.get("/api/lesson/chapters", getLessonChapters);
  router.post("/api/lesson/blueprint", postLessonBlueprint);
  router.post("/api/lesson/plan/save", postSavePlan);
  router.get("/api/lesson/plan/today", getTodayPlans);

  // Test endpoints
  router.post("/api/test/ask", postTestAsk);
  router.get("/api/test/stt", getTestStt);

  return router;
}
