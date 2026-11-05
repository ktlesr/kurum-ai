import { test } from "node:test";
import assert from "node:assert/strict";
import { filesCall, findFiles } from "./file-search.ts";
import { dateIn, nameDate, todayKey } from "./name-date.ts";

test("dateIn: days, months, quarters, years the way Turkish file names write them; the most precise wins", () => {
  const cases: [string, string | null][] = [
    ["Bakanlık_Raporu_2026-03", "Mart 2026"],
    ["2026_03_31 tablo", "31.03.2026"],
    ["31.03.2026 yazı", "31.03.2026"],
    ["03-04-2026", "03.04.2026"], // day first, the Turkish way
    ["12 Mart 2026 tutanak", "12.03.2026"],
    ["Mart 2026 rapor", "Mart 2026"],
    ["mart_26 rapor", "Mart 2026"],
    ["Ekim-2025 bülten", "Ekim 2025"],
    ["03.2026", "Mart 2026"],
    ["2026 Q1", "2026 1. çeyrek"],
    ["1. çeyrek 2026", "2026 1. çeyrek"],
    ["2026 I. Dönem", "2026 1. çeyrek"],
    ["Stratejik Plan 2024-2028", "2028"],
    ["Rapor 2025", "2025"],
    ["32.01.2026", null], // a mistyped day is no date, and not "Ocak 2026" either
    ["31 Şubat 2026", null],
    ["2026_02_30 tablo", null],
    ["Rapor 2026 2. çeyrek", "2026 2. çeyrek"], // not "Şubat 2026"
    ["2026 03 rapor", "Mart 2026"],
    ["Rapor 2026 3 nüsha", "2026"],
    ["31 Şubat 2026 - 01 Mart 2026", null], // one mistyped day: the name gives no date
    ["2025 1. çeyrek - 2026 2. çeyrek", "2026 2. çeyrek"], // each quarter with its own year
    ["I. Dönem Raporu (2026)", "2026 1. çeyrek"],
    ["2026 1. çeyrek ve 2. çeyrek", "2026 2. çeyrek"], // the one year goes with every quarter
    ["2026 Q1 ve Q2", "2026 2. çeyrek"],
    ["Q3 2025 - 2026 Q1", "2026 1. çeyrek"],
    ["Q1 2025 - Q1 2026 Q2 raporu", "2026 2. çeyrek"], // a year two quarters share
    ["2026 Q1-Q2 rapor", "2026 2. çeyrek"],
    ["2026 1.-2. çeyrek", "2026 2. çeyrek"],
    ["2025 Q4 - 2026 Q1-Q2 rapor", "2026 2. çeyrek"], // the year in effect where a quarter stands
    ["2025 4. çeyrek - 2026 1.-2. çeyrek", "2026 2. çeyrek"],
    ["Q4 raporu 2025", "2025 4. çeyrek"],
    ["2025 Q4 - Q1  2026", "2026 1. çeyrek"], // spacing of any width
    ["Mart__2026", "Mart 2026"],
    ["2025 rapor 1800 Q2", "2025 2. çeyrek"], // a number out of range is no year to take
    ["Rapor 01.01.2026-31.03.2026", "31.03.2026"], // a span of days: its end
    ["Rapor 2026-01-01-2026-03-31", "31.03.2026"],
    ["Rapor 2026-01-15-2026-03-31", "31.03.2026"], // "01-15-2026" inside it is the real days read wrong
    ["Rapor 31-03-2026-30-06-2026", "30.06.2026"],
    ["Rapor 31.03.2026-31.02.2026", null], // one end not in the calendar
    ["Rapor 01.01.2026 - 31.03.2026", "31.03.2026"],
    ["Rapor v2", null],
    ["1.234 TL", null],
  ];
  for (const [name, want] of cases) assert.equal(dateIn(name)?.shown ?? null, want, name);
  assert.ok(dateIn("2026")!.key < dateIn("Mart 2026")!.key && dateIn("Mart 2026")!.key < dateIn("31.03.2026")!.key);
});

