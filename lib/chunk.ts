// Chunking for retrieval and whole-document scans (lib/rag). Pure, so node --test covers it.
import { DEFAULT_CHARS_PER_TOKEN } from "./context.ts";

export const CHUNK = Math.round(800 * DEFAULT_CHARS_PER_TOKEN);

export interface Chunk {
  doc: string;
  label: string;
  text: string;
  vec?: number[];
}

/** Bump when chunk texts change: cached embeddings of the old chunks must not be reused (lib/rag key). */
export const CHUNKING = "c2";

/**
 * A line that opens a section: a markdown heading, a numbered heading ("3.2. Destek oranları"), "MADDE 5", "BÖLÜM 2",
 * or a short title in capitals. Table rows and sentences (ending in . : ;) aren't headings.
 */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120 || t.startsWith("|")) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (/[.:;,…]$/.test(t)) return false; // a sentence, even one that starts like a heading ("MADDE 5 kapsamında …")
  if (/^(MADDE|Madde|BÖLÜM|Bölüm|KISIM|Kısım|EK|Ek)[\s-]+\d+/u.test(t) && t.length <= 80) return true;
  if (/^\d+(\.\d+){0,3}[.)]?\s+\p{Lu}/u.test(t) && t.length <= 90) return true;
  return /^[\p{Lu}\d\s,:;()\-/&'’]{6,80}$/u.test(t) && /\p{Lu}{3}/u.test(t);
}

const headingText = (line: string) => line.trim().replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").slice(0, 100);

/**
 * Split on page/sheet markers first so every chunk carries its location; inside a page, a cut falls before a section
 * heading when one is near the end of the window (else at a line break), and a chunk that starts mid-section gets the
 * section's heading in front ("[3.2 Destek oranları]"), carried across pages, so search and the model see what the
 * text is about.
 */
export function chunkText(docName: string, text: string, size = CHUNK, overlap = Math.round(size * 0.15)): Chunk[] {
  const out: Chunk[] = [];
  const parts = text.split(/^(--- Sayfa \d+ ---|## Sheet: .+)$/m);
  // split() with a capture group → [before, marker, body, marker, body, ...]
  const sections: [string, string][] = [["", parts[0]]];
  for (let i = 1; i < parts.length; i += 2) sections.push([parts[i], parts[i + 1] ?? ""]);
  let n = 0;
  let current = ""; // the heading in effect, across pages
  for (const [marker, body] of sections) {
    // Text before the first page marker (outline, findings) is the document's front matter.
    const label = marker.startsWith("---") ? marker.replace(/-/g, "").trim() : marker ? marker.slice(3) : sections.length > 1 ? "Başlangıç" : "";
    // Where the headings of this page start, and their text.
    const heads: { at: number; text: string }[] = [];
    for (let at = 0, i = 0; at <= body.length; at = i + 1) {
      i = body.indexOf("\n", at);
      if (i < 0) i = body.length;
      const line = body.slice(at, i);
      if (isHeading(line)) heads.push({ at, text: headingText(line) });
    }
    // One pass over the headings: k advances with the chunk start (starts only grow), so long pages stay linear.
    let k = 0; // first heading after `start`
    for (let start = 0; start < body.length; ) {
      while (k < heads.length && heads[k].at <= start) k++;
      const prev = heads[k - 1];
      const head = prev ? prev.text : current;
      // The chunk opens with a heading itself: one starts exactly here, or after only blank text.
      const at = prev && prev.at === start ? prev : heads[k];
      const opens = !!at && at.at - start < 200 && body.slice(start, at.at).trim() === "";
      // At most a quarter of the window, and counted toward it: the text keeps the rest, the window its limit.
      const fit = Math.floor(size / 4) - 3; // room for the heading inside "[…]\n"; none in a tiny window
      const prefix = head && !opens && fit > 0 ? `[${head.slice(0, fit)}]\n` : "";
      const room = Math.max(1, size - prefix.length);
      let end = Math.min(body.length, start + room);
      let atHeading = false;
      if (end < body.length) {
        let before: { at: number } | undefined;
        for (let m = k; m < heads.length && heads[m].at <= end; m++) if (heads[m].at > start + room / 2) before = heads[m];
        const nl = body.lastIndexOf("\n", end);
        if (before) {
          end = before.at;
          atHeading = true;
        } else if (nl > start + room / 2) end = nl;
      }
      const piece = body.slice(start, end).trim();
      if (piece) out.push({ doc: docName, label: label || `Bölüm ${++n}`, text: prefix + piece });
      if (end >= body.length) break;
      // A cut before a heading starts the next chunk at the heading itself (no overlap into the previous section).
      start = atHeading ? end : Math.max(start + 1, end - overlap); // always forward, whatever the overlap
    }
    current = heads.at(-1)?.text ?? current;
  }
  return out;
}

/** Consecutive pages merged into windows of at most maxChars, for scanning a whole document piece by piece. */
export function windows(docs: { name: string; text: string }[], maxChars: number): Chunk[] {
  const out: Chunk[] = [];
  for (const d of docs) {
    let cur: (Chunk & { first: string }) | null = null;
    for (const c of chunkText(d.name, d.text, maxChars, 0)) {
      if (cur && cur.text.length + c.text.length + 2 <= maxChars) {
        cur.text += "\n\n" + c.text;
        cur.label = cur.first === c.label ? c.label : `${cur.first} – ${cur.first.startsWith("Sayfa") ? c.label.replace(/^Sayfa /, "") : c.label}`;
      } else {
        if (cur) out.push(cur);
        cur = { ...c, first: c.label };
      }
    }
    if (cur) out.push(cur);
  }
  return out.map(({ doc, label, text }) => ({ doc, label, text }));
}
