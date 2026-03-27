import { Router, json, urlencoded } from "express";
import type { MessageQueue } from "../messageQueue.js";
import type { SessionManager } from "../sessions.js";
import { SessionStatus, type ApiResponse } from "@clawpilot/shared";

export interface RespondRoutesDeps {
  queue: MessageQueue;
  sessions: SessionManager;
}

/**
 * Routes for the respond web UI.
 * Activator sends a Teams notification with a link like:
 *   {PUBLIC_URL}/respond/{correlationId}
 * User clicks → sees the question → types a response → submits.
 */
export function createRespondRouter(deps: RespondRoutesDeps): Router {
  const router = Router();
  router.use(json());
  router.use(urlencoded({ extended: true }));

  const { queue, sessions } = deps;

  // ── GET /respond/:correlationId — show the question form ───
  router.get("/respond/:correlationId", (req, res) => {
    const { correlationId } = req.params;
    const pending = queue.getPending(correlationId);

    if (!pending) {
      res.status(404).send(renderPage("Question Not Found",
        `<p>This question has expired or already been answered.</p>`
      ));
      return;
    }

    const optionButtons = pending.options?.length
      ? `<div class="options">${pending.options
          .map(
            (opt) =>
              `<button type="submit" name="response" value="${escapeHtml(opt)}" class="option-btn">${escapeHtml(opt)}</button>`
          )
          .join("\n")}</div>`
      : "";

    res.send(
      renderPage("ClawPilot — Input Needed", `
        <div class="card">
          <div class="header">🦀🤖 ClawPilot — Input Needed</div>
          <div class="session">Session: ${escapeHtml(pending.sessionId.slice(0, 8))}…</div>
          <div class="question">${escapeHtml(pending.question)}</div>
          <form method="POST" action="/respond/${encodeURIComponent(correlationId)}">
            ${optionButtons}
            <textarea name="response" placeholder="Type your response…" rows="4" required></textarea>
            <button type="submit" class="submit-btn">Send Response</button>
          </form>
        </div>
      `)
    );
  });

  // ── POST /respond/:correlationId — handle submission ───────
  router.post("/respond/:correlationId", async (req, res) => {
    const { correlationId } = req.params;
    const responseText: string =
      typeof req.body.response === "string" ? req.body.response.trim() : "";

    if (!responseText) {
      res.status(400).send(renderPage("Error",
        `<p>Response cannot be empty. <a href="/respond/${encodeURIComponent(correlationId)}">Go back</a></p>`
      ));
      return;
    }

    const pending = queue.getPending(correlationId);
    const sessionId = pending?.sessionId ?? "";

    const userResponse = {
      correlationId,
      sessionId,
      response: responseText,
      respondedAt: new Date().toISOString(),
    };

    const accepted = queue.submitResponse(userResponse);

    if (!accepted) {
      res.status(410).send(renderPage("Expired",
        `<p>This question has expired or was already answered.</p>`
      ));
      return;
    }

    // Update session status
    if (sessionId) {
      sessions.updateStatus(sessionId, SessionStatus.Active);
    }

    res.send(renderPage("Response Sent", `
      <div class="card success">
        <div class="header">✅ Response Sent</div>
        <p>Your response has been delivered to the Copilot session.</p>
        <div class="response-preview">"${escapeHtml(responseText)}"</div>
        <p class="subtle">You can close this tab.</p>
      </div>
    `));
  });

  return router;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #16213e;
      border-radius: 12px;
      padding: 24px;
      max-width: 600px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    .card.success { border-left: 4px solid #4caf50; }
    .header {
      font-size: 1.3em;
      font-weight: 700;
      margin-bottom: 8px;
      color: #fff;
    }
    .session { font-size: 0.85em; color: #888; margin-bottom: 16px; }
    .question {
      background: #0f3460;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 1.05em;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #1a1a2e;
      color: #e0e0e0;
      font-size: 1em;
      resize: vertical;
      margin-bottom: 12px;
    }
    textarea:focus { outline: none; border-color: #e94560; }
    .submit-btn {
      background: #e94560;
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 1em;
      cursor: pointer;
      width: 100%;
    }
    .submit-btn:hover { background: #c73e54; }
    .options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .option-btn {
      background: #0f3460;
      color: #e0e0e0;
      border: 1px solid #444;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.95em;
    }
    .option-btn:hover { background: #1a4a7a; border-color: #e94560; }
    .response-preview {
      background: #0f3460;
      padding: 12px;
      border-radius: 8px;
      margin: 12px 0;
      font-style: italic;
    }
    .subtle { color: #888; font-size: 0.85em; margin-top: 12px; }
    p { line-height: 1.6; }
    a { color: #e94560; }
  </style>
</head>
<body>${body}</body>
</html>`;
}
