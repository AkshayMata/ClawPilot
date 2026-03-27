import { Router, json } from "express";
import type {
  NotifyPayload,
  AskPayload,
  UserResponse,
  ApiResponse,
  PendingAsk,
} from "@clawpilot/shared";
import { SessionStatus } from "@clawpilot/shared";
import type { SessionManager } from "../sessions.js";
import type { MessageQueue } from "../messageQueue.js";
import type { ReplyInbox } from "../replyInbox.js";
import type { HeartbeatMonitor } from "../heartbeat.js";

export interface RoutesDeps {
  sessions: SessionManager;
  queue: MessageQueue;
  replyInbox: ReplyInbox;
  heartbeat: HeartbeatMonitor;
  sendNotification: (payload: NotifyPayload) => Promise<void>;
  sendQuestion: (ask: PendingAsk) => Promise<void>;
}

export function createApiRouter(deps: RoutesDeps): Router {
  const router = Router();
  router.use(json());

  const { sessions, queue, replyInbox, heartbeat, sendNotification, sendQuestion } = deps;

  // ── POST /api/notify ───────────────────────────────────────
  router.post("/api/notify", async (req, res) => {
    try {
      const payload = req.body as NotifyPayload;
      if (!payload.sessionId || !payload.message) {
        res.status(400).json({
          ok: false,
          error: "sessionId and message are required",
        } satisfies ApiResponse);
        return;
      }

      sessions.getOrCreate(payload.sessionId, payload.source, payload.label);
      sessions.touch(payload.sessionId);

      await sendNotification(payload);

      res.json({ ok: true } satisfies ApiResponse);
    } catch (err) {
      console.error("POST /api/notify error:", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "internal error",
      } satisfies ApiResponse);
    }
  });

  // ── POST /api/ask ──────────────────────────────────────────
  router.post("/api/ask", async (req, res) => {
    try {
      const payload = req.body as AskPayload;
      if (!payload.correlationId || !payload.sessionId || !payload.question) {
        res.status(400).json({
          ok: false,
          error: "correlationId, sessionId, and question are required",
        } satisfies ApiResponse);
        return;
      }

      const session = sessions.getOrCreate(
        payload.sessionId,
        payload.source,
        payload.label
      );
      sessions.updateStatus(payload.sessionId, SessionStatus.WaitingForInput);

      const pendingAsk: PendingAsk = {
        correlationId: payload.correlationId,
        sessionId: payload.sessionId,
        question: payload.question,
        options: payload.options,
        askedAt: new Date().toISOString(),
        timeoutMs: payload.timeoutMs ?? 300_000,
      };

      queue.addPending(pendingAsk);
      await sendQuestion(pendingAsk);

      res.json({ ok: true } satisfies ApiResponse);
    } catch (err) {
      console.error("POST /api/ask error:", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "internal error",
      } satisfies ApiResponse);
    }
  });

  // ── GET /api/ask/:correlationId/response ───────────────────
  router.get("/api/ask/:correlationId/response", (req, res) => {
    const { correlationId } = req.params;
    const response = queue.getResponse(correlationId);
    if (!response) {
      res.status(404).json({
        ok: false,
        error: "no response yet",
      } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: response } satisfies ApiResponse<UserResponse>);
  });

  // ── POST /api/respond ──────────────────────────────────────
  // Called when the user submits an answer via the web UI or API
  router.post("/api/respond", (req, res) => {
    try {
      const response = req.body as UserResponse;
      if (!response.correlationId || !response.response) {
        res.status(400).json({
          ok: false,
          error: "correlationId and response are required",
        } satisfies ApiResponse);
        return;
      }

      response.respondedAt = new Date().toISOString();

      const accepted = queue.submitResponse(response);
      if (!accepted) {
        res.status(410).json({
          ok: false,
          error: "question expired or unknown correlationId",
        } satisfies ApiResponse);
        return;
      }

      // Move session back to active
      if (response.sessionId) {
        sessions.updateStatus(response.sessionId, SessionStatus.Active);
      }

      res.json({ ok: true } satisfies ApiResponse);
    } catch (err) {
      console.error("POST /api/respond error:", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "internal error",
      } satisfies ApiResponse);
    }
  });

  // ── POST /api/reply ────────────────────────────────────────
  // Called by Power Automate when a user replies to a ClawPilot
  // message in Teams. Works for both notification and question cards.
  router.post("/api/reply", (req, res) => {
    try {
      const { correlationId, response: responseText, agentName } = req.body as {
        correlationId?: string;
        response?: string;
        agentName?: string;
      };

      if (!correlationId || !responseText) {
        res.status(400).json({
          ok: false,
          error: "correlationId and response are required",
        } satisfies ApiResponse);
        return;
      }

      const trimmed = responseText
        .replace(/<[^>]*>/g, "")   // strip HTML tags from Teams
        .replace(/^🦀🦀\s*/, "")   // strip ClawPilot tag prefix
        .trim();
      console.log(
        `[Reply] From Teams (agent: ${agentName ?? "unknown"}) for ${correlationId}: ${trimmed.slice(0, 80)}`
      );

      // Try to match to a pending ask_user question first
      const pending = queue.getPending(correlationId);
      if (pending) {
        const userResponse: UserResponse = {
          correlationId,
          sessionId: pending.sessionId,
          response: trimmed,
          respondedAt: new Date().toISOString(),
        };
        queue.submitResponse(userResponse);
        if (pending.sessionId) {
          sessions.updateStatus(pending.sessionId, SessionStatus.Active);
        }
      }

      // Always store in the reply inbox so the agent can poll it
      replyInbox.add({
        correlationId,
        response: trimmed,
        receivedAt: new Date().toISOString(),
      });

      res.json({ ok: true } satisfies ApiResponse);
    } catch (err) {
      console.error("POST /api/reply error:", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "internal error",
      } satisfies ApiResponse);
    }
  });

  // ── GET /api/replies ───────────────────────────────────────
  // Poll for replies from Teams. Returns and clears all pending replies.
  router.get("/api/replies", (_req, res) => {
    const replies = replyInbox.drain();
    res.json({ ok: true, data: replies } satisfies ApiResponse);
  });

  // ── GET /api/replies/peek ───────────────────────────────────
  // Peek at replies without clearing them.
  router.get("/api/replies/peek", (_req, res) => {
    const replies = replyInbox.peek();
    res.json({ ok: true, data: replies } satisfies ApiResponse);
  });

  // ── GET /api/replies/wait ──────────────────────────────────
  // Long-poll: holds connection until a reply arrives or timeout.
  // Query: ?timeout=300 (seconds, default 300, max 600)
  router.get("/api/replies/wait", async (req, res) => {
    const timeoutSec = Math.min(
      Math.max(parseInt(String(req.query.timeout ?? "300"), 10) || 300, 1),
      600
    );

    // Create an AbortController so the poll loop stops if the client disconnects
    const ac = new AbortController();
    // Listen on both req and res for close — different Express versions fire on different objects
    req.on("close", () => ac.abort());
    res.on("close", () => ac.abort());
    req.socket?.on("close", () => ac.abort());

    const replies = await replyInbox.waitForReply(timeoutSec * 1000, ac.signal);

    if (ac.signal.aborted) return; // client gone, don't write
    res.json({ ok: true, data: replies } satisfies ApiResponse);
  });

  // ── GET /api/sessions ──────────────────────────────────────
  router.get("/api/sessions", (_req, res) => {
    res.json({
      ok: true,
      data: sessions.listAll(),
    } satisfies ApiResponse);
  });

  // ── POST /api/heartbeat ────────────────────────────────────
  // Agent sends periodic heartbeats so the server can detect disconnections.
  router.post("/api/heartbeat", (req, res) => {
    const status = typeof req.body?.status === "string" ? req.body.status : undefined;
    heartbeat.beat({ status });
    res.json({ ok: true } satisfies ApiResponse);
  });

  // ── GET /api/heartbeat ─────────────────────────────────────
  router.get("/api/heartbeat", (_req, res) => {
    res.json({ ok: true, data: heartbeat.getStatus() } satisfies ApiResponse);
  });

  // ── Health check ───────────────────────────────────────────
  router.get("/api/health", (_req, res) => {
    res.json({ ok: true, data: { uptime: process.uptime(), activePollers: replyInbox.activePollers, pendingReplies: replyInbox.count } });
  });

  // ── DELETE /api/replies/pollers ────────────────────────────
  // Kill all active long-poll connections (zombie cleanup)
  router.delete("/api/replies/pollers", (_req, res) => {
    const killed = replyInbox.abortAllPollers();
    console.log(`[API] Killed ${killed} zombie pollers`);
    res.json({ ok: true, data: { killed } } satisfies ApiResponse);
  });

  return router;
}
