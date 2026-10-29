// Run: pnpm test. Deterministic recomputation (plan §5.2/§5.3): totals, shares, number forms, dates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellNumber, checkTotals, findDates, verifyNumbers } from "./checks.ts";

const table = (title: string, ...rows: string[][]) => [title, "", ...rows.map((r, i) => `| ${r.join(" | ")} |${i === 0 ? `\n|${" --- |".repeat(r.length)}` : ""}`)].join("\n");

test("cellNumber: Turkish and English forms, negatives, currency, %, footnotes; text isn't a number", () => {
  const cases: [string, number | null][] = [
    ["1.234.567", 1234567], ["1.234,56", 1234.56], ["94,7", 94.7], ["1,234.56", 1234.56], ["0,5", 0.5],
    ["(1.234)", -1234], ["−5", -5], ["- 12,5", -12.5], ["–3", -3], ["-", 0], ["—", 0],
    ["1.250.000 TL", 1250000], ["₺ 1.250", 1250], ["%12,5", 12.5], ["12,5 %", 12.5], ["$1,200.50", 1200.5], ["€ 3.000", 3000],
    ["1.234*", 1234], ["1.234¹", 1234], ["1.234 (2)", 1234], ["**4.500**", 4500], ["12,4(?)", 12.4],
    ["", null], ["Madde 3", null], ["3 adet", null], ["(1.234", null], ["2025-2026", null], ["abc", null],
  ];
  for (const [c, want] of cases) assert.equal(cellNumber(c), want, JSON.stringify(c));
});

