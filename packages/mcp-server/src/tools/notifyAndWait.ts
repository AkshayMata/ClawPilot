import {
  type NotifyPayload,
  type ApiResponse,
  NotificationPriority,
  SessionSource,
} from "../types.js";

const MIDDLEWARE_BASE =
  process.env.CLAWPILOT_SERVER_URL ?? "http://localhost:3978";

const DEFAULT_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const LONG_POLL_SECONDS = 600; // 10 min per long-poll call

interface InboxReply {
  correlationId: string;
  response: string;
  receivedAt: string;
}

/**
 * Sends a notification to Teams and then waits for a reply using long-poll.
 * The user replies by @mentioning the outgoing webhook in the Teams channel.
 * Returns the first reply received, or times out.
 */
export async function notifyAndWait(args: {
  sessionId: string;
  message: string;
  label?: string;
  priority?: string;
  source?: string;
  timeoutMs?: number;
}): Promise<{ response: string; timedOut: boolean }> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Send the notification
  const payload: NotifyPayload = {
    sessionId: args.sessionId,
    message: args.message,
    label: args.label,
    priority:
      (args.priority as NotificationPriority) ?? NotificationPriority.Normal,
    source: (args.source as SessionSource) ?? SessionSource.VSCode,
  };

  // Kill any zombie pollers before we start waiting
  const healthRes = await fetch(`${MIDDLEWARE_BASE}/api/health`);
  const healthBody = (await healthRes.json()) as ApiResponse<{ activePollers: number }>;
  if (healthBody.ok && healthBody.data && healthBody.data.activePollers > 0) {
    console.error(`[notifyAndWait] Found ${healthBody.data.activePollers} active pollers — killing zombies`);
    await fetch(`${MIDDLEWARE_BASE}/api/replies/pollers`, { method: "DELETE" });
  }

  const res = await fetch(`${MIDDLEWARE_BASE}/api/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await res.json()) as ApiResponse;
  if (!body.ok) {
    throw new Error(`notify failed: ${body.error ?? "unknown error"}`);
  }

  // Check if a reply already arrived (fast responder)
  // If so, return it immediately instead of draining it
  const peekRes = await fetch(`${MIDDLEWARE_BASE}/api/replies/peek`);
  const peekBody = (await peekRes.json()) as ApiResponse<InboxReply[]>;
  if (peekBody.ok && peekBody.data && peekBody.data.length > 0) {
    // Drain and return the first reply
    const drainRes = await fetch(`${MIDDLEWARE_BASE}/api/replies`);
    const drainBody = (await drainRes.json()) as ApiResponse<InboxReply[]>;
    if (drainBody.ok && drainBody.data && drainBody.data.length > 0) {
      return { response: drainBody.data[0].response, timedOut: false };
    }
  }

  // Long-poll for a reply (re-issue on timeout)
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingSec = Math.ceil((deadline - Date.now()) / 1000);
    const pollSec = Math.min(LONG_POLL_SECONDS, remainingSec);
    if (pollSec <= 0) break;

    try {
      const pollRes = await fetch(
        `${MIDDLEWARE_BASE}/api/replies/wait?timeout=${pollSec}`
      );
      const pollBody = (await pollRes.json()) as ApiResponse<InboxReply[]>;
      if (pollBody.ok && pollBody.data && pollBody.data.length > 0) {
        return { response: pollBody.data[0].response, timedOut: false };
      }
    } catch {
      // Network error — wait briefly and retry
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return { response: "", timedOut: true };
}
