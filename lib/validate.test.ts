// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, parseChatRequest } from "./validate.ts";

const allowed = new Set(["gemma4:12b"]);
const ok = { model: "gemma4:12b", fileIds: ["a"], messages: [{ role: "user", content: "soru" }] };

test("valid request passes, extra message keys are dropped", () => {
  const r = parseChatRequest({ ...ok, messages: [{ role: "user", content: "soru", images: ["x"] }], think: true }, allowed);
  assert.deepEqual(r, { model: "gemma4:12b", fileIds: ["a"], messages: [{ role: "user", content: "soru" }], think: true, scope: undefined });
});

test("rejects non-objects and the empty body that used to 500", () => {
  for (const b of [null, "x", [], {}]) assert.equal(typeof parseChatRequest(b, allowed), "string");
});

test("model must be on the server allowlist (no :cloud, no arbitrary names)", () => {
  assert.equal(typeof parseChatRequest({ ...ok, model: "gemini-3-flash-preview:cloud" }, allowed), "string");
  assert.equal(typeof parseChatRequest({ ...ok, model: 42 }, allowed), "string");
});

test("fileIds and messages shape and limits", () => {
  assert.equal(typeof parseChatRequest({ ...ok, fileIds: "a" }, allowed), "string");
  assert.equal(typeof parseChatRequest({ ...ok, fileIds: Array(LIMITS.files + 1).fill("a") }, allowed), "string");
  assert.equal(typeof parseChatRequest({ ...ok, messages: [] }, allowed), "string");
  assert.equal(typeof parseChatRequest({ ...ok, messages: [{ role: "system", content: "x" }] }, allowed), "string");
  assert.equal(typeof parseChatRequest({ ...ok, messages: [{ role: "user", content: "x".repeat(LIMITS.messageChars + 1) }] }, allowed), "string");
  assert.equal(typeof parseChatRequest({ ...ok, scope: "some" }, allowed), "string");
  assert.equal((parseChatRequest({ ...ok, scope: "part" }, allowed) as { scope?: string }).scope, "part");
  assert.equal(typeof parseChatRequest({ ...ok, think: "yes" }, allowed), "string");
});
