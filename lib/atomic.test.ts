// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./atomic.ts";

test("atomic write replaces content and leaves no temp files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atomic-"));
  try {
    const f = path.join(dir, "sub", "a.json");
    writeFileAtomic(f, "1");
    writeFileAtomic(f, "2");
    assert.equal(readFileSync(f, "utf8"), "2");
    assert.deepEqual(readdirSync(path.dirname(f)), ["a.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed write removes its temp file and keeps the old content", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atomic-"));
  try {
    const f = path.join(dir, "a.json");
    writeFileAtomic(f, "eski");
    // Target is a directory → rename fails after the temp file was written.
    assert.throws(() => writeFileAtomic(dir, "x"));
    assert.equal(readFileSync(f, "utf8"), "eski");
    // The temp file sat next to the target (in the parent dir) and must be gone.
    assert.deepEqual(readdirSync(path.dirname(dir)).filter((n) => n.startsWith(`${path.basename(dir)}.`) && n.endsWith(".tmp")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
