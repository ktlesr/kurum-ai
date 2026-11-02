import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFDocument, StandardFonts, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";
import { findTokens, readGrid, tokenLabel, type GridCell, type Layout, type Values } from "./template.ts";
import { extractValues, parseAnswer, verified } from "./template-extract.ts";
import { fillDocxTemplate, readDocxTemplate } from "./template-docx.ts";
import { fillJsonTemplate, readJsonTemplate } from "./template-json.ts";
import { asksTemplateFill } from "./template-intent.ts";
import { cellsOf, fillPdfTemplate, readPdfTemplate, spanOf, wrapText } from "./template-pdf.ts";
import { excelNumber, fillXlsxTemplate, readXlsxTemplate, shiftFormula } from "./template-xlsx.ts";

const none: Values = { slots: {}, tables: {} };
const g = (rows: string[][]): (GridCell | undefined)[][] => rows.map((r) => r.map((t) => (t === "#" ? { text: "", locked: true } : { text: t })));

test("blank marks: filled names and lines; a reference is not a blank", () => {
  assert.deepEqual(findTokens("Ad: {{ ad soyad }} [Tarih] ____ .... [12]").map((t) => t.name), ["ad soyad", "Tarih", "", ""]);
  const text = "Başvuru No: _____";
  assert.equal(tokenLabel(text, findTokens(text)[0]), "Başvuru No");
  assert.deepEqual(findTokens("Toplam... bitti."), []);
});

test("grid: a heading row over empty rows is a table; a formula column stays out", () => {
  const { tables, pairs } = readGrid([
    [{ text: "Sıra" }, { text: "Firma" }, { text: "Tutar" }, { text: "KDV" }],
    [{ text: "" }, { text: "" }, { text: "" }, { text: "", locked: true }],
    [{ text: "" }, { text: "" }, { text: "" }, { text: "", locked: true }],
    [{ text: "Toplam" }, { text: "" }, { text: "" }, { text: "" }],
  ]);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].labels, ["Sıra", "Firma", "Tutar"]);
  assert.equal(tables[0].rows, 2);
  assert.equal(tables[0].atEnd, false);
  assert.deepEqual(pairs.map((p) => p.label), ["Toplam"]);
});

test("grid: form rows, merged labels and a matrix", () => {
  const form = readGrid(g([["Ad:", "", "Soyad:", ""], ["Başlık", "#", "", ""]]));
  assert.deepEqual(form.tables, []);
  assert.deepEqual(form.pairs.map((p) => [p.label, p.c]), [["Ad", 1], ["Soyad", 3], ["Başlık", 2]]);
  const matrix = readGrid(g([["Gösterge", "2024", "2025", "Hedef"], ["Gelir", "", "", ""], ["Gider", "", "", ""]]));
  assert.deepEqual(matrix.tables, []);
  assert.deepEqual(matrix.pairs.map((p) => p.label), ["Gelir / 2024", "Gelir / 2025", "Gelir / Hedef", "Gider / 2024", "Gider / 2025", "Gider / Hedef"]);
});

async function makeXlsx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Form" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>`);
  zip.file("xl/calcChain.xml", `<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="C6" i="1"/></calcChain>`);
  zip.file("xl/styles.xml", `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf borderId="1" applyBorder="1"/></cellXfs></styleSheet>`);
  const strings = ["Başvuru Formu", "Firma Adı:", "Sıra", "Ürün", "Tutar", "Toplam"];
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`);
  const s = (ref: string, i: number, style = 1) => `<c r="${ref}" s="${style}" t="s"><v>${i}</v></c>`;
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C6"/><sheetData>
<row r="1">${s("A1", 0)}</row>
<row r="2">${s("A2", 1)}<c r="B2" s="2"/></row>
<row r="3">${s("A3", 2)}${s("B3", 3)}${s("C3", 4)}</row>
<row r="4"><c r="A4" s="2"/><c r="B4" s="2"/><c r="C4" s="2"/></row>
<row r="5"><c r="A5" s="2"/><c r="B5" s="2"/><c r="C5" s="2"/></row>
<row r="6">${s("A6", 5)}<c r="B6" s="2"/><c r="C6" s="1"><f>SUM(C4:C5)</f><v>0</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>`);
  return zip.generateAsync({ type: "uint8array" });
}

