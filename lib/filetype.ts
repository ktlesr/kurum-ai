// Upload checks that don't trust the file name (plan §9, OWASP file upload; audit S5). Pure, no Next.
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

const inflate = promisify(inflateRaw);

export const ZIP_LIMITS = { totalBytes: 200 * 1024 * 1024, entries: 10_000 };

const startsWith = (buf: Uint8Array, sig: number[]) => sig.every((b, i) => buf[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4: docx, xlsx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .xls/.doc

/** null when the bytes fit the extension, else a Turkish message for a 415. */
export async function contentProblem(ext: string, buf: Uint8Array): Promise<string | null> {
  const bad = `Dosya içeriği ".${ext}" uzantısıyla uyuşmuyor. Dosya bozuk ya da yanlış adlandırılmış olabilir.`;
  switch (ext) {
    case "pdf":
      // Readers accept junk before the header, but our files come from office tools: header must lead (within 1 KB).
      return indexOf(buf.subarray(0, 1024), PDF) >= 0 ? null : bad;
    case "docx":
    case "xlsx":
      return startsWith(buf, ZIP) ? zipProblem(buf) : bad;
    case "xls":
      // Some tools save xlsx content as .xls: then it gets the same zip-bomb check.
      return startsWith(buf, OLE) ? null : startsWith(buf, ZIP) ? zipProblem(buf) : bad;
    case "csv":
    case "txt":
    case "md":
      // Text: no NUL bytes in the first 64 KB (binary disguised as text).
      return buf.subarray(0, 65536).includes(0) ? bad : null;
    default:
      return null; // unknown extensions are rejected later by the parser with their own message
  }
}

async function zipProblem(buf: Uint8Array): Promise<string | null> {
  const z = zipTotals(buf);
  if (!z) return "Dosya bozuk görünüyor (ZIP yapısı okunamadı).";
  const tooBig = "Dosya açıldığında çok büyük (sıkıştırılmış içerik sınırı aşıldı).";
  if (z.entries > ZIP_LIMITS.entries || z.uncompressed > ZIP_LIMITS.totalBytes) return tooBig;
  // Declared sizes are the uploader's word. Inflate for real, capped, before any parser sees the file.
  const actual = await inflatedSize(buf, ZIP_LIMITS.totalBytes);
  return actual === "corrupt" ? "Dosya bozuk görünüyor (ZIP içeriği açılamadı)." : actual === "too_big" ? tooBig : null;
}

/** Real total of all entries (stored + deflate), stopping as soon as it passes `max`. */
export async function inflatedSize(buf: Uint8Array, max: number): Promise<number | "too_big" | "corrupt"> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = zipEntries(buf);
  if (!entries) return "corrupt";
  let total = 0;
  for (const { method, csize, local } of entries) {
    if (local + 30 > buf.length || v.getUint32(local, true) !== 0x04034b50) return "corrupt";
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + csize > buf.length) return "corrupt";
    const data = buf.subarray(start, start + csize);
    if (method === 0) total += csize;
    else if (method === 8) {
      try {
        total += (await inflate(data, { maxOutputLength: max - total + 1 })).byteLength;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" ? "too_big" : "corrupt";
      }
    } else return "corrupt"; // office files only use stored/deflate
    if (total > max) return "too_big";
  }
  return total;
}

function indexOf(buf: Uint8Array, sig: number[]): number {
  outer: for (let i = 0; i + sig.length <= buf.length; i++) {
    for (let j = 0; j < sig.length; j++) if (buf[i + j] !== sig[j]) continue outer;
    return i;
  }
  return -1;
}

interface ZipEntry {
  method: number;
  flags: number;
  csize: number;
  usize: number;
  local: number;
}

/**
 * The ZIP central directory, read strictly: the EOCD must end the file exactly (no fake record hidden in the
 * comment), its two entry counts must agree, and walking the directory by its declared byte size must find exactly
 * that many entries. ZIP64 (0xFFFF/0xFFFFFFFF markers) and anything inconsistent → null (rejected): office files
 * this size never need ZIP64, and a parser must not be able to see entries this check didn't.
 */
export function zipEntries(buf: Uint8Array): ZipEntry[] | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const onDisk = v.getUint16(eocd + 8, true), count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true), cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0 || count === 0xffff || onDisk !== count || cdOffset === 0xffffffff || cdOffset + cdSize !== eocd) return null;
  const out: ZipEntry[] = [];
  for (let p = cdOffset; p < cdOffset + cdSize; ) {
    if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) return null;
    const e = { method: v.getUint16(p + 10, true), flags: v.getUint16(p + 8, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true), local: v.getUint32(p + 42, true) };
    if (e.csize === 0xffffffff || e.usize === 0xffffffff || e.local === 0xffffffff) return null;
    out.push(e);
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    if (p > cdOffset + cdSize) return null;
  }
  if (out.length !== count || !localsAgree(v, out, cdOffset)) return null;
  return out;
}

/**
 * Parsers differ in what they trust: SheetJS reads the local headers, we read the central directory. So both must
 * say the same thing (method, sizes, no ZIP64 extra), and the local entries must tile the archive from byte 0 up
 * to the central directory with no gaps — nothing can hide in between for a sequential reader to find.
 */
function localsAgree(v: DataView, entries: ZipEntry[], cdOffset: number): boolean {
  let expect = 0;
  for (const e of [...entries].sort((a, b) => a.local - b.local)) {
    const l = e.local;
    if (l !== expect || l + 30 > cdOffset || v.getUint32(l, true) !== 0x04034b50) return false;
    const flags = v.getUint16(l + 6, true), method = v.getUint16(l + 8, true);
    const csize = v.getUint32(l + 18, true), usize = v.getUint32(l + 22, true);
    const nameLen = v.getUint16(l + 26, true), extraLen = v.getUint16(l + 28, true);
    const descriptor = (flags & 0x8) !== 0; // sizes follow the data instead (then local sizes are 0)
    if (method !== e.method || ((flags ^ e.flags) & 0x8) !== 0) return false;
    if (!descriptor && (csize !== e.csize || usize !== e.usize)) return false;
    if (descriptor && (csize !== 0 && csize !== e.csize)) return false;
    // ZIP64 extra field (id 0x0001) in the local header: sizes we didn't check.
    for (let x = l + 30 + nameLen; x + 4 <= l + 30 + nameLen + extraLen; x += 4 + v.getUint16(x + 2, true)) {
      if (v.getUint16(x, true) === 0x0001) return false;
    }
    expect = l + 30 + nameLen + extraLen + e.csize;
    if (descriptor) expect += expect + 4 <= cdOffset && v.getUint32(expect, true) === 0x08074b50 ? 16 : 12;
  }
  return expect === cdOffset;
}

/** Declared totals (cheap pre-check before the real inflate). */
export function zipTotals(buf: Uint8Array): { entries: number; uncompressed: number } | null {
  const e = zipEntries(buf);
  return e && { entries: e.length, uncompressed: e.reduce((n, x) => n + x.usize, 0) };
}

/**
 * Reads at most `max` bytes of a body stream; null as soon as it grows past that, so an oversized upload is never
 * buffered whole (audit S5: formData() used to read everything before the size check).
 */
export async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
