import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ReplyInbox } from "./replyInbox.js";
import type { InboxReply } from "./replyInbox.js";

function makeReply(overrides: Partial<InboxReply> = {}): InboxReply {
  return {
    correlationId: "corr-1",
    response: "hello",
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ReplyInbox", () => {
  let inbox: ReplyInbox;

  beforeEach(() => {
    vi.useFakeTimers();
    inbox = new ReplyInbox();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("add / count / peek / drain", () => {
    it("starts empty", () => {
      expect(inbox.count).toBe(0);
      expect(inbox.peek()).toEqual([]);
      expect(inbox.drain()).toEqual([]);
    });

    it("adds a reply and increments count", () => {
      inbox.add(makeReply());
      expect(inbox.count).toBe(1);
    });

    it("peek returns copies without clearing", () => {
      inbox.add(makeReply({ correlationId: "c1" }));
      inbox.add(makeReply({ correlationId: "c2" }));

      const peeked = inbox.peek();
      expect(peeked).toHaveLength(2);
      expect(inbox.count).toBe(2); // not cleared
    });

    it("drain returns all and clears", () => {
      inbox.add(makeReply({ correlationId: "c1" }));
      inbox.add(makeReply({ correlationId: "c2" }));

      const drained = inbox.drain();
      expect(drained).toHaveLength(2);
      expect(inbox.count).toBe(0);
      expect(inbox.drain()).toEqual([]);
    });
  });

  describe("waitForReply", () => {
    it("returns immediately if replies are already queued", async () => {
      inbox.add(makeReply());
      const replies = await inbox.waitForReply(5000);
      expect(replies).toHaveLength(1);
      expect(replies[0].response).toBe("hello");
      expect(inbox.count).toBe(0); // drained
    });

    it("waits and returns when a reply arrives", async () => {
      const promise = inbox.waitForReply(10_000);

      // Advance past a few poll cycles (500ms each)
      vi.advanceTimersByTime(1500);

      // Add a reply
      inbox.add(makeReply({ response: "delayed" }));

      // Advance past next poll cycle
      vi.advanceTimersByTime(500);

      const replies = await promise;
      expect(replies).toHaveLength(1);
      expect(replies[0].response).toBe("delayed");
    });

    it("returns empty array on timeout", async () => {
      const promise = inbox.waitForReply(3000);
      vi.advanceTimersByTime(3500);
      const replies = await promise;
      expect(replies).toEqual([]);
    });

    it("tracks active pollers", async () => {
      expect(inbox.activePollers).toBe(0);

      const p1 = inbox.waitForReply(5000);
      // Need to let microtask run — but since reply queue is empty,
      // the promise won't resolve immediately. Poller count increments synchronously.
      // Actually the increment happens in the promise callback, let's advance slightly:
      expect(inbox.activePollers).toBe(1);

      const p2 = inbox.waitForReply(5000);
      expect(inbox.activePollers).toBe(2);

      vi.advanceTimersByTime(5500);
      await p1;
      await p2;
      expect(inbox.activePollers).toBe(0);
    });

    it("aborts when signal is triggered", async () => {
      const ac = new AbortController();
      const promise = inbox.waitForReply(60_000, ac.signal);

      vi.advanceTimersByTime(1000);
      ac.abort();
      vi.advanceTimersByTime(500);

      const replies = await promise;
      expect(replies).toEqual([]);
    });
  });

  describe("abortAllPollers", () => {
    it("aborts all active pollers", async () => {
      const p1 = inbox.waitForReply(60_000);
      const p2 = inbox.waitForReply(60_000);

      const count = inbox.abortAllPollers();
      expect(count).toBe(2);

      vi.advanceTimersByTime(500);
      await p1;
      await p2;
      expect(inbox.activePollers).toBe(0);
    });

    it("returns 0 when no pollers active", () => {
      expect(inbox.abortAllPollers()).toBe(0);
    });
  });
});
