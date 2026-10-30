// Run: pnpm test. Which documents a message asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchByName, parsePicked, wantsSources } from "./sources.ts";

const lib = [
  { id: "1", path: "Mevzuat/KOSGEB/Uygulama Esasları.pdf" },
  { id: "2", path: "Mevzuat/IPARD/Çağrı İlanı.pdf" },
  { id: "3", path: "Raporlar/2026/Ekonomik Görünüm Manisa.pdf" },
];

test("a plain question doesn't ask for sources; a request does", () => {
  for (const q of ["Merhaba, nasılsın?", "KOSGEB nedir?", "Bana bir e-posta yaz"]) assert.equal(wantsSources(q), false, q);
  for (const q of ["Şu kaynakları kullanarak özet hazırla", "Belgelerden bul", "Mevzuat klasöründeki dosyalara bak", "DÖKÜMANLARA göre yaz"]) assert.equal(wantsSources(q), true, q);
});

test("matchByName: folder and file names, Turkish suffixes, nothing on unrelated words", () => {
  assert.deepEqual(matchByName("KOSGEB klasöründeki belgelere göre özetle", lib).map((e) => e.id), ["1"]);
  assert.deepEqual(matchByName("mevzuat klasörünü kullan", lib).map((e) => e.id).sort(), ["1", "2"]);
  assert.deepEqual(matchByName("Manisa ekonomik görünüm kaynağına göre", lib).map((e) => e.id), ["3"]);
  assert.deepEqual(matchByName("belgeleri kullanarak bir dilekçe hazırla", lib), []);
});

test("parsePicked: known numbers only", () => {
  assert.deepEqual(parsePicked('Tamam {"dosyalar":[2,2,9,"1",1]}', lib).map((e) => e.id), ["2", "1"]);
  assert.deepEqual(parsePicked("yok", lib), []);
  assert.deepEqual(parsePicked('{"dosyalar":{}}', lib), []);
});
