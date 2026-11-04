// Finding photos by words: folder and file names first, then what the local model saw in them. Only ever returns files that exist.
// Pure: tests drive it.

export type GalleryKind = "photo" | "video";
export interface GalleryEntry { id: string; path: string; name: string; size: number; mtime: number; caption?: string; year?: number; kind?: GalleryKind }

/** ı/i, ş/s…: "usak" finds "Uşak". */
export function foldTr(s: string): string {
  return s.toLocaleLowerCase("tr").replace(/[ıİ]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u").replace(/i̇/g, "i");
}
const words = (s: string) => foldTr(s).match(/[\p{L}\p{N}]+/gu) ?? [];

// Words about the asking, not the photos. "proje" stays out too: folders are often named without it.
const ASKING = new Set(["bana", "bize", "bir", "birkac", "tane", "adet", "resim", "resmi", "resmini", "resimler", "resimleri", "resimlerini", "resimlerinden", "resimlerden", "fotograf", "fotografi", "fotografini", "fotograflar", "fotograflari", "fotograflarini", "fotograflarindan", "fotograflardan", "foto", "fotolar", "fotolari", "fotolarini", "fotolarindan", "gorsel", "gorseli", "gorselini", "gorseller", "gorselleri", "gorsellerini", "gorsellerinden", "video", "videosu", "videosunu", "videolar", "videolari", "videolarini", "videolarindan", "videolardan", "videoyu", "videoda", "film", "filmi", "filmini", "filmleri", "filmlerini", "klip", "klibi", "klibini", "klipler", "klipleri", "galeri", "galeriden", "galerideki", "getir", "getirir", "getirin", "getirsene", "goster", "gosterir", "gosterin", "gostersene", "bul", "bulur", "bulun", "listele", "listeleyin", "ac", "ver", "verir", "misin", "misiniz", "musun", "lutfen", "ile", "ilgili", "ait", "olan", "icin", "daha", "ve", "de", "da", "su", "bu", "o", "proje", "projesi", "projesinin", "projesine", "projeden", "projenin", "yi", "ten", "den", "nin", "nun", "ayni", "gecen", "yil", "yili", "yilki", "bu",
  // A question about having them ("görselleri var mı?", "video veya resim") and a clarification ("galeride demek istedim").
  "var", "mi", "mu", "veya", "ya", "yok", "mevcut", "bulunuyor", "galeride", "galeriye", "galerideki", "demek", "istedim", "kastettim", "klasor", "klasorde", "klasorden", "klasordeki", "klasorundeki", "klasorunde", "icinde", "icindeki"]);
/**
 * The asking verbs in every form lib/gallery-intent accepts (folded: "bulur", "listeler", "gosterebilir", "musunuz"), so a
 * request it sends here isn't searched for its own verb ("listeler" left as a term matched nothing, seen in review).
 */
const ASKING_VERB = /^(?:(?:getir|goster|bul|listele)(?:ir|ur|er|ar|r|in|un|iniz|unuz|sene|ebilir|abilir)?|m[iu]s[iu]n(?:iz|uz)?)$/u;
const NUMBER_WORDS: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10 };

/** What was asked for: "videoları" videos, "resim/fotoğraf" photos, otherwise either. */
export function kindAsked(q: string): GalleryKind | undefined {
  const f = foldTr(q);
  const video = /(?<![\p{L}])(?:video|film|klip|klib)/u.test(f), photo = /(?<![\p{L}])(?:resim|resm|fotograf|foto|gorsel)/u.test(f);
  return video && !photo ? "video" : photo && !video ? "photo" : undefined;
}

export const DEFAULT_COUNT = 6;
export const MAX_COUNT = 24;

/** "3 tane", "üç fotoğraf": how many are wanted. */
export function countOf(q: string): number {
  const f = foldTr(q);
  const digit = /(?<![\p{L}\p{N}])(\d{1,3})\s*(?:tane|adet|resim|foto|gorsel|video)/u.exec(f)?.[1];
  if (digit) return Math.min(MAX_COUNT, Math.max(1, Number(digit)));
  for (const [w, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`(?<![\\p{L}])${w}\\s+(?:tane|adet|resim|foto|gorsel|video)`, "u").test(f)) return n;
  }
  return DEFAULT_COUNT;
}

