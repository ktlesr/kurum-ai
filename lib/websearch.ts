// Web search for questions the documents or the model can't answer: the stack's own SearXNG (deploy/compose.yml). What
// leaves the institution is the query, written from what the user typed; never document text. No "server-only": the test
// drives it against a local server.

export interface SearchResult { url: string; title: string; snippet: string }

const MAX_RESULTS = 8;

export async function searchWeb(base: string, query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("/search", base);
  url.search = new URLSearchParams({ q: query, format: "json", language: "tr-TR", safesearch: "1" }).toString();
  const r = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!r.ok) throw new Error(`search_http_${r.status}`);
  const j = (await r.json()) as { results?: { url?: unknown; title?: unknown; content?: unknown }[] };
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const x of j.results ?? []) {
    if (typeof x.url !== "string" || !/^https?:\/\//i.test(x.url) || seen.has(x.url)) continue;
    seen.add(x.url);
    out.push({ url: x.url, title: typeof x.title === "string" ? x.title.slice(0, 200) : "", snippet: typeof x.content === "string" ? x.content.slice(0, 500) : "" });
    if (out.length === MAX_RESULTS) break;
  }
  return out;
}

const NOT_TERMS = new Set(["hangi", "nedir", "için", "kaç", "nasıl", "neden", "kim", "ile", "ve", "bir", "bugün"]);
const low = (s: string) => s.toLocaleLowerCase("tr");

/** Where a query's words and numbers occur. A word counts by its start (Turkish suffixes); a number only whole, and weighs more: it is what names the item. */
function findTerms(lower: string, query: string): { weight: number; at: number[] }[] {
  const words = [...new Set(low(query).match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => !NOT_TERMS.has(w) && (w.length >= 3 || /^\d+$/.test(w)));
  return words.map((w) => {
    const number = /^\d+$/.test(w);
    const term = number ? w : w.slice(0, 6);
    const at: number[] = [];
    for (let i = lower.indexOf(term); i >= 0; i = lower.indexOf(term, i + term.length)) {
      if (!number || !(/\d/.test(lower[i - 1] ?? "") || /\d/.test(lower[i + term.length] ?? ""))) at.push(i);
    }
    return { weight: number ? 3 : 1, at };
  }).filter((t) => t.at.length);
}

/**
 * The part of a long page that the query is about, at most `size` characters, with the heading it falls under (the
 * thing named at a section's top, which a question about one article needs): a law's text runs to hundreds of pages
 * and its start says nothing of article 493. `score` compares pages: the query's terms found together.
 */
export function passage(text: string, query: string, size: number): { text: string; score: number } {
  const lower = low(text);
  const terms = lower.length === text.length ? findTerms(lower, query) : []; // a length-changing lowercase would shift every position
  if (!terms.length) return { text: text.slice(0, size), score: 0 };
  const inWindow = (from: number, to: number) => terms.reduce((n, t) => {
    let lo = 0, hi = t.at.length; // the first occurrence at or after `from`; `at` is sorted
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t.at[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return n + (lo < t.at.length && t.at[lo] < to ? t.weight : 0);
  }, 0);
  if (text.length <= size) return { text, score: inWindow(0, text.length) };
  // Candidates: the rarest number if there is one, else the rarest word.
  const rarest = [...terms].sort((a, b) => b.weight - a.weight || a.at.length - b.at.length)[0];
  const place = (i: number) => {
    const from = Math.max(0, Math.min(i - Math.floor(size * 2 / 3), text.length - size));
    return { from, to: from + size };
  };
  let hit = rarest.at[0];
  let best = place(hit);
  let score = inWindow(best.from, best.to);
  for (const i of rarest.at.slice(1)) {
    const w = place(i);
    const s = inWindow(w.from, w.to);
    if (s > score) [hit, best, score] = [i, w, s];
  }
  // Inside the window it is already there. Only capitals count, so a later heading in small letters can be missed: the
  // label says what this is rather than claiming the section.
  const heading = headingBefore(text, hit);
  const above = heading && heading.at < best.from ? `(Yukarıdaki son büyük harfli başlık: ${heading.text})\n` : "";
  return { text: `${above}…${text.slice(best.from, best.to)}…`, score };
}

/** The nearest all-capitals line before `end`, with the line under it (a section's title often sits there). */
function headingBefore(text: string, end: number): { at: number; text: string } | null {
  let stop = text.lastIndexOf("\n", end); // the hit's own line is not its heading
  while (stop > 0) {
    const start = text.lastIndexOf("\n", stop - 1) + 1;
    const l = text.slice(start, stop).trim();
    if (l.length <= 120 && /\p{L}{4}/u.test(l) && l === l.toLocaleUpperCase("tr")) {
      const next = text.slice(stop + 1, text.indexOf("\n", stop + 1) >>> 0).trim();
      return { at: start, text: next && next.length <= 120 ? `${l} ${next}` : l };
    }
    stop = start - 1;
  }
  return null;
}

/** The model's one-line query; null when it says no search is needed or wrote something else than a query. */
export function parseSearchQuery(raw: string): string | null {
  const q = raw.trim().split("\n")[0].trim().replace(/^["'“”]+|["'“”.]+$/g, "");
  return !q || q.length > 150 || /^yok\b/i.test(q) ? null : q;
}
