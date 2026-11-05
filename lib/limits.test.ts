// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Busy, RateLimiter, Semaphore } from "./limits.ts";

const tick = () => new Promise((r) => setImmediate(r));

test("semaphore: slots, FIFO hand-over, queue limit", async () => {
  const s = new Semaphore(1, 1);
  const order: string[] = [];
  const r1 = await s.acquire();
  const p2 = s.acquire().then((rel) => { order.push("2"); return rel; });
  await assert.rejects(s.acquire(), Busy, "queue (1) full → Busy");
  await tick();
  assert.deepEqual(order, [], "2 waits while 1 holds the slot");
  r1();
  const r2 = await p2;
  assert.deepEqual(order, ["2"]);
  assert.ok(s.full, "slot handed to 2, still full");
  r2();
  r2(); // double release is a no-op
  assert.ok(!s.full);
});

test("semaphore: an aborted waiter leaves the queue and never gets the slot", async () => {
  const s = new Semaphore(1, 5);
  const r1 = await s.acquire();
  const ac = new AbortController();
  const p = s.acquire(ac.signal);
  ac.abort(new Error("iptal"));
  await assert.rejects(p, /iptal/);
  r1();
  assert.ok(!s.full, "slot is free again, not leaked to the aborted waiter");
});

test("semaphore.run releases on throw", async () => {
  const s = new Semaphore(1, 0);
  await assert.rejects(s.run(async () => { throw new Error("x"); }));
  assert.ok(!s.full);
});

test("rate limiter: limit per window, resets after it", () => {
  const r = new RateLimiter(2, 1000);
  assert.ok(r.allow("u", 0));
  assert.ok(r.allow("u", 10));
  assert.ok(!r.allow("u", 20));
  assert.ok(r.allow("v", 20), "other key unaffected");
  assert.ok(r.allow("u", 1001), "new window");
});

test("Semaphore.idleFor: free and unused for the given time; busy, queued or just used isn't idle", async () => {
  const s = new Semaphore(1, 2);
  assert.ok(s.idleFor(60_000), "never used");
  const release = await s.acquire();
  assert.ok(!s.idleFor(0), "held");
  const t = Date.now();
  release();
  assert.ok(!s.idleFor(60_000, t + 1_000), "used a second ago");
  assert.ok(s.idleFor(60_000, t + 61_000));
});

test("Semaphore: background work doesn't count as use for idleFor", async () => {
  const s = new Semaphore(1, 1);
  await s.run(async () => {}, undefined, true);
  assert.ok(s.idleFor(60_000), "a caption's own call leaves the model idle for the next one");
  await s.run(async () => {});
  assert.ok(!s.idleFor(60_000), "a chat's call does count");
});

test("semaphore: background work (asBackground, however deep) is neither use for idleFor nor someone queued", async () => {
  const { asBackground } = await import("./limits.ts");
  const s = new Semaphore(1, 4);
  let release!: () => void;
  await asBackground(async () => {
    release = await s.acquire();
  });
  // A second background call queued behind it: its own work, nobody waiting.
  const own = asBackground(() => s.run(async () => {}));
  await tick();
  assert.equal(s.queued, 0);
  const person = s.acquire();
  assert.equal(s.queued, 1);
  release();
  (await person)(); // the person first, though queued later
  await own;
  assert.equal(s.queued, 0);
  const bg = new Semaphore(1, 4);
  await asBackground(() => bg.run(async () => {}));
  assert.equal(bg.idleFor(60_000), true, "background use leaves the semaphore idle");
});

test("semaphore: a full background queue never refuses a person, and a freed slot goes to the person first", async () => {
  const { asBackground } = await import("./limits.ts");
  const s = new Semaphore(1, 2);
  const order: string[] = [];
  let release!: () => void;
  await asBackground(async () => {
    release = await s.acquire();
  });
  // A table's strips read side by side: the background queue full.
  const strips = [1, 2].map((n) => asBackground(() => s.run(async () => void order.push(`strip${n}`))));
  await tick();
  await assert.rejects(asBackground(() => s.acquire()), Busy, "background bounded by its own queue");
  const person = s.run(async () => void order.push("person"));
  assert.equal(s.queued, 1);
  assert.equal(s.saturated, false);
  release();
  await Promise.all([person, ...strips]);
  assert.deepEqual(order, ["person", "strip1", "strip2"]);
});
