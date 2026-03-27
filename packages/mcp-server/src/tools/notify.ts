import {
  type NotifyPayload,
  type ApiResponse,
  NotificationPriority,
  SessionSource,
} from "../types.js";

const MIDDLEWARE_BASE =
  process.env.CLAWPILOT_SERVER_URL ?? "http://localhost:3978";

/**
 * Sends a notification to the user via Teams.
 * Fire-and-forget — does not wait for a user response.
 */
export async function notifyUser(args: {
  sessionId: string;
  message: string;
  label?: string;
  priority?: string;
  source?: string;
}): Promise<{ success: boolean }> {
  const payload: NotifyPayload = {
    sessionId: args.sessionId,
    message: args.message,
    label: args.label,
    priority:
      (args.priority as NotificationPriority) ?? NotificationPriority.Normal,
    source: (args.source as SessionSource) ?? SessionSource.VSCode,
  };

  const res = await fetch(`${MIDDLEWARE_BASE}/api/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await res.json()) as ApiResponse;
  if (!body.ok) {
    throw new Error(`notify failed: ${body.error ?? "unknown error"}`);
  }
  return { success: true };
}
