import "server-only";
import { DEFAULT_CHARS_PER_TOKEN } from "./context";
import type { Doc } from "./server";
import { modelConfig, providerOf } from "./model-config";
import { admission } from "./admission";
import { bm25, ranked, rrf } from "./search";
import { logError } from "./log";

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

type Embedder = { key: string; run: (input: string[], signal: AbortSignal) => Promise<number[][]> };

/** The embedding server and model chosen on the admin page; key tells vectors of one model from another's. */
async function embedder(): Promise<Embedder> {
  const { embed } = await modelConfig();
  const p = providerOf(embed);
  return { key: `${embed.kind}|${embed.url}|${embed.model}`, run: (input, signal) => admission.model.run(() => p.embed(embed.model, input, signal), signal) };
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
};

/** Embedding ranking (indices into all), best first. Doc embeddings are computed once and kept on the Doc. */
async function semantic(docs: Doc[], all: Chunk[], query: string, signal: AbortSignal, embed: Embedder): Promise<number[]> {
  // This request's own vectors: another request switching the embedding model may replace d.chunks meanwhile.
  const mine: Chunk[][] = [];
  for (const d of docs) {
    // Vectors from another embedding model aren't comparable with this query's: recompute.
    if (d.chunks && d.chunksKey === embed.key) {
      mine.push(d.chunks);
      continue;
    }
    const chunks = chunkText(d.name, d.text);
    for (let i = 0; i < chunks.length; i += 32) {
      const vecs = await embed.run(chunks.slice(i, i + 32).map(asDoc), signal);
      vecs.forEach((v, k) => (chunks[i + k].vec = v));
    }
    d.chunks = chunks;
    d.chunksKey = embed.key;
    mine.push(chunks);
  }
  const [q] = await embed.run([asQuery(query)], signal);
  const vecs = mine.flat();
  // ponytail: brute-force scan; fine up to tens of thousands of chunks
  return vecs.map((c, i) => [cosine(q, c.vec!), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i).slice(0, all.length);
}

/**
 * Top-k chunks across docs: keyword (BM25) and embedding rankings fused by RRF, so exact figures, codes and names
 * are found even where the embedding misses them. If the embedding call fails, keyword search alone answers
 * (semantic: false) instead of falling back to the start of the document.
 */
export async function retrieve(docs: Doc[], query: string, signal: AbortSignal): Promise<{ chunks: Chunk[]; semantic: boolean; matched: boolean }> {
  // Same chunking as the cached embeddings, so index i means the same chunk in both rankings.
  const all = docs.flatMap((d) => d.chunks ?? chunkText(d.name, d.text));
  const keyword = ranked(bm25(all.map((c) => `${c.label} ${c.text}`), query));
  let sem: number[] | null = null;
  const embed = await embedder();
  try {
    sem = await semantic(docs, all, query, signal, embed);
  } catch (e) {
    if (signal.aborted) throw e;
    logError(`rag ${embed.key}`, e);
  }
  // Nothing matched by keyword and no embeddings: the first chunks beat an empty context.
  const order = sem ? rrf([sem, keyword]) : keyword.length ? keyword : all.map((_, i) => i);
  return { chunks: order.slice(0, TOP_K).map((i) => all[i]), semantic: !!sem, matched: keyword.length > 0 };
}
