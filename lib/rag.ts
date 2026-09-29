import "server-only";
import { DEFAULT_CHARS_PER_TOKEN } from "./context";
import { OLLAMA_URL, type Doc } from "./server";

export const EMBED_MODEL = process.env.EMBED_MODEL ?? "embeddinggemma";
const CHUNK = Math.round(800 * DEFAULT_CHARS_PER_TOKEN);
export const TOP_K = 6;

export interface Chunk {
  doc: string;
  label: string;
  text: string;
  vec?: number[];
}

/** Split on page/sheet markers first so every chunk carries its location. */
export function chunkText(docName: string, text: string, size = CHUNK, overlap = Math.round(size * 0.15)): Chunk[] {
  const out: Chunk[] = [];
  const parts = text.split(/^(--- Sayfa \d+ ---|## Sheet: .+)$/m);
  // split() with a capture group → [before, marker, body, marker, body, ...]
  const sections: [string, string][] = [["", parts[0]]];
  for (let i = 1; i < parts.length; i += 2) sections.push([parts[i], parts[i + 1] ?? ""]);
  let n = 0;
  for (const [marker, body] of sections) {
    // Text before the first page marker (outline, findings) is the document's front matter.
    const label = marker.startsWith("---") ? marker.replace(/-/g, "").trim() : marker ? marker.slice(3) : sections.length > 1 ? "Başlangıç" : "";
    for (let start = 0; start < body.length; ) {
      let end = Math.min(body.length, start + size);
      const nl = body.lastIndexOf("\n", end);
      if (end < body.length && nl > start + size / 2) end = nl;
      const piece = body.slice(start, end).trim();
      if (piece) out.push({ doc: docName, label: label || `Bölüm ${++n}`, text: piece });
      if (end >= body.length) break;
      start = end - overlap;
    }
  }
  return out;
}

/** Consecutive pages merged into windows of at most maxChars, for scanning a whole document piece by piece. */
export function windows(docs: Doc[], maxChars: number): Chunk[] {
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

// embeddinggemma was trained with these task prefixes
const asQuery = (q: string) => `task: search result | query: ${q}`;
const asDoc = (c: Chunk) => `title: ${c.doc} ${c.label} | text: ${c.text}`;

async function embed(input: string[], signal: AbortSignal): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    signal,
    body: JSON.stringify({ model: EMBED_MODEL, input, truncate: true }),
  });
  const j = (await res.json()) as { embeddings?: number[][]; error?: string };
  if (!res.ok || !j.embeddings) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.embeddings;
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
};

/** Top-k chunks across docs. Doc embeddings are computed once and kept on the Doc. */
export async function retrieve(docs: Doc[], query: string, signal: AbortSignal): Promise<Chunk[]> {
  for (const d of docs) {
    if (d.chunks) continue;
    const chunks = chunkText(d.name, d.text);
    for (let i = 0; i < chunks.length; i += 32) {
      const vecs = await embed(chunks.slice(i, i + 32).map(asDoc), signal);
      vecs.forEach((v, k) => (chunks[i + k].vec = v));
    }
    d.chunks = chunks;
  }
  const [q] = await embed([asQuery(query)], signal);
  // ponytail: brute-force scan; fine up to tens of thousands of chunks
  return docs
    .flatMap((d) => d.chunks!)
    .map((c) => ({ c, s: cosine(q, c.vec!) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP_K)
    .map(({ c }) => c);
}
