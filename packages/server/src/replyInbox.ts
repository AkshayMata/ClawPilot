/**
 * Stores replies to notification cards sent by the agent.
 * Unlike MessageQueue (which handles ask_user correlation),
 * this is a simple inbox that the agent can poll for replies
 * to any card — notifications or questions.
 */
export interface InboxReply {
  correlationId: string;
  response: string;
  receivedAt: string;
}

export class ReplyInbox {
  private replies: InboxReply[] = [];
  private _activePollers = 0;
  private _pollerAborts = new Set<AbortController>();

  get activePollers(): number { return this._activePollers; }

  /** Abort all active pollers (zombie cleanup) */
  abortAllPollers(): number {
    const count = this._pollerAborts.size;
    for (const ac of this._pollerAborts) ac.abort();
    return count;
  }

  /** Add a reply from Teams */
  add(reply: InboxReply): void {
    this.replies.push(reply);
    console.log(`[ReplyInbox] add() — queued=${this.replies.length}, activePollers=${this._activePollers}`);
  }

  /**
   * Wait for the next reply using a simple poll loop.
   * Resolves with drained replies, or [] on timeout.
   * The AbortSignal allows the HTTP handler to cancel if the client disconnects.
   */
  waitForReply(timeoutMs: number, signal?: AbortSignal): Promise<InboxReply[]> {
    if (this.replies.length > 0) {
      console.log(`[ReplyInbox] waitForReply() — returning ${this.replies.length} queued replies immediately`);
      return Promise.resolve(this.drain());
    }
    this._activePollers++;
    // Track this poller's abort controller for zombie cleanup
    const internalAc = new AbortController();
    this._pollerAborts.add(internalAc);
    if (signal) signal.addEventListener("abort", () => internalAc.abort(), { once: true });

    console.log(`[ReplyInbox] waitForReply() — polling for up to ${timeoutMs}ms (activePollers=${this._activePollers})`);
    return new Promise((resolve) => {
      const done = (items: InboxReply[], reason: string) => {
        clearInterval(interval);
        this._activePollers--;
        this._pollerAborts.delete(internalAc);
        console.log(`[ReplyInbox] ${reason} (activePollers=${this._activePollers})`);
        resolve(items);
      };
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (internalAc.signal.aborted) {
          done([], "aborted (client disconnect or zombie cleanup)");
          return;
        }
        if (this.replies.length > 0) {
          done(this.drain(), `poll hit — drained ${this.replies.length} replies`);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          done([], `timed out after ${timeoutMs}ms`);
        }
      }, 500);
    });
  }

  /** Drain all unread replies (returns and clears them) */
  drain(): InboxReply[] {
    const items = [...this.replies];
    this.replies = [];
    return items;
  }

  /** Peek at replies without clearing */
  peek(): InboxReply[] {
    return [...this.replies];
  }

  /** Count of pending replies */
  get count(): number {
    return this.replies.length;
  }
}
