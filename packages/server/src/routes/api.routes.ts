import { Router } from "express";
import {
  getAlerts,
  getHealth,
  getLessonChapters,
  getLessonSubjects,
  getReteachState,
  getTodayPlans,
  getTestStt,
  getSchoolConfig,
  getStudents,
  getReportPerformance,
  postAlertsSession,
  postSocraticAlertSuggestion,
  postSocraticPreview,
  postLessonBlueprint,
  postReteachState,
  postSavePlan,
  postSocraticSummarize,
  postSchoolConfig,
  postStudents,
  postTestAsk,
  postVoiceFile,
} from "../controllers";
import { upload } from "../middleware";

/** Registers API endpoints on an Express router. */
export function createApiRouter(): Router {
  const router = Router();

  // Health
  router.get("/health", getHealth);
  router.get("/api/health", getHealth);

  // School setup
  router.get("/api/school/config", getSchoolConfig);
  router.post("/api/school/config", postSchoolConfig);
  router.get("/api/school/students", getStudents);
  router.post("/api/school/students", postStudents);

  // Alerts
  router.get("/api/alerts", getAlerts);
  router.post("/api/alerts/session", postAlertsSession);

  // Reteach state
  router.get("/api/reteach/state", getReteachState);
  router.post("/api/reteach/state", postReteachState);

  // Report
  router.get("/api/report/performance", getReportPerformance);

  // Socratic
  router.post("/api/socratic/alerts/suggestion", postSocraticAlertSuggestion);
  router.post("/api/socratic/preview", postSocraticPreview);
  router.post("/api/socratic/summarize", postSocraticSummarize);

  // Lesson plan
  router.get("/api/lesson/subjects", getLessonSubjects);
  router.get("/api/lesson/chapters", getLessonChapters);
  router.post("/api/lesson/blueprint", postLessonBlueprint);
  router.post("/api/lesson/plan/save", postSavePlan);
  router.get("/api/lesson/plan/today", getTodayPlans);

  // Voice
  router.post("/api/student/conservation", upload.single("audio"), postVoiceFile);

  // Test
  router.post("/api/test/ask", postTestAsk);
  router.get("/api/test/stt", getTestStt);

  return router;
}
