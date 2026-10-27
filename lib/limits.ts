// Admission control for the shared GPU/CPU (plan §8: chat, OCR and vision share one machine; audit S7).
// Pure, per process — fine because lib/boot allows one instance per database.

/** Thrown when the wait queue is full: map to HTTP 429. */
export class Busy extends Error {
  constructor() {
    super("busy");
  }
}

/** At most `slots` holders at once; up to `maxQueue` more wait in FIFO order, beyond that → Busy. */
export class Semaphore {
  private used = 0;
  private waiting: { go: () => void; fail: (e: unknown) => void }[] = [];
  readonly slots: number;
  readonly maxQueue: number;
  // No parameter properties: node --test strips types only (scripts/tests run this file unbundled).
  constructor(slots: number, maxQueue: number) {
    this.slots = slots;
    this.maxQueue = maxQueue;
  }

  /** True when a caller would have to wait (lets the UI say "sırada"). */
  get full() {
    return this.used >= this.slots;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.used < this.slots) {
      this.used++;
      return this.releaser();
    }
    if (this.waiting.length >= this.maxQueue) throw new Busy();
    await new Promise<void>((go, fail) => {
      const entry = {
        go: () => {
          signal?.removeEventListener("abort", onAbort);
          go();
        },
        fail,
      };
      const onAbort = () => {
        this.waiting = this.waiting.filter((w) => w !== entry);
        fail(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
    return this.releaser(); // the slot was handed over by release(), `used` already counts us
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private releaser() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiting.shift();
      if (next) next.go(); // hand the slot over directly: no window where a newcomer could jump the queue
      else this.used--;
    };
  }
}

/** Fixed-window counter per key: at most `limit` hits per `windowMs`. */
export class RateLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  readonly limit: number;
  readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Counts the hit; false when over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.until <= now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
      return true;
    }
    return ++h.n <= this.limit;
  }
}
