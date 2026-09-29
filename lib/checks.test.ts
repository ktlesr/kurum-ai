// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCriteria, checkMaxRows, markUncertain, normNum, verifyNumbers } from "./checks.ts";

test("normNum handles Turkish thousands and decimal comma", () => {
  assert.equal(normNum("698.264.164"), "698264164");
  assert.equal(normNum("94,7"), "94.7");
  assert.equal(normNum("94.7"), "94.7");
});

test("markUncertain flags numbers the second reading doesn't confirm", () => {
  const a = "| 1. KAT | 66.9 | 78 | 17.6 |";
  const b = "| 1. KAT | 66.9 | 77.8 | 17.6 |";
  const r = markUncertain(a, b);
  assert.equal(r.text, "| 1. KAT | 66.9 | 78(?) | 17.6 |");
  assert.equal(r.uncertain, 1);
  assert.equal(r.total, 4);
});

test("markUncertain survives a row missing from the second reading", () => {
  const a = "| 3 | 10 | 20 |\n| 4 | 30 | 40 |\n| 5 | 50 | 60 |";
  const b = "| 3 | 10 | 20 |\n| 5 | 50 | 60 |";
  assert.equal(markUncertain(a, b).text, "| 3 | 10 | 20 |\n| 4(?) | 30(?) | 40(?) |\n| 5 | 50 | 60 |");
});

test("criteria rows are recomputed and compared with the report's mark", () => {
  const md = [
    "## Göçmenin Önlenmesi Performans Düzeyi Değerlendirmesi :",
    "| Kriter | Sonuç | Kontrol |",
    "| --- | --- | --- |",
    "| Herhangi bir katta kirişlerin en fazla %20'si Göçme Bölgesi'ne geçebilir | %88.6 | x |",
    "| Belirgin Hasar Sınırı aşılmış olan düşey elemanlar tarafından taşınan kesme kuvveti oranı %30'u aşmamalıdır | %16.9 | √ |",
    "| İleri Hasar Bölgesi'ndeki düşey elemanların kesme kuvvetine katkısı %20'nin altında olmalıdır | %25 | √ |",
  ].join("\n");
  const notes = checkCriteria(md);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /%88\.6, eşik ≤ %20 → SAĞLAMIYOR; rapordaki işaret \(x\) ile tutarlı/);
  assert.match(notes[1], /%16\.9, eşik ≤ %30 → SAĞLIYOR; rapordaki işaret \(√\) ile tutarlı/);
  assert.match(notes[2], /%25, eşik < %20 → SAĞLAMIYOR; TUTARSIZ: rapor √ diyor/);
});

test("Maksimum row mismatch is reported", () => {
  const md = [
    "Kesme Kuvveti Yüzdeleri-X",
    "| Kat | SH | >= BH |",
    "| --- | --- | --- |",
    "| 3. KAT | 94.4 | 5.6 |",
    "| 1. BODRUM | 6.66 | 0.1 |",
    "| Maksimum | 99.9 | 5.6 |",
  ].join("\n");
  const [note] = checkMaxRows(md);
  assert.match(note, /Maksimum 99\.9, satırlardan 94\.4/);
  assert.equal(checkMaxRows(md.replace("6.66", "99.9")).length, 0);
  // unconfirmed or missing cells → the mismatch may be a misread, so stay quiet
  assert.equal(checkMaxRows(md.replace("6.66", "6.66(?)")).length, 0);
  assert.equal(checkMaxRows(md.replace("| 6.66 |", "|  |")).length, 0);
});

test("verifyNumbers separates unknown, uncertain and known numbers", () => {
  const source = "Sonuç %94.7, bütçe 698.264.164 TL, değer 78(?)";
  const r = verifyNumbers("Oran %94,7; bütçe 698264164 TL; değer 78; fark 12.5; madde 3", source);
  assert.deepEqual(r.unverified, ["12.5"]);
  assert.deepEqual(r.uncertain, ["78"]);
});