test("checkTotals: a right total is confirmed, a wrong one named with both figures", () => {
  const ok = checkTotals(table("Bütçe", ["Kalem", "Tutar (TL)"], ["Personel", "1.200.000"], ["Ekipman", "350.500"], ["Hizmet", "49.500"], ["Toplam", "1.600.000"]));
  assert.equal(ok.length, 1);
  assert.match(ok[0], /"Bütçe": "Toplam" satırı üstündeki satırların toplamıyla tutarlı \(1 sütun/);
  const bad = checkTotals(table("Bütçe", ["Kalem", "2025", "2026"], ["A", "100", "200"], ["B", "50", "75"], ["TOPLAM", "150", "285"]));
  assert.equal(bad.length, 1);
  assert.match(bad[0], /uyuşmuyor \(2026: tabloda 285, satırların toplamı 275\)/);
});

test("checkTotals: decimals and rounding, negatives, dash as zero", () => {
  // three rounded shares of 33,33 add to 99,99: within the rounding of the shown digits
  assert.match(checkTotals(table("", ["Kalem", "Pay"], ["A", "33,33"], ["B", "33,33"], ["C", "33,33"], ["Toplam", "100,00"]))[0], /tutarlı/);
  assert.match(checkTotals(table("", ["Kalem", "Fark"], ["A", "(250)"], ["B", "1.000"], ["C", "-"], ["Toplam", "750"]))[0], /tutarlı/);
  assert.match(checkTotals(table("", ["Kalem", "Tutar"], ["A", "10,5"], ["B", "10,5"], ["Toplam", "22"]))[0], /uyuşmuyor/);
});

test("checkTotals: sub-totals, grand total, parent items, label not in the first column", () => {
  const md = table("Proje bütçesi",
    ["No", "Kalem", "Tutar"],
    ["1", "Personel", "300"], ["2", "Seyahat", "100"], ["", "Ara toplam", "400"],
    ["3", "Makine", "500"], ["4", "Yazılım", "100"], ["", "Ara toplam", "600"],
    ["", "Genel toplam", "1.000"]);
  const notes = checkTotals(md);
  assert.equal(notes.length, 3, notes.join("\n"));
  assert.ok(notes.every((n) => /tutarlı/.test(n)), notes.join("\n"));
  // "Makine" may be its two sub-items or a fourth item: the numbers can't tell, so no note either way
  assert.deepEqual(checkTotals(table("", ["Kalem", "Tutar"], ["Makine", "500"], ["Torna", "300"], ["Freze", "200"], ["Yazılım", "100"], ["Toplam", "600"])), []);
  assert.deepEqual(checkTotals(table("", ["Kalem", "Tutar"], ["Makine", "600"], ["Torna", "500"], ["Parça A", "300"], ["Parça B", "200"], ["Freze", "100"], ["Yazılım", "100"], ["Toplam", "700"])), []);
  // a flat list where a value happens to equal the next rows' sum is still a flat list
  const flat = checkTotals(table("", ["Kalem", "Tutar"], ["A", "5"], ["B", "2"], ["C", "3"], ["D", "7"], ["Toplam", "17"]));
  assert.match(flat[0], /tutarlı/);
});

test("checkTotals: unread, uncertain or non-numeric cells skip the column instead of guessing", () => {
  assert.deepEqual(checkTotals(table("", ["Kalem", "Tutar"], ["A", "100"], ["B", ""], ["Toplam", "250"])), []);
  assert.deepEqual(checkTotals(table("", ["Kalem", "Tutar"], ["A", "100(?)"], ["B", "50"], ["Toplam", "250"])), []);
  assert.deepEqual(checkTotals(table("", ["Kalem", "Açıklama"], ["A", "metin"], ["B", "metin"], ["Toplam", "250"])), []);
  assert.deepEqual(checkTotals(table("", ["Kalem", "Tutar"], ["Toplam", "250"])), [], "nothing above");
});

test("checkTotals: share column = amount ÷ total", () => {
  const ok = checkTotals(table("Dağılım", ["Kalem", "Tutar", "Pay (%)"], ["A", "750", "75,0"], ["B", "250", "25,0"], ["Toplam", "1.000", "100,0"]));
  assert.ok(ok.some((n) => /pay sütunu .* tutarlı/.test(n)), ok.join("\n"));
  const bad = checkTotals(table("Dağılım", ["Kalem", "Tutar", "Oran"], ["A", "750", "%70"], ["B", "250", "%30"], ["Toplam", "1.000", "%100"]));
  assert.ok(bad.some((n) => /pay sütunu tutarlarla uyuşmuyor \(A: tabloda %70, hesaplanan %75,0/.test(n)), bad.join("\n"));
});

test("findDates: numeric and Turkish month forms, upper case too", () => {
  assert.deepEqual(findDates("01.11.2026, 1/11/2026, 2026-11-01 ve 1 Kasım 2026, 1 KASIM 2026, 29 şubat 2028").map((d) => d.key), ["1.11.2026", "1.11.2026", "1.11.2026", "1.11.2026", "1.11.2026", "29.2.2028"]);
  assert.deepEqual(findDates("13.13.2026 ve 1.234.567 ve 3 Kasımda"), []);
});

test("verifyNumbers: a date in another format and its year count as known; an unknown date is flagged", () => {
  const src = "Başvurular 01.11.2026 tarihinde başlar. Bütçe 1.250.000 TL.";
  assert.deepEqual(verifyNumbers("1 Kasım 2026'da başlıyor, 2026 yılı bütçesi 1.250.000 TL.", src), { unverified: [], uncertain: [] });
  assert.deepEqual(verifyNumbers("Son gün 15.11.2026.", src).unverified, ["15.11.2026"]);
  assert.deepEqual(verifyNumbers("Kayıp (1.250.000) değil, −1.250.000 değil.", src).unverified, []);
});

test("checkTotals (review): grand total with KDV after the sub-totals, wrong ones not certified", () => {
  const t = (grand: string) => checkTotals(table("", ["Kalem", "Tutar"], ["A", "200"], ["B", "100"], ["Ara toplam", "300"], ["C", "60"], ["D", "40"], ["Ara toplam", "100"], ["KDV (%20)", "80"], ["Genel toplam", grand]));
  assert.match(t("480").at(-1)!, /"Genel toplam" satırı .* tutarlı/);
  assert.match(t("400").at(-1)!, /uyuşmuyor \(Tutar: tabloda 400, satırların toplamı 480\)/);
  const tk = checkTotals(table("", ["Kalem", "Tutar"], ["A", "100"], ["B", "200"], ["Toplam", "300"], ["KDV", "60"], ["Genel toplam", "360"]));
  assert.equal(tk.length, 2);
  assert.ok(tk.every((n) => /tutarlı/.test(n)), tk.join(" | "));
});

test("checkTotals (review): text that starts with Toplam, year header rows, rate columns", () => {
  assert.deepEqual(checkTotals(table("", ["Konu", "Puan"], ["Toplam kalite yönetimi", "4"], ["Diğer", "3"])), []);
  const years = checkTotals(table("", ["Kalem", "Tutar"], ["", "2026"], ["A", "100"], ["B", "200"], ["Toplam", "300"]));
  assert.match(years[0], /tutarlı/);
  const kdv = checkTotals(table("", ["Kalem", "Tutar", "KDV Oranı"], ["A", "100", "20"], ["B", "200", "20"], ["Toplam", "300", "20"]));
  assert.equal(kdv.length, 1);
  assert.match(kdv[0], /tutarlı \(1 sütun/);
  assert.deepEqual(checkTotals(table("", ["Kalem", "Birim fiyat"], ["A", "10"], ["B", "20"], ["Toplam", "35"])), []);
});

test("checkTotals (review): a long table neither throws nor takes long", () => {
  const md = ["| Kalem | Tutar |", "| --- | --- |", ...Array.from({ length: 130_000 }, (_, i) => `| K${i} | 1 |`), "| Toplam | 130.000 |"].join("\n");
  const t0 = Date.now();
  const notes = checkTotals(md);
  assert.match(notes[0], /tutarlı/);
  assert.ok(Date.now() - t0 < 5000);
});

test("verifyNumbers (review): a date read uncertainly stays uncertain", () => {
  const r = verifyNumbers("Tarih 01.11.2026.", "Tarih 01.11.2026(?)");
  assert.deepEqual(r, { unverified: [], uncertain: ["01.11.2026"] });
});

test("checkTotals (review 2): several Toplam groups and KDV add up in the grand total", () => {
  const t = (grand: string) => checkTotals(table("", ["Kalem", "Tutar"], ["A", "100"], ["B", "200"], ["Toplam", "300"], ["C", "60"], ["D", "40"], ["Toplam", "100"], ["KDV", "80"], ["Genel toplam", grand]));
  assert.match(t("480").at(-1)!, /"Genel toplam" satırı .* tutarlı/);
  assert.match(t("180").at(-1)!, /uyuşmuyor/);
});

test("checkTotals (review 2): an uncertain amount stops the share check", () => {
  const notes = checkTotals(table("", ["Kalem", "Tutar", "Pay (%)"], ["A", "750(?)", "70"], ["B", "250", "30"], ["Toplam", "1.000", "100"]));
  assert.ok(!notes.some((n) => /pay sütunu/.test(n)), notes.join(" | "));
});

test("verifyNumbers (review 2): parts of an uncertain date aren't known numbers", () => {
  assert.deepEqual(verifyNumbers("2026 yılında", "2026-11-15(?)"), { unverified: [], uncertain: ["2026"] });
  assert.deepEqual(verifyNumbers("15 gün sürer", "15 Kasım 2026(?)"), { unverified: [], uncertain: ["15"] });
  assert.deepEqual(verifyNumbers("2026 yılında", "2026-11-15(?) ve 2026 bütçesi"), { unverified: [], uncertain: [] });
});

test("checkTotals / verifyNumbers (security review): hostile sizes stay fast", () => {
  // many 400-row tables whose totals never match and whose rows never nest: the shared budget caps the search
  const one = ["| Kalem | Tutar |", "| --- | --- |", ...Array.from({ length: 400 }, (_, i) => `| K${i} | ${2 ** (i % 30)} |`), "| Toplam | 1 |"].join("\n");
  let t0 = Date.now();
  const notes = checkTotals(Array.from({ length: 200 }, () => one).join("\n\nTablo\n\n"));
  assert.ok(!notes.some((n) => /tutarlı/.test(n)), "an exhausted search never certifies");
  assert.ok(Date.now() - t0 < 5000, `checkTotals ${Date.now() - t0} ms`);
  t0 = Date.now();
  assert.deepEqual(verifyNumbers("2026 ve 15", "01.11.2026(?)15.11.2026(?) ".repeat(100_000)), { unverified: [], uncertain: ["2026", "15"] });
  assert.ok(Date.now() - t0 < 5000, `verifyNumbers ${Date.now() - t0} ms`);
});
