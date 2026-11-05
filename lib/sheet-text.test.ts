// Run: pnpm test
// Real SheetJS workbooks through lib/sheet-text, then the table index: number formats, CSV, dates.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { readCsv, readXlsx, sheetText } from "./sheet-text.ts";
import { runQuery, SHEET_TR, tablesOf } from "./table.ts";
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

/** A workbook of several sheets, some hidden, written and read back as an upload is. */
function workbook(sheets: { name: string; rows: (string | number | null)[][]; hidden?: boolean; merges?: string[]; origin?: string }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.sheet_add_aoa({}, s.rows.map((r) => r.map((c) => (c === null ? undefined : c))), { origin: s.origin ?? "A1" });
    if (s.merges) ws["!merges"] = s.merges.map((m) => XLSX.utils.decode_range(m));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  wb.Workbook = { Sheets: sheets.map((s) => ({ Hidden: s.hidden ? 1 : 0 })) } as XLSX.WBProps;
  return readXlsx(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

test("xlsx structure: Excel row numbers kept past blank rows; the sheet's total and footnote rows apart from its entries", () => {
  const wb = workbook([{
    name: "İl Bazlı",
    rows: [
      ["İL BAZLI İSTİHDAM RAPORU", null, null], // row 1: a title
      ["İl", "Tarih", "İstihdam"], // row 2: the header
      ["Afyonkarahisar", "05.01.2026", 1000],
      ["Kütahya", "12.02.2026", 2000],
      [null, null, null], // row 5: blank
      ["Manisa", "20.03.2026", 3000],
      ["Uşak", "02.03.2026", 4000], // row 7: the last entry
      ["Genel Toplam", null, 10000], // row 8
      ["* Kaynak: SGK il müdürlükleri", null, null], // row 9: a footnote
    ],
  }]);
  const text = sheetText(wb, { csv: false }).text;
  assert.match(text, /^Excel satırları: 1-4, 6-9$/mu);
  const t = tablesOf(text)[0];
  assert.deepEqual(t.excelRows, [3, 4, 6, 7]);
  assert.deepEqual(t.totals, [{ cells: ["Genel Toplam", "", "10000"], excel: 8 }]);
  assert.ok(t.notes.some((n) => /Kaynak: SGK/u.test(n)) && t.notes.some((n) => /İL BAZLI/u.test(n)));
  // The sum is the entries' (10.000), not twice it with the sheet's own total row added in.
  const sum = runQuery([t], { sayfa: "İl Bazlı", topla: ["İstihdam"] });
  assert.ok("text" in sum);
  assert.deepEqual(sum.numbers, ["10.000"]);
  assert.match(sum.text, /Sayfanın kendi toplam satırları[^\n]*\n- Excel satırı 8: İl = Genel Toplam; İstihdam = 10000/u);
  // The last entry is Uşak in row 7: not the total, not the footnote.
  const last = runQuery([t], { sayfa: "İl Bazlı", sondan: true, adet: 1 });
  assert.ok("text" in last);
  assert.match(last.table, /\| Excel satırı \| İl \| Tarih \| İstihdam \|\n[^\n]+\n\| 7 \| Uşak \| 02\.03\.2026 \| 4000 \|/u);
  assert.match(last.text, /Sütunların Excel harfleri: İl A, Tarih B, İstihdam C\./u);
  assert.ok(last.numbers.includes("7"), "the row number is the document's, for the number check");
  // The latest by date is Manisa, row 6.
  const newest = runQuery([t], { sayfa: "İl Bazlı", sirala: "Tarih", azalan: true, adet: 1, sutunlar: ["İl"] });
  assert.ok("text" in newest && /\| 6 \| Manisa \|/u.test(newest.table));
});

test("xlsx structure: a hidden sheet is said so; merged group names reach every row; a sheet that starts further right keeps its letters", () => {
  const wb = workbook([
    { name: "Görünür", rows: [["A", "B"], ["x", 1]] },
    { name: "Gizli", rows: [["A", "B"], ["y", 2]], hidden: true },
    {
      name: "Gruplu",
      origin: "B3",
      rows: [["Bölge", "İl", "Proje"], ["TR33", "Kütahya", 3], [null, "Uşak", 4], ["TR41", "Bursa", 5]],
      merges: ["B4:B5"],
    },
  ]);
  const text = sheetText(wb, { csv: false }).text;
  const [shown, hidden, grouped] = tablesOf(text);
  assert.equal(shown.hidden, false);
  assert.equal(hidden.hidden, true);
  const r = runQuery([hidden], { sayfa: "Gizli" });
  assert.ok("text" in r && /Not: bu sayfa Excel'de gizli\./u.test(r.text));
  assert.deepEqual(grouped.rows.map((row) => row[0]), ["TR33", "TR33", "TR41"], "the merged region's name on both its rows");
  assert.deepEqual(grouped.excelRows, [4, 5, 6]);
  const g = runQuery([grouped], { sayfa: "Gruplu", filtreler: [{ sutun: "Bölge", esit: ["TR33"] }], topla: ["Proje"] });
  assert.ok("text" in g);
  assert.deepEqual(g.numbers, ["7"]);
  const rows = runQuery([grouped], { sayfa: "Gruplu", sutunlar: ["İl"] });
  assert.ok("text" in rows && /Sütunların Excel harfleri: İl C\./u.test(rows.text));
});

test("xlsx structure: a CSV and a text read before row numbers still query, without them", () => {
  const csv = sheetText(readCsv("Ad;Tutar\na;1\nToplam;1\n"), { csv: true }).text;
  const [t] = tablesOf(csv);
  assert.equal(t.excelRows, undefined);
  const r = runQuery([t], { sayfa: t.sheet });
  assert.ok("text" in r && !/Excel satırı \|/u.test(r.table));
  assert.equal(t.totals.length, 1, "a total row is a total row in a CSV too");
});

test("xlsx structure: a title merged across the columns stays above the real header; only real totals are taken out", () => {
  const wb = workbook([{
    name: "Rapor",
    rows: [
      ["2026 EĞİTİM RAPORU", null, null], // merged A1:C1
      ["İl", "Eğitim", "Tutar"],
      ["Kütahya", "Toplam kalite yönetimi eğitimi", 100], // an entry that starts with "Toplam"
      ["Uşak", "Genel", 200], // "Genel" as a category, not a label
      ["Manisa", "Dış ticaret", 300],
      ["Genel", null, 600], // the sheet's own total, labelled "Genel"
    ],
    merges: ["A1:C1"],
  }]);
  const [t] = tablesOf(sheetText(wb, { csv: false }).text);
  assert.deepEqual(t.columns, ["İl", "Eğitim", "Tutar"], "the merged title is a note, not the header");
  assert.deepEqual(t.rows.map((r) => r[0]), ["Kütahya", "Uşak", "Manisa"]);
  assert.deepEqual(t.totals.map((r) => r.cells[0]), ["Genel"]);
  const r = runQuery([t], { sayfa: "Rapor", topla: ["Tutar"] });
  assert.ok("text" in r);
  assert.deepEqual(r.numbers, ["600"]);
});

test("xlsx structure: a last entry with an empty cell and a one-column list stay entries; only marked lines are footnotes", () => {
  const wb = workbook([
    { name: "Liste", rows: [["İl", "Tutar"], ["Kütahya", 5], ["Uşak", null], ["Not: tutarlar bin TL", null], ["(1) 2026 tahmini", null]] },
    { name: "Tek", rows: [["İl"], ["Afyonkarahisar"], ["Kütahya"], ["Uşak"]] },
  ]);
  const [list, one] = tablesOf(sheetText(wb, { csv: false }).text);
  assert.deepEqual(list.rows.map((r) => r[0]), ["Kütahya", "Uşak"]);
  assert.ok(list.notes.includes("Not: tutarlar bin TL") && list.notes.includes("(1) 2026 tahmini"));
  assert.deepEqual(one.rows.map((r) => r[0]), ["Afyonkarahisar", "Kütahya", "Uşak"]);
  const last = runQuery([list], { sayfa: "Liste", sondan: true, adet: 1 });
  assert.ok("text" in last && /\| Uşak \|/u.test(last.table));
});

test("xlsx structure: a footnote before the sheet's total is a footnote too", () => {
  const wb = workbook([{ name: "N", rows: [["İl", "Tutar"], ["Kütahya", 50], ["Uşak", 100], ["Not: tutarlar bin TL", null], ["Genel Toplam", 150], ["(1) geçici", null]] }]);
  const [t] = tablesOf(sheetText(wb, { csv: false }).text);
  assert.deepEqual(t.rows.map((r) => r[0]), ["Kütahya", "Uşak"]);
  assert.deepEqual(t.totals.map((r) => r.cells[0]), ["Genel Toplam"]);
  assert.ok(t.notes.includes("Not: tutarlar bin TL") && t.notes.includes("(1) geçici"));
  const last = runQuery([t], { sayfa: "N", sondan: true, adet: 1 });
  assert.ok("text" in last && /\| Uşak \|/u.test(last.table));
});

test("xlsx structure: blank rows under a merged group name stay blank, no entry is made up", () => {
  const wb = workbook([{
    name: "Bölge",
    rows: [["Bölge", "İl", "Tutar"], ["TR33", "Kütahya", 1], [null, null, null], [null, null, null], [null, "Uşak", 2]],
    merges: ["A2:A5"],
  }]);
  const [t] = tablesOf(sheetText(wb, { csv: false }).text);
  assert.deepEqual(t.rows, [["TR33", "Kütahya", "1"], ["TR33", "Uşak", "2"]]);
  assert.deepEqual(t.excelRows, [2, 5]);
  const r = runQuery([t], { sayfa: "Bölge", filtreler: [{ sutun: "Bölge", esit: ["TR33"] }] });
  assert.ok("text" in r && /Eşleşen satır: 2\./u.test(r.text));
  // The cell under the merge written as an empty text: the same.
  const wb2 = workbook([{ name: "B", rows: [["Bölge", "İl", "Tutar"], ["TR33", "Kütahya", 1], ["", "Uşak", 2]], merges: ["A2:A3"] }]);
  assert.deepEqual(tablesOf(sheetText(wb2, { csv: false }).text)[0].rows.map((x) => x[0]), ["TR33", "TR33"]);
  // A total row under the merge keeps its label first: still a total, not one more entry.
  const wb4 = workbook([{ name: "D", rows: [["Bölge", "İl", "Tutar"], ["Ege", "Kütahya", 100], ["", "Uşak", 200], ["", "Toplam", 300]], merges: ["A2:A4"] }]);
  const [d] = tablesOf(sheetText(wb4, { csv: false }).text);
  assert.deepEqual(d.rows, [["Ege", "Kütahya", "100"], ["Ege", "Uşak", "200"]]);
  assert.equal(d.totals.length, 1);
  const sum = runQuery([d], { sayfa: "D", topla: ["Tutar"] });
  assert.ok("text" in sum);
  assert.deepEqual(sum.numbers, ["300"]);
  // "Toplam" as an entry's category (its third cell): an entry, and it gets its group.
  const wb5 = workbook([{ name: "E", rows: [["Bölge", "İl", "Tür", "Tutar"], ["Ege", "Kütahya", "Proje", 100], ["", "Uşak", "Toplam", 200]], merges: ["A2:A3"] }]);
  const [e] = tablesOf(sheetText(wb5, { csv: false }).text);
  const ege = runQuery([e], { sayfa: "E", filtreler: [{ sutun: "Bölge", esit: ["Ege"] }], topla: ["Tutar"] });
  assert.ok("text" in ege);
  assert.deepEqual(ege.numbers, ["300"]);
  // A total label written over two lines in its cell: still a total, under the merge too.
  const wb7 = workbook([{ name: "G", rows: [["Bölge", "İl", "Tutar"], ["Ege", "Uşak", 100], ["", "Genel\nToplam", 100]], merges: ["A2:A3"] }]);
  const [g7] = tablesOf(sheetText(wb7, { csv: false }).text);
  assert.equal(g7.totals.length, 1);
  const s7 = runQuery([g7], { sayfa: "G", topla: ["Tutar"] });
  assert.ok("text" in s7);
  assert.deepEqual(s7.numbers, ["100"]);
  // A footnote under the merge stays a footnote.
  const wb6 = workbook([{ name: "F", rows: [["Bölge", "İl", "Tutar"], ["Ege", "Kütahya", 100], ["", "Uşak", 200], ["", "* Kaynak: TÜİK", ""]], merges: ["A2:A4"] }]);
  const [f] = tablesOf(sheetText(wb6, { csv: false }).text);
  assert.deepEqual(f.rows.map((x) => x[1]), ["Kütahya", "Uşak"]);
  assert.ok(f.notes.includes("* Kaynak: TÜİK"));
  // A note-like line among the entries is an entry: it gets its group.
  const wb8 = workbook([{ name: "H", rows: [["Grup", "İş"], ["Ege", "A"], ["", "Not: inceleme"], ["", "B"]], merges: ["A2:A4"] }]);
  const [h] = tablesOf(sheetText(wb8, { csv: false }).text);
  const inH = runQuery([h], { sayfa: "H", filtreler: [{ sutun: "Grup", esit: ["Ege"] }] });
  assert.ok("text" in inH && /Eşleşen satır: 3\./u.test(inH.text));
  // A row of spaces under it is as blank as an empty one.
  const wb3 = workbook([{ name: "C", rows: [["Bölge", "İl", "Tutar"], ["TR33", "Kütahya", 1], ["", "  ", " "], ["", "Uşak", 2]], merges: ["A2:A4"] }]);
  assert.deepEqual(tablesOf(sheetText(wb3, { csv: false }).text)[0].rows, [["TR33", "Kütahya", "1"], ["TR33", "Uşak", "2"]]);
});

test("xlsx structure: an empty-text cell far off doesn't widen the table", () => {
  const ws = XLSX.utils.aoa_to_sheet([["İl", "Tutar"], ["Kütahya", 1], ["Uşak", 2]]);
  ws.Z1 = { t: "s", v: "" };
  ws.Y9 = { t: "s", v: "   " };
  ws["!ref"] = "A1:Z9";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const [t] = tablesOf(sheetText(readXlsx(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer), { csv: false }).text);
  assert.deepEqual(t.columns, ["İl", "Tutar"]);
  const r = runQuery([t], { sayfa: "S", topla: ["Tutar"] });
  assert.ok("text" in r);
  assert.deepEqual(r.numbers, ["3"]);
});

test("Excel satırları: a line the document wrote itself can't make the reader loop or grow; a wrong one is ignored", () => {
  const sheet = (spans: string) => `## Sheet: S
${SHEET_TR}
Excel satırları: ${spans}

| A | B |
| --- | --- |
| x | 1 |
| y | 2 |`;
  const started = Date.now();
  for (const bad of ["9007199254740992", "1-9007199254740992", "1-1048577", "0-2", "1, 1-2", "3-2", "1-2, 2", "1-50"]) {
    const [t] = tablesOf(sheet(bad));
    assert.equal(t.excelRows, undefined, bad);
    assert.equal(t.rows.length, 2, bad);
  }
  assert.ok(Date.now() - started < 1000, "no long loop");
  assert.deepEqual(tablesOf(sheet("1, 3-4"))[0].excelRows, [3, 4]);
});

test("xlsx structure: a merge the file claims over a billion billion rows fills only the rows that hold values, at once", () => {
  const ws = XLSX.utils.aoa_to_sheet([["Bölge", "İl"], ["TR33", "Kütahya"], ["", "Uşak"]]);
  ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: Number.MAX_SAFE_INTEGER, c: 0 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const started = Date.now();
  const [t] = tablesOf(sheetText(wb, { csv: false }).text);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(t.rows, [["TR33", "Kütahya"], ["TR33", "Uşak"]]);
});

test("xlsx structure: two cells far apart are not walked cell by cell; the sheet is said to be too big", () => {
  const ws: XLSX.WorkSheet = { A1: { t: "s", v: "İl" }, XFD1048576: { t: "n", v: 1 }, "!ref": "A1:XFD1048576" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const started = Date.now();
  const text = sheetText(wb, { csv: false }).text;
  assert.ok(Date.now() - started < 1000);
  assert.match(text, /dolu alanı çok büyük \(1048576 satır × 16384 sütun\); okunmadı/u);
});

test("xlsx structure: a thousand merges over wide rows fill fast", () => {
  const ws: XLSX.WorkSheet = {};
  for (let c = 0; c < 1000; c++) ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: `G${c}` };
  for (let r = 1; r <= 10; r++) ws[XLSX.utils.encode_cell({ r, c: 1000 })] = { t: "n", v: r };
  ws["!merges"] = Array.from({ length: 1000 }, (_, c) => ({ s: { r: 0, c }, e: { r: 10, c } }));
  ws["!ref"] = "A1:ALM11";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const started = Date.now();
  sheetText(wb, { csv: false });
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
});

test("isTotalRow: the label is the whole cell, first or after a row number or code", async () => {
  const { isTotalRow } = await import("./table.ts");
  for (const r of [["Toplam", "5"], ["GENEL TOPLAM", "", "9"], ["Ara Toplam:", "3"], ["Genel Toplam (Bin TL)", "1"], ["12", "Toplam", "4"], ["IV.", "Genel Toplam", "4"], ["Yekûn", "2"], ["Total", "1"], ["Genel", "7"]]) assert.ok(isTotalRow(r), r.join("|"));
  for (const r of [["Toplam kalite yönetimi", "5"], ["Uşak", "Genel", "2"], ["", "Genel", "200"], ["Uşak", "Toplam", "2"], ["Toplamda 5 il", "1"], ["Kütahya", "4"]]) assert.ok(!isTotalRow(r), r.join("|"));
});
