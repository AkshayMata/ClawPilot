import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import {
  createOutgoingWebhookRouter,
  type OutgoingWebhookDeps,
} from "./outgoingWebhook.js";
import { MessageQueue } from "../messageQueue.js";
import { ReplyInbox } from "../replyInbox.js";
import { SessionManager } from "../sessions.js";

function buildApp(overrides: Partial<OutgoingWebhookDeps> = {}) {
  const deps: OutgoingWebhookDeps = {
    queue: new MessageQueue(),
    replyInbox: new ReplyInbox(),
    sessions: new SessionManager(),
    ...overrides,
  };
  const app = express();
  app.use(createOutgoingWebhookRouter(deps));
  return { app, ...deps };
}

function teamsPayload(text: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    text,
    from: {
      id: "user-1",
      name: "Test User",
      aadObjectId: "aad-obj-id-123",
    },
    channelData: { tenant: { id: "tenant-1" } },
    ...overrides,
  };
}

describe("OutgoingWebhook Router", () => {
  beforeEach(() => {
    // Clear OUTGOING_WEBHOOK_SECRET for tests that don't need it
    delete process.env.OUTGOING_WEBHOOK_SECRET;
  });

  describe("text processing", () => {
    it("strips @mention tag and HTML entities", async () => {
      const { app, replyInbox } = buildApp();
      const body = teamsPayload(
        "<at>ClawPilot</at> hello &amp; world"
      );

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.text).toContain("Reply received from Test User");
      const replies = replyInbox.drain();
      expect(replies).toHaveLength(1);
      expect(replies[0].response).toBe("hello & world");
    });

    it("strips multiple HTML tags", async () => {
      const { app, replyInbox } = buildApp();

      await request(app)
        .post("/api/outgoing-webhook")
        .send(
          teamsPayload(
            "<at>Bot</at> <b>bold</b> &lt;script&gt; &quot;test&quot;"
          )
        );

      const replies = replyInbox.drain();
      expect(replies[0].response).toBe('bold <script> "test"');
    });

    it("returns empty-message warning when text is only @mention", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(teamsPayload("<at>ClawPilot</at>"));

      expect(res.status).toBe(200);
      expect(res.body.text).toContain("empty message");
    });

    it("returns empty-message warning for missing text", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(teamsPayload(""));

      expect(res.body.text).toContain("empty message");
    });
  });

  describe("reply routing", () => {
    it("stores reply in inbox with outgoing-webhook correlationId", async () => {
      const { app, replyInbox } = buildApp();

      await request(app)
        .post("/api/outgoing-webhook")
        .send(teamsPayload("<at>Bot</at> my reply"));

      const replies = replyInbox.drain();
      expect(replies).toHaveLength(1);
      expect(replies[0].correlationId).toBe("outgoing-webhook");
      expect(replies[0].response).toBe("my reply");
    });

    it("routes to pending ask when exactly one is queued", async () => {
      const queue = new MessageQueue();
      queue.addPending({
        correlationId: "corr-99",
        sessionId: "sess-1",
        question: "Yes or no?",
        askedAt: new Date().toISOString(),
        timeoutMs: 300_000,
      });

      const { app, replyInbox } = buildApp({ queue });

      await request(app)
        .post("/api/outgoing-webhook")
        .send(teamsPayload("<at>Bot</at> yes"));

      // Should have submitted response to queue
      expect(queue.getResponse("corr-99")).toBeDefined();
      expect(queue.getResponse("corr-99")!.response).toBe("yes");

      // And also stored in reply inbox
      const replies = replyInbox.drain();
      expect(replies[0].correlationId).toBe("corr-99");
    });

    it("extracts correlationId from hidden clawpilot metadata in channelData", async () => {
      const { app, replyInbox } = buildApp();
      const body = teamsPayload("<at>Bot</at> my answer", {
        channelData: {
          tenant: { id: "t1" },
          // Simulating clawpilot metadata in channelData
          extraField:
            "<!--clawpilot:https://example.com/api/reply|aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-->",
        },
      });

      await request(app).post("/api/outgoing-webhook").send(body);

      const replies = replyInbox.drain();
      expect(replies[0].correlationId).toBe(
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      );
    });
  });

  describe("AAD identity check", () => {
    it("rejects messages from non-matching AAD ID", async () => {
      const { app, replyInbox } = buildApp({
        allowedAadId: "allowed-aad-id",
      });

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(
          teamsPayload("<at>Bot</at> hello", {
            from: { id: "u1", name: "Other", aadObjectId: "wrong-aad-id" },
          })
        );

      expect(res.status).toBe(200);
      expect(res.body.text).toContain("Unauthorized");
      expect(replyInbox.drain()).toHaveLength(0);
    });

    it("rejects messages with no AAD ID when allowedAadId set", async () => {
      const { app, replyInbox } = buildApp({
        allowedAadId: "allowed-aad-id",
      });

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(
          teamsPayload("<at>Bot</at> hello", {
            from: { id: "u1", name: "Other" },
          })
        );

      expect(res.body.text).toContain("Unauthorized");
      expect(replyInbox.drain()).toHaveLength(0);
    });

    it("allows messages from matching AAD ID", async () => {
      const { app, replyInbox } = buildApp({
        allowedAadId: "correct-aad-id",
      });

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(
          teamsPayload("<at>Bot</at> hello", {
            from: {
              id: "u1",
              name: "Me",
              aadObjectId: "correct-aad-id",
            },
          })
        );

      expect(res.body.text).toContain("Reply received");
      expect(replyInbox.drain()).toHaveLength(1);
    });

    it("skips AAD check when allowedAadId is not set", async () => {
      const { app, replyInbox } = buildApp(); // no allowedAadId

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(teamsPayload("<at>Bot</at> open sesame"));

      expect(res.body.text).toContain("Reply received");
      expect(replyInbox.drain()).toHaveLength(1);
    });
  });

  describe("HMAC validation", () => {
    it("rejects when HMAC does not match", async () => {
      process.env.OUTGOING_WEBHOOK_SECRET =
        Buffer.from("test-secret").toString("base64");
      const { app } = buildApp();

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .set("Authorization", "HMAC invalidhmac")
        .send(teamsPayload("<at>Bot</at> hello"));

      expect(res.status).toBe(401);
      expect(res.body.text).toBe("Unauthorized");
    });

    it("accepts when HMAC matches", async () => {
      const secret = "test-secret-key";
      process.env.OUTGOING_WEBHOOK_SECRET =
        Buffer.from(secret).toString("base64");
      const { app, replyInbox } = buildApp();

      const payload = teamsPayload("<at>Bot</at> secure msg");
      const bodyStr = JSON.stringify(payload);
      const hmac = createHmac("sha256", Buffer.from(secret))
        .update(bodyStr)
        .digest("base64");

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .set("Authorization", `HMAC ${hmac}`)
        .set("Content-Type", "application/json")
        .send(bodyStr);

      expect(res.status).toBe(200);
      expect(res.body.text).toContain("Reply received");
      expect(replyInbox.drain()).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("returns error message on exception", async () => {
      const brokenQueue = {
        listPending: () => {
          throw new Error("boom");
        },
        getPending: () => undefined,
      } as unknown as MessageQueue;

      const { app } = buildApp({ queue: brokenQueue });

      const res = await request(app)
        .post("/api/outgoing-webhook")
        .send(teamsPayload("<at>Bot</at> hello"));

      expect(res.status).toBe(200);
      expect(res.body.text).toContain("Something went wrong");
    });
  });
});
