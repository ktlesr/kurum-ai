// lib/destek without a database: the zip reader, the loader's normalisation, matching, plans, the SQL compiler, number
// formats, and the comment check. The workbooks are made here (made-up rows, no agency data); the real workbook and
// the values of its gold set are checked by tests/destek-gold.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { headerUse, normHeader } from "./columns.ts";
import { compileAggregate, compileProjects, metinProblem, searchWords } from "./compile.ts";
import { commentHidden, formatCell, numbersIn, unsupportedNumbers } from "./format.ts";
import { parseWorkbook } from "./load.ts";
import { distance, FAMILY_SPELLINGS, matchValue, PLACE_SPELLINGS } from "./match.ts";
import { PLAN, planJsonSchema, readPlan } from "./plan.ts";
import { METRICS, resolveMetric } from "./semantic.ts";
import { readParts, refBounds, resolvePart, uncachedCells } from "./xlsx-zip.ts";
import { coverageProblems, icmalMetric } from "./reconcile.ts";

const HEAD = ["#", "Yılı", "Program Kısaltması", "Başvuru Sahibi", "Başvuru Sıra No", "İlçe", "İl", "Ana Yasal Statü", "Proje Adı",
  "Teknik ve Mali Değerlendirme Sonucu", "Asil/Yedek/U.D. Liste", "Sözleşme Ajans Destek Miktarı (TL)", "Sözleşme Toplam Bütçe (TL)",
  "Sözleşme Destek Oranı (%)", "Sözleşme İmzaladı Mı?", "Ön Ödeme Tarihi", "Ön Ödeme Tutarı", "Proje Tamamlanma Durumu", "Yeni Bir Kolon"];

