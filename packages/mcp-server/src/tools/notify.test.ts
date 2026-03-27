import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyUser } from "./notify.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("notifyUser", () => {
  it("sends POST to /api/notify and returns success", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await notifyUser({
      sessionId: "s1",
      message: "Build done",
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/notify");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.sessionId).toBe("s1");
    expect(body.message).toBe("Build done");
    expect(body.priority).toBe("normal");
    expect(body.source).toBe("vscode");
  });

  it("passes label and priority when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });

    await notifyUser({
      sessionId: "s1",
      message: "hi",
      label: "DevBox-1",
      priority: "high",
      source: "cli",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.label).toBe("DevBox-1");
    expect(body.priority).toBe("high");
    expect(body.source).toBe("cli");
  });

  it("throws when API returns ok: false", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, error: "bad request" }),
    });

    await expect(
      notifyUser({ sessionId: "s1", message: "hi" })
    ).rejects.toThrow("notify failed: bad request");
  });
});