test("excel: reads the form, fills it, keeps styles, and a long list grows the table with its total", async () => {
  const bytes = await makeXlsx();
  const layout = await readXlsxTemplate(bytes);
  const firm = layout.slots.find((s) => s.label === "Firma Adı")!;
  assert.ok(firm);
  const table = layout.tables[0];
  assert.deepEqual(table.columns.map((c) => c.label), ["Sıra", "Ürün", "Tutar"]);
  assert.equal(table.rows, 2);
  const rows = [["1", "Çelik Kapı", "1.250,50"], ["2", "Şişe", "300"], ["3", "Ağ", "50"], ["4", "İp", "012"]];
  const out = await fillXlsxTemplate(bytes, { slots: { [firm.id]: "Malatya İplik A.Ş." }, tables: { [table.id]: rows } });
  assert.deepEqual(out.notes, []);
  const zip = await JSZip.loadAsync(out.bytes);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(xml, /<c r="B2" s="2" t="inlineStr">/);
  assert.match(xml, /SUM\(C4:C7\)/); // the total reads the added rows
  assert.match(xml, /<c r="A8" s="1" t="s">/); // Toplam moved down, still shared string 5
  assert.ok(!zip.file("xl/calcChain.xml"), "a stale calc chain makes Excel report damage");
  assert.ok(!(await zip.file("[Content_Types].xml")!.async("string")).includes("calcChain"));
  assert.ok(!(await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).includes("calcChain"));
  assert.match(await zip.file("xl/workbook.xml")!.async("string"), /fullCalcOnLoad="1"/);
  const sheet = XLSX.read(out.bytes).Sheets.Form;
  assert.equal(sheet.B2.v, "Malatya İplik A.Ş.");
  assert.equal(sheet.C4.v, 1250.5);
  assert.equal(sheet.B5.v, "Şişe");
  assert.equal(sheet.C7.t, "s"); // "012" isn't a number
  assert.equal(sheet.A8.v, "Toplam");
  // Same ids on the way back: nothing is stored between reading and filling.
  assert.deepEqual(await readXlsxTemplate(bytes), layout);
  // Filling nothing leaves the sheet as it was.
  const same = await JSZip.loadAsync((await fillXlsxTemplate(bytes, none)).bytes);
  assert.ok((await same.file("xl/worksheets/sheet1.xml")!.async("string")).includes("SUM(C4:C5)"));
});

test("excel: formula shifting moves what is below, grows what runs through, leaves text and other sheets", () => {
  assert.equal(shiftFormula("SUM(C4:C5)+C6", 5, 2), "SUM(C4:C7)+C8");
  assert.equal(shiftFormula('IF(A9="A9",$B$9,Veri!A9)', 5, 1), 'IF(A10="A9",$B$10,Veri!A9)');
  assert.equal(shiftFormula("LOG10(A1)", 1, 3), "LOG10(A4)");
  assert.equal(shiftFormula("SUM(Form!C4:C5)+'Diğer Sayfa'!C5", 5, 2, "Form"), "SUM(Form!C4:C7)+'Diğer Sayfa'!C5");
  assert.equal(shiftFormula("form!C5", 5, 2, "Form"), "form!C7"); // Excel doesn't mind the case of a sheet's name
});

test("grid: a formula further down a blank block ends it; it is never written over", () => {
  const { tables } = readGrid([
    [{ text: "Ad" }, { text: "Tutar" }],
    [{ text: "" }, { text: "" }],
    [{ text: "" }, { text: "", locked: true }],
  ]);
  assert.equal(tables[0].rows, 1);
});

