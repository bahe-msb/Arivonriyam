import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  generateLlmJson: vi.fn(),
  generateLlmResponse: vi.fn(),
  generateTamilResponse: vi.fn(),
  generateTeluguResponse: vi.fn(),
  retrieveTopicChunks: vi.fn(),
  summarizeTopic: vi.fn(),
}));

vi.mock("../repositories", () => repoMocks);

const { createApp } = await import("../app");

const payload = {
  className: "Class 4",
  studentName: "Ravi",
  topic: "Fractions",
  subject: "Mathematics",
  totalQuestions: 6,
  incorrectCount: 3,
  missedQuestions: [
    {
      question: "What is 1/2 + 1/2?",
      selectedOption: "1/2",
      correctOption: "1",
      explain: "Two halves make one whole.",
    },
  ],
};

describe("socratic alert suggestion smoke", () => {
  beforeEach(() => {
    repoMocks.generateLlmJson.mockReset();
    repoMocks.generateLlmResponse.mockReset();
    repoMocks.generateTamilResponse.mockReset();
    repoMocks.generateTeluguResponse.mockReset();
    repoMocks.retrieveTopicChunks.mockReset();
    repoMocks.summarizeTopic.mockReset();
  });

  it("returns source metadata when AI suggestion generation succeeds", async () => {
    repoMocks.generateLlmJson.mockResolvedValue({
      gapSummary: "Ravi needs a slower recap on how halves combine to make one whole.",
      focusAreas: ["halves make a whole", "fraction examples", "choosing the right option"],
      teacherActions: [
        "Show two half circles joining into one whole.",
        "Ask Ravi to explain the answer in his own words.",
        "Give two more quick fraction questions before the next round.",
      ],
      encouragement: "You are close, Ravi. Let us solve one step at a time.",
    });

    const response = await request(createApp())
      .post("/api/socratic/alerts/suggestion")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source: "ai",
      gapSummary: "Ravi needs a slower recap on how halves combine to make one whole.",
    });
    expect(Array.isArray(response.body.focusAreas)).toBe(true);
    expect(response.body.teacherActions).toHaveLength(3);
  });

  it("returns fallback metadata when AI suggestion generation fails", async () => {
    repoMocks.generateLlmJson.mockRejectedValue(new Error("LLM offline"));

    const response = await request(createApp())
      .post("/api/socratic/alerts/suggestion")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source: "fallback",
      message: "AI suggestion is unavailable right now. Showing a local support plan instead.",
    });
    expect(typeof response.body.gapSummary).toBe("string");
    expect(response.body.focusAreas.length).toBeGreaterThan(0);
    expect(response.body.teacherActions).toHaveLength(3);
  });
});
