import { describe, it, expect, vi, beforeEach } from "vitest";
import { askUser } from "./ask.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("askUser", () => {
  it("submits question and returns response when user answers", async () => {
    // POST /api/ask → ok
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });
    // First poll → 404 (not yet)
    mockFetch.mockResolvedValueOnce({
      status: 404,
      json: () => Promise.resolve({ ok: false, error: "no response yet" }),
    });
    // Second poll → 200 (answered)
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          data: {
            correlationId: "c1",
            sessionId: "s1",
            response: "yes",
            respondedAt: new Date().toISOString(),
          },
        }),
    });

    const result = await askUser({
      sessionId: "s1",
      question: "Continue?",
      timeoutMs: 10_000,
    });

    expect(result.response).toBe("yes");
    // First call: POST /api/ask, second & third: GET polls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws on ask submission failure", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, error: "bad request" }),
    });

    await expect(
      askUser({ sessionId: "s1", question: "?", timeoutMs: 1000 })
    ).rejects.toThrow("ask failed: bad request");
  });

  it("sends correlationId, options, and source in payload", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          data: { response: "opt1", respondedAt: "" },
        }),
    });

    await askUser({
      sessionId: "s1",
      question: "Pick",
      options: ["opt1", "opt2"],
      source: "cli",
      timeoutMs: 10_000,
    });

    const askBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(askBody.question).toBe("Pick");
    expect(askBody.options).toEqual(["opt1", "opt2"]);
    expect(askBody.source).toBe("cli");
    expect(askBody.correlationId).toBeTruthy();
  });

  it("times out when no response arrives", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });
    // Keep returning 404
    mockFetch.mockResolvedValue({
      status: 404,
      json: () => Promise.resolve({ ok: false, error: "no response yet" }),
    });

    await expect(
      askUser({ sessionId: "s1", question: "?", timeoutMs: 3000 })
    ).rejects.toThrow("timed out");
  }, 15_000);
});