test("nameDate: the file's own name before its folders, the nearest folder first", () => {
  assert.deepEqual(nameDate("Giden/2025/Mart 2026 liste.xlsx"), { key: 20260300, shown: "Mart 2026", from: "dosya adı" });
  assert.deepEqual(nameDate("Arşiv 2019/Giden/2026/liste.xlsx"), { key: 20260000, shown: "2026", from: "klasör adı" });
  assert.equal(nameDate("Giden/liste.xlsx"), null);
  assert.equal(todayKey(Date.UTC(2026, 10, 4, 22, 30)), 20261105, "Istanbul's day");
});

const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 9);
const NOW = at(2026, 11, 5);

test("findFiles 'yeni': the name's date before the file time; a later date (a draft, a forecast) is not the latest; the basis is shown", () => {
  const files = [
    // Restored from a backup last week: the newest file time, an old report.
    { path: "Bakanlığa Giden/2025/Giden Tablo Mart 2025.xlsx", size: 1, mtime: at(2026, 10, 30), readable: true },
    { path: "Bakanlığa Giden/2026/Giden Tablo Mart 2026.xlsx", size: 1, mtime: at(2026, 4, 2), readable: true },
    { path: "Bakanlığa Giden/2026/Giden Tablo Haziran 2026.xlsx", size: 1, mtime: at(2026, 7, 1), readable: true },
    { path: "Gönderilecekler/Taslak Tablo 2027.xlsx", size: 1, mtime: at(2026, 9, 1), readable: true },
    { path: "Bakanlığa Giden/tablo notları.txt", size: 1, mtime: at(2026, 6, 15), readable: true },
  ];
  const r = findFiles(files, { sorgu: "tablo", siralama: "yeni" }, 30, NOW);
  const order = r.text.split("\n").filter((l) => /^\| [BG]/u.test(l)).map((l) => l.split(" | ")[0].slice(2));
  assert.deepEqual(order, [
    "Bakanlığa Giden/tablo notları.txt", // no date in its name: its file time, 15 Jun 2026, after "Haziran 2026"
    "Bakanlığa Giden/2026/Giden Tablo Haziran 2026.xlsx",
    "Bakanlığa Giden/2026/Giden Tablo Mart 2026.xlsx",
    "Bakanlığa Giden/2025/Giden Tablo Mart 2025.xlsx", // restored last week: its name, not its file time
    "Gönderilecekler/Taslak Tablo 2027.xlsx", // a later year: a draft, last
  ]);
  assert.match(r.text, /\| Haziran 2026 \(dosya adı\) \|/u);
  assert.match(r.text, /\| 2027 \(dosya adı, ileri tarih\) \|/u);
  assert.match(r.text, /adındaki ya da klasöründeki tarihe göre.*ileri bir tarih olanlar en sonda/u);
});

test("findFiles 'degisiklik': the file time alone, for 'which file was changed last'", () => {
  const files = [
    { path: "Rapor/Mart 2025.xlsx", size: 1, mtime: at(2026, 11, 4), readable: true },
    { path: "Rapor/Mart 2026.xlsx", size: 1, mtime: at(2026, 4, 2), readable: true },
  ];
  const order = (siralama: "yeni" | "degisiklik") =>
    findFiles(files, { sorgu: "rapor", siralama }, 30, NOW).text.split("\n").filter((l) => l.startsWith("| Rapor")).map((l) => l.split(" | ")[0].slice(2));
  assert.deepEqual(order("yeni"), ["Rapor/Mart 2026.xlsx", "Rapor/Mart 2025.xlsx"]);
  assert.deepEqual(order("degisiklik"), ["Rapor/Mart 2025.xlsx", "Rapor/Mart 2026.xlsx"]);
  assert.match(findFiles(files, { siralama: "degisiklik" }, 30, NOW).text, /en son değiştirilen önce \(yalnızca son değiştirilme tarihine göre\)/u);
});

test("filesCall: degisiklik passes through, anything else is ilgi", () => {
  const files = [{ path: "a/Rapor.xlsx", size: 1, mtime: at(2026, 1, 1), readable: true }];
  assert.match(filesCall('{"siralama":"degisiklik"}', files), /en son değiştirilen önce/u);
  assert.doesNotMatch(filesCall('{"siralama":"eski"}', files), /önce/u);
});
