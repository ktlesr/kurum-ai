// Run: pnpm test
// Real SheetJS workbooks through lib/sheet-text, then the table index: number formats, CSV, dates.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { readCsv, readXlsx, sheetText } from "./sheet-text.ts";
import { runQuery, tablesOf } from "./table.ts";
import { checkTotals } from "./checks.ts";

/** A workbook written and read back the way an upload is (xlsx bytes, cellNF). */
function book(rows: (string | number | { v: number; z: string } | Date)[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (typeof c === "object" && !(c instanceof Date) ? c.v : c))), { cellDates: true });
  rows.forEach((r, i) => r.forEach((c, j) => {
    if (typeof c === "object" && !(c instanceof Date)) ws[XLSX.utils.encode_cell({ r: i, c: j })].z = c.z;
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  return readXlsx(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

test("xlsx: number formats come out Turkish and sum right; currency, accounting, negatives", () => {
  const wb = book([
    ["Kalem", "Tutar", "TL", "Muhasebe", "Net"],
    ["a", { v: 1234, z: "#,##0" }, { v: 1234.5, z: '#,##0.00 "₺"' }, { v: 1234.57, z: '_-* #,##0.00 "₺"_-;-* #,##0.00 "₺"_-;_-* "-"?? "₺"_-;_-@_-' }, { v: -5, z: "#,##0;(#,##0)" }],
    ["b", { v: 2500, z: "#,##0" }, { v: 2000, z: '#,##0.00 "₺"' }, { v: 0, z: '_-* #,##0.00 "₺"_-;-* #,##0.00 "₺"_-;_-* "-"?? "₺"_-;_-@_-' }, { v: 1500, z: "#,##0;(#,##0)" }],
    ["c", 7, { v: 1, z: '#,##0.00 "₺"' }, { v: -10, z: '_-* #,##0.00 "₺"_-;-* #,##0.00 "₺"_-;_-* "-"?? "₺"_-;_-@_-' }, { v: 2, z: "#,##0;(#,##0)" }],
  ]);
  const text = sheetText(wb, { csv: false }).text;
  assert.match(text, /\| a \| 1\.234 \| 1\.234,50 ₺ \|/);
  const r = runQuery(tablesOf(text), { sayfa: "S", topla: ["Tutar", "TL", "Muhasebe", "Net"] });
  assert.ok("text" in r, JSON.stringify(r));
  assert.deepEqual(r.numbers, ["3.741", "3.235,5", "1.224,57", "1.497"]);
  // The code's own total check reads the same text the Turkish way too.
  assert.ok(!checkTotals(text).some((n) => /tutmuyor|TUTARSIZ/i.test(n)));
});

test("xlsx: dates and times keep SheetJS's text; percentages read as written", () => {
  const wb = book([
    ["Tarih", "Saat", "Oran"],
    [new Date(Date.UTC(2023, 2, 15)), { v: 0.5000057870, z: "hh:mm:ss.000" }, { v: 0.125, z: "0.0%" }],
  ]);
  const text = sheetText(wb, { csv: false }).text;
  assert.ok(!/15,03/.test(text), text);
  assert.match(text, /12,5%/);
  assert.match(text, /12:00:00\.500/, "a time's fraction isn't made Turkish");
});

test("csv: the file's own numbers are never converted; Turkish CSVs read right", () => {
  const tr = sheetText(readCsv("il;tutar;oran\nAnkara;1.234;12,5\nIzmir;2.000;7,5"), { csv: true }).text;
  assert.match(tr, /\| Ankara \| 1\.234 \| 12,5 \|/);
  const r = runQuery(tablesOf(tr), { sayfa: "Sheet1", topla: ["tutar"] });
  assert.ok("text" in r && r.numbers[0] === "3.234", JSON.stringify(r));
});

test("xlsx: a display that rounds gets the cell's whole value; the sum is Excel's, not the shown digits'", () => {
  const rows: (string | { v: number; z: string })[][] = [["Kalem", "Tutar"]];
  for (let i = 0; i < 10; i++) rows.push([`k${i}`, { v: 100.4, z: "#,##0" }]);
  rows.push(["pay", { v: 0.12345, z: "0%" }]);
  const text = sheetText(book(rows), { csv: false }).text;
  assert.match(text, /\| k0 \| 100,4 \|/);
  assert.match(text, /\| pay \| 12,345% \|/);
  const r = runQuery(tablesOf(text), { sayfa: "S", filtreler: [{ sutun: "Kalem", icerir: ["k"] }], topla: ["Tutar"] });
  assert.ok("text" in r && r.numbers[0] === "1.004", JSON.stringify(r));
});

test("xlsx: a format that scales (thousands, millions) keeps its shown figure; only rounding is undone", () => {
  const text = sheetText(book([
    ["Kalem", "Tutar (Bin TL)", "M"],
    ["a", { v: 1234567, z: "#,##0," }, { v: 1234567, z: '#,##0.0,,"M"' }],
    ["b", { v: 100.4, z: "#,##0" }, { v: 2, z: "0" }],
  ]), { csv: false }).text;
  assert.match(text, /\| a \| 1\.235 \| 1,2M \|/);
  assert.match(text, /\| b \| 100,4 \| 2 \|/);
});
