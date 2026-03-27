import {
  type AskPayload,
  type ApiResponse,
  type UserResponse,
  SessionSource,
} from "../types.js";
import { randomUUID } from "node:crypto";

const MIDDLEWARE_BASE =
  process.env.CLAWPILOT_SERVER_URL ?? "http://localhost:3978";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2_000; // 2 seconds

/**
 * Sends a question to the user via Teams and polls until they respond.
 * Returns the user's text response.
 */
export async function askUser(args: {
  sessionId: string;
  question: string;
  label?: string;
  source?: string;
  options?: string[];
  timeoutMs?: number;
}): Promise<{ response: string }> {
  const correlationId = randomUUID();
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const payload: AskPayload = {
    correlationId,
    sessionId: args.sessionId,
    question: args.question,
    label: args.label,
    source: (args.source as SessionSource) ?? SessionSource.VSCode,
    options: args.options,
    timeoutMs,
  };

  // Submit the question
  const res = await fetch(`${MIDDLEWARE_BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await res.json()) as ApiResponse;
  if (!body.ok) {
    throw new Error(`ask failed: ${body.error ?? "unknown error"}`);
  }

  // Poll for the response
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(
      `${MIDDLEWARE_BASE}/api/ask/${encodeURIComponent(correlationId)}/response`
    );
    if (pollRes.status === 200) {
      const pollBody = (await pollRes.json()) as ApiResponse<UserResponse>;
      if (pollBody.ok && pollBody.data) {
        return { response: pollBody.data.response };
      }
    }
    // 404 = not yet answered, keep polling
    if (pollRes.status !== 404) {
      const errBody = (await pollRes.json()) as ApiResponse;
      throw new Error(
        `poll error: ${errBody.error ?? `status ${pollRes.status}`}`
      );
    }
  }

  throw new Error(
    `ask_user timed out after ${timeoutMs / 1000}s with no response`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
