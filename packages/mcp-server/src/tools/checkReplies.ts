import type { ApiResponse } from "../types.js";

const MIDDLEWARE_BASE =
  process.env.CLAWPILOT_SERVER_URL ?? "http://localhost:3978";

interface InboxReply {
  correlationId: string;
  response: string;
  receivedAt: string;
}

/**
 * Drains all pending replies from the inbox.
 * Returns any messages that came in via the Teams outgoing webhook.
 */
export async function checkReplies(): Promise<{ replies: InboxReply[] }> {
  const res = await fetch(`${MIDDLEWARE_BASE}/api/replies`);
  const body = (await res.json()) as ApiResponse<InboxReply[]>;
  if (!body.ok) {
    throw new Error(`check_replies failed: ${body.error ?? "unknown error"}`);
  }
  return { replies: body.data ?? [] };
}
