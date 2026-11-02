// The year a JPEG was taken, from its EXIF. File dates change with copying; this doesn't. Pure, reads only within the bytes given,
// and any oddity is "don't know": photo files come from anywhere.

const ASCII_DATE = /^(19|20)\d\d:\d\d:\d\d/;

export function exifYear(b: Uint8Array): number | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  for (let guard = 0; guard < 64 && p + 4 <= b.length && b[p] === 0xff; guard++) {
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) return undefined; // the image itself begins
    const len = v.getUint16(p + 2);
    if (len < 2) return undefined;
    if (marker === 0xe1 && p + 10 < b.length && String.fromCharCode(...b.subarray(p + 4, p + 8)) === "Exif") return readTiff(b, v, p + 10, Math.min(b.length, p + 2 + len));
    p += 2 + len;
  }
  return undefined;
}

function readTiff(b: Uint8Array, v: DataView, base: number, end: number): number | undefined {
  if (base + 8 > end) return undefined;
  const order = v.getUint16(base);
  if (order !== 0x4949 && order !== 0x4d4d) return undefined;
  const le = order === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const textAt = (entry: number) => {
    const n = u32(entry + 4);
    if (n < 10 || n > 64) return "";
    const off = base + u32(entry + 8);
    if (off < base || off + n > end) return "";
    return String.fromCharCode(...b.subarray(off, off + n));
  };
  const year = (s: string) => (ASCII_DATE.test(s) ? Number(s.slice(0, 4)) : undefined);
  const ifd = (at: number, visit: (tag: number, entry: number) => void) => {
    if (at < base || at + 2 > end) return;
    const n = u16(at);
    for (let i = 0; i < n && i < 512; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > end) return;
      visit(u16(e), e);
    }
  };
  let sub = 0;
  let modified: number | undefined;
  ifd(base + u32(base + 4), (tag, e) => {
    if (tag === 0x8769) sub = u32(e + 8);
    if (tag === 0x0132) modified = year(textAt(e));
  });
  let taken: number | undefined;
  if (sub) ifd(base + sub, (tag, e) => {
    if (tag === 0x9003 || (tag === 0x9004 && !taken)) taken = year(textAt(e));
  });
  return taken ?? modified;
}
