// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkColumns, checkCriteria, checkMaxRows, checkPages, compactTables, isLooping, markUncertain, normNum, verifyNumbers } from "./checks.ts";

test("normNum handles Turkish thousands and decimal comma", () => {
  assert.equal(normNum("698.264.164"), "698264164");
  assert.equal(normNum("94,7"), "94.7");
  assert.equal(normNum("94.7"), "94.7");
  // N5 regressions
  assert.equal(normNum("1.234,56"), "1234.56");
  assert.equal(normNum("1.234.567"), "1234567");
  assert.equal(normNum("-12,5"), "-12.5");
  assert.equal(normNum("-1.234,5"), "-1234.5");
  assert.equal(normNum("1.234"), "1234", "Turkish thousands");
  assert.equal(normNum("1,234.56"), "1234.56");
  assert.equal(normNum("1,234,567"), "1234567");
  assert.equal(normNum("12,345"), "12.345", "a single comma stays a decimal comma");
  assert.equal(parseFloat(normNum("1.234,56")), 1234.56);
  assert.equal(normNum("0.123"), "0.123", "leading zero: decimal, not thousands");
  assert.equal(normNum("-0,5"), "-0.5");
});

test("mixed separators still match across the two readings", () => {
  assert.equal(markUncertain("| 1.234,56 | 7 |", "| 1234,56 | 7 |").uncertain, 0);
  assert.equal(markUncertain("| 1.234,56 | 7 |", "| 1.234,65 | 7 |").uncertain, 1);
});

test("Maksimum check reads whole Turkish numbers (firstNum, N5b)", () => {
  const md = "| İl | Değer |\n| --- | --- |\n| A | 1.234,56 |\n| B | 999 |\n| Maksimum | 1.234,56 |";
  assert.deepEqual(checkMaxRows(md), [], "1.234,56 is 1234.56, not 1.234");
  const wrong = md.replace("| Maksimum | 1.234,56 |", "| Maksimum | %94,7 |");
  assert.match(checkMaxRows(wrong).join(), /Maksimum 94\.7, satırlardan 1234\.56/);
});

