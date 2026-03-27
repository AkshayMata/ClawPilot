import dotenv from "dotenv";
import { resolve } from "path";

// Load .env from repo root (two levels up from packages/server/)
dotenv.config({ path: resolve(__dirname, "..", "..", "..", ".env") });

import express from "express";
import { execSync } from "child_process";
import { v4 as uuid } from "uuid";
import type { NotifyPayload, PendingAsk } from "@clawpilot/shared";
import { SessionManager } from "./sessions.js";
import { MessageQueue } from "./messageQueue.js";
import { ReplyInbox } from "./replyInbox.js";
import { createApiRouter } from "./routes/api.js";
import { createRespondRouter } from "./routes/respond.js";
import { sendTeamsWebhook } from "./webhook.js";
import { createOutgoingWebhookRouter } from "./routes/outgoingWebhook.js";
import { HeartbeatMonitor } from "./heartbeat.js";
import { ensurePublicUrl } from "./devTunnel.js";

const PORT = parseInt(process.env.PORT ?? "3978", 10);
let PUBLIC_URL = process.env.PUBLIC_URL ?? "";
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? "";
const AGENT_NAME = process.env.AGENT_NAME ?? "ClawPilot";

// ── Core services ────────────────────────────────────────────
const sessions = new SessionManager();
const queue = new MessageQueue();
const replyInbox = new ReplyInbox();
const heartbeat = new HeartbeatMonitor({ webhookUrl: TEAMS_WEBHOOK_URL });

// ── Resolve local user's AAD Object ID for auth ─────────────
function resolveLocalAadId(): string | undefined {
  try {
    const id = execSync("az ad signed-in-user show --query id -o tsv", {
      timeout: 10_000,
      encoding: "utf-8",
    }).trim();
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      console.log(`[Auth] Local AAD Object ID: ${id}`);
      return id;
    }
  } catch {
    console.warn("[Auth] Could not resolve local AAD ID (az cli not available or not signed in). Auth check disabled.");
  }
  return undefined;
}
const LOCAL_AAD_ID = resolveLocalAadId();

// ── Notification & question handlers ─────────────────────────
async function sendNotification(payload: NotifyPayload): Promise<void> {
  console.log(`[ClawPilot] Notification: ${payload.message}`);
  if (TEAMS_WEBHOOK_URL) {
    const correlationId = uuid();
    const session = sessions.get(payload.sessionId);
    await sendTeamsWebhook(TEAMS_WEBHOOK_URL, {
      type: "notification",
      title: `${payload.priority ?? "normal"} priority`,
      message: payload.message,
      sessionId: payload.sessionId,
      agentName: AGENT_NAME,
      sessionLabel: session?.label ?? payload.label,
      correlationId,
      callbackUrl: `${PUBLIC_URL}/api/reply`,
    });
  }
}

async function sendQuestion(ask: PendingAsk): Promise<void> {
  const responseUrl = `${PUBLIC_URL}/respond/${encodeURIComponent(ask.correlationId)}`;
  console.log(`[ClawPilot] Question for user: ${ask.question}`);
  console.log(`[ClawPilot] Respond at: ${responseUrl}`);
  if (TEAMS_WEBHOOK_URL) {
    const session = sessions.get(ask.sessionId);
    await sendTeamsWebhook(TEAMS_WEBHOOK_URL, {
      type: "question",
      title: "Input Needed",
      message: ask.question,
      sessionId: ask.sessionId,
      agentName: AGENT_NAME,
      sessionLabel: session?.label,
      correlationId: ask.correlationId,
      callbackUrl: `${PUBLIC_URL}/api/reply`,
      responseUrl,
      options: ask.options,
    });
  }
}

// ── Express app ──────────────────────────────────────────────
const app = express();

// ── Outgoing Webhook endpoint (must be before API router) ────
// Teams sends @mention messages here; needs raw body for HMAC
app.use(
  createOutgoingWebhookRouter({
    queue,
    replyInbox,
    sessions,
    allowedAadId: LOCAL_AAD_ID,
  })
);

// API routes (notify, ask, respond via API, sessions, health)
app.use(
  createApiRouter({
    sessions,
    queue,
    replyInbox,
    heartbeat,
    sendNotification,
    sendQuestion,
  })
);

// Response web UI (user clicks link from Teams → sees question → responds)
app.use(
  createRespondRouter({
    queue,
    sessions,
  })
);

// ── Start ────────────────────────────────────────────────────
async function main() {
  // Resolve public URL (auto-tunnel or env)
  try {
    const tunnel = await ensurePublicUrl(PORT);
    PUBLIC_URL = tunnel.url;
    if (tunnel.managed) {
      console.log(`[Tunnel] Auto-provisioned dev tunnel: ${PUBLIC_URL}`);
    }
  } catch (err) {
    // If no PUBLIC_URL is set at all, fall back to localhost (dev-only)
    if (!PUBLIC_URL) {
      PUBLIC_URL = `http://localhost:${PORT}`;
      console.warn(`[Tunnel] ${(err as Error).message}`);
      console.warn(`[Tunnel] Falling back to ${PUBLIC_URL} — outgoing webhook will not work from Teams.`);
    }
  }

  app.listen(PORT, () => {
    heartbeat.start();
    const webhookCallbackUrl = `${PUBLIC_URL}/api/outgoing-webhook`;
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║         \u{1F980}\u{1F916} ClawPilot Server v0.1.0                              ║
╠══════════════════════════════════════════════════════════════════╣
║  Local:     http://localhost:${PORT}                                ║
║  Public:    ${PUBLIC_URL.padEnd(51)}║
║  Health:    http://localhost:${PORT}/api/health                      ║
╠══════════════════════════════════════════════════════════════════╣
║  \u{1F449} Outgoing Webhook URL (paste into Teams):                       ║
║  ${webhookCallbackUrl.padEnd(63)}║
╚══════════════════════════════════════════════════════════════════╝

${  TEAMS_WEBHOOK_URL
    ? `✔ Teams webhook configured\n  Agent:    ${AGENT_NAME}`
    : `⚠ No TEAMS_WEBHOOK_URL set — notifications logged to console only.
  Create an Incoming Webhook in Teams and add the URL to .env`
}
    `);
  });
}

main().catch((err) => {
  console.error("Failed to start ClawPilot server:", err);
  process.exit(1);
});