export interface SearchTerms { terms: string[]; year?: number }

export function termsOf(q: string, thisYear: number): SearchTerms {
  const f = foldTr(q);
  let year: number | undefined;
  if (/gecen\s+yil/.test(f)) year = thisYear - 1;
  else if (/bu\s+yil/.test(f)) year = thisYear;
  const terms: string[] = [];
  for (const w of words(q)) {
    if (/^(?:19|20)\d\d$/.test(w)) year = Number(w);
    else if (/^\d+$/.test(w) || NUMBER_WORDS[w] !== undefined || ASKING.has(w) || ASKING_VERB.test(w) || w.length < 2) continue;
    else terms.push(w);
  }
  return { terms: [...new Set(terms)], year };
}

/** A word in the question matches the word in a name, with Turkish endings on either: "kilimleri" and "kilim". */
const hits = (term: string, word: string) => word === term || (term.length >= 3 && word.startsWith(term)) || (word.length >= 4 && term.startsWith(word));

interface Indexed { e: GalleryEntry; folder: string[]; file: string[]; caption: string[] }
const indexOf = (e: GalleryEntry): Indexed => ({
  e,
  folder: words(e.path.split("/").slice(0, -1).join(" ")),
  file: words(e.name.replace(/\.[^.]+$/, "")),
  caption: words(e.caption ?? ""),
});

function score(x: Indexed, terms: string[]): number {
  let total = 0;
  let found = 0;
  for (const t of terms) {
    const s = x.folder.some((w) => hits(t, w)) ? 3 : x.file.some((w) => hits(t, w)) ? 2 : x.caption.some((w) => hits(t, w)) ? 1 : 0;
    if (s) found++;
    total += s;
  }
  // Every word; of three or more, one may miss ("uşak kilim atölyesi" in a folder called Uşak Kilim).
  return found >= (terms.length >= 3 ? terms.length - 1 : terms.length) ? total : 0;
}

/** Same question, same order: "3 tane daha" goes on from where it stopped; a stable shuffle keeps them from being 3 near-identical shots. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export interface SearchResult<T = GalleryEntry> { items: T[]; total: number; folder?: string; terms: string[] }

export function searchGallery<T extends GalleryEntry>(all: readonly T[], query: string, opts: { count: number; offset?: number; thisYear: number; kind?: GalleryKind }): SearchResult<T> {
  const { terms, year } = termsOf(query, opts.thisYear);
  if (!terms.length && year === undefined) return { items: [], total: 0, terms };
  const seed = terms.join(" ") + (year ?? "");
  const found = all.flatMap((e) => {
    if (opts.kind && (e.kind ?? "photo") !== opts.kind) return [];
    if (year !== undefined && (e.year ?? new Date(e.mtime).getFullYear()) !== year && !e.path.includes(String(year))) return [];
    const s = terms.length ? score(indexOf(e), terms) : 1;
    return s ? [{ e, s, order: hash(seed + e.id) }] : [];
  }).sort((a, b) => b.s - a.s || a.order - b.order);
  const counts = new Map<string, number>();
  for (const f of found) {
    const dir = f.e.path.split("/").slice(0, -1).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const folder = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || undefined;
  const from = opts.offset ?? 0;
  return { items: found.slice(from, from + opts.count).map((f) => f.e), total: found.length, folder, terms };
}

/** Folders with the closest name, to offer when nothing matched. */
export function nearFolders(all: readonly GalleryEntry[], query: string, thisYear: number): string[] {
  const { terms } = termsOf(query, thisYear);
  const dirs = new Map<string, number>();
  for (const e of all) {
    const dir = e.path.split("/").slice(0, -1).join("/");
    if (!dir || dirs.has(dir)) continue;
    const ws = words(dir);
    dirs.set(dir, terms.filter((t) => ws.some((w) => hits(t, w))).length);
  }
  return [...dirs.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d);
}
