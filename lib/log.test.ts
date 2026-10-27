// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { errCode } from "./log.ts";

test("only our own codes are logged verbatim, never foreign messages", () => {
  assert.equal(errCode(new Error("ollama_http_500")), "ollama_http_500");
  let parseErr: unknown;
  try { JSON.parse("gizli belge metni"); } catch (e) { parseErr = e; }
  assert.equal(errCode(parseErr), "SyntaxError");
  assert.equal(errCode(new Error("Model gizli metin döndürdü")), "Error");
  assert.equal(errCode("x"), "unknown");
});
