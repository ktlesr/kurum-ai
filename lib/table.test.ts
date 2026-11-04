// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorkbook, runQuery, schemaOf, tablesFor, tablesOf } from "./table.ts";

const book = [
  "## Sheet: İller",
  "| İl Adı | Ürün | Yıl | Üretim (Ton) |",
  "| --- | --- | --- | --- |",
  "| Afyonkarahisar-3 | Elma (Golden) | 2025 | 4725 |",
  "| Kütahya-43 | Elma (Golden) | 2025 | 2764 |",
  "| Manisa-45 | Elma (Golden) | 2025 | 1479 |",
  "| Uşak-64 | Elma (Golden) | 2025 | 343 |",
  "| Afyonkarahisar-3 | Elma (Starking) | 2025 | 6698 |",
  "| İzmir-35 | Elma (Golden) | 2025 | 9999 |",
  "| Uşak-64 | Kiraz | 2025 | 1.234,5 |",
  "| Uşak-64 | Elma (Amasya) | 2025 | — |",
  "",
  "## Sheet: Notlar",
  "metin, tablo yok",
].join("\n");

test("tablesOf: each sheet's table, cells trimmed, short rows padded; sheets without a table left out", () => {
  const [t, ...rest] = tablesOf(book);
  assert.equal(rest.length, 0);
  assert.equal(t.sheet, "İller");
  assert.deepEqual(t.columns, ["İl Adı", "Ürün", "Yıl", "Üretim (Ton)"]);
  assert.equal(t.rows.length, 8);
  assert.deepEqual(tablesOf("| a | b |\n| - | - |"), []);
  assert.deepEqual(tablesOf("## Sheet: X\n| a \\| b | c |\n| --- | --- |\n| 1 |")[0].rows, [["1", ""]]);
});

test("schemaOf: the shape, not the rows", () => {
  const s = schemaOf(tablesOf(book));
  assert.match(s, /^Sayfa: İller \(8 satır\)/);
  assert.match(s, /- Yıl: sayı \(2025 … 2025\)/);
  assert.match(s, /- Ürün: metin, 5 farklı değer: Elma \(Golden\) \| Elma \(Starking\) \| Kiraz \| Elma \(Amasya\)|- Ürün: metin, 4 farklı değer/);
  assert.match(s, /- Üretim \(Ton\): metin/, "a dash among the figures: not all numbers");
});

test("runQuery: TR33 apple totals by province, exact; filters by equality and containment, any case", () => {
  const r = runQuery(tablesOf(book), {
    sayfa: "iller",
    filtreler: [{ sutun: "İl Adı", icerir: ["afyonkarahisar", "kütahya", "manisa", "uşak"] }, { sutun: "ürün", icerir: ["elma"] }],
    topla: ["Üretim (Ton)"], grupla: ["İl Adı"],
  });
  assert.ok("text" in r);
  assert.match(r.text, /Eşleşen satır: 6\./);
  assert.match(r.text, /\| Afyonkarahisar-3 \| 2 \| 11\.423 \|/);
  assert.match(r.text, /\| Uşak-64 \| 2 \| 343 \|/);
  assert.match(r.text, /\| Toplam \| 6 \| 16\.009 \|/);
  assert.match(r.text, /Sayı olmayan 1 hücre toplama katılmadı/);
  assert.ok(!r.text.includes("İzmir"));
  assert.deepEqual(r.numbers.at(-1), "16.009");
  // Decimals in Turkish form, summed exactly.
  const k = runQuery(tablesOf(book), { sayfa: "İller", filtreler: [{ sutun: "Ürün", esit: ["kiraz"] }], topla: ["Üretim (Ton)"] });
  assert.ok("text" in k && /\| 1 \| 1\.234,5 \|/.test(k.text));
});

test("runQuery: rows without sums; unknown sheet or column is an error naming what there is", () => {
  const r = runQuery(tablesOf(book), { sayfa: "İller", filtreler: [{ sutun: "İl Adı", esit: ["Uşak-64"] }], sutunlar: ["Ürün", "Üretim (Ton)"] });
  assert.ok("text" in r);
  assert.match(r.text, /\| Ürün \| Üretim \(Ton\) \|\n\| --- \| --- \|\n\| Elma \(Golden\) \| 343 \|/);
  const a = runQuery(tablesOf(book), { sayfa: "Bütçe" });
  assert.ok("error" in a && /Sayfalar: İller/.test(a.error));
  const b = runQuery(tablesOf(book), { sayfa: "İller", topla: ["Değer"] });
  assert.ok("error" in b && /Değer/.test(b.error) && /Sütunlar: İl Adı/.test(b.error));
});

test("tablesFor: made once per version of the document; a newer text replaces the index", () => {
  const doc = { text: book };
  const first = tablesFor(doc);
  assert.equal(tablesFor(doc), first, "same version: the kept index");
  doc.text = book.replace("| 343 |", "| 400 |");
  const next = tablesFor(doc);
  assert.notEqual(next, first);
  assert.ok(next[0].rows.some((r) => r[3] === "400"));
  assert.ok(isWorkbook(doc) && !isWorkbook({ text: "düz metin" }));
});
