/**
 * Teams Outgoing Webhook handler.
 *
 * When a user @mentions the outgoing webhook in a Teams channel,
 * Teams POSTs the message here. We validate the HMAC signature,
 * extract the reply text, and route it into the reply inbox.
 *
 * Teams outgoing webhook payload shape:
 * {
 *   type: "message",
 *   text: "<at>ClawPilot</at> the actual message",
 *   from: { id, name },
 *   channelData: { ... },
 *   ...
 * }
 *
 * We must respond with a JSON object: { type: "message", text: "..." }
 */
import { Router, json } from "express";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import type { MessageQueue } from "../messageQueue.js";
import type { ReplyInbox } from "../replyInbox.js";
import type { SessionManager } from "../sessions.js";
import type { UserResponse } from "@clawpilot/shared";
import { SessionStatus } from "@clawpilot/shared";

export interface OutgoingWebhookDeps {
  queue: MessageQueue;
  replyInbox: ReplyInbox;
  sessions: SessionManager;
  /** When set, only messages from this AAD object ID are accepted. */
  allowedAadId?: string;
}

export function createOutgoingWebhookRouter(deps: OutgoingWebhookDeps): Router {
  const router = Router();

  // Parse JSON but keep the raw body buffer for HMAC validation
  router.use(
    "/api/outgoing-webhook",
    json({
      verify: (req: Request, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  const { queue, replyInbox, sessions, allowedAadId } = deps;
  const WEBHOOK_SECRET = process.env.OUTGOING_WEBHOOK_SECRET ?? "";

  router.post("/api/outgoing-webhook", (req, res) => {
    // ── HMAC Validation ────────────────────────────────────
    if (WEBHOOK_SECRET) {
      const authHeader = (req.headers["authorization"] ?? req.headers["Authorization"]) as string | undefined;
      if (!authHeader || !authHeader.startsWith("HMAC ")) {
        console.warn("[OutgoingWebhook] Missing or invalid Authorization header");
      } else {
        const providedHmac = authHeader.slice(5); // strip "HMAC "
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!rawBody) {
          console.warn("[OutgoingWebhook] No raw body captured for HMAC");
          res.status(401).json({ type: "message", text: "Unauthorized" });
          return;
        }
        const secretBuf = Buffer.from(WEBHOOK_SECRET, "base64");
        const computedHmac = createHmac("sha256", secretBuf)
          .update(rawBody)
          .digest("base64");

        // Timing-safe comparison
        const a = Buffer.from(providedHmac, "utf8");
        const b = Buffer.from(computedHmac, "utf8");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          console.warn("[OutgoingWebhook] HMAC mismatch");
          res.status(401).json({ type: "message", text: "Unauthorized" });
          return;
        }
      }
    }

    // ── AAD Identity Check ─────────────────────────────────
    if (allowedAadId) {
      const senderAad = (req.body as { from?: { aadObjectId?: string } })?.from?.aadObjectId;
      if (!senderAad || senderAad !== allowedAadId) {
        console.warn(`[OutgoingWebhook] AAD mismatch: sender=${senderAad ?? "none"} allowed=${allowedAadId}`);
        res.json({
          type: "message",
          text: "🦀🤖 Unauthorized — your AAD identity doesn't match the allowed user for this agent.",
        });
        return;
      }
    }

    try {
      const activity = req.body as {
        type?: string;
        text?: string;
        from?: { id?: string; name?: string; aadObjectId?: string };
        replyToId?: string;
        channelData?: Record<string, unknown>;
        value?: Record<string, unknown>;
      };

      const rawText = activity.text ?? "";
      // Strip the @mention tag: "<at>BotName</at> actual message"
      // Also decode HTML entities and strip remaining tags
      const cleanText = rawText
        .replace(/<at>[^<]*<\/at>\s*/gi, "")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      if (!cleanText) {
        res.json({
          type: "message",
          text: "🦀🤖 Got an empty message. Please include your reply after @mentioning me.",
        });
        return;
      }

      const senderName = activity.from?.name ?? "unknown";
      const senderId = activity.from?.id ?? "unknown";
      const senderAadId = activity.from?.aadObjectId ?? "unknown";
      const tenantId = (activity.channelData as Record<string, Record<string, string>> | undefined)?.tenant?.id ?? "unknown";
      console.log(`[OutgoingWebhook] from: ${JSON.stringify(activity.from)}`);
      console.log(`[OutgoingWebhook] channelData.tenant: ${JSON.stringify((activity.channelData as Record<string, unknown>)?.tenant)}`);
      console.log(`[OutgoingWebhook] Message from ${senderName} (aadObjectId=${senderAadId}, tenant=${tenantId}): ${cleanText.slice(0, 100)}`);

      // Try to find a correlationId from the message text itself
      // (user might paste it, or it could be in replied-to context)
      const correlationMatch = cleanText.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      );

      // Check channelData for parent message metadata
      let correlationId: string | undefined;
      const channelDataStr = JSON.stringify(activity.channelData ?? {});
      const metadataMatch = channelDataStr.match(
        /<!--clawpilot:https?:\/\/[^|]+\|([0-9a-f-]{36})-->/
      );
      if (metadataMatch) {
        correlationId = metadataMatch[1];
      }

      // Fall back to the most recent pending question if no correlation found
      if (!correlationId) {
        const pendingList = queue.listPending();
        if (pendingList.length === 1) {
          correlationId = pendingList[0].correlationId;
        }
      }

      const finalCorrelationId = correlationId ?? "outgoing-webhook";

      // Try to match to a pending ask_user question
      if (correlationId) {
        const pending = queue.getPending(correlationId);
        if (pending) {
          const userResponse: UserResponse = {
            correlationId,
            sessionId: pending.sessionId,
            response: cleanText,
            respondedAt: new Date().toISOString(),
          };
          queue.submitResponse(userResponse);
          if (pending.sessionId) {
            sessions.updateStatus(pending.sessionId, SessionStatus.Active);
          }
        }
      }

      // Always store in reply inbox
      replyInbox.add({
        correlationId: finalCorrelationId,
        response: cleanText,
        receivedAt: new Date().toISOString(),
      });

      res.json({
        type: "message",
        text: `🦀🤖 Reply received from ${senderName} and forwarded to the agent.`,
      });
    } catch (err) {
      console.error("[OutgoingWebhook] Error:", err);
      res.json({
        type: "message",
        text: "🦀🤖 Something went wrong processing that message.",
      });
    }
  });

  return router;
}