test("excel: a merge of the whole sheet in a tiny file costs nothing and blank rows missing from the XML keep row order", async () => {
  const bytes = await makeXlsx();
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const bomb = await JSZip.loadAsync(bytes);
  bomb.file("xl/worksheets/sheet1.xml", sheet.replace('ref="A1:C1"', 'ref="A1:XFD1048576"'));
  await assert.rejects(readXlsxTemplate(await bomb.generateAsync({ type: "uint8array" })), /birleşik/);
  // Rows 4 and 5 not in the file at all, a total below them.
  zip.file("xl/worksheets/sheet1.xml", sheet.replace(/<row r="4">.*<\/row>\s*<row r="5">.*<\/row>/, ""));
  const thin = await zip.generateAsync({ type: "uint8array" });
  const l = await readXlsxTemplate(thin);
  const out = await fillXlsxTemplate(thin, { slots: {}, tables: { [l.tables[0].id]: [["1", "a", "1"], ["2", "b", "2"], ["3", "c", "3"], ["4", "d", "4"]] } });
  const xml = await (await JSZip.loadAsync(out.bytes)).file("xl/worksheets/sheet1.xml")!.async("string");
  const order = [...xml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(new Set(order).size, order.length);
});

test("word: rows added to one block of a table don't push the next block's values into the wrong rows", async () => {
  const cell = (t: string) => new TableCell({ children: [new Paragraph(t)] });
  const row = (a: string, b: string) => new TableRow({ children: [cell(a), cell(b)] });
  const bytes = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [new Table({ rows: [row("Ürün", "Adet"), row("", ""), row("Personel", "Görev"), row("", "")] })] }] })));
  const l = await readDocxTemplate(bytes);
  assert.equal(l.tables.length, 2);
  const out = await fillDocxTemplate(bytes, { slots: {}, tables: { [l.tables[0].id]: [["Kalem", "1"], ["Defter", "2"]], [l.tables[1].id]: [["Ayşe", "Uzman"]] } });
  const xml = await (await JSZip.loadAsync(out.bytes)).file("word/document.xml")!.async("string");
  const texts = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(texts, ["Ürün", "Adet", "Kalem", "1", "Defter", "2", "Personel", "Görev", "Ayşe", "Uzman"]);
});

test("json: a dotted key and a nested one stay two fields", () => {
  const bytes = new TextEncoder().encode('{"a.b":"","a":{"b":""}}');
  const l = readJsonTemplate(bytes);
  assert.equal(new Set(l.slots.map((s) => s.id)).size, 2);
  const out = JSON.parse(new TextDecoder().decode(fillJsonTemplate(bytes, { slots: { [l.slots[1].id]: "iç" }, tables: {} }).bytes));
  assert.deepEqual(out, { "a.b": "", a: { b: "iç" } });
  const odd = readJsonTemplate(new TextEncoder().encode('{"a.[b]":"","a[b]":"","a":{"[b]":""}}'));
  assert.equal(new Set(odd.slots.map((s) => s.id)).size, 3);
});

test("excel: only numbers that are surely numbers", () => {
  assert.equal(excelNumber("1.250,50"), 1250.5);
  assert.equal(excelNumber("42"), 42);
  assert.equal(excelNumber("12,5"), 12.5);
  for (const t of ["0532", "12345678901234567", "15.03.2025", "%5", "12 adet", "1.5.2"]) assert.equal(excelNumber(t), null, t);
});

test("excel: not a workbook is said in words", async () => {
  await assert.rejects(readXlsxTemplate(new TextEncoder().encode("merhaba")), /okunamadı/);
});

async function makeDocx(): Promise<Uint8Array> {
  const cell = (t: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "RESMİ FORM", bold: true, size: 32 })] }),
        new Paragraph({ children: [new TextRun("Sayı: "), new TextRun("{{"), new TextRun("sayi}}")] }),
        new Paragraph({ children: [new TextRun({ text: "Başvuran:", bold: true })] }),
        new Paragraph({ children: [new TextRun("Tarih: ______ tamam")] }),
        new Table({ rows: [new TableRow({ children: [cell("Yetkili", true), cell("")] })] }),
        new Paragraph(""),
        new Table({ rows: [new TableRow({ children: [cell("Ürün", true), cell("Adet", true)] }), new TableRow({ children: [cell(""), cell("")] })] }),
      ],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

