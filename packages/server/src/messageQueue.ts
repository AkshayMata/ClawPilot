import type {
  CorrelationId,
  PendingAsk,
  UserResponse,
} from "@clawpilot/shared";

/**
 * Manages the correlation between ask_user requests and user responses.
 * The MCP server posts a question → gets a correlationId → polls for the answer.
 * The Teams bot posts the user's response using the same correlationId.
 */
export class MessageQueue {
  /** Questions waiting for an answer */
  private pending = new Map<CorrelationId, PendingAsk>();
  /** Answered questions */
  private responses = new Map<CorrelationId, UserResponse>();

  /** Register a new pending ask */
  addPending(ask: PendingAsk): void {
    this.pending.set(ask.correlationId, ask);

    // Auto-expire after timeout
    setTimeout(() => {
      this.pending.delete(ask.correlationId);
    }, ask.timeoutMs);
  }

  /** Get a pending ask (for building the Teams card) */
  getPending(correlationId: CorrelationId): PendingAsk | undefined {
    return this.pending.get(correlationId);
  }

  /** List all pending asks */
  listPending(): PendingAsk[] {
    return Array.from(this.pending.values());
  }

  /** Submit a user response (called when user answers in Teams) */
  submitResponse(response: UserResponse): boolean {
    if (!this.pending.has(response.correlationId)) {
      return false; // Expired or unknown
    }
    this.pending.delete(response.correlationId);
    this.responses.set(response.correlationId, response);

    // Clean up response after 60s (the MCP poller should have picked it up by then)
    setTimeout(() => {
      this.responses.delete(response.correlationId);
    }, 60_000);

    return true;
  }

  /** Poll for a response (called by MCP server) */
  getResponse(correlationId: CorrelationId): UserResponse | undefined {
    return this.responses.get(correlationId);
  }
}
