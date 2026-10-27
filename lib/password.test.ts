// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearFailures, DUMMY_HASH, hashPassword, isLocked, passwordProblem, recordFailure, tokenHash, verifyPassword } from "./password.ts";

test("hash verifies only the right password; salts differ", async () => {
  const a = await hashPassword("doğru-parola-123");
  assert.ok(await verifyPassword("doğru-parola-123", a));
  assert.ok(!(await verifyPassword("yanlis-parola-123", a)));
  assert.notEqual(a, await hashPassword("doğru-parola-123"));
});

test("malformed or dummy hashes never verify", async () => {
  assert.ok(!(await verifyPassword("x", "")));
  assert.ok(!(await verifyPassword("x", "md5$abc")));
  assert.ok(!(await verifyPassword("", DUMMY_HASH)));
});

test("token hash is stable and not the token", () => {
  assert.equal(tokenHash("abc"), tokenHash("abc"));
  assert.notEqual(tokenHash("abc"), "abc");
});

test("password policy", () => {
  assert.ok(passwordProblem("kısa"));
  assert.equal(passwordProblem("yeterince-uzun"), null);
});

test("lockout after 5 failures, expires after the window, clears on success", () => {
  const t = 1_000_000;
  for (let i = 0; i < 4; i++) recordFailure("u", t);
  assert.ok(!isLocked("u", t));
  recordFailure("u", t);
  assert.ok(isLocked("u", t));
  assert.ok(!isLocked("u", t + 15 * 60_000 + 1));
  clearFailures("u");
  assert.ok(!isLocked("u", t));
});
