// Web search for questions the documents or the model can't answer: the stack's own SearXNG (deploy/compose.yml). What
// leaves the institution is the query, written from what the user typed; never document text. No "server-only": the test
// drives it against a local server.

export interface SearchResult { url: string; title: string; snippet: string }

const MAX_RESULTS = 5;

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

/** The model's one-line query; null when it says no search is needed or wrote something else than a query. */
export function parseSearchQuery(raw: string): string | null {
  const q = raw.trim().split("\n")[0].trim().replace(/^["'“”]+|["'“”.]+$/g, "");
  return !q || q.length > 150 || /^yok\b/i.test(q) ? null : q;
}
