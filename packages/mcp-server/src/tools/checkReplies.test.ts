import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkReplies } from "./checkReplies.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("checkReplies", () => {
  it("returns empty array when no replies", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, data: [] }),
    });

    const result = await checkReplies();

    expect(result.replies).toEqual([]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/replies");
  });

  it("returns replies when available", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          ok: true,
          data: [
            {
              correlationId: "c1",
              response: "hello",
              receivedAt: "2026-01-01",
            },
          ],
        }),
    });

    const result = await checkReplies();

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].response).toBe("hello");
  });

  it("throws when API returns ok: false", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, error: "server down" }),
    });

    await expect(checkReplies()).rejects.toThrow(
      "check_replies failed: server down"
    );
  });

  it("handles missing data field gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await checkReplies();

    expect(result.replies).toEqual([]);
  });
});
