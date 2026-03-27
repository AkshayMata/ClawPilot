import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MessageQueue } from "./messageQueue.js";
import type { PendingAsk, UserResponse } from "@clawpilot/shared";

function makePendingAsk(overrides: Partial<PendingAsk> = {}): PendingAsk {
  return {
    correlationId: "corr-1",
    sessionId: "session-1",
    question: "What color?",
    askedAt: new Date().toISOString(),
    timeoutMs: 300_000,
    ...overrides,
  };
}

function makeUserResponse(
  overrides: Partial<UserResponse> = {}
): UserResponse {
  return {
    correlationId: "corr-1",
    sessionId: "session-1",
    response: "blue",
    respondedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("MessageQueue", () => {
  let queue: MessageQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new MessageQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("addPending / getPending", () => {
    it("stores a pending ask", () => {
      const ask = makePendingAsk();
      queue.addPending(ask);
      expect(queue.getPending("corr-1")).toBe(ask);
    });

    it("returns undefined for unknown correlation", () => {
      expect(queue.getPending("unknown")).toBeUndefined();
    });
  });

  describe("listPending", () => {
    it("returns empty array initially", () => {
      expect(queue.listPending()).toEqual([]);
    });

    it("lists all pending asks", () => {
      queue.addPending(makePendingAsk({ correlationId: "c1" }));
      queue.addPending(makePendingAsk({ correlationId: "c2" }));
      expect(queue.listPending()).toHaveLength(2);
    });
  });

  describe("submitResponse / getResponse", () => {
    it("submits a response for a pending ask", () => {
      queue.addPending(makePendingAsk());
      const resp = makeUserResponse();
      const accepted = queue.submitResponse(resp);
      expect(accepted).toBe(true);
      expect(queue.getResponse("corr-1")).toBe(resp);
    });

    it("removes pending ask after submission", () => {
      queue.addPending(makePendingAsk());
      queue.submitResponse(makeUserResponse());
      expect(queue.getPending("corr-1")).toBeUndefined();
    });

    it("rejects response for unknown correlation", () => {
      const resp = makeUserResponse({ correlationId: "unknown" });
      expect(queue.submitResponse(resp)).toBe(false);
    });

    it("rejects duplicate response", () => {
      queue.addPending(makePendingAsk());
      queue.submitResponse(makeUserResponse());
      // Second submit should fail — pending was already removed
      expect(queue.submitResponse(makeUserResponse())).toBe(false);
    });
  });

  describe("auto-expiry", () => {
    it("expires pending ask after timeoutMs", () => {
      queue.addPending(makePendingAsk({ timeoutMs: 5000 }));
      expect(queue.getPending("corr-1")).toBeDefined();

      vi.advanceTimersByTime(5001);
      expect(queue.getPending("corr-1")).toBeUndefined();
    });

    it("cleans up response after 60s", () => {
      queue.addPending(makePendingAsk());
      queue.submitResponse(makeUserResponse());
      expect(queue.getResponse("corr-1")).toBeDefined();

      vi.advanceTimersByTime(60_001);
      expect(queue.getResponse("corr-1")).toBeUndefined();
    });

    it("cannot submit response after pending expires", () => {
      queue.addPending(makePendingAsk({ timeoutMs: 1000 }));
      vi.advanceTimersByTime(1001);
      expect(queue.submitResponse(makeUserResponse())).toBe(false);
    });
  });
});
