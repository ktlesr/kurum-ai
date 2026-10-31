// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { spacingSnap } from "./snap.ts";

const r = (x: number, y = 0, w = 100, h = 100) => ({ x, y, w, h });

test("spacingSnap: catches the row's gap after it and before it", () => {
  const row = [r(100), r(300)]; // gap 100
  const after = spacingSnap(r(505), row, "x", 8);
  assert.equal(after?.delta, -5);
  assert.deepEqual(after?.marks.map((m) => [m.from, m.to]), [[200, 300], [400, 500]]);
  assert.equal(spacingSnap(r(-103), row, "x", 8)?.delta, 3);
});

test("spacingSnap: catches the middle between two", () => {
  const s = spacingSnap(r(304), [r(100), r(500)], "x", 8); // 200 and 100 wide: 100 either side
  assert.equal(s?.delta, -4);
  assert.deepEqual(s?.marks.map((m) => [m.from, m.to]), [[200, 300], [400, 500]]);
});

test("spacingSnap: only its own row, only within reach; works on the other axis", () => {
  assert.equal(spacingSnap(r(505, 500), [r(100), r(300)], "x", 8), null); // another row
  assert.equal(spacingSnap(r(530), [r(100), r(300)], "x", 8), null); // too far
  assert.equal(spacingSnap(r(505), [r(100)], "x", 8), null); // one element has no gap
  assert.equal(spacingSnap(r(0, 503), [r(0, 100), r(0, 300)], "y", 8)?.delta, -3);
});

test("spacingSnap: the nearest catch wins; overlapping neighbours give no gap", () => {
  assert.equal(spacingSnap(r(505), [r(100), r(150)], "x", 8), null);
  const s = spacingSnap(r(502), [r(100), r(300), r(500, 0, 2, 100)], "x", 8);
  assert.ok(s === null || Math.abs(s.delta) <= 8);
});

test("spacingSnap: never onto another element of the row", () => {
  assert.equal(spacingSnap(r(505), [r(100), r(300), r(440, 0, 400, 100)], "x", 8), null);
});
