import assert from "node:assert/strict";
import test from "node:test";
import { asksForOutline, docOutline, outlineMarkdown } from "./outline.ts";

const DOC = `--- Otomatik içindekiler (sayfa başlıkları ve sonuç satırları) ---
- Sayfa 3: ESKİ LİSTE

--- Sayfa 1 ---
## CUMHURBAŞKANLIĞI KARARNAMESİ

## Kararname Numarası: 202

MADDE 1- 4 sayılı Kararnamenin 500 üncü maddesi değiştirilmiştir.

- MADDE 3- 4 sayılı Kararnamenin 496 ncı maddesi.
- a) Program Geliştirme görevleri şunlardır:

--- Sayfa 3 ---
(Önceki sayfalardan süren bölüm: CUMHURBAŞKANLIĞI KARARNAMESİ)
## "Yönlendirme Komitesi

MADDE 496/A- (1) Kurum bünyesinde kurulan Yönlendirme Komitesi, Bakanın başkanlığında, Bakanlığın ilgili Bakan Yardımcısı ve Hazine Bakan Yardımcısından oluşur.

Madde 5 uyarınca işlem yapılır.

4. Bn    i i n

--- Sayfa 8 ---
## (1) SAYILI LİSTE

KURUMU : TÜRK İŞBİRLİĞİ AJANSI

| GİH | TOPLAM |

1.2 Kapsam ve Tanımlar

GİRİŞ
`;

test("headings come with their real pages, in order; ordinary lines don't", () => {
  const items = docOutline(DOC);
  assert.deepEqual(items.map((i) => [i.page, i.text.slice(0, 40)]), [
    [1, "CUMHURBAŞKANLIĞI KARARNAMESİ"],
    [1, "Kararname Numarası: 202"],
    [1, "MADDE 1 — 4 sayılı Kararnamenin 500 üncü m"],
    [1, "MADDE 3 — 4 sayılı Kararnamenin 496 ncı ma"],
    [3, "Yönlendirme Komitesi"],
    [3, "MADDE 496/A — (1) Kurum bünyesinde kurul"],
    [8, "(1) SAYILI LİSTE"],
    [8, "1.2 Kapsam ve Tanımlar"],
    [8, "GİRİŞ"],
  ].map(([p, t]) => [p, (t as string).slice(0, 40)]));
  assert.ok(items[5].text.endsWith("…") && items[5].text.length <= 92);
  assert.ok(!items.some((i) => i.text === "ESKİ LİSTE"), "the older contents list isn't read as the document");
});

test("a running header on every page isn't a heading; a file without pages still works", () => {
  const pages = [1, 2, 3, 4].map((n) => `--- Sayfa ${n} ---\nRESMİ GAZETE\nMADDE ${n}- Metin.`).join("\n\n");
  assert.deepEqual(docOutline(pages).map((i) => i.text), ["MADDE 1 — Metin.", "MADDE 2 — Metin.", "MADDE 3 — Metin.", "MADDE 4 — Metin."]);
  assert.deepEqual(docOutline("# Rapor\n\nDüz metin burada.\n\n## Sonuç"), [{ page: null, text: "Rapor" }, { page: null, text: "Sonuç" }]);
  assert.deepEqual(docOutline("Hiç başlığı olmayan düz bir metin."), []);
});

test("the list asked for, not a question about some heading", () => {
  for (const q of ["Dokümanın ana başlıklarını ve bölümlerini sırayla, sayfa numaralarıyla listele.", "içindekileri çıkar", "Başlıkları neler?", "bu belgenin tüm başlıklarını yaz", "başlıklarını listele"]) assert.ok(asksForOutline(q), q);
  for (const q of ["Tanımlar başlığı ne diyor?", "Yönlendirme Komitesi kimlerden oluşur?", "Özetle"]) assert.ok(!asksForOutline(q), q);
});

