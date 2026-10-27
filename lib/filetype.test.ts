// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentProblem, inflatedSize, readLimited, ZIP_LIMITS, zipTotals } from "./filetype.ts";

import { deflateRawSync } from "node:zlib";

/**
 * Real little ZIP: local headers + data + central directory + EOCD. `declared` lets an entry lie about its
 * uncompressed size, like a crafted bomb would.
 */
function zip(entries: { data: Uint8Array; stored?: boolean; declared?: number }[]): Uint8Array {
  const locals: Buffer[] = [], cds: Buffer[] = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const name = Buffer.from(`f${i}.xml`);
    const body = e.stored ? Buffer.from(e.data) : deflateRawSync(e.data);
    const size = e.declared ?? e.data.byteLength;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(e.stored ? 0 : 8, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(e.stored ? 0 : 8, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    cds.push(ch, name);
    offset += 30 + name.length + body.length;
  });
  const cd = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}
const bytes = (n: number) => new Uint8Array(n); // zeros: compress ~1000:1

test("zip totals come from the central directory", () => {
  assert.deepEqual(zipTotals(zip([{ data: bytes(10) }, { data: bytes(20), stored: true }])), { entries: 2, uncompressed: 30 });
  assert.equal(zipTotals(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null, "no EOCD");
  assert.equal(zipTotals(zip([{ data: bytes(1), declared: 0xffffffff }])), null, "ZIP64 marker rejected");
});

test("real inflate: honest files pass, a bomb that lies about its size is caught", async () => {
  assert.equal(await inflatedSize(zip([{ data: bytes(1000) }, { data: bytes(10), stored: true }]), 10_000), 1010);
  // Declares 1 KB, really inflates to 300 MB: the declared-size check alone would let it through.
  const bomb = zip([{ data: bytes(300 * 1024 * 1024), declared: 1024 }]);
  assert.ok(bomb.byteLength < 1024 * 1024, "small on the wire");
  assert.equal(zipTotals(bomb)!.uncompressed, 1024, "lies in the directory");
  assert.equal(await inflatedSize(bomb, ZIP_LIMITS.totalBytes), "too_big");
  assert.match((await contentProblem("docx", bomb))!, /çok büyük/);
});

test("docx/xlsx/xls-as-zip: declared bomb, broken zip, mismatched content", async () => {
  assert.equal(await contentProblem("docx", zip([{ data: bytes(1000) }])), null);
  assert.match((await contentProblem("xlsx", zip([{ data: bytes(1), declared: ZIP_LIMITS.totalBytes + 1 }])))!, /çok büyük/);
  assert.match((await contentProblem("xls", zip([{ data: bytes(300 * 1024 * 1024), declared: 1 }])))!, /çok büyük/, "xls that is really a zip gets the zip check");
  const broken = zip([{ data: bytes(100) }]);
  broken[40] ^= 0xff; // damage the deflate stream
  assert.notEqual(await contentProblem("docx", broken), null);
  assert.match((await contentProblem("docx", new Uint8Array(Buffer.from("%PDF-1.7"))))!, /uyuşmuyor/);
});

test("magic bytes per extension", async () => {
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 ..."));
  assert.equal(await contentProblem("pdf", pdf), null);
  assert.match((await contentProblem("pdf", zip([{ data: bytes(1) }])))!, /uyuşmuyor/);
  assert.equal(await contentProblem("xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), null);
  assert.match((await contentProblem("xls", pdf))!, /uyuşmuyor/);
  assert.equal(await contentProblem("csv", new Uint8Array(Buffer.from("a;b,1;2"))), null);
  assert.match((await contentProblem("txt", new Uint8Array([0x61, 0x00, 0x62])))!, /uyuşmuyor/, "NUL byte = binary");
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

test("tampered directories are rejected, not read as empty", async () => {
  const good = zip([{ data: bytes(1000) }, { data: bytes(10) }]);
  const eocd = good.length - 22;
  const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  const zeroTotal = good.slice();
  dv(zeroTotal).setUint16(eocd + 10, 0, true); // "0 entries" while the disk count still says 2
  assert.equal(zipTotals(zeroTotal), null);
  assert.notEqual(await contentProblem("xlsx", zeroTotal), null);

  const bothZero = good.slice();
  dv(bothZero).setUint16(eocd + 8, 0, true);
  dv(bothZero).setUint16(eocd + 10, 0, true);
  assert.equal(zipTotals(bothZero), null, "directory bytes say 2 entries, counts say 0");

  // A fake EOCD hidden in the archive comment: the real EOCD must end the file exactly.
  const fake = Buffer.alloc(22);
  fake.writeUInt32LE(0x06054b50, 0);
  const withComment = Buffer.concat([Buffer.from(good.subarray(0, eocd + 20)), Buffer.from([22, 0]), fake]);
  // The fake one ends the file, so it is what a parser would use too: an ambiguous archive is refused.
  assert.equal(zipTotals(new Uint8Array(withComment)), null, "fake EOCD in the comment → rejected");
  const lyingComment = Buffer.from(withComment);
  lyingComment.writeUInt16LE(5, eocd + 20); // comment length no longer reaches the end
  assert.equal(zipTotals(new Uint8Array(lyingComment)), null);
});
