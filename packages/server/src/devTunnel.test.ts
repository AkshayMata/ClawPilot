import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensurePublicUrl, stopTunnel } from "./devTunnel.js";
import * as childProcess from "child_process";
import { EventEmitter } from "events";

// We mock execSync and spawn since devtunnel may not be installed in CI
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

const mockExecSync = vi.mocked(childProcess.execSync);
const mockSpawn = vi.mocked(childProcess.spawn);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockExecSync.mockReset();
  mockSpawn.mockReset();
  mockFetch.mockReset();
  delete process.env.PUBLIC_URL;
});

afterEach(() => {
  stopTunnel();
});

describe("ensurePublicUrl", () => {
  describe("when PUBLIC_URL is set", () => {
    it("returns the env URL when reachable", async () => {
      process.env.PUBLIC_URL = "https://my-tunnel.example.com";
      mockFetch.mockResolvedValueOnce({ ok: true }); // reachability check

      const result = await ensurePublicUrl(3978);

      expect(result.url).toBe("https://my-tunnel.example.com");
      expect(result.managed).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("falls through to devtunnel when PUBLIC_URL is not reachable", async () => {
      process.env.PUBLIC_URL = "https://dead-tunnel.example.com";
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED")); // not reachable

      // devtunnel available and logged in
      mockExecSync
        .mockReturnValueOnce("1.0.0" as any) // --version
        .mockReturnValueOnce("Logged in" as any); // user show

      const fakeChild = new EventEmitter() as any;
      fakeChild.stdout = new EventEmitter();
      fakeChild.stderr = new EventEmitter();
      fakeChild.killed = false;
      fakeChild.kill = vi.fn();
      mockSpawn.mockReturnValue(fakeChild);

      const promise = ensurePublicUrl(3978);

      // Wait for async code to progress past await isUrlReachable() and into startDevtunnel
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      fakeChild.stdout.emit("data", Buffer.from("Connect via browser: https://new-tunnel-3978.usw2.devtunnels.ms\n"));

      const result = await promise;
      expect(result.url).toBe("https://new-tunnel-3978.usw2.devtunnels.ms");
      expect(result.managed).toBe(true);
    });

    it("ignores non-http PUBLIC_URL values", async () => {
      process.env.PUBLIC_URL = "not-a-url";
      // devtunnel not available either
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      await expect(ensurePublicUrl(3978)).rejects.toThrow(
        "Cannot establish a public URL"
      );
    });
  });

  describe("when devtunnel is available and logged in", () => {
    it("spawns devtunnel and resolves with the URL", async () => {
      // execSync calls: --version (true), user show (logged in)
      mockExecSync
        .mockReturnValueOnce("1.0.0" as any) // --version
        .mockReturnValueOnce("Logged in as user@test.com" as any); // user show

      // Create a fake child process
      const fakeChild = new EventEmitter() as any;
      fakeChild.stdout = new EventEmitter();
      fakeChild.stderr = new EventEmitter();
      fakeChild.killed = false;
      fakeChild.kill = vi.fn(() => {
        fakeChild.killed = true;
      });
      mockSpawn.mockReturnValue(fakeChild);

      const promise = ensurePublicUrl(3978);

      // Simulate devtunnel outputting the URL
      fakeChild.stdout.emit(
        "data",
        Buffer.from(
          "Connect via browser: https://abc123-3978.usw2.devtunnels.ms\n"
        )
      );

      const result = await promise;
      expect(result.url).toBe(
        "https://abc123-3978.usw2.devtunnels.ms"
      );
      expect(result.managed).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        "devtunnel",
        ["host", "-p", "3978", "--allow-anonymous"],
        expect.any(Object)
      );
    });
  });

  describe("when devtunnel is available but not logged in", () => {
    it("throws with login instructions", async () => {
      mockExecSync
        .mockReturnValueOnce("1.0.0" as any) // --version
        .mockReturnValueOnce("Not logged in." as any); // user show

      await expect(ensurePublicUrl(3978)).rejects.toThrow(
        "not logged in"
      );
    });
  });

  describe("when devtunnel is not available", () => {
    it("attempts winget install, fails, and throws with instructions", async () => {
      // --version fails (not installed)
      mockExecSync.mockImplementation(() => {
        throw new Error("command not found");
      });

      await expect(ensurePublicUrl(3978)).rejects.toThrow(
        "Cannot establish a public URL"
      );
      // Should mention install instructions
      await ensurePublicUrl(3978).catch((err: Error) => {
        expect(err.message).toContain("winget install");
        expect(err.message).toContain("PUBLIC_URL");
      });
    });
  });

  describe("when devtunnel process exits before producing URL", () => {
    it("rejects with exit code info", async () => {
      mockExecSync
        .mockReturnValueOnce("1.0.0" as any)
        .mockReturnValueOnce("Logged in" as any);

      const fakeChild = new EventEmitter() as any;
      fakeChild.stdout = new EventEmitter();
      fakeChild.stderr = new EventEmitter();
      fakeChild.killed = false;
      fakeChild.kill = vi.fn();
      mockSpawn.mockReturnValue(fakeChild);

      const promise = ensurePublicUrl(3978);

      // Simulate exit before URL
      fakeChild.emit("exit", 1);

      await expect(promise).rejects.toThrow("exited with code 1");
    });
  });

  describe("when devtunnel process errors", () => {
    it("rejects with error info", async () => {
      mockExecSync
        .mockReturnValueOnce("1.0.0" as any)
        .mockReturnValueOnce("Logged in" as any);

      const fakeChild = new EventEmitter() as any;
      fakeChild.stdout = new EventEmitter();
      fakeChild.stderr = new EventEmitter();
      fakeChild.killed = false;
      fakeChild.kill = vi.fn();
      mockSpawn.mockReturnValue(fakeChild);

      const promise = ensurePublicUrl(3978);

      fakeChild.emit("error", new Error("ENOENT"));

      await expect(promise).rejects.toThrow("Failed to start devtunnel");
    });
  });
});