test("compactTables keeps equal neighbouring cells (N4)", () => {
  assert.equal(compactTables("| a | 100 | 100 |\n|:--|--:|---|\n<!-- image -->"), "| a | 100 | 100 |\n| --- | --- | --- |");
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

test("checkPages flags pages no document has; skips docs without page markers", () => {
  const doc = "--- Sayfa 1 ---\na\n--- Sayfa 2 ---\nb\n--- Sayfa 3 ---\nc";
  assert.deepEqual(checkPages("Sayfa 2'de ve sayfa 7'de; ayrıca Sayfa 3–12 arası.", [doc]), ["Sayfa 7", "Sayfa 12"]);
  assert.deepEqual(checkPages("Sayfa 2", [doc, "--- Sayfa 1 ---\nx"]), []);
  assert.deepEqual(checkPages("Sayfa 99", [doc, "işaretsiz metin"]), []);
});

test("checkColumns flags a figure put under the wrong document's column", () => {
  const docs = [
    { name: "cagri-2025.pdf", text: "Destek üst limiti 1.500.000 TL. Süre 12 ay." },
    { name: "cagri-2026.pdf", text: "Destek üst limiti 2.000.000 TL. Süre 18 ay." },
  ];
  const ok = "| Konu | cagri-2025.pdf | cagri-2026.pdf |\n| --- | --- | --- |\n| Limit | 1.500.000 TL (Sayfa 3) | 2.000.000 TL (Sayfa 2) |\n| Süre | 12 ay | 18 ay |";
  assert.deepEqual(checkColumns(ok, docs), []);
  const swapped = "| Konu | Çağrı 2025 (cagri-2025) | cagri-2026 |\n|---|---|---|\n| Limit | 2.000.000 TL | 1.500.000 TL |";
  assert.deepEqual(checkColumns(swapped, docs), [
    "2.000.000: cagri-2025.pdf sütununda, ama yalnızca cagri-2026.pdf içinde geçiyor",
    "1.500.000: cagri-2026.pdf sütununda, ama yalnızca cagri-2025.pdf içinde geçiyor",
  ]);
  // Numbers in neither document, page refs and single digits are left to the other checks.
  assert.deepEqual(checkColumns("| | cagri-2025 | cagri-2026 |\n| --- | --- | --- |\n| x | 999 (Sayfa 18) | 7 |", docs), []);
  assert.deepEqual(checkColumns(swapped, docs.slice(0, 1)), []);
  // Short names: "a" doesn't claim the "Fark" column.
  const ab = [{ name: "a.pdf", text: "100 TL" }, { name: "b.pdf", text: "200 TL" }];
  assert.deepEqual(checkColumns("| Konu | a | b | Fark |\n| --- | --- | --- | --- |\n| x | 100 | 200 | 100 |", ab), []);
  assert.deepEqual(checkColumns("| Konu | a | b |\n| --- | --- | --- |\n| x | 200 | 100 |", ab).length, 2);
  // Escaped pipe in a cell, no outer pipes, one-dash separators.
  const ab2 = [{ name: "alpha.pdf", text: "100" }, { name: "beta.pdf", text: "200" }];
  assert.deepEqual(checkColumns("| Konu | alpha | beta |\n| --- | --- | --- |\n| A \\| B | 100 | 200 |", ab2), []);
  assert.equal(checkColumns("Konu | alpha | beta\n- | - | -\nx | 200 | 100", ab2).length, 2);
  // Similar names: "rapor-ek.pdf" is its own column; a "Fark" header never belongs to "fark.pdf".
  const re = [{ name: "rapor.pdf", text: "200" }, { name: "rapor-ek.pdf", text: "100" }];
  assert.equal(checkColumns("| Konu | rapor.pdf | rapor-ek.pdf |\n|---|---|---|\n| x | 200 | 200 |", re).length, 1);
  // A header naming both documents belongs to neither.
  assert.deepEqual(checkColumns("| Konu | rapor.pdf / rapor-ek.pdf |\n|---|---|\n| x | 100 |", re), []);
  const fk = [{ name: "a.pdf", text: "200" }, { name: "fark.pdf", text: "100" }];
  assert.deepEqual(checkColumns("| Konu | a.pdf | fark.pdf | Fark |\n|---|---|---|---|\n| x | 200 | 100 | 200 |", fk), []);
});

test("isLooping: a repeating answer stops, real text doesn't", () => {
  assert.equal(isLooping("respect de olsa, respect de de olsa, ".repeat(40)), true);
  assert.equal(isLooping("respect de olsa ".repeat(10)), false); // too short to tell
  assert.equal(isLooping("_al_en_le".repeat(25)), true); // a tight loop stops sooner
  const amounts = Array.from({ length: 30 }, (_, i) => `| ${i + 1} | ${1250 + i * 10} TL | Uygun |`).join("\n");
  assert.equal(isLooping(amounts), false);
  const yesNo = Array.from({ length: 26 }, (_, i) => `| ${String.fromCharCode(65 + i)} | Evet | Hayır | Evet |`).join("\n");
  assert.equal(isLooping(yesNo), false);
  const budget = Array.from({ length: 12 }, (_, m) => ["Kira", "Elektrik", "Su"].map((k) => `| ${k} | ${m + 1}. ay | 0,00 | 1000,00 |`).join("\n")).join("\n");
  assert.equal(isLooping(budget), false);
  assert.equal(isLooping("| 0 | 0 | 0 |\n".repeat(30)), false); // a zero matrix can be asked for
  const table = Array.from({ length: 80 }, (_, i) => `| Satır ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (i >> 2))} | Evet | Hayır |`).join("\n");
  assert.equal(isLooping(table), false);
});
