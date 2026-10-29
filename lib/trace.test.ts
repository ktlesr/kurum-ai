// Run: pnpm test. Sentence → source tracing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsOf, traceClaims } from "./trace.ts";

const rapor = [
  "--- Sayfa 1 ---",
  "Program, bölgedeki KOBİ'lerin dijital dönüşümünü desteklemek amacıyla hazırlanmıştır.",
  "--- Sayfa 2 ---",
  "Destek üst limiti proje başına 1.500.000 TL'dir. Destek oranı yüzde 50 olarak uygulanır.",
  "--- Sayfa 3 ---",
  "Başvurular 15.11.2026 tarihine kadar elektronik ortamda yapılır.",
].join("\n");
const butce = ["## Sheet: Bütçe", "| Kalem | Tutar |", "| --- | --- |", "| Personel | 750000 |", "| Toplam | 1000000 |"].join("\n");

test("claimsOf: factual sentences only; tables, headings, questions and short bits skipped", () => {
  const c = claimsOf("## Özet\nDestek üst limiti 1.500.000 TL'dir. Peki ya oran?\n| a | b |\n- Başvurular 15.11.2026 tarihine kadar elektronik ortamda yapılmalıdır.\nTamam.");
  assert.deepEqual(c, ["Destek üst limiti 1.500.000 TL'dir.", "Başvurular 15.11.2026 tarihine kadar elektronik ortamda yapılmalıdır."]);
});

test("traceClaims: each sentence finds its page and quote; a figure not in the documents is 'none'", () => {
  const claims = traceClaims(
    "Programda destek üst limiti proje başına 1.500.000 TL olarak belirlenmiştir. Başvurular 15.11.2026 tarihine kadar elektronik ortamda yapılır. Program kapsamında toplam 250 işletmeye 2 milyar TL hibe verilecektir.",
    [{ name: "rapor.pdf", text: rapor }],
  );
  assert.equal(claims.length, 3);
  assert.equal(claims[0].status, "ok");
  assert.equal(claims[0].source, "Sayfa 2");
  assert.match(claims[0].quote!, /1\.500\.000/);
  assert.equal(claims[1].source, "Sayfa 3");
  assert.equal(claims[2].status, "none");
  assert.equal(claims[2].source, undefined);
});

test("traceClaims: several documents name the document; sheets keep their label", () => {
  const claims = traceClaims("Bütçe tablosunda personel kalemi 750.000 olarak yer almaktadır ve toplam 1.000.000 tutarındadır.", [
    { name: "rapor.pdf", text: rapor },
    { name: "butce.xlsx", text: butce },
  ]);
  assert.equal(claims[0].status, "ok");
  assert.equal(claims[0].source, "butce.xlsx · Sheet: Bütçe");
});

test("traceClaims: words without the figures is at best weak; no documents, no claims", () => {
  const [c] = traceClaims("Destek üst limiti proje başına 3.000.000 TL olarak uygulanır ve oran yüzde 50 olur.", [{ name: "rapor.pdf", text: rapor }]);
  assert.notEqual(c.status, "ok");
  assert.deepEqual(traceClaims("Bir şey söylendi ve bu uzun bir cümledir gerçekten.", []), []);
});

test("traceClaims: a huge document and a long answer stay fast", () => {
  const big = Array.from({ length: 2000 }, (_, i) => `--- Sayfa ${i + 1} ---\n${"Bölgesel kalkınma ajansı destek programı başvuru ".repeat(8)} ${i * 37}`).join("\n");
  const answer = Array.from({ length: 60 }, (_, i) => `Programın ${i}. maddesinde destek tutarı ${i * 37} olarak belirtilmiştir ve başvuru şartları açıklanmıştır.`).join(" ");
  const t0 = Date.now();
  const claims = traceClaims(answer, [{ name: "buyuk.pdf", text: big }]);
  assert.equal(claims.length, 60);
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
});

