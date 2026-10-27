// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractDir, sweepExtract, sweepJobs, withJobDir } from "./workspace.ts";

const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const H1 = "a".repeat(64), H2 = "b".repeat(64);
const scratch = () => mkdtempSync(path.join(tmpdir(), "ws-"));

test("extract keys are validated: no traversal through user id or hash", () => {
  assert.throws(() => extractDir("../x", H1));
  assert.throws(() => extractDir(U1, "../../etc"));
  assert.equal(path.basename(extractDir(U1, H1, "/r")), H1);
});

test("job dir is removed after success, after failure, and when writing the input fails", async () => {
  const root = scratch();
  try {
    let seen = "";
    await withJobDir(async (d) => { seen = d; writeFileSync(path.join(d, "in.pdf"), "x"); }, root);
    assert.ok(seen && !existsSync(seen));
    await assert.rejects(withJobDir(async (d) => { seen = d; writeFileSync(path.join(d, "in.pdf"), "x"); throw new Error("boom"); }, root));
    assert.ok(!existsSync(seen));
    await assert.rejects(withJobDir(async (d) => { seen = d; writeFileSync(path.join(d, "yok", "in.pdf"), "x"); }, root));
    assert.ok(!existsSync(seen));
    // Two jobs never share a directory.
    const dirs = await Promise.all([withJobDir(async (d) => d, root), withJobDir(async (d) => d, root)]);
    assert.notEqual(dirs[0], dirs[1]);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup sweeps remove crash leftovers and unreferenced extracts, nothing else", () => {
  const root = scratch();
  try {
    const jobs = path.join(root, "jobs"), ex = path.join(root, "extract");
    mkdirSync(path.join(jobs, "job-abc"), { recursive: true });
    writeFileSync(path.join(jobs, "job-abc", "in.pdf"), "ham belge");
    assert.equal(sweepJobs(jobs), 1);
    assert.deepEqual(readdirSync(jobs), []);

    for (const [u, h] of [[U1, H1], [U1, H2], [U2, H1]]) mkdirSync(extractDir(u, h, ex), { recursive: true });
    mkdirSync(path.join(ex, "baska-bir-sey"), { recursive: true }); // not ours by name: left alone
    assert.equal(sweepExtract(new Set([`${U1}/${H1}`]), ex), 2);
    assert.ok(existsSync(extractDir(U1, H1, ex)));
    assert.ok(!existsSync(extractDir(U1, H2, ex)));
    assert.ok(!existsSync(extractDir(U2, H1, ex)), "same content, other user: separate and removed");
    assert.ok(!existsSync(path.join(ex, U2)), "user dir with nothing left is removed too");
    assert.ok(existsSync(path.join(ex, "baska-bir-sey")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
