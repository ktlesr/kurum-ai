// Admission control for the shared GPU/CPU (plan §8: chat, OCR and vision share one machine; audit S7).
// Pure, per process — fine because lib/boot allows one instance per database.
import { AsyncLocalStorage } from "node:async_hooks";

const backgroundWork = new AsyncLocalStorage<true>();
/**
 * Runs `fn` as background work (the content index reading a file): every slot it takes on the way, however deep (Docling,
 * the vision model inside an extraction), is taken as background — not counted as use for idleFor, and not as someone
 * waiting in `queued`.
 */
export const asBackground = <T>(fn: () => Promise<T>): Promise<T> => backgroundWork.run(true, fn);

/** Thrown when the wait queue is full: map to HTTP 429. */
export class Busy extends Error {
  constructor() {
    super("busy");
  }
}

/**
 * At most `slots` holders at once; up to `maxQueue` more wait in FIFO order, beyond that → Busy. Background work waits
 * in a queue of its own size and behind every person: a freed slot goes to the first person waiting, and background
 * waiters never fill the queue a person is refused for.
 */
export class Semaphore {
  private used = 0;
  private waiting: { go: () => void; fail: (e: unknown) => void; background: boolean }[] = [];
  readonly slots: number;
  readonly maxQueue: number;
  // No parameter properties: node --test strips types only (scripts/tests run this file unbundled).
  constructor(slots: number, maxQueue: number) {
    this.slots = slots;
    this.maxQueue = maxQueue;
  }

  /** True when a new caller would be refused outright (all slots busy and the queue full). */
  get saturated() {
    return this.used >= this.slots && this.queued >= this.maxQueue;
  }

  /** How many people are waiting for a slot, background work not counted (it steps aside when someone is). */
  get queued() {
    return this.waiting.filter((w) => !w.background).length;
  }

  /** True when a caller would have to wait (lets the UI say "sırada"). */
  get full() {
    return this.used >= this.slots;
  }

  /** `background`: work that mustn't count as use for idleFor (a caption's own call would hold back the next one). */
  async acquire(signal?: AbortSignal, background = false): Promise<() => void> {
    signal?.throwIfAborted();
    background ||= backgroundWork.getStore() === true;
    if (this.used < this.slots) {
      this.used++;
      return this.releaser(background);
    }
    if (this.waiting.filter((w) => w.background === background).length >= this.maxQueue) throw new Busy();
    await new Promise<void>((go, fail) => {
      const entry = {
        go: () => {
          signal?.removeEventListener("abort", onAbort);
          go();
        },
        fail,
        background,
      };
      const onAbort = () => {
        this.waiting = this.waiting.filter((w) => w !== entry);
        fail(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
    return this.releaser(background); // the slot was handed over by release(), `used` already counts us
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal, background = false): Promise<T> {
    const release = await this.acquire(signal, background);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private releaser(background: boolean) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      // A person first, then background work; FIFO within each.
      const i = this.waiting.findIndex((w) => !w.background);
      const next = i >= 0 ? this.waiting.splice(i, 1)[0] : this.waiting.shift();
      if (next) next.go(); // hand the slot over directly: no window where a newcomer could jump the queue
      else this.used--;
      if (!background) this.lastUsed = Date.now();
    };
  }

  private lastUsed = 0;
  /**
   * Nobody holding or waiting, and nobody for `ms`: background work (gallery captions) goes only then, so it doesn't
   * slip in between the calls of one answer and slow its writing (seen live with 31B).
   */
  idleFor(ms: number, now = Date.now()) {
    return this.used === 0 && this.waiting.length === 0 && now - this.lastUsed >= ms;
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