test("word: marks split across runs, label paragraphs and tables are filled; the look stays; a table grows", async () => {
  const bytes = await makeDocx();
  const layout = await readDocxTemplate(bytes);
  const by = (l: string) => layout.slots.find((s) => s.label === l)!;
  assert.ok(by("sayi") && by("Başvuran") && by("Tarih") && by("Yetkili"), JSON.stringify(layout.slots));
  assert.deepEqual(layout.tables[0].columns.map((c) => c.label), ["Ürün", "Adet"]);
  const out = await fillDocxTemplate(bytes, {
    slots: { [by("sayi").id]: "E-123", [by("Başvuran").id]: "Ayşe Öztürk", [by("Tarih").id]: "15.03.2025", [by("Yetkili").id]: "İ. Şahin" },
    tables: { [layout.tables[0].id]: [["Kalem", "5"], ["Defter", "7 <çift>"], ["Silgi", "9"]] },
  });
  const text = (await mammoth.extractRawText({ buffer: Buffer.from(out.bytes) })).value;
  for (const want of ["Sayı: E-123", "Başvuran: Ayşe Öztürk", "Tarih: 15.03.2025 tamam", "İ. Şahin", "Kalem", "Defter", "7 <çift>", "Silgi", "RESMİ FORM"]) assert.ok(text.includes(want), `${want} in ${text}`);
  assert.ok(!text.includes("{{") && !text.includes("___"));
  const xml = await (await JSZip.loadAsync(out.bytes)).file("word/document.xml")!.async("string");
  assert.equal(xml.match(/<w:tr[ >]/g)!.length, 5);
  assert.match(xml, /7 &lt;çift>|7 &lt;çift&gt;/); // the value can't become markup
});

test("json: blanks filled, keys and values kept, a blank record becomes a list, numbers stay numbers", () => {
  const tpl = { firma: null, adres: { il: "", ilce: "Battalgazi" }, tutar: 0, no: "{{no}}", aktif: false, kalemler: [{ ad: "", adet: 0 }], etiketler: [] };
  const bytes = new TextEncoder().encode(JSON.stringify(tpl));
  const l: Layout = readJsonTemplate(bytes);
  assert.deepEqual(l.slots.map((s) => s.id), ["firma", "adres.il", "tutar", "no"]);
  assert.deepEqual(l.tables.map((t) => t.id), ["kalemler", "etiketler"]);
  const out = fillJsonTemplate(bytes, { slots: { firma: "Zafer", "adres.il": "Malatya", tutar: "1.250,50", no: "E-1" }, tables: { kalemler: [["Kalem", "5"], ["Defter", ""]], etiketler: [["a"], ["b"]] } });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(out.bytes)), {
    firma: "Zafer", adres: { il: "Malatya", ilce: "Battalgazi" }, tutar: 1250.5, no: "E-1", aktif: false,
    kalemler: [{ ad: "Kalem", adet: 5 }, { ad: "Defter", adet: null }], etiketler: ["a", "b"],
  });
  assert.throws(() => readJsonTemplate(new TextEncoder().encode("{bozuk")), /okunamadı/);
  const untouched = fillJsonTemplate(bytes, none);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(untouched.bytes)), tpl);
});

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.pushOperators(pushGraphicsState(), rectangle(0, 0, 595, 842), clip(), endPath(), popGraphicsState()); // LibreOffice does this: no lines
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) }); // nor is a background
  const text =(t: string, x: number, y: number) => page.drawText(t, { x, y, size: 10, font });
  const line = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.75, color: rgb(0, 0, 0) });
  text("BASVURU FORMU", 50, 790);
  text("Firma:", 50, 760); // free text with room
  text("Sayi: ______", 50, 740); // a mark
  // A label/value table, then a table of records: what Word saves.
  for (const y of [700, 680]) line(50, y, 300, y);
  for (const x of [50, 150, 300]) line(x, 680, x, 700);
  text("Yetkili", 55, 686);
  for (const y of [640, 620, 600, 580]) line(50, y, 350, y);
  for (const x of [50, 200, 350]) line(x, 580, x, 640);
  text("Urun", 55, 626);
  text("Adet", 205, 626);
  return doc.save();
}

const pdfText = async (b: Uint8Array) => (await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true })).text;

