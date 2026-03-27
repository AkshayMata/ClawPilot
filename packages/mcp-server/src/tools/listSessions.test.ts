import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSessions } from "./listSessions.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("listSessions", () => {
  it("returns empty array when no sessions", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, data: [] }),
    });

    const result = await listSessions();

    expect(result.sessions).toEqual([]);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/sessions");
  });

  it("returns sessions when available", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          ok: true,
          data: [
            {
              id: "s1",
              source: "vscode",
              label: "Test",
              status: "active",
              createdAt: "2026-01-01",
              lastActivityAt: "2026-01-01",
            },
          ],
        }),
    });

    const result = await listSessions();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("s1");
  });

  it("throws when API returns ok: false", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, error: "fail" }),
    });

    await expect(listSessions()).rejects.toThrow("list_sessions failed: fail");
  });

  it("handles missing data field gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await listSessions();

    expect(result.sessions).toEqual([]);
  });
});
