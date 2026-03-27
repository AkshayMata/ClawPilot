import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { SessionSource } from "@clawpilot/shared";
import { createApiRouter, type RoutesDeps } from "./api.js";
import { MessageQueue } from "../messageQueue.js";
import { ReplyInbox } from "../replyInbox.js";
import { SessionManager } from "../sessions.js";
import { HeartbeatMonitor } from "../heartbeat.js";

vi.mock("../webhook.js", () => ({
  sendTeamsWebhook: vi.fn().mockResolvedValue(undefined),
}));

function buildApp(overrides: Partial<RoutesDeps> = {}) {
  const deps: RoutesDeps = {
    sessions: new SessionManager(),
    queue: new MessageQueue(),
    replyInbox: new ReplyInbox(),
    heartbeat: new HeartbeatMonitor({ webhookUrl: "" }),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendQuestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const app = express();
  app.use(createApiRouter(deps));
  return { app, ...deps };
}

describe("API Routes", () => {
  describe("POST /api/notify", () => {
    it("sends a notification and returns ok", async () => {
      const { app, sendNotification } = buildApp();

      const res = await request(app).post("/api/notify").send({
        sessionId: "s1",
        message: "Build done",
        source: "vscode",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(sendNotification).toHaveBeenCalledOnce();
    });

    it("creates session on notify", async () => {
      const { app, sessions } = buildApp();

      await request(app).post("/api/notify").send({
        sessionId: "s1",
        message: "hi",
        source: "vscode",
        label: "My Label",
      });

      const session = sessions.get("s1");
      expect(session).toBeDefined();
      expect(session!.label).toBe("My Label");
    });

    it("returns 400 when sessionId is missing", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/notify")
        .send({ message: "hi" });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns 400 when message is missing", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/notify")
        .send({ sessionId: "s1" });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns 500 when sendNotification throws", async () => {
      const { app } = buildApp({
        sendNotification: vi.fn().mockRejectedValue(new Error("net error")),
      });

      const res = await request(app).post("/api/notify").send({
        sessionId: "s1",
        message: "hi",
      });

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain("net error");
    });
  });

  describe("POST /api/ask", () => {
    it("submits a question and returns ok", async () => {
      const { app, sendQuestion, queue } = buildApp();

      const res = await request(app).post("/api/ask").send({
        correlationId: "c1",
        sessionId: "s1",
        question: "Yes or no?",
        source: "vscode",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(sendQuestion).toHaveBeenCalledOnce();
      expect(queue.getPending("c1")).toBeDefined();
    });

    it("returns 400 when required fields missing", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/ask")
        .send({ sessionId: "s1" });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("sets session status to waiting_for_input", async () => {
      const { app, sessions } = buildApp();

      await request(app).post("/api/ask").send({
        correlationId: "c1",
        sessionId: "s1",
        question: "?",
        source: "vscode",
      });

      expect(sessions.get("s1")!.status).toBe("waiting_for_input");
    });
  });

  describe("GET /api/ask/:correlationId/response", () => {
    it("returns 404 when no response yet", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/api/ask/c1/response");

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
    });

    it("returns the response when available", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      queue.submitResponse({
        correlationId: "c1",
        sessionId: "s1",
        response: "yes",
        respondedAt: new Date().toISOString(),
      });

      const { app } = buildApp({ queue });

      const res = await request(app).get("/api/ask/c1/response");

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.response).toBe("yes");
    });
  });

  describe("POST /api/respond", () => {
    it("submits a response to a pending ask", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue });

      const res = await request(app).post("/api/respond").send({
        correlationId: "c1",
        sessionId: "s1",
        response: "yes",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(queue.getResponse("c1")).toBeDefined();
    });

    it("returns 400 when fields missing", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/respond")
        .send({ correlationId: "c1" });

      expect(res.status).toBe(400);
    });

    it("returns 410 when question expired", async () => {
      const { app } = buildApp();

      const res = await request(app).post("/api/respond").send({
        correlationId: "unknown",
        response: "yes",
      });

      expect(res.status).toBe(410);
      expect(res.body.ok).toBe(false);
    });
  });

  describe("POST /api/reply", () => {
    it("stores reply in inbox", async () => {
      const { app, replyInbox } = buildApp();

      const res = await request(app).post("/api/reply").send({
        correlationId: "corr-1",
        response: "got it",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(replyInbox.drain()).toHaveLength(1);
    });

    it("routes to matching pending ask", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "c1",
        sessionId: "s1",
        question: "?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });
      const { app } = buildApp({ queue });

      await request(app).post("/api/reply").send({
        correlationId: "c1",
        response: "done",
      });

      expect(queue.getResponse("c1")).toBeDefined();
    });

    it("strips HTML tags from response", async () => {
      const { app, replyInbox } = buildApp();

      await request(app).post("/api/reply").send({
        correlationId: "c1",
        response: "<b>bold</b> text",
      });

      const replies = replyInbox.drain();
      expect(replies[0].response).toBe("bold text");
    });

    it("returns 400 when fields missing", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/reply")
        .send({ correlationId: "c1" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/replies", () => {
    it("drains all replies", async () => {
      const replyInbox = new ReplyInbox();
      replyInbox.add({
        correlationId: "c1",
        response: "r1",
        receivedAt: new Date().toISOString(),
      });
      const { app } = buildApp({ replyInbox });

      const res = await request(app).get("/api/replies");

      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveLength(1);
      // Should be drained
      expect(replyInbox.count).toBe(0);
    });
  });

  describe("GET /api/replies/peek", () => {
    it("returns replies without draining", async () => {
      const replyInbox = new ReplyInbox();
      replyInbox.add({
        correlationId: "c1",
        response: "r1",
        receivedAt: new Date().toISOString(),
      });
      const { app } = buildApp({ replyInbox });

      const res = await request(app).get("/api/replies/peek");

      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(replyInbox.count).toBe(1); // not drained
    });
  });

  describe("GET /api/sessions", () => {
    it("returns empty array initially", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/api/sessions");

      expect(res.body.ok).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("returns sessions after creation", async () => {
      const sessions = new SessionManager();
      sessions.getOrCreate("s1", SessionSource.VSCode, "Label");
      const { app } = buildApp({ sessions });

      const res = await request(app).get("/api/sessions");

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe("s1");
    });
  });

  describe("POST /api/heartbeat", () => {
    it("accepts heartbeat", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/heartbeat")
        .send({ status: "active" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe("GET /api/heartbeat", () => {
    it("returns heartbeat status", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/api/heartbeat");

      expect(res.body.ok).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.lastStatus).toBeDefined();
    });
  });

  describe("GET /api/health", () => {
    it("returns uptime, activePollers, pendingReplies", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/api/health");

      expect(res.body.ok).toBe(true);
      expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.data.activePollers).toBe(0);
      expect(res.body.data.pendingReplies).toBe(0);
    });
  });

  describe("DELETE /api/replies/pollers", () => {
    it("returns killed count", async () => {
      const { app } = buildApp();

      const res = await request(app).delete("/api/replies/pollers");

      expect(res.body.ok).toBe(true);
      expect(res.body.data.killed).toBe(0);
    });
  });
});
