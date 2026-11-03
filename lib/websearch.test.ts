// Run: pnpm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { aboutTheDocument, isClearNo, parseRelevant, parseSearchQuery, passage, safeQuery, saysNotWritten, searchWeb } from "./websearch.ts";

let asked = "";
const server = createServer((req, res) => {
  asked = req.url ?? "";
  if (asked.includes("bozuk")) return void res.writeHead(500).end();
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ results: [
    { url: "https://a.gov.tr/x", title: "A", content: "özet" },
    { url: "https://a.gov.tr/x", title: "Aynı", content: "" },
    { url: "javascript:alert(1)", title: "Kötü" },
    { url: "http://b.tr", title: 5 },
    ...["c", "d", "e", "f", "g", "h", "i", "j"].map((h) => ({ url: `https://${h}.tr`, title: h })),
  ] }));
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("searchWeb: http(s) only, no repeats, at most 8, the query goes as asked", async () => {
  const r = await searchWeb(base, "493 üncü madde", AbortSignal.timeout(5000));
  assert.deepEqual(r.map((x) => x.url), ["https://a.gov.tr/x", "http://b.tr", "https://c.tr", "https://d.tr", "https://e.tr", "https://f.tr", "https://g.tr", "https://h.tr"]);
  assert.equal(r[1].title, "");
  assert.equal(new URL(asked, base).searchParams.get("q"), "493 üncü madde");
  assert.equal(new URL(asked, base).searchParams.get("format"), "json");
});

test("searchWeb: a failing search is an error, for the caller to answer without it", async () => {
  await assert.rejects(searchWeb(base, "bozuk", AbortSignal.timeout(5000)));
});

test("parseSearchQuery: one line; YOK or a sentence-long reply is no query", () => {
  assert.equal(parseSearchQuery('"dolar kuru bugün".\nAçıklama'), "dolar kuru bugün");
  assert.equal(parseSearchQuery("YOK"), null);
  assert.equal(parseSearchQuery("yok."), null);
  assert.equal(parseSearchQuery(""), null);
  assert.equal(parseSearchQuery("x".repeat(151)), null);
});

test("passage: finds the numbered article deep in a long text, with its section heading", () => {
  const filler = "Genel hükümler bu metinde yer alır ve uygulanır.\n".repeat(2000);
  const law = `${filler}OTUZBEŞİNCİ BÖLÜM\nTarım Kurumu\nAmaç\nMADDE 489 – kuruluş\n${filler}MADDE 4930 – başka\nMADDE 493 – (1) Kurum, merkez ve taşra teşkilatından oluşur.\n${filler}`;
  const p = passage(law, "4 sayılı Kararname 493. madde hangi kurum", 3000);
  assert.ok(p.text.includes("MADDE 493 – (1)"));
  assert.ok(p.text.startsWith("(Yukarıdaki son büyük harfli başlık: OTUZBEŞİNCİ BÖLÜM Tarım Kurumu)"));
  assert.ok(p.text.length < 3100);
  assert.ok(p.score >= 4);
});

test("passage: a heading inside the window isn't repeated, and an older one isn't named", () => {
  const filler = "Genel hükümler bu metinde yer alır ve uygulanır.\n".repeat(200);
  const p = passage(`ESKİ BÖLÜM\nTapu\n${filler}YENİ BÖLÜM\nTarım\nMADDE 493 – kurum\n${filler}`, "493", 1000);
  assert.ok(p.text.startsWith("…"));
  assert.ok(p.text.includes("YENİ BÖLÜM") && !p.text.includes("ESKİ"));
});

test("passage: the best place can be after hundreds of mere mentions", () => {
  const mentions = "bkz. 493 sayılı\n".repeat(300);
  const filler = "x".repeat(2000) + "\n";
  const p = passage(`${mentions}${filler}MADDE 493 Tarım görevleri\n`, "493 tarım görevleri", 500);
  assert.ok(p.text.includes("MADDE 493 Tarım görevleri"));
});

test("passage: a short page stays whole; no term found means the start, scored zero", () => {
  assert.deepEqual(passage("Dolar kuru 40 lira.", "dolar kuru", 100), { text: "Dolar kuru 40 lira.", score: 2 });
  assert.deepEqual(passage("abc ".repeat(100), "dolar", 8), { text: "abc abc ", score: 0 });
});

