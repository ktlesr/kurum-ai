// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./atomic.ts";

const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(path.join(tmpdir(), "atomic-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("atomic write replaces content and leaves no temp files", () =>
  withDir((dir) => {
    const f = path.join(dir, "sub", "a.json");
    writeFileAtomic(f, "1");
    writeFileAtomic(f, "2");
    assert.equal(readFileSync(f, "utf8"), "2");
    assert.deepEqual(readdirSync(path.dirname(f)), ["a.json"]);
  }));

test("large content round-trips byte for byte", () =>
  withDir((dir) => {
    const f = path.join(dir, "b.json");
    const big = "ğüşiöç".repeat(1_000_000); // ~12 MB of multibyte text
    writeFileAtomic(f, big);
    assert.equal(readFileSync(f, "utf8"), big);
  }));

test("replacing an existing file fails → old content kept, temp file removed", () =>
  withDir((dir) => {
    const f = path.join(dir, "a.json");
    writeFileAtomic(f, "eski");
    const boom = () => {
      throw new Error("rename_failed");
    };
    assert.throws(() => writeFileAtomic(f, "yeni", boom), /rename_failed/);
    assert.equal(readFileSync(f, "utf8"), "eski");
    assert.deepEqual(readdirSync(dir), ["a.json"]);
  }));
