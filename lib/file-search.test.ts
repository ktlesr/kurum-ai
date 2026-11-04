// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { filesCall, findFiles, type FileEntry } from "./file-search.ts";

const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 9);
const files: FileEntry[] = [
  { path: "Ajans Tanıtım ve Brifing/Sunum/2024/Cumhurbaşkanı Yardımcısı Sunumu.pptx", size: 4_200_000, mtime: at(2024, 10, 2), readable: false },
  { path: "Ajans Tanıtım ve Brifing/Sunum/2025/CBY Ziyareti Sunum.pptx", size: 5_100_000, mtime: at(2025, 3, 14), readable: false },
  { path: "Ajans Tanıtım ve Brifing/Sunum/2025/Cumhurbaşkanı Yardımcısı Brifing.pdf", size: 900_000, mtime: at(2025, 6, 20), readable: true },
  { path: "Ekspertiz/2023/Ekspertiz Raporu - Uşak.pdf", size: 300_000, mtime: at(2023, 5, 1), readable: true },
  { path: "Ekspertiz/2025/Ekspertiz Raporu - Manisa.docx", size: 120_000, mtime: at(2025, 9, 9), readable: true },
  { path: "Belgelerim/notlar.txt", size: 2_000, readable: true },
];

test("findFiles: by words, Turkish letters and suffixes; most matched first, then newest", () => {
  const r = findFiles(files, { sorgu: "cumhurbaşkanı yardımcısına hazırlanan sunum" });
  assert.equal(r.count, 3);
  const rows = r.text.split("\n").filter((l) => l.startsWith("| Ajans"));
  assert.match(rows[0], /Cumhurbaşkanı Yardımcısı Sunumu\.pptx/, "three words matched");
  assert.match(r.text, /\| hayır \|/, "a presentation is listed, not readable");
  assert.match(r.text, /4,0 MB/);
});

test("findFiles: within a folder, newest first; a folder that doesn't match finds nothing", () => {
  const r = findFiles(files, { klasor: "ajans tanıtım sunum 2025", siralama: "yeni" });
  assert.equal(r.count, 2);
  const rows = r.text.split("\n").filter((l) => l.startsWith("| Ajans"));
  assert.match(rows[0], /Brifing\.pdf/);
  assert.match(rows[0], /20\.06\.2025/);
  assert.equal(findFiles(files, { sorgu: "ekspertiz", klasor: "pazarlama" }).count, 0);
});

test("findFiles: 'ekspertiz raporları en son' gives the reports, newest first; uploads have no date; nothing found says so", () => {
  const r = findFiles(files, { sorgu: "ekspertiz raporları", siralama: "yeni" });
  assert.equal(r.count, 2);
  assert.match(r.text.split("\n").find((l) => l.startsWith("| Ekspertiz"))!, /Manisa/);
  assert.match(findFiles(files, { sorgu: "notlar" }).text, /\| Belgelerim\/notlar\.txt \| — \|/);
  assert.match(findFiles(files, { sorgu: "kilim" }).text, /eşleşen dosya yok/);
  assert.equal(findFiles(files, {}, 2).text.split("\n").filter((l) => /^\| [^-Y]/u.test(l)).length, 2, "at most max rows");
});

test("filesCall: the model's JSON read safely", () => {
  assert.match(filesCall('{"sorgu":"ekspertiz","siralama":"yeni"}', files), /2 dosya eşleşti, en yeni önce/);
  assert.match(filesCall("{bozuk", files), /^HATA: argümanlar JSON/);
  assert.match(filesCall("[1]", files), /^HATA: argümanlar bir JSON nesnesi/);
  assert.match(filesCall('{"sorgu": 5}', files), /tüm dosyalar/, "a non-string is no query");
});
