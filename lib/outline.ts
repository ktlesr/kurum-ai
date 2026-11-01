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
// eslint-disable-next-line no-control-regex -- control characters are the chat stream's own separators: they can't pass
const plain = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/[`*_<>[\]|\\]/g, "").replace(/\s+/g, " ").trim();

// The number as OCR left it: "52W/A" is an article with a misread digit, which must stay in the list and say so.
const ARTICLE = /^((?:(?:ek|geçici|GEÇİCİ|gecici|mükerrer)\s+)?madde)\s+(\d[\d\p{Lu}]{0,5}(?:\/[\p{Lu}])?)\s*(?:[-–—:.]\s*|(?=\())(.*)$/iu;
const WORDS_ALONE = /^(?:GİRİŞ|SONUÇ|ÖZET|ÖNSÖZ|KAYNAKÇA|KAYNAKLAR|EKLER?|İÇİNDEKİLER|AMAÇ|KAPSAM|DAYANAK|TANIMLAR|ABSTRACT)$/u;
// Written with their capitals, and a part's list or annex standing alone or with its title: "Ek 1 kapsamında" and "ikinci
// bölüm uyarınca" are sentences.
const PART = /^(?:(?:BİRİNCİ|İKİNCİ|ÜÇÜNCÜ|DÖRDÜNCÜ|BEŞİNCİ|ALTINCI|YEDİNCİ|SEKİZİNCİ|DOKUZUNCU|ONUNCU|Birinci|İkinci|Üçüncü|Dördüncü|Beşinci|Altıncı|Yedinci|Sekizinci|Dokuzuncu|Onuncu|\d+\.?)\s+(?:BÖLÜM|KISIM|KİTAP|Bölüm|Kısım|Kitap)|(?:BÖLÜM|KISIM|Bölüm|Kısım)\s+\d+|(?:EK|Ek)\s*[-–:]?\s*\d+\s*(?:$|[-–:.]\s*\S|\p{Lu})|\(\d+\)?\s*(?:SAYILI|Sayılı|sayılı)\s+(?:LİSTE|Liste|liste|CETVEL|Cetvel|cetvel)\s*$)/u;
const NUMBERED = new RegExp(`^\\d+(?:\\.\\d+)+\\.?\\s+[^${lower}\\s]`, "u");
/** "1. Giriş": short, and words a misread line ("4. Bn i i n") doesn't have. */
const isNumberedTitle = (s: string) => s.length <= 60 && /^\d+\.\s+\p{Lu}/u.test(s) && s.replace(/^\d+\.\s+/, "").split(/\s+/).every((w) => w.length >= 2);
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
    const unsure = /\p{Lu}/u.test(article[2].split("/")[0]) ? " (numara okunamamış olabilir, asıl belgeden kontrol edin)" : "";
    return { text: `${article[1].toLocaleUpperCase("tr").replace(/\s+/g, " ")} ${article[2]}${unsure}${article[3] ? ` — ${article[3]}` : ""}` };
  }
  if (s.length <= MAX_LEN && !/[.;,]$/.test(s) && PART.test(s)) return { text: s };
  if (marked) return s.includes(" : ") ? null : { text: s };
  if (s.length > MAX_LEN || FINAL_STOP.test(s)) return null;
  if (NUMBERED.test(s) || isNumberedTitle(s)) return { text: s };
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
  const kept = found.filter((f) => (pagesOf.get(f.text)?.size ?? 0) < repeats && !(f.weak && times.get(f.text)! > 1 && !WORDS_ALONE.test(f.text)));
  return kept.filter((f, i) => !(kept[i - 1]?.text === f.text && kept[i - 1]?.page === f.page)).map(({ page, text }) => ({ page, text }));
}

/** Asked for the list of a document's headings, not for what some heading says. */
export function asksForOutline(question: string): boolean {
  const q = question.toLocaleLowerCase("tr");
  // The headings themselves, a word asking for them, and nothing to do with them: analysis needs the model.
  return /içindekiler|başlıklar/u.test(q) && /listele|sırala|çıkar|göster|yaz|\bver|neler|\bne\b/u.test(q) && !/altında|tutarlı|karşılaştır|özetle|açıkla|değerlendir|analiz|yorumla|anlat|içerik|kaç\b|hangi/u.test(q);
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
