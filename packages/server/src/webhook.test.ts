import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendTeamsWebhook,
  getThreadId,
  clearThreadId,
} from "./webhook.js";

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  clearThreadId();
});

afterEach(() => {
  clearThreadId();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "notification" as const,
    title: "Test",
    message: "Hello",
    sessionId: "sess-1",
    agentName: "TestBot",
    ...overrides,
  };
}

describe("sendTeamsWebhook", () => {
  it("sends a POST with Adaptive Card JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await sendTeamsWebhook("https://example.com/webhook", basePayload());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/webhook");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.type).toBe("message");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].contentType).toBe(
      "application/vnd.microsoft.card.adaptive"
    );
  });

  it("includes agent name and title in card header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await sendTeamsWebhook(
      "https://example.com/webhook",
      basePayload({ agentName: "MyBot", title: "Alert" })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const headerBlock = body.attachments[0].content.body[0];
    expect(headerBlock.text).toContain("MyBot");
    expect(headerBlock.text).toContain("Alert");
  });

  it("uses sessionLabel when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await sendTeamsWebhook(
      "https://example.com/webhook",
      basePayload({ sessionLabel: "DevBox-1" })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const subtitleBlock = body.attachments[0].content.body[1];
    expect(subtitleBlock.text).toBe("DevBox-1");
  });

  it("falls back to truncated sessionId when no label", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await sendTeamsWebhook(
      "https://example.com/webhook",
      basePayload({ sessionId: "abcdefghijklmnopqrst" })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const subtitleBlock = body.attachments[0].content.body[1];
    expect(subtitleBlock.text).toContain("abcdefghijkl");
  });

  it("builds question card with responseUrl and options", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await sendTeamsWebhook(
      "https://example.com/webhook",
      basePayload({
        type: "question",
        responseUrl: "https://example.com/respond/123",
        options: ["Yes", "No"],
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const card = body.attachments[0].content;
    // Should have actions
    expect(card.actions).toBeDefined();
    expect(card.actions[0].type).toBe("Action.OpenUrl");
    expect(card.actions[0].url).toBe("https://example.com/respond/123");
    // Should have FactSet for options
    const factSet = card.body.find(
      (b: Record<string, unknown>) => b.type === "FactSet"
    );
    expect(factSet).toBeDefined();
    expect(factSet.facts).toHaveLength(2);
  });

  it("embeds correlation metadata when callbackUrl and correlationId provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await sendTeamsWebhook(
      "https://example.com/webhook",
      basePayload({
        callbackUrl: "https://example.com/api/reply",
        correlationId: "corr-abc-123",
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const card = body.attachments[0].content;
    const hiddenBlock = card.body.find(
      (b: Record<string, unknown>) => b.isVisible === false
    );
    expect(hiddenBlock).toBeDefined();
    expect(hiddenBlock.text).toContain("<!--clawpilot:");
    expect(hiddenBlock.text).toContain("corr-abc-123");
  });

  it("captures messageId from response for threading", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ messageId: "msg-42" })),
    });

    expect(getThreadId()).toBeNull();
    await sendTeamsWebhook("https://example.com/webhook", basePayload());
    expect(getThreadId()).toBe("msg-42");
  });

  it("includes replyToId when threadId is set", async () => {
    // First call to set the threadId
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ messageId: "msg-42" })),
    });
    await sendTeamsWebhook("https://example.com/webhook", basePayload());

    // Second call should include replyToId
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
    });
    await sendTeamsWebhook("https://example.com/webhook", basePayload());

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.replyToId).toBe("msg-42");
  });

  it("does not overwrite threadId once set", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ messageId: "first" })),
    });
    await sendTeamsWebhook("https://example.com/webhook", basePayload());

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ messageId: "second" })),
    });
    await sendTeamsWebhook("https://example.com/webhook", basePayload());

    expect(getThreadId()).toBe("first");
  });

  it("logs error on non-ok response", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error"),
    });

    await sendTeamsWebhook("https://example.com/webhook", basePayload());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("POST failed (500)")
    );
    consoleSpy.mockRestore();
  });

  it("clearThreadId resets the thread", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ messageId: "msg-1" })),
    });
    await sendTeamsWebhook("https://example.com/webhook", basePayload());
    expect(getThreadId()).toBe("msg-1");

    clearThreadId();
    expect(getThreadId()).toBeNull();
  });
});