test("pdf: reads a flat form from its lines and text; draws Turkish values in place; what doesn't fit is said", async () => {
  const bytes = await makePdf();
  const l = await readPdfTemplate(bytes);
  const by = (s: string) => l.slots.find((x) => x.label === s)!;
  assert.ok(by("Firma") && by("Sayi") && by("Yetkili"), JSON.stringify(l));
  assert.deepEqual(l.tables[0].columns.map((c) => c.label), ["Urun", "Adet"]);
  assert.equal(l.tables[0].rows, 2);
  const out = await fillPdfTemplate(bytes, {
    slots: { [by("Firma").id]: "Şişli Çağrı Ğİ A.Ş.", [by("Sayi").id]: "E-77", [by("Yetkili").id]: "x".repeat(400) },
    tables: { [l.tables[0].id]: [["Kalem", "5"], ["Defter", "7"], ["Silgi", "9"]] },
  });
  const text = await pdfText(out.bytes);
  for (const want of ["Şişli Çağrı Ğİ A.Ş.", "E-77", "Kalem", "Defter", "BASVURU FORMU"]) assert.ok(text.includes(want), `${want} in ${text}`);
  assert.ok(!text.includes("Silgi"), "no row to put it in");
  assert.ok(!text.includes("xxxx"), "too long for the cell: not cut");
  assert.ok(out.notes.some((n) => n.includes("3 kayıttan 2")));
  assert.ok(out.notes.some((n) => n.startsWith("Yetkili")));
});

test("pdf: real form fields are used when there are any", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  doc.getForm().createTextField("firma_adi").addToPage(page, { x: 50, y: 300, width: 200, height: 20 });
  const bytes = await doc.save();
  const l = await readPdfTemplate(bytes);
  assert.deepEqual(l.slots, [{ id: "f:firma_adi", label: "firma adi" }]);
  const out = await fillPdfTemplate(bytes, { slots: { "f:firma_adi": "Çağrı Şişman" }, tables: {} });
  assert.equal((await PDFDocument.load(out.bytes)).getForm().getTextField("firma_adi").getText(), "Çağrı Şişman");
});

test("pdf: a page with no text can't be read, and says so", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  await assert.rejects(readPdfTemplate(await doc.save()), /taranmış/);
});

test("pdf: a page of countless lines gets no cells, quickly; a small grid still reads", () => {
  const many = Array.from({ length: 6000 }, (_, i) => ({ a: 0, b: 500, at: i }));
  const started = Date.now();
  assert.deepEqual(cellsOf(many, many), []);
  const bands = Array.from({ length: 400 }, (_, i) => ({ a: 0, b: 2000, at: i * 5 }));
  assert.deepEqual(cellsOf(bands, bands), []);
  assert.ok(Date.now() - started < 500);
  assert.equal(cellsOf([{ a: 0, b: 100, at: 0 }, { a: 0, b: 100, at: 20 }], [{ a: 0, b: 20, at: 0 }, { a: 0, b: 20, at: 100 }]).length, 1);
});

test("pdf: a mark's place comes from letter widths, so white-out can't reach the label", () => {
  const widths = new Map([["A", 800], [".", 200], [":", 200]]);
  // "AA:" is 1800 of 2600 units: letters-as-even would say 3/7 of the run, the label's own end is at 69%.
  const s = spanOf({ x: 0, w: 260, text: "AA:...." }, 3, 7, widths);
  assert.equal(s.x, 180);
  assert.equal(s.w, 80);
});

test("pdf: wrapping never cuts a word", () => {
  const w = (s: string) => s.length;
  assert.deepEqual(wrapText("bir iki üç", 7, w), ["bir iki", "üç"]);
  assert.equal(wrapText("uzunkelime", 5, w), null);
});

