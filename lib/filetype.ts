// Upload checks that don't trust the file name (plan §9, OWASP file upload; audit S5). Pure, no Next.

export const ZIP_LIMITS = { totalBytes: 200 * 1024 * 1024, entries: 10_000 };

const startsWith = (buf: Uint8Array, sig: number[]) => sig.every((b, i) => buf[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4: docx, xlsx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .xls/.doc

/** null when the bytes fit the extension, else a Turkish message for a 415. */
export function contentProblem(ext: string, buf: Uint8Array): string | null {
  const bad = `Dosya içeriği ".${ext}" uzantısıyla uyuşmuyor. Dosya bozuk ya da yanlış adlandırılmış olabilir.`;
  switch (ext) {
    case "pdf":
      // Readers accept junk before the header, but our files come from office tools: header must lead (within 1 KB).
      return indexOf(buf.subarray(0, 1024), PDF) >= 0 ? null : bad;
    case "docx":
    case "xlsx": {
      if (!startsWith(buf, ZIP)) return bad;
      const z = zipTotals(buf);
      if (!z) return "Dosya bozuk görünüyor (ZIP yapısı okunamadı).";
      if (z.entries > ZIP_LIMITS.entries || z.uncompressed > ZIP_LIMITS.totalBytes) {
        return "Dosya açıldığında çok büyük (sıkıştırılmış içerik sınırı aşıldı).";
      }
      return null;
    }
    case "xls":
      return startsWith(buf, OLE) || startsWith(buf, ZIP) ? null : bad; // some tools save xlsx content as .xls
    case "csv":
    case "txt":
    case "md":
      // Text: no NUL bytes in the first 64 KB (binary disguised as text).
      return buf.subarray(0, 65536).includes(0) ? bad : null;
    default:
      return null; // unknown extensions are rejected later by the parser with their own message
  }
}

function indexOf(buf: Uint8Array, sig: number[]): number {
  outer: for (let i = 0; i + sig.length <= buf.length; i++) {
    for (let j = 0; j < sig.length; j++) if (buf[i + j] !== sig[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Declared totals from the ZIP central directory, without inflating anything (zip-bomb check).
 * ZIP64 (sizes 0xFFFFFFFF) and broken directories return null → rejected: office files this size don't need ZIP64.
 */
export function zipTotals(buf: Uint8Array): { entries: number; uncompressed: number } | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: 22 bytes + up to 64 KB comment, searched from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) return null;
  let p = cdOffset, uncompressed = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) return null;
    const size = v.getUint32(p + 24, true);
    if (size === 0xffffffff) return null;
    uncompressed += size;
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return { entries, uncompressed };
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
