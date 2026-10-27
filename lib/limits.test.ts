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
