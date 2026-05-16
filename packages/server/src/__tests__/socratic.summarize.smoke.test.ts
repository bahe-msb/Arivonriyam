import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../lib/errors";

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

function questionEnvelope(): string {
  return JSON.stringify({
    questions: [
      {
        q: "What does a fraction show?",
        options: ["Part of a whole", "Only whole numbers", "Only shapes", "Only money"],
        answerIndex: 0,
        explain: "A fraction represents parts of one complete whole.",
      },
      {
        q: "In 3/4, what is 4 called?",
        options: ["Numerator", "Denominator", "Multiplier", "Remainder"],
        answerIndex: 1,
        explain: "The denominator tells how many equal parts make the whole.",
      },
      {
        q: "Which fraction is bigger?",
        options: ["1/4", "1/2", "1/8", "1/10"],
        answerIndex: 1,
        explain: "With the same numerator, a smaller denominator gives a bigger part.",
      },
      {
        q: "How many halves make one whole?",
        options: ["One", "Two", "Three", "Four"],
        answerIndex: 1,
        explain: "Two halves combine to make one complete whole.",
      },
      {
        q: "Which pair is equivalent?",
        options: ["1/2 and 2/4", "1/3 and 2/5", "1/4 and 2/5", "1/6 and 3/7"],
        answerIndex: 0,
        explain: "1/2 and 2/4 represent the same quantity.",
      },
      {
        q: "What helps compare unlike fractions?",
        options: [
          "Common denominator",
          "Random guess",
          "Bigger numerator only",
          "Skip the question",
        ],
        answerIndex: 0,
        explain: "A common denominator allows direct comparison of fractions.",
      },
    ],
  });
}

describe("socratic summarize smoke", () => {
  beforeEach(() => {
    const longContent = Array.from(
      { length: 26 },
      (_unused, index) =>
        `Fractions lesson fact ${index + 1} explains how parts of a whole are compared using equal pieces and simple examples.`,
    ).join(" ");

    repoMocks.retrieveTopicChunks.mockReset();
    repoMocks.summarizeTopic.mockReset();
    repoMocks.generateLlmResponse.mockReset();
    repoMocks.generateTamilResponse.mockReset();
    repoMocks.generateTeluguResponse.mockReset();
    repoMocks.generateLlmJson.mockReset();

    repoMocks.retrieveTopicChunks.mockResolvedValue([
      {
        text: "Fractions describe parts of a whole.",
        score: 0.9,
        grade: "class_5",
        subject: "Mathematics",
        chapter: "Fractions",
        page: 4,
        language: "en",
        source_file: "maths-class-5.pdf",
      },
    ]);

    repoMocks.summarizeTopic.mockResolvedValue({
      intro: "Today we will understand fractions in simple classroom language.",
      content: longContent,
      key_points: [
        "A fraction means part of one whole.",
        "Denominator tells total equal parts.",
        "Numerator tells selected parts.",
        "Equivalent fractions show the same value.",
      ],
      bridge: "Now we can try short MCQs on fractions.",
      word_count: 300,
      chunks_used: 3,
      images_base64: [],
      diagram_captions: ["This picture shows how a whole is split into equal parts."],
      exercise_chunks: [],
    });

    const envelope = questionEnvelope();
    repoMocks.generateLlmResponse.mockResolvedValue(envelope);
    repoMocks.generateTamilResponse.mockResolvedValue(envelope);
    repoMocks.generateTeluguResponse.mockResolvedValue(envelope);
    repoMocks.generateLlmJson.mockResolvedValue(JSON.parse(envelope));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns expected response shape for curriculum summarize", async () => {
    const response = await request(createApp()).post("/api/socratic/summarize").send({
      topic: "Fractions",
      subject: "Mathematics",
      className: "class_5",
      source: "curriculum",
      studentCount: 1,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      language: "en",
      classLevel: 5,
      sourceUsed: "curriculum",
      questionsPerStudent: 6,
      studentCount: 1,
      diagram_captions: ["This picture shows how a whole is split into equal parts."],
    });
    expect(Array.isArray(response.body.lines)).toBe(true);
    expect(response.body.lines.length).toBeGreaterThan(0);
    expect(Array.isArray(response.body.questions)).toBe(true);
    expect(response.body.questions.length).toBeGreaterThanOrEqual(5);
    expect(response.body.chunks_used).toBeGreaterThan(0);
  });

  it("fails the summarize request when question generation fails", async () => {
    const timeoutError = new AppError("Ollama did not respond within 25 seconds.", 504, "ollama");

    repoMocks.generateLlmJson.mockRejectedValue(timeoutError);
    repoMocks.generateLlmResponse.mockRejectedValue(timeoutError);
    repoMocks.generateTamilResponse.mockRejectedValue(timeoutError);
    repoMocks.generateTeluguResponse.mockRejectedValue(timeoutError);

    const response = await request(createApp()).post("/api/socratic/summarize").send({
      topic: "Fractions",
      subject: "Mathematics",
      className: "class_5",
      source: "curriculum",
      studentCount: 1,
    });

    expect(response.status).toBe(504);
    expect(response.body).toMatchObject({
      error: "Ollama did not respond within 25 seconds.",
      stage: "ollama",
    });
  });

  it("returns the summary immediately when questions are deferred", async () => {
    repoMocks.generateLlmJson.mockClear();
    repoMocks.generateLlmResponse.mockClear();
    repoMocks.generateTamilResponse.mockClear();
    repoMocks.generateTeluguResponse.mockClear();

    const response = await request(createApp()).post("/api/socratic/summarize").send({
      topic: "Fractions",
      subject: "Mathematics",
      className: "class_5",
      source: "curriculum",
      studentCount: 1,
      includeQuestions: false,
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.lines)).toBe(true);
    expect(response.body.lines.length).toBeGreaterThan(0);
    expect(response.body.questions).toEqual([]);
    expect(repoMocks.generateLlmJson).not.toHaveBeenCalled();
    expect(repoMocks.generateLlmResponse).not.toHaveBeenCalled();
    expect(repoMocks.generateTamilResponse).not.toHaveBeenCalled();
    expect(repoMocks.generateTeluguResponse).not.toHaveBeenCalled();
  });

  it("builds questions from an existing summary without regenerating it", async () => {
    repoMocks.summarizeTopic.mockClear();

    const response = await request(createApp())
      .post("/api/socratic/questions")
      .send({
        topic: "Fractions",
        subject: "Mathematics",
        className: "class_5",
        studentCount: 1,
        language: "en",
        summaryLines: [
          "Fractions describe parts of a whole.",
          "The denominator tells how many equal parts make the whole.",
          "Equivalent fractions can show the same value.",
        ],
        exerciseChunks: [{ text: "Compare fractions using common denominators.", page: 4 }],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      language: "en",
      classLevel: 5,
      questionsPerStudent: 6,
      studentCount: 1,
    });
    expect(Array.isArray(response.body.questions)).toBe(true);
    expect(response.body.questions.length).toBeGreaterThanOrEqual(5);
    expect(repoMocks.summarizeTopic).not.toHaveBeenCalled();
  });
});