test("the answer groups by page and can't carry markup from the document", () => {
  const md = outlineMarkdown([{ name: "a.pdf", items: [{ page: 1, text: "A" }, { page: 1, text: "B" }, { page: 3, text: "C" }] }]);
  assert.equal(md, "**Sayfa 1**\n\n- A\n- B\n\n**Sayfa 3**\n\n- C");
  assert.ok(!docOutline("## [tıkla](http://x) <b>").some((i) => /[[\]<>]/.test(i.text)));
  const two = outlineMarkdown([{ name: "a.pdf", items: [{ page: null, text: "A" }] }, { name: "b.pdf", items: [{ page: 2, text: "B" }] }]);
  assert.ok(two.startsWith("### a.pdf") && two.includes("### b.pdf") && two.includes("**Sayfa 2**"));
});

test("what the production OCR really leaves on a scanned law", () => {
  const items = docOutline(`--- Sayfa 4 ---
## "Tanımlar

MADDE 52W/A- (1) Bu Bölümde geçen;

--- Sayfa 7 ---
MADDE 10- Ekli (1) sayılı listede yer alan kadrolar iptal edilerek 2 sayılı listede.

--- Sayfa 8 ---
## (1 SAYILI LİSTE

(2) SAYILI LİSTE

KURUMU

TÜRK İŞBİRLİĞİ VE KOORDİNASYON AJANSI BAŞKANLIĞI

MERKEZ

TÜRK İŞBİRLİĞİ VE KOORDİNASYON AJANSI BAŞKANLIĞI

MERKEZ
`).map((i) => i.text);
  assert.ok(items[1].startsWith("MADDE 52W/A (numara okunamamış olabilir"), "kept, and says so");
  assert.ok(items.includes("(1 SAYILI LİSTE") && items.includes("(2) SAYILI LİSTE"));
  assert.ok(!items.some((t) => /^(KURUMU|MERKEZ|TÜRK İŞBİRLİĞİ)/.test(t)), "a table's labels aren't headings");
  assert.ok(!docOutline("--- Sayfa 1 ---\n2 sayılı listede yer alan kadrolar").length);
  assert.ok(items.some((t) => t.startsWith("MADDE 10 — ")));
});


test("what a first review found", () => {
  for (const q of ["İçindekiler tablosu ile metin tutarlı mı?", "Tüm başlıklar altında belirtilen riskleri karşılaştır."]) assert.ok(!asksForOutline(q), q);
  const texts = (t: string) => docOutline(t).map((i) => i.text);
  assert.ok(texts("## Giriş\n## Sonuç\u001eBOZUK").every((t) => !/[\u0000-\u001f]/.test(t)), "stream separators can't pass");
  assert.deepEqual(texts("--- Sayfa 1 ---\nGİRİŞ\nSONUÇ\n\n--- Sayfa 2 ---\nGİRİŞ\n\n--- Sayfa 9 ---\nSONUÇ"), ["GİRİŞ", "SONUÇ", "GİRİŞ", "SONUÇ"]);
  assert.deepEqual(texts("RAPOR BAŞLIĞI\n\n1. Giriş\n\n2. Yöntem\n\nSONUÇ"), ["RAPOR BAŞLIĞI", "1. Giriş", "2. Yöntem", "SONUÇ"]);
  assert.deepEqual(texts("EK MADDE 1- Ek hüküm\nMükerrer Madde 3- Diğer hüküm\nGEÇİCİ MADDE 2- Geçiş"), ["EK MADDE 1 — Ek hüküm", "MÜKERRER MADDE 3 — Diğer hüküm", "GEÇİCİ MADDE 2 — Geçiş"]);
  assert.deepEqual(texts("Ek 1 kapsamında inceleme yapılmıştır\nGeçici madde 2 uyarınca işlem yapılır.\nikinci bölüm uyarınca\n(1) sayılı liste uyarınca"), []);
  assert.deepEqual(texts("EK-1\nEk 2: Formlar\nİKİNCİ BÖLÜM\n(3) SAYILI CETVEL"), ["EK-1", "Ek 2: Formlar", "İKİNCİ BÖLÜM", "(3) SAYILI CETVEL"]);
});
