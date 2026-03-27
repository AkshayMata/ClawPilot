import type {
  SessionId,
  CopilotSession,
  SessionSource,
  SessionStatus,
} from "@clawpilot/shared";

/**
 * In-memory session store.
 * Tracks all Copilot sessions that have communicated through ClawPilot.
 * Designed with a pluggable interface so it can be swapped to a persistent store later.
 */
export class SessionManager {
  private sessions = new Map<SessionId, CopilotSession>();

  /** Get or create a session. Automatically created on first notify/ask from a session. */
  getOrCreate(
    sessionId: SessionId,
    source: SessionSource,
    label?: string
  ): CopilotSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      const now = new Date().toISOString();
      session = {
        id: sessionId,
        source,
        label: label ?? `${source}-${sessionId.slice(0, 8)}`,
        status: "active" as SessionStatus,
        createdAt: now,
        lastActivityAt: now,
      };
      this.sessions.set(sessionId, session);
    } else if (label && session.label !== label) {
      // Update label if a better one is provided
      session.label = label;
    }
    return session;
  }

  /** Update the status and touch lastActivityAt */
  updateStatus(sessionId: SessionId, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.lastActivityAt = new Date().toISOString();
    }
  }

  /** Get a session by ID */
  get(sessionId: SessionId): CopilotSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Touch lastActivityAt */
  touch(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
    }
  }

  /** List all sessions */
  listAll(): CopilotSession[] {
    return Array.from(this.sessions.values());
  }

  /** Remove a session */
  remove(sessionId: SessionId): void {
    this.sessions.delete(sessionId);
  }
}
