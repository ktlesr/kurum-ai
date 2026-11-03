import { test } from "node:test";
import assert from "node:assert/strict";
import { districtsAsked, focusSheets, parseReading, rowsNamed } from "./sheet-focus.ts";

test("districtsAsked: a district of the region as a name, Merkez only with its province", () => {
  assert.deepEqual(districtsAsked("ZAFER Destekler Veriler Tablosuna göre Banaz ilçesine verilen ajans destekleri"), [{ il: "Uşak", ilce: "Banaz" }]);
  assert.deepEqual(districtsAsked("Salihli'ye ve Simav'a verilen destekler"), [{ il: "Kütahya", ilce: "Simav" }, { il: "Manisa", ilce: "Salihli" }]);
  assert.deepEqual(districtsAsked("Uşak merkez ilçesindeki projeler"), [{ il: "Uşak", ilce: "Merkez" }]);
  assert.deepEqual(districtsAsked("Afyon'un merkez ilçesi"), [{ il: "Afyonkarahisar", ilce: "Merkez" }]);
  // Everyday words and names of other things aren't districts unless the request is about districts.
  assert.deepEqual(districtsAsked("Çay üretimi ve Dinar kuru ile Gediz havzası"), []);
  assert.deepEqual(districtsAsked("Gediz ilçesindeki destekler"), [{ il: "Kütahya", ilce: "Gediz" }]);
  assert.deepEqual(districtsAsked("banazlı firmalar, merkez bankası, tüm destekler"), []);
});

const book = [
  "## Sheet: PTÇ",
  "Satır: 4, Sütun: 4",
  "Sütun başlıkları: #, Başvuru Sahibi, İlçe, İl",
  "",
  "| # | Başvuru Sahibi | İlçe | İl |",
  "| --- | --- | --- | --- |",
  "| 1 | Uşak İl Özel İdaresi | Banaz | Uşak |",
  "| 2 | Banaz Belediyesi \\| Ek | Banaz | Uşak |",
  "| 3 | Kütahya Belediyesi | Merkez | Kütahya |",
  "| 4 | Uşak Valiliği | Merkez | Uşak |",
  "",
  "> [Kod kontrolü] Toplam satırı tutuyor.",
  "",
  "## Sheet: PTÇ İcmal",
  "Satır: 1, Sütun: 2",
  "",
  "| İl | İlçe |",
  "| --- | --- |",
  "| UŞAK | Banaz |",
  "",
  "## Sheet: Genel Analiz",
  "",
  "| | | PTÇ |",
  "| --- | --- | --- |",
  "| Uşak | Banaz | 21 |",
  "",
  "## Sheet: FND",
  "Satır: 1, Sütun: 2",
  "",
  "| İlçe | İl |",
  "| --- | --- |",
  "| Soma | Manisa |",
].join("\n");

test("focusSheets: the district's rows with each sheet's header; İcmal and sheets without it out", () => {
  const t = focusSheets(book, [{ il: "Uşak", ilce: "Banaz" }])!;
  assert.match(t, /^> \[Kod kontrolü\] Belgeden yalnızca Banaz \(Uşak\) satırları verildi \(2 satır/);
  assert.ok(t.includes("| # | Başvuru Sahibi | İlçe | İl |\n| --- | --- | --- | --- |\n| 1 | Uşak İl Özel İdaresi | Banaz | Uşak |\n| 2 | Banaz Belediyesi \\| Ek | Banaz | Uşak |"));
  for (const gone of ["## Sheet: PTÇ İcmal", "## Sheet: Genel Analiz", "Kütahya Belediyesi", "## Sheet: FND", "Toplam satırı", "Satır: 4"]) assert.ok(!t.includes(gone), gone);
  // Merkez: only the asked province's.
  const m = focusSheets(book, [{ il: "Uşak", ilce: "Merkez" }])!;
  assert.ok(m.includes("Uşak Valiliği") && !m.includes("Kütahya Belediyesi"));
  // Not in the book, no district, or not a workbook: read as it is.
  assert.equal(focusSheets(book, [{ il: "Manisa", ilce: "Salihli" }]), null);
  assert.equal(focusSheets(book, []), null);
  assert.equal(focusSheets("Banaz ilçesi düz metin", [{ il: "Uşak", ilce: "Banaz" }]), null);
});

test("parseReading: the model's reading, bounded; anything else is none", () => {
  assert.deepEqual(parseReading('```json\n{"anlam":"TR33 = Afyonkarahisar, Kütahya, Manisa, Uşak","adlar":["Afyonkarahisar","Kütahya","Manisa","Uşak","Uşak",3,"x"]}\n```'),
    { meaning: "TR33 = Afyonkarahisar, Kütahya, Manisa, Uşak", names: ["Afyonkarahisar", "Kütahya", "Manisa", "Uşak"] });
  assert.equal(parseReading("bilmiyorum"), null);
  assert.equal(parseReading("{bozuk"), null);
});

test("rowsNamed: every sheet's rows naming one of the things, as a word; nothing matched is null", () => {
  const stats = [
    "## Sheet: Meyve",
    "Satır: 3, Sütun: 3",
    "",
    "| Ürün | Yıl | İl |",
    "| --- | --- | --- |",
    "| Portakal | 2023 | Mersin-33 |",
    "| Elma | 2023 | Uşak-64 |",
    "| Kiraz | 2023 | AFYONKARAHİSAR-03 |",
    "| Vişne | 2023 | Uşaklı |",
    "",
    "## Sheet: İcmal",
    "",
    "| İl | Toplam |",
    "| --- | --- |",
    "| Uşak | 5 |",
  ].join("\n");
  const out = rowsNamed(stats, ["Afyonkarahisar", "Uşak", "a.b(c"])!;
  assert.match(out, /Uşak-64/);
  assert.match(out, /AFYONKARAHİSAR-03/);
  assert.match(out, /\| Uşak \| 5 \|/); // totals sheets stay: a province question may need them
  assert.doesNotMatch(out, /Mersin|Uşaklı/);
  assert.match(out, /3 satır/);
  assert.equal(rowsNamed(stats, ["Manisa"]), null);
  assert.equal(rowsNamed("düz metin Uşak", ["Uşak"]), null);
});