test("traceClaims (review): single digits, signs and whole dates must match", () => {
  const doc = [{ name: "a.pdf", text: "--- Sayfa 1 ---\nProje süresi 9 ay olarak uygulanır. Değişim -50 puan oldu. Son başvuru tarihi 15.11.2027 olarak ilan edildi." }];
  const [a, b, c] = traceClaims("Proje süresi 3 ay olarak uygulanır ve uzatılmaz. Değişim 50 puan olarak gerçekleşmiş durumdadır. Son başvuru tarihi 15.11.2026 olarak ilan edildi.", doc);
  assert.notEqual(a.status, "ok", "3 ay is not 9 ay");
  assert.notEqual(b.status, "ok", "50 is not -50");
  assert.notEqual(c.status, "ok", "2026 is not 2027");
  assert.equal(traceClaims("Proje süresi 9 ay olarak uygulanır ve bu süre uzatılmaz.", doc)[0].status, "ok");
});

test("traceClaims (review): a later document is still searched after a huge first one", () => {
  const huge = { name: "buyuk.pdf", text: Array.from({ length: 30_000 }, (_, i) => `--- Sayfa ${i + 1} ---\nGenel açıklama metni ${i}`).join("\n") };
  const small = { name: "kucuk.pdf", text: "--- Sayfa 4 ---\nYatırım teşvik belgesi başvurusu 45 gün içinde sonuçlandırılır." };
  const [c] = traceClaims("Yatırım teşvik belgesi başvurusu 45 gün içinde sonuçlandırılır.", [huge, small]);
  assert.equal(c.status, "ok");
  assert.equal(c.source, "kucuk.pdf · Sayfa 4");
});

test("claimsOf (review): code fences skipped, *emphasis* starts a sentence, Dr. doesn't end one", () => {
  const c = claimsOf("```\nBu kod bloğunun içindeki uzun satır bir iddia değildir ama uzundur.\n```\nKurul toplantısı her ay yapılır ve kararlar yazılır. *Üye sayısı* yedi kişiden oluşan bir kurul seçilir.\nToplantıya Dr. Ahmet Yılmaz başkanlık eder ve gündemi belirler.");
  assert.deepEqual(c, ["Kurul toplantısı her ay yapılır ve kararlar yazılır.", "Üye sayısı yedi kişiden oluşan bir kurul seçilir.", "Toplantıya Dr. Ahmet Yılmaz başkanlık eder ve gündemi belirler."]);
});

test("traceClaims (review): 20 large documents stay within a few seconds", () => {
  const docs = Array.from({ length: 20 }, (_, d) => ({ name: `belge${d}.pdf`, text: Array.from({ length: 400 }, (_, i) => `--- Sayfa ${i + 1} ---\n${"Bölgesel kalkınma ajansı destek programı başvuru şartları ve uygulama esasları ".repeat(10)} ${d * 1000 + i}`).join("\n") }));
  const answer = Array.from({ length: 40 }, (_, i) => `Programın ${i}. maddesinde destek tutarı ${i * 1000 + 7} olarak belirtilmiştir ve başvuru şartları açıklanmıştır.`).join(" ");
  const t0 = Date.now();
  const claims = traceClaims(answer, docs);
  const ms = Date.now() - t0;
  assert.equal(claims.length, 40);
  assert.ok(ms < 8000, `${ms} ms for ${docs.reduce((n, d) => n + d.text.length, 0)} chars`);
  console.log(`# 20 belge, ${docs.reduce((n, d) => n + d.text.length, 0)} karakter: ${ms} ms`);
});

test("traceClaims (review 2): the page marker's number is no evidence", () => {
  const [c] = traceClaims("Proje süresi 3 ay olarak uygulanır ve bu süre uzatılmaz.", [{ name: "a.pdf", text: "--- Sayfa 3 ---\nProje süresi 9 ay olarak uygulanır ve bu süre uzatılmaz." }]);
  assert.notEqual(c.status, "ok");
  const [d] = traceClaims("Proje süresi 9 ay olarak uygulanır ve bu süre uzatılmaz.", [{ name: "a.pdf", text: "--- Sayfa 3 ---\nProje süresi 9 ay olarak uygulanır ve bu süre uzatılmaz." }]);
  assert.equal(d.source, "Sayfa 3");
});
