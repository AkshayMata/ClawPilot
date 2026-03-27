import { sendTeamsWebhook } from "./webhook.js";

const AGENT_NAME = process.env.AGENT_NAME ?? "ClawPilot";

export interface HeartbeatPayload {
  /** What the agent is currently doing */
  status?: string;
}

/**
 * Monitors agent heartbeats and fires a Teams notification
 * if the agent goes silent (likely stuck or session interrupted).
 */
export class HeartbeatMonitor {
  private lastBeat: number = 0;
  private lastStatus: string = "idle";
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private isDown = false;
  private webhookUrl: string;
  private deadlineMs: number;
  private checkIntervalMs: number;

  constructor(opts: {
    webhookUrl: string;
    /** How long without a heartbeat before alerting (ms). Default: 2 min */
    deadlineMs?: number;
    /** How often to check (ms). Default: 30s */
    checkIntervalMs?: number;
  }) {
    this.webhookUrl = opts.webhookUrl;
    this.deadlineMs = opts.deadlineMs ?? 120_000;
    this.checkIntervalMs = opts.checkIntervalMs ?? 30_000;
  }

  /** Start monitoring. Call after server is ready. */
  start(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.check(), this.checkIntervalMs);
    console.log(
      `[Heartbeat] Watchdog started (alert after ${this.deadlineMs / 1000}s silence)`
    );
  }

  /** Stop monitoring. */
  stop(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Record a heartbeat from the agent. */
  beat(payload?: HeartbeatPayload): void {
    this.lastBeat = Date.now();
    if (payload?.status) {
      this.lastStatus = payload.status;
    }

    // If agent was down and just came back, notify recovery
    if (this.isDown) {
      this.isDown = false;
      console.log("[Heartbeat] Agent is back online");
      this.notify(
        `${AGENT_NAME} is back online. Last status: ${this.lastStatus}`
      );
    }
  }

  /** Check if the agent has gone silent. */
  private check(): void {
    if (this.lastBeat === 0) return; // No heartbeat received yet — agent hasn't started
    const silentMs = Date.now() - this.lastBeat;
    if (silentMs > this.deadlineMs && !this.isDown) {
      this.isDown = true;
      const silentSec = Math.round(silentMs / 1000);
      console.log(`[Heartbeat] Agent appears stuck (${silentSec}s silence)`);
      this.notify(
        `⚠️ ${AGENT_NAME} appears stuck or disconnected.\nLast heartbeat: ${silentSec}s ago\nLast status: ${this.lastStatus}`
      );
    }
  }

  private async notify(message: string): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      await sendTeamsWebhook(this.webhookUrl, {
        type: "notification",
        title: "Agent Heartbeat",
        message,
        sessionId: "heartbeat-monitor",
        agentName: AGENT_NAME,
      });
    } catch (err) {
      console.error("[Heartbeat] Failed to send notification:", err);
    }
  }

  /** Get current status for health endpoint */
  getStatus(): {
    lastBeat: number;
    lastStatus: string;
    isDown: boolean;
    silentMs: number;
  } {
    return {
      lastBeat: this.lastBeat,
      lastStatus: this.lastStatus,
      isDown: this.isDown,
      silentMs: this.lastBeat > 0 ? Date.now() - this.lastBeat : 0,
    };
  }
}
