/**
 * Send Adaptive Card notifications to a Teams Incoming Webhook.
 *
 * Setup: Teams channel → ••• → Connectors → Incoming Webhook → create → copy URL.
 * Paste the URL into .env as TEAMS_WEBHOOK_URL.
 */

interface WebhookPayload {
  type: "notification" | "question";
  title: string;
  message: string;
  sessionId: string;
  agentName: string;
  /** Human-friendly session label (e.g. "DevBox-1 / ClawPilot") */
  sessionLabel?: string;
  correlationId?: string;
  callbackUrl?: string;
  responseUrl?: string;
  options?: string[];
}

/** Tracks the root message ID for threading replies in the same channel conversation. */
let currentThreadId: string | null = null;

export function getThreadId(): string | null {
  return currentThreadId;
}

export function clearThreadId(): void {
  currentThreadId = null;
}

export async function sendTeamsWebhook(
  webhookUrl: string,
  payload: WebhookPayload
): Promise<void> {
  const card = buildAdaptiveCard(payload);

  // Include threadId so the Power Automate flow can reply in-thread
  const envelope: Record<string, unknown> = { ...card };
  if (currentThreadId) {
    envelope.replyToId = currentThreadId;
  }

  // Power Automate "Post to a channel when a webhook request is received"
  // expects { type: "message", attachments: [{ contentType, content }] }
  // Classic Incoming Webhooks also accept this format.
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[Webhook] POST failed (${res.status}): ${text}`);
  } else {
    console.log(`[Webhook] ✔ Sent ${payload.type} to Teams`);

    // Try to capture the message ID for threading
    try {
      const text = await res.text().catch(() => "");
      if (text) {
        const parsed = JSON.parse(text);
        const msgId = parsed.messageId ?? parsed.id ?? parsed.MessageId;
        if (msgId && typeof msgId === "string") {
          if (!currentThreadId) {
            currentThreadId = msgId;
            console.log(`[Webhook] Thread started: ${msgId}`);
          }
        }
      }
    } catch {
      // Response wasn't JSON or didn't contain a message ID — that's fine
    }
  }
}

function buildAdaptiveCard(payload: WebhookPayload) {
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      size: "Medium",
      weight: "Bolder",
      text: `🦀🤖 ${payload.agentName} — ${payload.title}`,
      wrap: true,
    },
    {
      type: "TextBlock",
      text: payload.sessionLabel
        ? `${payload.sessionLabel}`
        : `Session: ${payload.sessionId.slice(0, 12)}…`,
      isSubtle: true,
      spacing: "None",
    },
    {
      type: "TextBlock",
      text: payload.message,
      wrap: true,
      spacing: "Medium",
    },
  ];

  const actions: Record<string, unknown>[] = [];

  if (payload.type === "question" && payload.responseUrl) {
    // Quick-reply option buttons (if any)
    if (payload.options?.length) {
      body.push({
        type: "TextBlock",
        text: "Quick options:",
        isSubtle: true,
        spacing: "Medium",
      });
      // Show options as a fact set for clarity
      body.push({
        type: "FactSet",
        facts: payload.options.map((opt, i) => ({
          title: `${i + 1}.`,
          value: opt,
        })),
      });
    }

    actions.push({
      type: "Action.OpenUrl",
      title: "Respond in Browser",
      url: payload.responseUrl,
    });

    body.push({
      type: "TextBlock",
      text: `Reply to this message to respond, or click the button above.`,
      spacing: "Medium",
      isSubtle: true,
      wrap: true,
    });
  }

  // Embed callback metadata on ALL cards so replies can route back
  if (payload.callbackUrl && payload.correlationId) {
    if (payload.type === "notification") {
      body.push({
        type: "TextBlock",
        text: `Reply to this message to send feedback to the agent.`,
        spacing: "Medium",
        isSubtle: true,
        wrap: true,
      });
    }
    body.push({
      type: "TextBlock",
      text: `<!--clawpilot:${payload.callbackUrl}|${payload.correlationId}-->`,
      isVisible: false,
    });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(actions.length > 0 ? { actions } : {}),
        },
      },
    ],
  };
}
