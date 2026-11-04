// A question after one specific fact gets answered only if the documents state it: the model quotes the sentence before
// any answer is written, and the code checks the quote is really there. Prompt rules alone didn't stop the model filling
// the gap from the document's general subject.

export type Gate = { kind: "analysis" } | { kind: "general" } | { kind: "fact"; quote: string | null };

/** The model's two lines; null when they aren't what was asked for (the caller then answers as usual). */
export function parseGate(raw: string): Gate | null {
  const type = /T[ÜU]R\s*:[\s*_]*(OLGU|ANAL[İI]Z|GENEL)/iu.exec(raw)?.[1];
  if (!type) return null;
  if (/^genel$/iu.test(type)) return { kind: "general" }; // not about the documents: a plain request
  if (!/^olgu$/iu.test(type)) return { kind: "analysis" };
  const quote = /AL[Iı]NT[Iı]\s*:(.*)/iu.exec(raw)?.[1].replace(/^[\s*_"'“”«]+|[\s*_"'“”»]+$/gu, "");
  if (quote === undefined) return null;
  return { kind: "fact", quote: !quote || /^yok\.?$/iu.test(quote) ? null : quote };
}

/**
 * What the gate's verdict does. A plain request (the model's GENEL) skips the document checks, unless the request's own
 * words are about the document or ask for it as a file (`ofDoc`, decided in code). "Not stated" only where the fact
 * gate ran in full (`factGate`: the web part exists, a part of the document was searched).
 */
export function gatePolicy(gate: Gate | null, o: { ofDoc: boolean; factGate: boolean; quoted: (quote: string) => boolean }) {
  const general = gate?.kind === "general" && !o.ofDoc;
  return {
    general,
    analysis: gate?.kind === "analysis" || general,
    unstated: o.factGate && gate?.kind === "fact" && !(gate.quote && o.quoted(gate.quote)),
  };
}

// What can change a fact stays: digits with their separators and signs, and word boundaries. Line breaks, table bars and
// markdown go.
const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}.,%/-]+/gu, " ").trim();
const inWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
/** The match at [i, end) cuts through a word or a number: 30 in 130, 20 in -20, 1,20 or 20%, 15 in 15,00 or 15/07. */
const cuts = (d: string, i: number, end: number) =>
  inWord(d[i - 1]) || inWord(d[end]) ||
  (/\d/.test(d[i]) && /[-.,/]/.test(d[i - 1] ?? "")) ||
  (/\d/.test(d[end - 1]) && (d[end] === "%" || (/[-.,/]/.test(d[end] ?? "") && /\d/.test(d[end + 1] ?? ""))));

/** The quote stands in a document, as whole words. Says it exists, not that it answers the question. */
export function quoteInDocs(quote: string, docs: string[]): boolean {
  const q = fold(quote).replace(/[.,]+$/, "");
  if (!q) return false;
  return docs.some((doc) => {
    const d = fold(doc);
    for (let i = d.indexOf(q); i >= 0; i = d.indexOf(q, i + 1)) {
      if (!cuts(d, i, i + q.length)) return true;
    }
    return false;
  });
}
