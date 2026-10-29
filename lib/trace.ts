// Sentence → source tracing (plan §5.2): each factual sentence of an answer is matched, by code, to the passage of the
// selected documents that supports it best, with its page/sheet and a short quote. A sentence nothing supports is
// labelled as such. Pure: no model call, no server deps (node --test covers it).
import { normNum } from "./checks.ts";
import { tokens } from "./search.ts";

export type ClaimStatus = "ok" | "weak" | "none";
export interface Claim {
  /** The sentence as it appears in the answer (trimmed, markdown marks removed), at most 160 chars. */
  text: string;
  status: ClaimStatus;
  /** "<doc> · Sayfa 3" / "Sayfa 3" (single document) — the same chip format as meta.sources, for the source panel. */
  source?: string;
  /** The supporting source sentence, at most 220 chars. */
  quote?: string;
}

const MAX_PASSAGES = 20_000;
const PASSAGE = 420; // chars per passage window; a sentence or two of a report

/**
 * Numbers of a text in one notation: "1.250.000" = "1250000", "4,5" = "4.5", a sign kept ("-50" isn't "50"; a hyphen
 * between numbers, "2025-2026", is no sign), dates and other dotted groups whole ("15.11.2026" isn't "15.11.2027").
 */
export const numbersOf = (s: string) =>
  new Set(
    [...s.matchAll(/(?<![\p{L}\p{N}.,])[-−]?\d+(?:[.,]\d+)*/gu)].map((m) => {
      const n = normNum(m[0].replace("−", "-"));
      return /^-?\d+(\.\d+)?$/.test(n) ? String(Number(n)) : n;
    }),
  );

/** Abbreviations a sentence doesn't end at ("Dr. Ahmet", "vb. belgeler"). */
const ABBR = /(?:^|\s)(dr|prof|doç|av|sn|no|md|mad|vb|vs|örn|bkz|yy|ltd|şti|a\.ş|st|cad|sok|mah)\.$/i;

/** Sentences worth tracing: a figure in them, or enough words to state a fact. */
export function claimsOf(answer: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of answer.split("\n")) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      fence = !fence; // code blocks, delimiters and contents, aren't claims
      continue;
    }
    // Tables are checked number by number elsewhere; headings, rules and code aren't claims.
    if (fence || !t || t.startsWith("|") || t.startsWith("#") || t.startsWith(">") || /^(-{3,}|\*{3,})$/.test(t)) continue;
    const plain = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\*\*|__|`|(?<!\w)[*_]|[*_](?!\w)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Split after . ! ? … before a capital, a digit or an opening mark; glue back pieces cut after an abbreviation.
    const pieces: string[] = [];
    for (const p of plain.split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9"“(])/)) {
      if (pieces.length && ABBR.test(pieces[pieces.length - 1])) pieces[pieces.length - 1] += ` ${p}`;
      else pieces.push(p);
    }
    for (const s of pieces) {
      const x = s.trim();
      if (x.length < 25 || /\?$/.test(x)) continue;
      if (/^(kaynak|kaynaklar|not|özetle|sonuç olarak)\s*:/i.test(x)) continue;
      const words = tokens(x).filter((w) => !/^\d/.test(w));
      if (numbersOf(x).size || words.length >= 6) out.push(x);
    }
  }
  return out.slice(0, 60);
}

interface Passage { doc: string; label: string; text: string; words: Set<string>; nums: Set<string> }

/**
 * Each document cut on its page/sheet markers, then into overlapping windows. Every document is covered whole: the
 * passage budget is shared between them, and a document too long for its share gets longer windows, not fewer.
 */
function passages(docs: { name: string; text: string }[]): Passage[] {
  const out: Passage[] = [];
  const share = Math.floor(MAX_PASSAGES / docs.length);
  for (const d of docs) {
    const size = Math.max(PASSAGE, Math.ceil(d.text.length / (share * 0.75)) + 1);
    // "--- Sayfa N ---" (PDF/DOCX) and "## Sheet: X" (spreadsheets) mark where each part of the text comes from.
    const parts = d.text.split(/^(?=--- Sayfa \d+ ---$|## Sheet: )/m);
    for (const part of parts) {
      const head = (/^--- (Sayfa \d+) ---$/m.exec(part.slice(0, 40))?.[1] ?? /^## (Sheet: .+)$/m.exec(part.slice(0, 200))?.[1] ?? "").slice(0, 120);
      // A page marker is no evidence ("Sayfa 3" doesn't support "3 ay"): only its label is kept. A sheet's name is
      // the document's own words ("Bütçe") and stays.
      const body = part.replace(/^--- Sayfa \d+ ---\n?/, "");
      for (let i = 0; i < body.length; i += size * 0.75) {
        const text = body.slice(i, i + size);
        out.push({ doc: d.name, label: head, text, words: new Set(tokens(text).filter((w) => !/^\d/.test(w))), nums: numbersOf(text) });
      }
    }
  }
  return out;
}

/** The source sentence of a passage that shares most with the claim, cut to a readable quote. */
function quoteOf(p: Passage, words: string[], nums: Set<string>): string {
  const sentences = p.text.replace(/^--- Sayfa \d+ ---\s*/, "").split(/(?<=[.!?:;])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
  let best = sentences[0] ?? p.text;
  let score = -1;
  for (const s of sentences) {
    const ws = new Set(tokens(s));
    const sc = words.filter((w) => ws.has(w)).length + 3 * [...nums].filter((n) => numbersOf(s).has(n)).length;
    if (sc > score) {
      score = sc;
      best = s;
    }
  }
  return best.length > 220 ? `${best.slice(0, 217).trimEnd()}…` : best;
}

/**
 * Every claim of the answer with its best passage. "ok": every figure of the sentence is in the passage and most of
 * its words are; "weak": partly; "none": nothing in the documents says it (general knowledge, a calculation or made
 * up — the UI says which sentences these are).
 */
export function traceClaims(answer: string, docs: { name: string; text: string }[]): Claim[] {
  return traceTexts(claimsOf(answer), docs);
}

/** The same matching for given texts (e.g. a poster's title and date), whatever their length. */
export function traceTexts(texts: string[], docs: { name: string; text: string }[]): Claim[] {
  if (!docs.length) return [];
  const ps = passages(docs);
  const single = docs.length === 1;
  return texts.map((text): Claim => {
    const words = [...new Set(tokens(text).filter((w) => !/^\d/.test(w)))];
    const nums = numbersOf(text);
    let best: Passage | null = null;
    let bestScore = 0;
    let bestCover = 0;
    let bestNums = 0;
    for (const p of ps) {
      let hit = 0;
      for (const w of words) if (p.words.has(w)) hit++;
      let nhit = 0;
      for (const n of nums) if (p.nums.has(n)) nhit++;
      // Figures weigh more than words: "2026'da %42 arttı" is about the 42.
      const score = hit + 3 * nhit;
      if (score > bestScore) {
        bestScore = score;
        best = p;
        bestCover = words.length ? hit / words.length : 1;
        bestNums = nums.size ? nhit / nums.size : 1;
      }
    }
    const short = text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
    if (!best) return { text: short, status: "none" };
    const status: ClaimStatus = bestNums === 1 && bestCover >= 0.5 ? "ok" : bestCover >= 0.3 && bestNums >= 0.5 ? "weak" : "none";
    if (status === "none") return { text: short, status };
    const label = best.label || "Başlangıç";
    return { text: short, status, source: (single ? (best.label ? label : best.doc) : `${best.doc} · ${label}`).slice(0, 300), quote: quoteOf(best, words, nums) };
  });
}