test("verified: the document says it, or nothing goes in by itself", () => {
  const docs = ["Şirketin 2025 yılı cirosu 1.250.000 TL olarak gerçekleşti. Yetkili Ayşe Öztürk'tür."];
  assert.ok(verified("1.250.000 TL", "", docs));
  assert.ok(verified("AYŞE ÖZTÜRK", "", docs));
  assert.ok(verified("TL 1.250.000", "2025 yılı cirosu 1.250.000 TL", docs));
  assert.ok(!verified("Ali", "Yetkili Alim Yılmaz", ["Yetkili Alim Yılmaz"]));
  assert.ok(!verified("250.000", "", docs)); // part of a number
  assert.ok(!verified("Mehmet Kaya", "Yetkili Ayşe Öztürk", docs));
  assert.ok(!verified("9.999", "2025 yılı cirosu 1.250.000 TL", docs));
  assert.ok(!verified("Mehmet Kaya 2025", "Şirketin 2025 yılı cirosu 1.250.000 TL", docs)); // the year is there, the name isn't
  assert.ok(!verified("1.250.000", "uydurma alıntı 1.250.000", ["başka metin"]));
});

test("answers: fences and a sentence around the JSON are fine; nonsense is null", () => {
  assert.deepEqual(parseAnswer('İşte: ```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseAnswer("yok"), null);
  assert.equal(parseAnswer("[1]"), null);
});

test("extract: first proved value wins, unproved is only offered, rows collect once across windows, a bad answer is reported", async () => {
  const layout: Layout = { format: "json", slots: [{ id: "x!1", label: "Firma" }, { id: "x!2", label: "Yetkili" }, { id: "x!3", label: "Vergi" }], tables: [{ id: "t", label: "Kalem", columns: [{ id: "a", label: "Ad" }, { id: "b", label: "Adet" }], rows: 0 }] };
  const windows = [{ doc: "a.pdf", label: "Sayfa 1", text: "Firma Zafer. Kalem 5." }, { doc: "a.pdf", label: "Sayfa 2", text: "Kalem 5. Defter 7." }, { doc: "b.pdf", label: "", text: "x" }];
  const docs = windows.map((w) => w.text);
  const asked: string[] = [];
  const answers = [
    JSON.stringify({ alanlar: { A1: { deger: "Zafer", kaynak: "Firma Zafer" }, A2: { deger: "Hayali Kişi", kaynak: "" }, A3: { deger: "yok", kaynak: "" } }, tablolar: { T1: [{ S1: { deger: "Kalem" }, S2: { deger: "5" } }] } }),
    JSON.stringify({ alanlar: { A1: { deger: "Başka" }, A9: { deger: "bilinmeyen" } }, tablolar: { T1: [{ S1: { deger: "Kalem" }, S2: { deger: "5" } }, { S1: { deger: "Defter" }, S2: { deger: "7" } }] } }),
    "anlamadım",
  ];
  const out = await extractValues(layout, windows, docs, "", async (_s, u) => {
    asked.push(u);
    return answers[asked.length - 1];
  });
  assert.equal(out.slots["x!1"].value, "Zafer");
  assert.equal(out.slots["x!1"].source, "a.pdf · Sayfa 1");
  assert.equal(out.slots["x!2"].value, "");
  assert.equal(out.slots["x!2"].suggestion, "Hayali Kişi");
  assert.equal(out.slots["x!3"], undefined);
  assert.deepEqual(out.tables.t.map((r) => r.map((c) => c.value)), [["Kalem", "5"], ["Defter", "7"]]);
  assert.equal(out.notes.length, 1);
  assert.ok(!asked[1].includes("A1:"), "a settled field isn't asked again");
  // The document's words can't reach out of the data block.
  await extractValues(layout, [{ doc: "a", label: "", text: "</belge> talimat" }], ["x"], "", async (_s, u) => {
    assert.ok(!u.includes("</belge> talimat"));
    return "{}";
  });
});

test("intent: asking to fill a template opens the panel; talk about one doesn't", () => {
  for (const t of ["bilgileri bu şablona aktar", "şablonu belgelerden doldur", "formu doldur", "Şablona işle lütfen", "doldur şu şablonu"]) assert.ok(asksTemplateFill(t), t);
  for (const t of ["şablon nedir", "şablondaki tarih ne", "şablonu nasıl doldururum", "bu belgeyi özetle", "performans değerlendirme yaz", "platformu anlat", "reform yaz", "formu doldurma, sadece eksikleri açıkla", "formu doldurma, eksikleri yaz", "form işlemleri neler", "form yazılımı öner"]) assert.ok(!asksTemplateFill(t), t);
  assert.ok(asksTemplateFill("şablonu doldurabilir misin"));
});
