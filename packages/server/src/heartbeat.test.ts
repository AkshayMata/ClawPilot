import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { HeartbeatMonitor } from "./heartbeat.js";

// Mock sendTeamsWebhook at module level
vi.mock("./webhook.js", () => ({
  sendTeamsWebhook: vi.fn().mockResolvedValue(undefined),
}));

import { sendTeamsWebhook } from "./webhook.js";
const mockSendWebhook = vi.mocked(sendTeamsWebhook);

describe("HeartbeatMonitor", () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSendWebhook.mockClear();
    monitor = new HeartbeatMonitor({
      webhookUrl: "https://teams.example.com/webhook",
      deadlineMs: 5000,
      checkIntervalMs: 1000,
    });
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  describe("start / stop", () => {
    it("starts without error", () => {
      monitor.start();
      // No assertion needed — just shouldn't throw
    });

    it("start is idempotent", () => {
      monitor.start();
      monitor.start(); // second call should be no-op
    });

    it("stop clears the watchdog", () => {
      monitor.start();
      monitor.stop();
      // Advance past deadline — should NOT trigger alert
      monitor.beat();
      vi.advanceTimersByTime(10_000);
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });
  });

  describe("beat", () => {
    it("records heartbeat status", () => {
      monitor.beat({ status: "working" });
      const status = monitor.getStatus();
      expect(status.lastStatus).toBe("working");
      expect(status.lastBeat).toBeGreaterThan(0);
      expect(status.isDown).toBe(false);
    });

    it("uses default status when no payload", () => {
      monitor.beat();
      expect(monitor.getStatus().lastStatus).toBe("idle");
    });
  });

  describe("silence detection", () => {
    it("does not alert before first heartbeat", () => {
      monitor.start();
      vi.advanceTimersByTime(10_000);
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });

    it("alerts when agent goes silent past deadline", () => {
      monitor.start();
      monitor.beat({ status: "building" });

      // Advance past deadline
      vi.advanceTimersByTime(6000);
      expect(mockSendWebhook).toHaveBeenCalledTimes(1);
      expect(mockSendWebhook).toHaveBeenCalledWith(
        "https://teams.example.com/webhook",
        expect.objectContaining({
          type: "notification",
          title: "Agent Heartbeat",
          message: expect.stringContaining("appears stuck"),
        })
      );
    });

    it("does not alert repeatedly once down", () => {
      monitor.start();
      monitor.beat();

      vi.advanceTimersByTime(6000); // triggers alert
      vi.advanceTimersByTime(6000); // should NOT trigger again
      expect(mockSendWebhook).toHaveBeenCalledTimes(1);
    });

    it("sends recovery notification when agent comes back", () => {
      monitor.start();
      monitor.beat();

      // Go silent → alert
      vi.advanceTimersByTime(6000);
      expect(mockSendWebhook).toHaveBeenCalledTimes(1);

      // Come back
      monitor.beat({ status: "recovered" });
      expect(mockSendWebhook).toHaveBeenCalledTimes(2);
      expect(mockSendWebhook).toHaveBeenLastCalledWith(
        "https://teams.example.com/webhook",
        expect.objectContaining({
          message: expect.stringContaining("back online"),
        })
      );
    });
  });

  describe("getStatus", () => {
    it("returns initial status", () => {
      const status = monitor.getStatus();
      expect(status.lastBeat).toBe(0);
      expect(status.lastStatus).toBe("idle");
      expect(status.isDown).toBe(false);
      expect(status.silentMs).toBe(0);
    });

    it("reflects current state after activity", () => {
      monitor.beat({ status: "testing" });
      vi.advanceTimersByTime(2000);
      const status = monitor.getStatus();
      expect(status.lastStatus).toBe("testing");
      expect(status.silentMs).toBeGreaterThanOrEqual(2000);
      expect(status.isDown).toBe(false);
    });
  });
});
