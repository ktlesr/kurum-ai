// Dimension values the model wrote, matched to the real ones of the active version (prompt §5): case and Turkish
// letters ignored, the synonym lists of lib/destek/semantic, a unique prefix ("afyon"), then a small typo. Anything
// else is not guessed: the tool says "no such value" with the closest ones, so "filter matched nothing" never looks
// like "no data".
import { foldTr } from "../gallery-search.ts";
import { FAMILY_WORDS, PLACE_WORDS } from "./semantic.ts";

const key = (s: string) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, "");

export function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export type Match = { value: string; note?: string } | { error: string };

/** One value against the candidates; `words` maps extra spellings (folded) to a candidate. */
export function matchValue(input: string, candidates: string[], words: Record<string, string> = {}): Match {
  const k = key(input);
  if (!k) return { error: `boş değer` };
  const byKey = new Map(candidates.map((c) => [key(c), c]));
  const exact = byKey.get(k);
  if (exact) return { value: exact };
  const word = words[k];
  if (word && candidates.includes(word)) return { value: word, note: `"${input}" → ${word}` };
  if (k.length >= 3) {
    const pre = candidates.filter((c) => key(c).startsWith(k));
    if (pre.length === 1) return { value: pre[0], note: `"${input}" → ${pre[0]}` };
  }
  const near = candidates.map((c) => ({ c, d: distance(k, key(c)) })).sort((a, b) => a.d - b.d);
  const room = k.length >= 8 ? 2 : k.length >= 4 ? 1 : 0;
  if (near.length && near[0].d <= room && (near.length === 1 || near[1].d > near[0].d))
    return { value: near[0].c, note: `"${input}" → ${near[0].c} (yazım farkı)` };
  const close = near.filter((n) => n.d <= 3).slice(0, 5).map((n) => n.c);
  return { error: `"${input}" bu dosyada yok${close.length ? `; benzerleri: ${close.join(", ")}` : ""}` };
}

/** Folded spelling → family, from FAMILY_WORDS. */
export const FAMILY_SPELLINGS: Record<string, string> = Object.fromEntries(
  Object.entries(FAMILY_WORDS).flatMap(([fam, ws]) => ws.map((w) => [key(w), fam])),
);
export const PLACE_SPELLINGS: Record<string, string> = Object.fromEntries(Object.entries(PLACE_WORDS).map(([w, p]) => [key(w), p]));
