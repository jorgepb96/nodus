/** Admission for the host resources a capability can ask for in bulk: interpreters, subworkers
 *  and concurrent invocations of one tool.
 *
 *  Waiting is first come, first served and can be abandoned: a caller whose signal aborts while
 *  it waits leaves the queue at once and never starts. The time spent waiting is the caller's
 *  business, not the resource's — every budget the host enforces on the work itself starts when
 *  the slot is granted, so a call queued behind its siblings is never reported as one that ran
 *  out of time. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<{ grant: () => void; signal?: AbortSignal; onAbort?: () => void }> = [];

  constructor(private limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get size(): number { return this.limit; }
  get running(): number { return this.active; }
  get queued(): number { return this.waiting.length; }

  /** Resolves with a release function once a slot is free. Releasing twice is harmless. */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.active < this.limit && !this.waiting.length) {
      this.active += 1;
      return this.releaser();
    }
    await new Promise<void>((resolve, reject) => {
      const entry: { grant: () => void; signal?: AbortSignal; onAbort?: () => void } = { grant: resolve, signal };
      if (signal) {
        entry.onAbort = () => {
          const at = this.waiting.indexOf(entry);
          if (at >= 0) this.waiting.splice(at, 1);
          reject(new DOMException('The request was cancelled while it waited for its turn.', 'AbortError'));
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.waiting.push(entry);
    });
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.waiting.length) {
      const next = this.waiting.shift()!;
      if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
      this.active += 1;
      next.grant();
    }
  }
}