test("passage: a page with the asked number outranks one with only the words", () => {
  const q = "kararname 493. madde";
  assert.ok(passage("kararname madde 493 kurum", q, 100).score > passage("kararname madde 12 kurum", q, 100).score);
});

test("saysNotWritten: the answers that went without a search", () => {
  assert.ok(saysNotWritten("doğrudan bir kurum ismi metin içerisinde açıkça belirtilmemiştir. Ancak bir çıkarım yapılabilir:"));
  assert.ok(saysNotWritten("Belgede yok."));
  assert.ok(saysNotWritten("bilgi açıkça yazmamaktadır"));
  assert.ok(!saysNotWritten("Belgenin 4. sayfasına göre tutar açıkça belirtilmiştir: 12 milyon TL."));
  assert.ok(!saysNotWritten("Süre açıkça yazmaktadır ve açıkça geçmektedir."));
  assert.ok(!saysNotWritten("Süre açıkça belirtilmektedir ve açıkça zikredilmektedir."));
  assert.ok(saysNotWritten("Süre açıkça zikredilmemiştir."));
});

test("isClearNo: only a plain no skips the search; empty or unclear doesn't", () => {
  for (const no of ["HAYIR", "Hayır.", "**hayır**", "HAYIR\n"]) assert.ok(isClearNo(no), no);
  for (const other of ["", "EVET", "Bence hayır", "Hayırlı", "HAYIR,EVET", "HAYIRı", "ıHAYIR"]) assert.ok(!isClearNo(other), other);
});

test("safeQuery: the document gives its subject, never a name, place or number", () => {
  const doc = "YENİ TEŞVİK SİSTEMİNİN KURGUSU\nyatırım teşvik sistemi kapsamında bölgeler. Halit ÇAĞDAŞ görevden alındı. Karar 2026/363, Sakarya İl Müdürü.";
  assert.equal(safeQuery("yatırım teşvik sistemi bölgeler tablosu", "bölgeler tablosunu excel olarak hazırlar mısın", doc), "yatırım teşvik sistemi bölgeler tablosu");
  assert.equal(safeQuery("Halit Çağdaş Sakarya 2026/363 atama kararı", "atamaları json yazar mısın", doc), "atama"); // "atama" the user typed; "Karar" only capitalized
  assert.equal(safeQuery("Sakarya il müdürü", "Sakarya il müdürü kim", doc), "Sakarya il müdürü"); // the user's own words always go
  assert.equal(safeQuery("teşvik", "x", "TEŞVİK"), ""); // capitals only: could be a name
  assert.equal(safeQuery("kurgu yatırım teşvik sistemi bölgeler", "", doc), "yatırım teşvik sistemi bölgeler"); // "kurgu" only in capitals; and at most 4
});

test("parseRelevant: only a plain list of result numbers picks", () => {
  assert.deepEqual(parseRelevant("1,3", 3), [0, 2]);
  assert.deepEqual(parseRelevant("düşünce\n2, 2, 9", 3), [1]);
  for (const none of ["YOK", "", "Hiçbiri. 1", "1 ve 2"]) assert.deepEqual(parseRelevant(none, 3), [], none);
});

test("a question about the attached document itself doesn't go to the web", () => {
  for (const q of ["Dokümanın ana başlıklarını ve bölümlerini sırayla, sayfa numaralarıyla listele.", "Dokümanın tamamını özetle", "Dokümanları madde bazında karşılaştır", "Dokümandaki şartları çıkar", "Tablolardaki sütunları açıkla", "bu belgeyi özetle", "BELGENİN AMACI NE", "bölgeler tablosunu excel olarak hazırlar mısın", "atamaları json formatında yazar mısın", "Kararları tabloya dök", "isimleri liste halinde ver"]) assert.ok(aboutTheDocument(q), q);
  for (const q of ["493 sayılı kararnamede Tarım Kurumu nereye bağlı?", "Belgede yazan kurumun başkanı kim?", "Dokümanı internetten doğrula", "Türkiye'nin başkenti neresi", "Periyodik tablonun mucidi kim?", "Başvuru için gerekli belgeler neler?", "Excel'de düşeyara nasıl yapılır?", "bölgeleri internetten excel olarak hazırla"]) assert.ok(!aboutTheDocument(q), q);
});
