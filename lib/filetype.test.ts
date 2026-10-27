// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentProblem, inflatedSize, readLimited, ZIP_LIMITS, zipTotals } from "./filetype.ts";

import { deflateRawSync } from "node:zlib";

/**
 * Real little ZIP: local headers + data + central directory + EOCD. `declared` lets an entry lie about its
 * uncompressed size, like a crafted bomb would.
 */
type Entry = {
  data: Uint8Array;
  stored?: boolean;
  declared?: number;
  /** Tampering: what only the local header says. */
  localMethod?: number;
  localSize?: number;
  zip64Extra?: boolean;
  /** Bytes hidden after this entry's data, before the next one. */
  gap?: number;
  /** Sizes in a trailing data descriptor (flag bit 3), local sizes 0. */
  descriptor?: boolean;
  /** Tampering with a descriptor entry: non-zero local uncompressed size / lying descriptor size. */
  localDescUsize?: number;
  descriptorUsize?: number;
  /** ZIP64 extra field in the central directory entry only: this uncompressed size, then the real compressed size. */
  cdZip64Extra?: number;
  /** ...or a short one holding only the uncompressed size (8 bytes). */
  cdZip64Short?: boolean;
  /** Local extra length pointing past the directory. */
  localExtraLen?: number;
};
function zip(entries: Entry[]): Uint8Array {
  const locals: Buffer[] = [], cds: Buffer[] = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const name = Buffer.from(`f${i}.xml`);
    const body = e.stored ? Buffer.from(e.data) : deflateRawSync(e.data);
    const size = e.declared ?? e.data.byteLength;
    const method = e.stored ? 0 : 8;
    const flags = e.descriptor ? 0x8 : 0;
    // Local ZIP64 extra claiming 1 MiB (usize) and 1 MiB (csize): disagrees with the 32-bit fields.
    const extra = e.zip64Extra ? Buffer.from([0x01, 0x00, 0x10, 0x00, 0, 0, 0x10, 0, 0, 0, 0, 0, 0, 0, 0x10, 0, 0, 0, 0, 0]) : Buffer.alloc(0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(e.localMethod ?? method, 8);
    lh.writeUInt32LE(e.descriptor ? 0 : body.length, 18);
    lh.writeUInt32LE(e.descriptor ? (e.localDescUsize ?? 0) : (e.localSize ?? size), 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(e.localExtraLen ?? extra.length, 28);
    const dd = Buffer.alloc(e.descriptor ? 16 : 0);
    if (e.descriptor) {
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(body.length, 8);
      dd.writeUInt32LE(e.descriptorUsize ?? size, 12);
    }
    const gap = Buffer.alloc(e.gap ?? 0, 0x41);
    locals.push(lh, name, extra, body, dd, gap);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    const cdExtra = Buffer.alloc(e.cdZip64Extra === undefined ? 0 : e.cdZip64Short ? 12 : 20);
    if (e.cdZip64Extra !== undefined) {
      cdExtra.writeUInt16LE(0x0001, 0);
      cdExtra.writeUInt16LE(cdExtra.length - 4, 2);
      cdExtra.writeBigUInt64LE(BigInt(e.cdZip64Extra), 4);
      if (!e.cdZip64Short) cdExtra.writeBigUInt64LE(BigInt(body.length), 12);
    }
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(cdExtra.length, 30);
    ch.writeUInt32LE(offset, 42);
    cds.push(ch, name, cdExtra);
    offset += 30 + name.length + extra.length + body.length + dd.length + gap.length;
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

test("local headers must agree with the directory and tile the archive", async () => {
  assert.notEqual(zipTotals(zip([{ data: bytes(100), descriptor: true }, { data: bytes(5) }])), null, "data descriptors are fine");
  // Codex repro: directory says "stored, small", local says "deflate" — SheetJS would inflate by the local one.
  assert.equal(zipTotals(zip([{ data: bytes(1024 * 1024), declared: 1034, localMethod: 0 }])), null, "method mismatch");
  assert.equal(zipTotals(zip([{ data: bytes(10), localSize: 999 }])), null, "size mismatch");
  assert.equal(zipTotals(zip([{ data: bytes(10), zip64Extra: true }])), null, "ZIP64 extra in local header with other sizes");
  assert.equal(zipTotals(zip([{ data: bytes(10), gap: 64 }, { data: bytes(10) }])), null, "bytes hidden between entries");
  assert.notEqual(await contentProblem("xlsx", zip([{ data: bytes(10), gap: 64 }])), null);
});

test("descriptor entries and directory extras can't smuggle sizes past the check (Codex round 3 repros)", () => {
  // Directory declares 0 bytes; the local header of a descriptor entry claims 1 MiB.
  assert.equal(zipTotals(zip([{ data: bytes(10), descriptor: true, declared: 0, localDescUsize: 1024 * 1024 }])), null);
  // Descriptor itself lying about the size.
  assert.equal(zipTotals(zip([{ data: bytes(10), descriptor: true, descriptorUsize: 1024 * 1024 }])), null);
  // ZIP64 extra only in the central directory entry, claiming another size: refused.
  assert.equal(zipTotals(zip([{ data: bytes(10), cdZip64Extra: 1024 * 1024 }])), null);
  // ...but a redundant ZIP64 extra that repeats the checked size is fine (some office tools always write one).
  assert.notEqual(zipTotals(zip([{ data: bytes(10), cdZip64Extra: 10 }])), null);
  assert.notEqual(zipTotals(zip([{ data: bytes(10), descriptor: true }])), null, "an honest descriptor still passes");
});

test("short ZIP64 extras and out-of-bounds local extras are refused, not misread (Codex round 4)", () => {
  // SheetJS reads 16 bytes whatever the field says: an 8-byte field would lend it the next bytes as sizes.
  assert.equal(zipTotals(zip([{ data: bytes(10), cdZip64Extra: 10, cdZip64Short: true }])), null);
  // Local extra length running past the directory: a clean rejection, no RangeError.
  assert.doesNotThrow(() => assert.equal(zipTotals(zip([{ data: bytes(10), localExtraLen: 0xffff }])), null));
});
