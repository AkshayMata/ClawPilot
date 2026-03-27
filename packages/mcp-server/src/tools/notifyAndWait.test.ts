import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyAndWait } from "./notifyAndWait.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

/** Helper: queue a mock response for fetch */
function queueFetch(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    json: () => Promise.resolve(body),
  });
}

describe("notifyAndWait", () => {
  it("kills zombie pollers before waiting", async () => {
    // 1. GET /api/health → 2 active pollers
    queueFetch({ ok: true, data: { activePollers: 2 } });
    // 2. DELETE /api/replies/pollers
    queueFetch({ ok: true, data: { killed: 2 } });
    // 3. POST /api/notify → ok
    queueFetch({ ok: true });
    // 4. GET /api/replies/peek → reply already there
    queueFetch({
      ok: true,
      data: [
        { correlationId: "c1", response: "fast reply", receivedAt: "" },
      ],
    });
    // 5. GET /api/replies (drain)
    queueFetch({
      ok: true,
      data: [
        { correlationId: "c1", response: "fast reply", receivedAt: "" },
      ],
    });

    const result = await notifyAndWait({
      sessionId: "s1",
      message: "hey",
    });

    expect(result.response).toBe("fast reply");
    expect(result.timedOut).toBe(false);
    // Verify zombie kill was called
    const deleteCall = mockFetch.mock.calls.find(
      (call) => {
        const [url, opts] = call as [string, { method?: string }];
        return url.includes("/api/replies/pollers") && opts?.method === "DELETE";
      }
    );
    expect(deleteCall).toBeDefined();
  });

  it("returns immediately when peek finds existing reply", async () => {
    // health → no pollers
    queueFetch({ ok: true, data: { activePollers: 0 } });
    // notify → ok
    queueFetch({ ok: true });
    // peek → has reply
    queueFetch({
      ok: true,
      data: [{ correlationId: "c", response: "already here", receivedAt: "" }],
    });
    // drain
    queueFetch({
      ok: true,
      data: [{ correlationId: "c", response: "already here", receivedAt: "" }],
    });

    const result = await notifyAndWait({
      sessionId: "s1",
      message: "check",
    });

    expect(result.response).toBe("already here");
    expect(result.timedOut).toBe(false);
  });

  it("long-polls and returns when reply arrives", async () => {
    // health → ok
    queueFetch({ ok: true, data: { activePollers: 0 } });
    // notify → ok
    queueFetch({ ok: true });
    // peek → empty
    queueFetch({ ok: true, data: [] });
    // first long-poll → empty (timeout)
    queueFetch({ ok: true, data: [] });
    // second long-poll → reply
    queueFetch({
      ok: true,
      data: [{ correlationId: "c", response: "waited", receivedAt: "" }],
    });

    const result = await notifyAndWait({
      sessionId: "s1",
      message: "wait",
      timeoutMs: 30_000,
    });

    expect(result.response).toBe("waited");
    expect(result.timedOut).toBe(false);
  });

  it("times out when no reply arrives", async () => {
    // health → ok
    queueFetch({ ok: true, data: { activePollers: 0 } });
    // notify → ok
    queueFetch({ ok: true });
    // peek → empty
    queueFetch({ ok: true, data: [] });

    // Short timeout so test finishes fast
    const result = await notifyAndWait({
      sessionId: "s1",
      message: "no one?",
      timeoutMs: 500,
    });

    expect(result.response).toBe("");
    expect(result.timedOut).toBe(true);
  }, 10_000);

  it("throws when notify fails", async () => {
    // health → ok
    queueFetch({ ok: true, data: { activePollers: 0 } });
    // notify → fail
    queueFetch({ ok: false, error: "server error" });

    await expect(
      notifyAndWait({ sessionId: "s1", message: "fail" })
    ).rejects.toThrow("notify failed");
  });

  it("skips zombie kill when no active pollers", async () => {
    // health → 0 pollers
    queueFetch({ ok: true, data: { activePollers: 0 } });
    // notify → ok
    queueFetch({ ok: true });
    // peek → reply
    queueFetch({
      ok: true,
      data: [{ correlationId: "c", response: "quick", receivedAt: "" }],
    });
    // drain
    queueFetch({
      ok: true,
      data: [{ correlationId: "c", response: "quick", receivedAt: "" }],
    });

    await notifyAndWait({ sessionId: "s1", message: "hi" });

    // No DELETE call should have been made
    const deleteCall = mockFetch.mock.calls.find(
      (call) => {
        const [url, opts] = call as [string, { method?: string }];
        return url.includes("/api/replies/pollers") && opts?.method === "DELETE";
      }
    );
    expect(deleteCall).toBeUndefined();
  });

  it("retries on network error during long-poll", async () => {
    // health → ok
    queueFetch({ ok: true, data: { activePollers: 0 } });
    // notify → ok
    queueFetch({ ok: true });
    // peek → empty
    queueFetch({ ok: true, data: [] });
    // first long-poll → network error
    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    // second long-poll → reply
    queueFetch({
      ok: true,
      data: [{ correlationId: "c", response: "recovered", receivedAt: "" }],
    });

    const result = await notifyAndWait({
      sessionId: "s1",
      message: "retry",
      timeoutMs: 30_000,
    });

    expect(result.response).toBe("recovered");
    expect(result.timedOut).toBe(false);
  }, 15_000);
});