async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SOGEP");
  ws.addTable({
    name: "SOGEP_Projeler", ref: "A1", headerRow: true,
    columns: HEAD.map((name) => ({ name })),
    rows: [
      [1, 2025, "SOGEP25", "Bir Belediyesi", 1, "Merkez", "Uşak", "Kamu ", "Kadın Kooperatifi Projesi", "Başarılı", "Asıl", 100.5, 200, { formula: "L2/M2", result: 0.5025 }, "evet", new Date(Date.UTC(2025, 2, 1)), 50, "tamamlandı", "x"],
      [2, 2025, "SOGEP25", "İki Derneği", 2, "Banaz", "Uşak", "STK", "Gençlik Merkezi", "Başarısız", "U.D.", 0, 0, { formula: "L3/M3", result: { error: "#DIV/0!" } }, "Hayır", "-", 0, "U.D", null],
      // FKD-like template row: no province, not a project.
      [3, 2026, null, null, null, null, null, null, null, null, "Başarısız", null, null, null, null, null, null, null, null],
    ],
  });
  const t = wb.addWorksheet("TD");
  t.addTable({
    name: "TD_Projeler", ref: "A1", headerRow: true,
    columns: ["Yılı", "İl", "Faaliyet Adı", "Nihai Değerlendirme Sonucu", "Sözleşme Yüklenici Toplam Maliyet (TL)", "Sözleşme İmzaladı Mı?"].map((name) => ({ name })),
    rows: [[2021, "Kütahya", "Eğitim", "Başarılı", 1000, "Evet"]],
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("xlsx-zip: tables found from the zip itself; rels paths; uncached formula cells; ranges", async () => {
  const p = await readParts(await workbook());
  assert.deepEqual(p.tables.map((t) => [t.sheet, t.name, t.ref]), [["SOGEP", "SOGEP_Projeler", "A1:S4"], ["TD", "TD_Projeler", "A1:F2"]]);
  assert.equal(resolvePart("xl/workbook.xml", "worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
  assert.equal(resolvePart("xl/worksheets/sheet1.xml", "../tables/table1.xml"), "xl/tables/table1.xml");
  assert.equal(resolvePart("xl/workbook.xml", "/xl/worksheets/sheet2.xml"), "xl/worksheets/sheet2.xml");
  const xml = `<sheetData><row r="1"><c r="A1"><f>1+1</f><v>0</v></c><c r="B1"><f>C1</f></c><c r="C1" t="s"><v>3</v></c><c r="D1" s="2"/><c r="E1"><f t="shared" si="0"/></c></row></sheetData>`;
  assert.deepEqual([...uncachedCells(xml)], ["B1", "E1"], "a stored 0 is a stored result; no <v> is none");
  assert.deepEqual(refBounds("A1:BQ2053"), { c1: 1, r1: 1, c2: 69, r2: 2053 });
});

test("load: headers by name (TD's own), values as Excel stored them, normalisation and findings", async () => {
  const p = await parseWorkbook(await workbook(), "t.xlsx");
  const s = p.families.find((f) => f.aile === "SOGEP")!;
  assert.equal(s.rows.length, 2);
  assert.equal(s.skipped, 1, "the row without a province is not a project");
  const [a, b] = s.rows;
  assert.equal(a.row, 2, "Excel row number kept");
  assert.equal(a.values.imzaladi, "Evet", "\"evet\" is Excel-equal to Evet");
  assert.equal(a.values.durum, "Tamamlandı");
  assert.equal(a.values.liste, "Asıl", "\"Asıl\" is not \"Asil\" for the İcmal formula: kept as written");
  assert.equal(a.values.ana_yasal_statu, "Kamu", "trailing space removed");
  assert.equal(a.values.sozlesme_destek, "100.5");
  assert.deepEqual(a.payments, [{ tur: "on", tarih: "2025-03-01", tutar: "50" }]);
  assert.equal(b.values.durum, "U.D.", "\"U.D\" → \"U.D.\"");
  assert.equal(b.payments.length, 0, "\"-\" date and 0 amount: no payment");
  const kinds = p.dq.map((d) => d.kind);
  assert.ok(kinds.includes("hata_degeri") && kinds.includes("schema_drift") && kinds.includes("bos_il") && kinds.includes("yazim") && kinds.includes("bosluk"), kinds.join(","));
  assert.ok(p.dq.some((d) => d.kind === "schema_drift" && /Yeni Bir Kolon/u.test(d.detail)));
  assert.equal(a.extra["Yeni Bir Kolon"], "x", "unknown header kept raw in extra");
  const td = p.families.find((f) => f.aile === "TD")!.rows[0];
  assert.equal(td.values.sozlesme_destek, "1000", "TD's contract cost is its support (Genel Analiz)");
  assert.equal(td.values.proje_adi, "Eğitim");
  assert.equal(td.values.degerlendirme, "Başarılı");
});

test("columns: header matching ignores spaces, line breaks and case; İcmal headers map to metrics", () => {
  assert.deepEqual(headerUse("PTÇ", "Sözleşme  İmzaladı\nMı?"), { to: "canon", col: "imzaladi" });
  assert.deepEqual(headerUse("PTÇ", "sözleşme yüklenici toplam maliyet (tl)"), { to: "extra", known: false }, "TD-only header elsewhere: drift");
  assert.deepEqual(headerUse("TD", "Sözleşme Yüklenici Toplam Maliyet (TL)"), { to: "canon", col: "sozlesme_destek" });
  assert.deepEqual(headerUse("SOGEP", "1. Ara Ödeme Tutarı"), { to: "payment", tur: "ara1", part: "tutar" });
  assert.equal(normHeader(" Ajans Proje Destek \nMiktarı "), "ajans proje destek miktarı");
  assert.equal(icmalMetric("Sözleşme Toplam Maliyet (TL)"), "destek_sozlesme");
  assert.equal(icmalMetric("Nihai Fiili Toplam Bütçe (Def-TL)"), "butce_def");
  for (const m of ["destek_sozlesme", "butce_def", "asil_proje", "fizibilite_sayisi"]) assert.ok(METRICS[m], m);
});

test("match: case and Turkish letters ignored, synonyms, unique prefix, small typos; else no guess", () => {
  const iller = ["Afyonkarahisar", "Kütahya", "Manisa", "Uşak"];
  assert.deepEqual(matchValue("USAK", iller), { value: "Uşak" });
  assert.deepEqual(matchValue("uşak", iller), { value: "Uşak" });
  assert.equal((matchValue("afyon", iller, PLACE_SPELLINGS) as { value: string }).value, "Afyonkarahisar");
  assert.equal((matchValue("Kütahy", iller) as { value: string }).value, "Kütahya");
  assert.equal((matchValue("Manısa", iller) as { value: string }).value, "Manisa");
  assert.match((matchValue("Çanakkale", iller) as { error: string }).error, /bu dosyada yok/u);
  const aileler = ["PTÇ", "GPD", "FND", "FKD", "DFD-FZD", "TD", "SOGEP", "Diğer"];
  assert.equal((matchValue("sosyal gelişme", aileler, FAMILY_SPELLINGS) as { value: string }).value, "SOGEP");
  assert.equal((matchValue("ptc", aileler, FAMILY_SPELLINGS) as { value: string }).value, "PTÇ");
  assert.equal((matchValue("teknik destek", aileler, FAMILY_SPELLINGS) as { value: string }).value, "TD");
  assert.ok("error" in matchValue("FD", ["FKD", "FND"]), "two equally near: not guessed");
  assert.equal(distance("kitten", "sitting"), 3);
});

test("plan: zod schema is the tool's input; unknown fields and metrics refused with the reason", () => {
  const ok = readPlan(JSON.stringify({ type: "aggregate", filters: { aile: ["SOGEP"], yil: { in: [2025] } }, group_by: ["il"], metrics: ["destek"] }));
  assert.ok("plan" in ok);
  assert.equal(ok.plan.amount_basis, "default");
  assert.equal(ok.plan.include_total_row, true);
  assert.match((readPlan(JSON.stringify({ type: "aggregate", metrics: ["hibe"] })) as { error: string }).error, /metrics/u);
  assert.match((readPlan(JSON.stringify({ type: "aggregate", sql: "DROP TABLE x" })) as { error: string }).error, /geçersiz/u);
  assert.match((readPlan("{oops") as { error: string }).error, /JSON/u);
  const schema = planJsonSchema() as { type: string; properties: Record<string, unknown> };
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.filters && schema.properties.metrics && !JSON.stringify(schema).includes("$ref"));
  assert.equal(resolveMetric("destek", "def"), "destek_def");
  assert.equal(resolveMetric("es_finansman", "def"), null, "no Def-TL co-financing column");
});

test("compile: values only as parameters; weighted ratio; total row by GROUPING SETS; the limit spares it", () => {
  const evil = "x'; DROP TABLE destek.projeler; --";
  const plan = PLAN.parse({ type: "aggregate", filters: { il: [evil], metin: evil, yil: { in: [2025] } }, group_by: ["il"], metrics: ["destek", "destek_orani"], limit: 3 });
  const c = compileAggregate(plan, "sozlesme", 7);
  assert.ok(!("error" in c));
  assert.ok(!c.text.includes("DROP"), "user text never in the SQL");
  assert.ok(c.params.some((x) => Array.isArray(x) && x[0] === evil));
  assert.ok(c.params.some((x) => typeof x === "string" && x.startsWith("%") && x.includes("drop")), "search words folded, as a LIKE parameter");
  assert.match(c.text, /GROUPING SETS \(\(il\), \(\)\)/u);
  assert.match(c.text, /sum\(m_destek_sozlesme\) FILTER \(WHERE m_butce_sozlesme IS NOT NULL\)/u, "Σ destek / Σ bütçe, not a mean of row ratios");
  assert.match(c.text, /"__total" <> 0 OR __rn <= 3/u);
  const all = compileAggregate(PLAN.parse({ type: "aggregate", group_by: ["ilce", "program_kodu"], metrics: ["gelen_proje"] }), "def", 1);
  assert.ok(!("error" in all));
  assert.match(all.text, /__rn <= 200/u, "no plan limit: still at most a page's 200 rows (a backup keeps them all)");
  assert.deepEqual(c.columns.map((x) => x.key), ["il", "destek_sozlesme", "destek_orani_sozlesme"]);
  assert.match((compileAggregate(PLAN.parse({ type: "aggregate", metrics: ["es_finansman"] }), "def", 1) as { error: string }).error, /yok/u);
  assert.ok(!PLAN.safeParse({ type: "list_projects", limit: 500 }).success, "a list is capped at 200 by the plan");
  const l = compileProjects(PLAN.parse({ type: "list_projects", order_by: [{ field: "destek", dir: "desc" }], limit: 200 }), "def", 1, false);
  assert.match(l.text, /ORDER BY "destek" DESC NULLS LAST/u);
  assert.match(l.text, /LIMIT 200$/u);
  assert.match(compileProjects(PLAN.parse({ type: "lookup_project", filters: { metin: "x y" }, limit: 200 }), "def", 1, true).text, /LIMIT 20$/u, "a lookup shows at most 20");
  assert.deepEqual(searchWords("Çobanlar Belediyesi %_"), ["cobanlar", "belediyesi"]);
  assert.match(metinProblem(PLAN.parse({ type: "lookup_project", filters: { metin: "A B" } }))!, /aranacak kelime yok/u, "no words left: refused, not run unfiltered");
  assert.equal(metinProblem(PLAN.parse({ type: "lookup_project", filters: { metin: "Çobanlar" } })), null);
  assert.equal(metinProblem(PLAN.parse({ type: "aggregate" })), null);
});

test("compile: an order by a generic metric is by its basis' column, never a name it only begins (destek_bakiyesi)", () => {
  const c = compileAggregate(PLAN.parse({ type: "aggregate", group_by: ["il"], metrics: ["destek_bakiyesi", "destek"], order_by: [{ field: "destek", dir: "desc" }], limit: 2 }), "def", 1);
  assert.ok(!("error" in c));
  assert.match(c.text, /ORDER BY "destek_def" DESC NULLS LAST/u);
  assert.doesNotMatch(c.text, /ORDER BY "destek_bakiyesi"/u);
  const l = compileProjects(PLAN.parse({ type: "list_projects", order_by: [{ field: "destek_def", dir: "asc" }] }), "def", 1, false);
  assert.match(l.text, /ORDER BY "destek" ASC NULLS LAST/u);
  const d = compileProjects(PLAN.parse({ type: "lookup_project", filters: { metin: "ab" }, order_by: [{ field: "destek", dir: "desc" }] }), "def", 1, true);
  assert.match(d.text, /ORDER BY yil DESC/u, "no prefix match onto destek_bakiyesi in the detail list either");
});

test("reconcile: a family with projects but no usable İcmal fails the gate", () => {
  const ok = { aile: "SOGEP", ilceRows: 58, metrics: new Set(["gelen_proje", "sozlesme_imzalanan", "destek_sozlesme"]) };
  assert.deepEqual(coverageProblems([{ aile: "SOGEP", loaded: 105 }, { aile: "FKD", loaded: 0 }], [ok]), [], "an empty family needs no İcmal");
  assert.match(coverageProblems([{ aile: "SOGEP", loaded: 105 }, { aile: "TD", loaded: 1409 }], [ok])[0], /TD: İcmal tablosu .* bulunamadı/u);
  assert.match(coverageProblems([{ aile: "SOGEP", loaded: 1 }], [{ ...ok, ilceRows: 0 }])[0], /il\/ilçe satırı yok/u);
  assert.match(coverageProblems([{ aile: "SOGEP", loaded: 1 }], [{ ...ok, metrics: new Set(["gelen_proje"]) }])[0], /sozlesme_imzalanan, bir destek tutarı kolonu/u);
});

test("format: Turkish numbers from decimal strings; the comment check", () => {
  assert.equal(formatCell("4567890", "amount"), "4.567.890,00");
  assert.equal(formatCell("3141592.65", "amount"), "3.141.592,65");
  assert.equal(formatCell("0.4136912345678901", "ratio"), "%41,37");
  assert.equal(formatCell("13", "count"), "13");
  assert.equal(formatCell("2025", "int"), "2025");
  assert.equal(formatCell("2025-03-01", "date"), "01.03.2025");
  assert.equal(formatCell(null, "amount"), "");
  assert.equal(formatCell("123456789012345678.125", "amount"), "123.456.789.012.345.678,13", "no float on the way");
  assert.deepEqual(numbersIn("Bir il %41,37 ile 4.567.890,00 TL aldı; 13 proje, 2025."), ["41.37", "4567890", "13", "2025"]);
  const tool = ["| Bir il | 3 | 4.567.890,00 | %41,37 |", "Kapsam: Yılı=2025 · 13 proje satırı"];
  assert.deepEqual(unsupportedNumbers("Bir il %41,37 oranla öne çıkıyor; 2025'te 13 proje.", tool), []);
  assert.deepEqual(unsupportedNumbers("Bir il yaklaşık 4,6 milyon TL aldı.", tool), ["4600000"], "a rounded number is not in the table");
  assert.deepEqual(unsupportedNumbers("9 proje desteklendi.", tool), ["9"], "a small number not in the table is not let through either");
  assert.deepEqual(unsupportedNumbers("Bir il 3 projeyle öne çıkıyor.", tool), [], "one that is, is");
  assert.deepEqual(unsupportedNumbers("Fark -4.567.890,00 TL.", tool), ["-4567890"], "a sign makes another number");
  assert.deepEqual(unsupportedNumbers("Yaklaşık 3e9 TL.", tool), ["3e9"], "so does an exponent");
  assert.deepEqual(numbersIn("2-3 cümle, −5 ve -0"), ["2", "3", "-5", "0"]);
  assert.deepEqual(numbersIn("%3.9 ve 1.234 ve 1.2345 ve 4.567.890,00"), ["3.9", "1234", "1.2345", "4567890"], "a dot not in groups of three is a decimal point");
  assert.deepEqual(unsupportedNumbers("Oran %3.9.", ["| 3 | 9 |"]), ["3.9"], "a dot decimal can't pass as two numbers of the table");
  assert.deepEqual(unsupportedNumbers("Oran %41.37.", tool), [], "the table's %41,37 written with a dot is the same number");
  assert.deepEqual(numbersIn("Oran %.9, destek .5 milyon, ,25 pay"), ["0.9", "500000", "0.25"], "a decimal without its 0 (and its scale word)");
  assert.deepEqual(unsupportedNumbers("Destek .5 milyon TL.", tool), ["500000"]);
  assert.deepEqual(numbersIn("3 milyon, 12,2 milyar, 5 bin, 1.5 Milyon, 2 milyonluk"), ["3000000", "12200000000", "5000", "1500000", "2000000"]);
  assert.deepEqual(unsupportedNumbers("Destek 3 milyon TL.", ["| 3 | 100,00 |"]), ["3000000"], "a scale word makes another number than the table's 3");
  assert.deepEqual(unsupportedNumbers("Bir il 4.567.890,00 TL aldı.", tool), [], "the table's own number, as written, passes");
  // The tool refused the plan (no table): the model's answer after it is still checked against what the tool said.
  assert.equal(commentHidden("9 proje desteklendi.", ["HATA (filtre eşleşmedi, veri yokluğu değil): Çanakkale bu dosyada yok"]), true);
  assert.equal(commentHidden("Çanakkale bu dosyada yok; doğru ili yazar mısınız?", ["HATA: ..."]), false);
  assert.equal(commentHidden("9 proje", []), false, "no tool call: not this check's business");
});

test("view: a chat backup's tables are bounded and checked; copy text has the table, not a held-back comment", async () => {
  const { cleanDestek, answerText } = await import("./view.ts");
  assert.equal(cleanDestek("x"), undefined);
  const t = cleanDestek([{ title: "T", columns: [{ label: "İl", kind: "text" }, { label: "Destek", kind: "amount" }, { label: "x", kind: "<script>" }], rows: [["Uşak", "1,00", "a", "fazla"], "kötü"], total: ["Toplam", "1,00", ""], footer: "Kapsam", warnings: ["u", 5] }])!;
  assert.deepEqual(t[0].columns.map((c) => c.kind), ["text", "amount", "text"], "an unknown kind is text");
  assert.deepEqual(t[0].rows, [["Uşak", "1,00", "a"]], "rows cut to the columns; a non-row dropped");
  assert.deepEqual(t[0].warnings, ["u"]);
  const meta = { destek: t };
  assert.match(answerText("Yorum.", meta), /\| İl \| Destek \| x \|\n\| --- \| ---: \| --- \|\n\| Uşak \| 1,00 \| a \|\n\| \*\*Toplam\*\* \| \*\*1,00\*\* \|  \|[\s\S]*Yorum\.$/u);
  assert.doesNotMatch(answerText("Gizli 4,6 milyon.", { ...meta, destekHidden: true }), /Gizli/u);
  assert.equal(answerText("Düz cevap", undefined), "Düz cevap");
  const { historyText, HISTORY_CHARS, MAX_ROWS, MAX_TABLES } = await import("./view.ts");
  const { MAX_CALLS, MAX_STEPS } = await import("../lookup.ts");
  assert.ok(MAX_TABLES >= MAX_CALLS * MAX_STEPS, "an answer keeps a table for every tool call its loop can make");
  const twelve = Array.from({ length: MAX_TABLES }, (_, i) => ({ title: `T${i}`, columns: [{ label: "x", kind: "text" }], rows: [[`${i}`]], footer: "", warnings: [] }));
  assert.equal(cleanDestek(twelve)!.length, MAX_TABLES, "a backup keeps them all");
  assert.match(historyText("", { ...meta, destekHidden: true }), /\| Uşak \| 1,00 \| a \|/u, "a table-only answer is the next question's history too");
  const big = { destek: [{ title: "T", columns: [{ label: "x", kind: "text" }], rows: Array.from({ length: 5000 }, () => ["y".repeat(40)]), footer: "", warnings: [] }] };
  assert.ok(historyText("", big).length < HISTORY_CHARS + 100, "capped well under the request's 100.000 characters");
  assert.equal(cleanDestek([{ ...big.destek[0], rows: big.destek[0].rows.slice(0, MAX_ROWS) }])![0].rows.length, MAX_ROWS, "a full table survives a backup");
  const long = "uzun cevap ".repeat(3000);
  assert.equal(historyText(long, undefined), long, "an answer without support tables goes whole, as before");
  assert.equal(historyText(long, { destek: [] }), long);
  assert.ok(historyText(long, big).endsWith(long), "with tables: only the tables are capped, the text goes whole");
});

test("stream: text taken back (RETRACT) is not part of the answer; status lines never are", async () => {
  const { RETRACT, STATUS_SEP, streamText } = await import("../context.ts");
  const st = (s: string) => `${STATUS_SEP}${s}${STATUS_SEP}`;
  assert.equal(streamText(`Merhaba ${st("Düşünüyor…")}dünya`), "Merhaba dünya");
  assert.equal(streamText(`999 proje desteklendi. ${st(RETRACT)}${st("Destek verisi hesaplanıyor…")}`), "", "taken back before the tool answered");
  assert.equal(streamText(`999 ${st(RETRACT)}${st("Destek verisi hesaplanıyor…")}Tabloda 13 proje var.`), "Tabloda 13 proje var.");
  assert.equal(streamText(`Yarım ${STATUS_SEP}Düşü`), "Yarım ", "a status line cut by the network");
  assert.equal(streamText(`999 proje${STATUS_SEP}${RETRACT}`), "", "a marker cut by the network takes the text back too");
  const { hasAnswer } = await import("./view.ts");
  assert.equal(hasAnswer({ content: "", meta: { destek: [{ title: "", columns: [], rows: [], footer: "", warnings: [] }], destekHidden: true } }), true, "tables without text: kept");
  assert.equal(hasAnswer({ content: "", meta: { destekHidden: true } }), true, "the held-back note alone: kept");
  assert.equal(hasAnswer({ content: "  " }), false);
});

test("the support workbook is known by its name across years, not by a bare figure", async () => {
  const { bookKey } = await import("./match.ts");
  const k = bookKey("ZAFER Destekler - Veriler (Deflatörlü - 2026)-YK.xlsx");
  assert.ok(k);
  assert.equal(bookKey("ZAFER Destekler - Veriler (Deflatörlü - 2027)-YK.xlsx"), k, "next year's file is the same workbook");
  assert.equal(bookKey("zafer destekler veriler deflatorlu 2027 yk.XLSX"), k, "case, Turkish letters and separators don't matter");
  assert.notEqual(bookKey("SOGEP Başvuru Rehberi 2026.pdf"), k);
  assert.equal(bookKey("2026.xlsx"), null, "a name of figures alone matches nothing");
});

test("destekAnswers: the tool's refusals all start with HATA, its results don't", async () => {
  const { destekAnswers, runDestek } = await import("./tool.ts");
  const { readPlan } = await import("./plan.ts");
  const noSql = undefined as never;
  for (const args of ["{", JSON.stringify({ type: "aggregate", metrics: ["yok_boyle"] })]) {
    const r = readPlan(args);
    assert.ok("error" in r && !destekAnswers(r.error), args);
  }
  assert.equal(destekAnswers((await runDestek(noSql, undefined, "{}")).out), false, "nothing loaded");
  assert.equal(destekAnswers("SONUÇ: 0 proje. Kapsamda proje yok."), true);
  assert.equal(destekAnswers("Kullanıcıya şu soruyu sor, tahmin etme: hangi yıl?"), true);
});

test("support and budget bring their ratio; amounts named on one basis set the table's basis", () => {
  const c = compileAggregate(PLAN.parse({ type: "aggregate", group_by: ["yil"], metrics: ["destek", "butce"] }), "def", 1) as { columns: { key: string; label: string }[] };
  assert.deepEqual(c.columns.map((x) => x.key), ["yil", "destek_def", "butce_def", "destek_orani_def"]);
  assert.equal(c.columns[3].label, "Nihai fiili destek oranı (Def-%)");
  const one = compileAggregate(PLAN.parse({ type: "aggregate", metrics: ["destek_sozlesme"] }), "def", 1) as { columns: { key: string }[] };
  assert.deepEqual(one.columns.map((x) => x.key), ["destek_sozlesme"]);
});

test("basisOf: one named basis wins, anything mixed keeps the plan's", async () => {
  const { basisOf } = await import("./tool.ts");
  const b = (o: object) => basisOf(PLAN.parse({ type: "aggregate", amount_basis: "def", ...o }));
  assert.equal(b({ metrics: ["butce_nihai", "destek_nihai"] }), "nihai");
  assert.equal(b({ metrics: ["destek", "butce_nihai"] }), "def");
  assert.equal(b({ metrics: ["destek_nihai", "butce_sozlesme"] }), "def");
  assert.equal(b({ metrics: ["gelen_proje"] }), "def");
  assert.equal(basisOf(PLAN.parse({ type: "list_projects", amount_basis: "def", metrics: ["destek_nihai"] })), "def");
  const c = compileAggregate(PLAN.parse({ type: "aggregate", metrics: ["destek", "butce", "gelen_proje"] }), "def", 1) as { columns: { key: string }[] };
  assert.deepEqual(c.columns.map((x) => x.key), ["destek_def", "butce_def", "destek_orani_def", "gelen_proje"]);
});
