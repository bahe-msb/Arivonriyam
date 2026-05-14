import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app";

describe("health smoke", () => {
  it("returns ok payload from /api/health", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns ok payload from /health", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
