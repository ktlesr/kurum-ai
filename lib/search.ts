// Keyword side of hybrid retrieval (lib/rag): BM25 over chunks, fused with the embedding ranking by RRF.
// Pure functions, no server deps, so they're unit-tested directly.

/**
 * Lowercased (Turkish rules) words and numbers. Words are cut to 5 letters: a crude Turkish stem, so "bütçenin",
 * "bütçede" and "bütçe" meet. Numbers stay whole ("1.250.000", "4,5") since an exact figure is what's searched for.
 * ponytail: prefix stem; a real Turkish stemmer (Zemberek) if recall on inflected words proves short.
 */
export function tokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLocaleLowerCase("tr").matchAll(/\p{N}+(?:[.,]\p{N}+)*|\p{L}+/gu)) {
    const t = m[0];
    if (/^\p{N}/u.test(t)) out.push(t);
    else if (t.length >= 2) out.push(t.slice(0, 5));
  }
  return out;
}

/** BM25 score of each text for the query (k1 1.2, b 0.75); 0 = no query term present. */
export function bm25(texts: string[], query: string): number[] {
  const q = [...new Set(tokens(query))];
  const docs = texts.map((t) => {
    const tf = new Map<string, number>();
    const toks = tokens(t);
    for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { tf, len: toks.length };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1) || 1;
  const idf = new Map(q.map((w) => {
    const df = docs.filter((d) => d.tf.has(w)).length;
    return [w, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
  }));
  return docs.map((d) =>
    q.reduce((s, w) => {
      const f = d.tf.get(w) ?? 0;
      return f ? s + idf.get(w)! * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.len) / avg))) : s;
    }, 0),
  );
}

/** Indices ordered by score, highest first; zero scores dropped (they matched nothing). */
export const ranked = (scores: number[]) =>
  scores.map((s, i) => [s, i] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, i]) => i);

/** Reciprocal rank fusion of several rankings (lists of indices); returns the fused order. */
export function rrf(lists: number[][], k = 60): number[] {
  const score = new Map<number, number>();
  for (const list of lists) list.forEach((i, r) => score.set(i, (score.get(i) ?? 0) + 1 / (k + r + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
}
