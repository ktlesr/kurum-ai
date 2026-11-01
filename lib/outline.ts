// A document's headings with their pages, taken from its text by code: the question "list the headings" has an exact answer,
// so no model gets to reorder it, drop an article or invent a page. Works on what is stored (`--- Sayfa n ---` markers), so
// documents uploaded earlier need no second reading. What a heading says is what OCR read.

export type OutlineItem = { page: number | null; text: string };

const MAX_LEN = 90;
const MAX_ITEMS = 400;
const lower = "a-zçğıöşü";

/** The line without list dashes, markdown, opening quotes and the list number Docling can put before an article. */
function bare(line: string): string {
  return line
    .trim()
    .replace(/^(?:#+\s*|[-*•]\s+)+/, "")
    .replace(/^\d+\.\s+(?=["“]?madde\b)/iu, "")
    .replace(/\*\*/g, "")
    .replace(/^["“”'‘]+/, "")
    .trim();
}
function cut(s: string): string {
  if (s.length <= MAX_LEN) return s;
  const at = s.lastIndexOf(" ", MAX_LEN);
  return `${s.slice(0, at > 40 ? at : MAX_LEN)}…`;
}
/** Letters of the document can't act as markup in the list. */
const plain = (s: string) => s.replace(/[`*_<>[\]|\\]/g, "").replace(/\s+/g, " ").trim();

// The number as OCR left it: "52W/A" is an article with a misread digit, which must stay in the list and say so.
const ARTICLE = /^madde\s+(\d[\d\p{Lu}]{0,5}(?:\/[\p{Lu}])?)\s*(?:[-–—:.]\s*|(?=\())(.*)$/iu;
const WORDS_ALONE = /^(?:GİRİŞ|SONUÇ|ÖZET|ÖNSÖZ|KAYNAKÇA|KAYNAKLAR|EKLER?|İÇİNDEKİLER|AMAÇ|KAPSAM|DAYANAK|TANIMLAR|ABSTRACT)$/u;
const PART = /^(?:(?:birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu|\d+\.?)\s+(?:bölüm|kısım|kitap)|(?:bölüm|kısım)\s+\d+|ek\s*[-–:]?\s*\d+\b|\(\d+\)?\s*sayılı\s+(?:liste|cetvel)(?!\p{L})|geçici\s+madde\s+\d+)/iu;
const NUMBERED = new RegExp(`^\\d+(?:\\.\\d+)+\\.?\\s+[^${lower}\\s]`, "u");
const FINAL_STOP = /[.;,:]$/;

function isCaps(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length < 4 || s !== s.toLocaleUpperCase("tr") || s.includes(" : ")) return false;
  return /\s/.test(s) || WORDS_ALONE.test(s); // one word in capitals is more often a table's label or a signature
}

/** A heading on this line, as it will be listed, or null. `marked`: the reader itself took it for a heading. `weak`: only its capitals say so. */
function headingOf(raw: string): { text: string; weak?: boolean } | null {
  const marked = /^#{1,6}\s/.test(raw.trim());
  const s = bare(raw);
  if (!s || s.startsWith("|") || s.startsWith("(Önceki") || s.startsWith("[") || s.startsWith(">")) return null;
  const article = ARTICLE.exec(s);
  if (article) {
    const unsure = /\p{Lu}/u.test(article[1].split("/")[0]) ? " (numara okunamamış olabilir, asıl belgeden kontrol edin)" : "";
    return { text: `MADDE ${article[1]}${unsure}${article[2] ? ` — ${article[2]}` : ""}` };
  }
  if (s.length <= MAX_LEN && PART.test(s)) return { text: s };
  if (marked) return s.includes(" : ") ? null : { text: s };
  if (s.length > MAX_LEN || FINAL_STOP.test(s)) return null;
  if (NUMBERED.test(s)) return { text: s };
  return isCaps(s) ? { text: s, weak: true } : null;
}

export function docOutline(text: string): OutlineItem[] {
  // Anything before the first page is notes added on reading (older documents' own contents list among them); a file
  // without pages (a Word document) is all one.
  const first = text.search(/^--- Sayfa \d+ ---$/m);
  const parts = first < 0 ? [{ page: null as number | null, body: text.replace(/^--- Otomatik [^\n]*\n(?:- [^\n]*\n?)*/gm, "") }] : text.slice(first).split(/^(?=--- Sayfa \d+ ---$)/m).map((p) => {
    const nl = p.indexOf("\n");
    return { page: Number(/\d+/.exec(p.slice(0, nl < 0 ? undefined : nl))![0]), body: nl < 0 ? "" : p.slice(nl + 1) };
  });
  const found: (OutlineItem & { weak?: boolean })[] = [];
  const pagesOf = new Map<string, Set<number | null>>();
  for (const { page, body } of parts) {
    for (const line of body.split("\n")) {
      const h = headingOf(line);
      if (!h) continue;
      const text = cut(plain(h.text));
      if (!text) continue;
      found.push({ page, text, weak: h.weak });
      pagesOf.set(text, (pagesOf.get(text) ?? new Set()).add(page));
    }
  }
  // What stands on many pages is the page's running header, not a heading.
  const repeats = Math.max(3, Math.ceil(parts.length / 2));
  const times = new Map<string, number>();
  for (const f of found) times.set(f.text, (times.get(f.text) ?? 0) + 1);
  // Capitals alone that come back are labels of a form or table too.
  const kept = found.filter((f) => (pagesOf.get(f.text)?.size ?? 0) < repeats && !(f.weak && times.get(f.text)! > 1));
  return kept.filter((f, i) => !(kept[i - 1]?.text === f.text && kept[i - 1]?.page === f.page)).map(({ page, text }) => ({ page, text }));
}

/** Asked for the list of a document's headings, not for what some heading says. */
export function asksForOutline(question: string): boolean {
  const q = question.toLocaleLowerCase("tr");
  return /içindekiler|(?:ana|tüm|bütün)\s+başlık|başlıkların[ıi]\s+(?:ve\s+\S+\s+)?(?:\S+\s+){0,3}(?:listele|sırala|çıkar|göster|yaz)|başlıklar[ıi]?\s+ne(?:ler)?\b/u.test(q);
}

export function outlineMarkdown(docs: { name: string; items: OutlineItem[] }[]): string {
  const clean = (s: string) => plain(s);
  return docs.map(({ name, items }) => {
    const shown = items.slice(0, MAX_ITEMS);
    const out: string[] = docs.length > 1 ? [`### ${clean(name)}`, ""] : [];
    let last: number | null | undefined;
    for (const it of shown) {
      if (it.page !== null && it.page !== last) out.push(`${out.length && out.at(-1) !== "" ? "\n" : ""}**Sayfa ${it.page}**\n`);
      last = it.page;
      out.push(`- ${it.text}`);
    }
    if (items.length > shown.length) out.push(`\n… ve ${items.length - shown.length} başlık daha.`);
    return out.join("\n");
  }).join("\n\n");
}
