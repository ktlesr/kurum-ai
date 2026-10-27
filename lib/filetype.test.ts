// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentProblem, readLimited, ZIP_LIMITS, zipTotals } from "./filetype.ts";

/** Minimal ZIP: local headers skipped, only what zipTotals reads (central directory + EOCD) with declared sizes. */
function zip(sizes: number[]): Uint8Array {
  const name = Buffer.from("a.xml");
  const cd: Buffer[] = sizes.map((size) => {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(size, 24); // uncompressed
    h.writeUInt16LE(name.length, 28);
    return Buffer.concat([h, name]);
  });
  const lead = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Array(26).fill(0)]);
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(sizes.length, 8);
  eocd.writeUInt16LE(sizes.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(lead.length, 16);
  return new Uint8Array(Buffer.concat([lead, cdBuf, eocd]));
}

test("zip totals come from the central directory", () => {
  assert.deepEqual(zipTotals(zip([10, 20])), { entries: 2, uncompressed: 30 });
  assert.equal(zipTotals(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null, "no EOCD");
  assert.equal(zipTotals(zip([0xffffffff])), null, "ZIP64 marker rejected");
});

test("docx/xlsx: zip bomb by declared size or entry count is refused", () => {
  assert.equal(contentProblem("docx", zip([1000])), null);
  assert.match(contentProblem("xlsx", zip([ZIP_LIMITS.totalBytes, 1]))!, /çok büyük/);
  assert.match(contentProblem("docx", new Uint8Array(Buffer.from("%PDF-1.7")))!, /uyuşmuyor/);
});

test("magic bytes per extension", () => {
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n..."));
  assert.equal(contentProblem("pdf", pdf), null);
  assert.match(contentProblem("pdf", zip([1]))!, /uyuşmuyor/);
  assert.equal(contentProblem("xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), null);
  assert.match(contentProblem("xls", pdf)!, /uyuşmuyor/);
  assert.equal(contentProblem("csv", new Uint8Array(Buffer.from("a;b\n1;2"))), null);
  assert.match(contentProblem("txt", new Uint8Array([0x61, 0x00, 0x62]))!, /uyuşmuyor/, "NUL byte = binary");
});

test("readLimited stops at the limit without buffering the rest", async () => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(1000));
      if (pulled === 100) c.close();
    },
  });
  assert.equal(await readLimited(body, 2500), null);
  assert.ok(pulled < 10, `stopped early (pulled ${pulled} of 100 chunks)`);
  const small = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } });
  assert.deepEqual([...(await readLimited(small, 10))!], [1, 2, 3]);
});
