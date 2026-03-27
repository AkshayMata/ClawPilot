import type { ApiResponse, CopilotSession } from "../types.js";

const MIDDLEWARE_BASE =
  process.env.CLAWPILOT_SERVER_URL ?? "http://localhost:3978";

/**
 * Lists all active Copilot sessions tracked by the middleware.
 */
export async function listSessions(): Promise<{
  sessions: CopilotSession[];
}> {
  const res = await fetch(`${MIDDLEWARE_BASE}/api/sessions`);
  const body = (await res.json()) as ApiResponse<CopilotSession[]>;
  if (!body.ok) {
    throw new Error(
      `list_sessions failed: ${body.error ?? "unknown error"}`
    );
  }
  return { sessions: body.data ?? [] };
}
