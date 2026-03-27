import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import {
  createRespondRouter,
  type RespondRoutesDeps,
} from "./respond.js";
import { MessageQueue } from "../messageQueue.js";
import { SessionManager } from "../sessions.js";

function buildApp(overrides: Partial<RespondRoutesDeps> = {}) {
  const deps: RespondRoutesDeps = {
    queue: new MessageQueue(),
    sessions: new SessionManager(),
    ...overrides,
  };
  const app = express();
  app.use(createRespondRouter(deps));
  return { app, ...deps };
}

describe("Respond Routes", () => {
  describe("GET /respond/:correlationId", () => {
    it("returns 404 page when question not found", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/respond/unknown-id");

      expect(res.status).toBe(404);
      expect(res.text).toContain("Question Not Found");
    });

    it("renders question form for pending ask", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "What color do you prefer?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue });

      const res = await request(app).get("/respond/c1");

      expect(res.status).toBe(200);
      expect(res.text).toContain("What color do you prefer?");
      expect(res.text).toContain("Input Needed");
      expect(res.text).toContain('action="/respond/c1"');
    });

    it("renders option buttons when options provided", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "Pick one",
        options: ["Red", "Blue"],
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue });

      const res = await request(app).get("/respond/c1");

      expect(res.text).toContain("Red");
      expect(res.text).toContain("Blue");
      expect(res.text).toContain("option-btn");
    });

    it("escapes HTML in question text", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: '<script>alert("xss")</script>',
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue });

      const res = await request(app).get("/respond/c1");

      expect(res.text).not.toContain("<script>");
      expect(res.text).toContain("&lt;script&gt;");
    });
  });

  describe("POST /respond/:correlationId", () => {
    it("accepts response and shows success page", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue });

      const res = await request(app)
        .post("/respond/c1")
        .type("form")
        .send({ response: "my answer" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Response Sent");
      expect(queue.getResponse("c1")).toBeDefined();
      expect(queue.getResponse("c1")!.response).toBe("my answer");
    });

    it("returns 400 when response is empty", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/respond/c1")
        .type("form")
        .send({ response: "" });

      expect(res.status).toBe(400);
      expect(res.text).toContain("cannot be empty");
    });

    it("returns 410 when question expired", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/respond/c1")
        .type("form")
        .send({ response: "too late" });

      expect(res.status).toBe(410);
      expect(res.text).toContain("expired");
    });

    it("updates session status to active after submit", async () => {
      const queue = new MessageQueue();
      const sessions = new SessionManager();
      sessions.getOrCreate("s1", "vscode");
      sessions.updateStatus("s1", "waiting_for_input");
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue, sessions });

      await request(app)
        .post("/respond/c1")
        .type("form")
        .send({ response: "done" });

      expect(sessions.get("s1")!.status).toBe("active");
    });
  });
});
