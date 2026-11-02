import assert from "node:assert/strict";
import { test } from "node:test";
import { metered, type ChatOpts, type ChatResult, type Provider } from "./provider.ts";
import { DEFAULT_PRICE, checkPrice, costUsd, readPrice } from "./token-price.ts";

test("cost: input and output have their own price", () => {
  const p = { ...DEFAULT_PRICE, input: 2, output: 10 };
  assert.equal(costUsd(1_000_000, 0, p), 2);
  assert.equal(costUsd(500_000, 100_000, p), 2);
  assert.equal(costUsd(0, 0, p), 0);
});

test("price: Turkish decimals pass, nonsense does not", () => {
  const ok = checkPrice({ label: " X ", input: "2,5", output: "10", usdTry: "49,86" }, "2026-11-02");
  assert.deepEqual(ok, { label: "X", input: 2.5, output: 10, usdTry: 49.86, at: "2026-11-02" });
  for (const bad of [
    { label: "", input: 1, output: 1, usdTry: 1 },
    { label: "x".repeat(61), input: 1, output: 1, usdTry: 1 },
    { label: "X", input: -1, output: 1, usdTry: 1 },
    { label: "X", input: "", output: 1, usdTry: 1 },
    { label: "X", input: 1, output: "abc", usdTry: 1 },
    { label: "X", input: 1, output: 1, usdTry: 0 },
    { label: "X", input: 1, output: Infinity, usdTry: 1 },
    { label: "X", input: {}, output: 1, usdTry: 1 },
  ]) assert.equal(typeof checkPrice(bad, "2026-11-02"), "string", JSON.stringify(bad));
});

test("price: unreadable saved value falls back to the default", () => {
  assert.equal(readPrice(undefined), DEFAULT_PRICE);
  assert.equal(readPrice("{bozuk"), DEFAULT_PRICE);
  assert.equal(readPrice('{"label":"X","input":-5,"output":1,"usdTry":1}'), DEFAULT_PRICE);
  assert.equal(readPrice('{"label":"X","input":1,"output":1,"usdTry":1,"at":"2026-01-01"}').label, "X");
});

const opts = (over: Partial<ChatOpts> = {}): ChatOpts => ({ model: "m", messages: [{ role: "user", content: "x".repeat(220) }], maxTokens: 9, signal: new AbortController().signal, ...over });
const fake = (run: (o: ChatOpts) => Promise<ChatResult>) => ({ chat: run }) as unknown as Provider;

test("metered: the server's own figures win", async () => {
  const seen: number[][] = [];
  const r = await metered(fake(async (o) => {
    o.onText?.("a");
    return { text: "a", truncated: false, promptTokens: 40, outputTokens: 7 };
  }), (i, o) => seen.push([i, o])).chat(opts());
  assert.equal(r.text, "a");
  assert.deepEqual(seen, [[40, 7]]);
});

test("metered: no figures from the server: estimated; callbacks still reach the caller", async () => {
  const seen: number[][] = [];
  const got: string[] = [];
  let thought = 0;
  await metered(fake(async (o) => {
    o.onThinking?.(1);
    o.onThinking?.(2);
    o.onText?.("a");
    return { text: "a", truncated: false };
  }), (i, o) => seen.push([i, o])).chat(opts({ onText: (t) => got.push(t), onThinking: (n) => (thought = n) }));
  assert.deepEqual(seen, [[100, 3]]);
  assert.deepEqual(got, ["a"]);
  assert.equal(thought, 2);
});

test("metered: one big piece counts by its length; cancelled before output still counts the prompt", async () => {
  const seen: number[][] = [];
  await metered(fake(async (o) => {
    o.onText?.("y".repeat(220));
    return { text: "", truncated: false, promptTokens: 5 };
  }), (i, o) => seen.push([i, o])).chat(opts());
  assert.deepEqual(seen, [[5, 100]]);
  seen.length = 0;
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(metered(fake(async () => {
    throw new Error("iptal");
  }), (i, o) => seen.push([i, o])).chat(opts({ signal: ac.signal })), /iptal/);
  assert.deepEqual(seen, [[100, 0]]);
});

test("metered: stopped midway counts what was generated and still fails; a call that never started counts nothing", async () => {
  const seen: number[][] = [];
  await assert.rejects(metered(fake(async (o) => {
    o.onText?.("a");
    throw new Error("durdu");
  }), (i, o) => seen.push([i, o])).chat(opts()), /durdu/);
  assert.deepEqual(seen, [[100, 1]]);
  seen.length = 0;
  await assert.rejects(metered(fake(async () => {
    throw new Error("model_http_500");
  }), (i, o) => seen.push([i, o])).chat(opts()), /model_http_500/);
  assert.deepEqual(seen, []);
});
