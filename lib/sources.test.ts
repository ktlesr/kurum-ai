// Run: pnpm test. Which documents a message asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchByName, parsePicked, wantsSources } from "./sources.ts";
import { mergePicks, namedFiles, namedScan } from "./sources.ts";

const lib = [
  { id: "1", path: "Mevzuat/KOSGEB/Uygulama Esasları.pdf" },
  { id: "2", path: "Mevzuat/IPARD/Çağrı İlanı.pdf" },
  { id: "3", path: "Raporlar/2026/Ekonomik Görünüm Manisa.pdf" },
];

test("a plain question doesn't ask for sources; a request does", () => {
  for (const q of ["Merhaba, nasılsın?", "KOSGEB nedir?", "Bana bir e-posta yaz"]) assert.equal(wantsSources(q), false, q);
  for (const q of ["Şu kaynakları kullanarak özet hazırla", "Belgelerden bul", "Mevzuat klasöründeki dosyalara bak", "DÖKÜMANLARA göre yaz"]) assert.equal(wantsSources(q), true, q);
});

test("matchByName: folder and file names, Turkish suffixes, nothing on unrelated words", () => {
  assert.deepEqual(matchByName("KOSGEB klasöründeki belgelere göre özetle", lib).map((e) => e.id), ["1"]);
  assert.deepEqual(matchByName("mevzuat klasörünü kullan", lib).map((e) => e.id).sort(), ["1", "2"]);
  assert.deepEqual(matchByName("Manisa ekonomik görünüm kaynağına göre", lib).map((e) => e.id), ["3"]);
  assert.deepEqual(matchByName("belgeleri kullanarak bir dilekçe hazırla", lib), []);
});

test("parsePicked: known numbers only", () => {
  assert.deepEqual(parsePicked('Tamam {"dosyalar":[2,2,9,"1",1]}', lib).map((e) => e.id), ["2", "1"]);
  assert.deepEqual(parsePicked("yok", lib), []);
  assert.deepEqual(parsePicked('{"dosyalar":{}}', lib), []);
});

test("namedFiles: a file named in the message is found without the word 'belge'; common short names aren't", () => {
  const entries = [
    { id: "s-1", path: "Raporlar/KURUM_2025_Raporu.pdf" },
    { id: "s-2", path: "Ajans/Sunum/Faaliyet Değerlendirme.docx" },
    { id: "s-3", path: "Genel/Rapor.pdf" },
    { id: "s-4", path: "Genel/Kooperatifcilik.pdf" },
  ];
  const ids = (q: string) => namedFiles(q, entries).map((e) => e.id);
  assert.deepEqual(ids("KURUM_2025_Raporu.pdf'yi özetle"), ["s-1"]);
  assert.deepEqual(ids("kurum 2025 raporunu oku"), ["s-1"], "a suffix on the last word");
  assert.deepEqual(ids("Faaliyet Değerlendirme'deki hedefler neler"), ["s-2"]);
  assert.deepEqual(ids("kooperatifcilik hakkında ne yazıyor"), ["s-4"], "ten letters or more");
  assert.deepEqual(ids("bu raporu özetle"), [], "a common short name isn't a pick");
  assert.deepEqual(ids("faaliyet raporlarını değerlendir"), [], "words of a name, not the name");
  // Review: a name ending in a figure isn't the start of another number.
  const num = [{ id: "s-9", path: "Arşiv/202.pdf" }];
  assert.deepEqual(namedFiles("2026 yılı için e-posta yaz", num), []);
  assert.deepEqual(namedFiles("202 dosyasını özetle", num).map((e) => e.id), ["s-9"]);
});

test("namedFiles: with the attached ones left out first, a newly named file isn't crowded out by them", () => {
  const all = [2022, 2023, 2024, 2025].map((y) => ({ id: `s-${y}`, path: `Raporlar/KURUM_${y}_Faaliyet_Raporu.pdf` })).concat([{ id: "s-new", path: "Raporlar/2026.pdf" }]);
  const q = "KURUM_2022_Faaliyet_Raporu, KURUM_2023_Faaliyet_Raporu, KURUM_2024_Faaliyet_Raporu, KURUM_2025_Faaliyet_Raporu ve 2026 dosyasını karşılaştır";
  const attached = new Set(["s-2022", "s-2023", "s-2024", "s-2025"]);
  assert.deepEqual(namedFiles(q, all.filter((e) => !attached.has(e.id))).map((e) => e.id), ["s-new"]);
});

test("a named file and a folder in one message: both picked, the named one first", () => {
  const entries = [{ id: "s-r", path: "Raporlar/KURUM_2025_Raporu.pdf" }, { id: "s-k1", path: "KOSGEB/Destek Rehberi.pdf" }, { id: "s-k2", path: "KOSGEB/Başvuru.docx" }];
  const q = "KURUM_2025_Raporu.pdf ve KOSGEB klasöründeki belgeleri karşılaştır";
  const ids = mergePicks(namedFiles(q, entries), matchByName(q, entries)).map((e) => e.id);
  assert.equal(ids[0], "s-r");
  assert.ok(ids.includes("s-k1") && ids.includes("s-k2"), JSON.stringify(ids));
  assert.equal(new Set(ids).size, ids.length, "each once");
});

test("namedFiles: a short name written with its extension is that file; without it, still not", () => {
  const entries = [{ id: "s-r", path: "Genel/Rapor.pdf" }];
  assert.deepEqual(namedFiles("Rapor.pdf'yi özetle", entries).map((e) => e.id), ["s-r"]);
  assert.deepEqual(namedFiles("bu raporu özetle", entries), []);
  assert.deepEqual(namedFiles("raporu pdf olarak ver", entries), [], "the words apart aren't the name");
});

test("namedFiles review: 'rapor pdf' apart isn't Rapor.pdf; no cut of its own when asked for all", () => {
  const entries = [{ id: "s-r", path: "Genel/Rapor.pdf" }];
  assert.deepEqual(namedFiles("rapor pdf olarak ver", entries), []);
  assert.deepEqual(namedFiles("rapor.pdf olarak ver", entries).map((e) => e.id), ["s-r"]);
  const many = Array.from({ length: 6 }, (_, i) => ({ id: `s-${i}`, path: `Arşiv/KURUM_${2020 + i}_Raporu.pdf` }));
  const q = many.map((e) => e.path.split("/").pop()).join(", ") + " dosyalarını karşılaştır";
  assert.equal(namedFiles(q, many).length, 4, "a default cap for other callers");
  assert.equal(namedFiles(q, many, Number.MAX_SAFE_INTEGER).length, 6);
});

test("namedFiles review: an extension picks that version only; without one, every version of the name", () => {
  const entries = [{ id: "s-pdf", path: "R/KURUM_2025_Raporu.pdf" }, { id: "s-doc", path: "R/KURUM_2025_Raporu.docx" }];
  assert.deepEqual(namedFiles("KURUM_2025_Raporu.pdf'yi özetle", entries).map((e) => e.id), ["s-pdf"]);
  assert.deepEqual(namedFiles("KURUM_2025_Raporu'nu özetle", entries).map((e) => e.id).sort(), ["s-doc", "s-pdf"]);
});

test("namedScan review: the namesakes of a file named with its extension are kept out of every route", () => {
  const entries = [{ id: "s-pdf", path: "R/KURUM_2025_Raporu.pdf" }, { id: "s-doc", path: "R/KURUM_2025_Raporu.docx" }];
  const q = "KURUM_2025_Raporu.pdf dosyasını özetle";
  const scan = namedScan(q, entries);
  // A folder/word match would bring the .docx back; the route filters it by the namesakes.
  const others = matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id));
  assert.deepEqual(mergePicks(scan.hits, others).map((e) => e.id), ["s-pdf"]);
  // The .pdf already attached: left out of the new ones, and the .docx still isn't picked.
  assert.deepEqual(scan.hits.filter((e) => e.id !== "s-pdf").map((e) => e.id), []);
});

test("namedScan review: a name asked with an extension no file has picks none of its namesakes", () => {
  const entries = [{ id: "s-doc", path: "R/KURUM_2025_Raporu.docx" }];
  const scan = namedScan("KURUM_2025_Raporu.pdf dosyasını özetle", entries);
  assert.deepEqual(scan.hits, []);
  assert.ok(scan.namesakes.has("s-doc"));
  assert.deepEqual(namedScan("KURUM_2025_Raporu.pdf'yi özetle", entries).hits, [], "with a suffix after the extension too");
  assert.deepEqual(namedScan("KURUM_2025_Raporu'nu özetle", entries).hits.map((e) => e.id), ["s-doc"], "no extension asked: the name is enough");
});

test("namedScan review: the extension is matched whole, and any extension counts as asked", () => {
  const both = [{ id: "s-xls", path: "R/KURUM_2025_Raporu.xls" }, { id: "s-xlsx", path: "R/KURUM_2025_Raporu.xlsx" }];
  assert.deepEqual(namedScan("KURUM_2025_Raporu.xlsx dosyasını özetle", both).hits.map((e) => e.id), ["s-xlsx"]);
  assert.deepEqual(namedScan("KURUM_2025_Raporu.xls dosyasını özetle", both).hits.map((e) => e.id), ["s-xls"]);
  const doc = [{ id: "s-doc", path: "R/KURUM_2025_Raporu.docx" }];
  for (const ext of ["markdown", "7z", "p"]) {
    const scan = namedScan(`KURUM_2025_Raporu.${ext} dosyasını özetle`, doc);
    assert.deepEqual(scan.hits, [], ext);
    assert.ok(scan.namesakes.has("s-doc"), ext);
  }
});

test("namedScan review: a name written only inside a longer one isn't picked; written on its own too, it is", () => {
  const entries = [{ id: "s-old", path: "A/Eski Rapor.pdf" }, { id: "s-r", path: "A/Rapor.pdf" }];
  assert.deepEqual(namedScan("Eski Rapor.pdf'yi özetle", entries).hits.map((e) => e.id), ["s-old"]);
  assert.deepEqual(namedScan("Eski Rapor.pdf ve Rapor.pdf'yi karşılaştır", entries).hits.map((e) => e.id).sort(), ["s-old", "s-r"]);
  const long = [{ id: "s-l", path: "R/KURUM 2025 Faaliyet Raporu.docx" }, { id: "s-s", path: "R/2025 Faaliyet Raporu.docx" }];
  assert.deepEqual(namedScan("KURUM 2025 Faaliyet Raporunu özetle", long).hits.map((e) => e.id), ["s-l"]);
});

test("namedScan review: a name only inside a longer one stays out of the folder/word match too (as the route merges)", () => {
  const entries = [{ id: "s-old", path: "A/Eski Rapor.pdf" }, { id: "s-r", path: "A/Rapor.pdf" }];
  const q = "Eski Rapor.pdf dosyasını özetle";
  const scan = namedScan(q, entries);
  const others = matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id));
  assert.deepEqual(mergePicks(scan.hits, others).map((e) => e.id), ["s-old"]);
});

test("namedScan review: a name with its extension is the whole file name, not a part of a longer one", () => {
  const entries = [{ id: "s-r", path: "A/Rapor.pdf" }];
  assert.deepEqual(namedScan("Rapor.pdf.docx dosyasını özetle", entries).hits, []);
  assert.deepEqual(namedScan("Eski.Rapor.pdf dosyasını özetle", entries).hits, []);
  assert.deepEqual(namedScan("Rapor.pdf. Bunu özetle", entries).hits.map((e) => e.id), ["s-r"], "a sentence's full stop is no extension");
});

test("namedScan review: a refused place doesn't count as a match on its own elsewhere", () => {
  const entries = [{ id: "s-old", path: "A/Eski Rapor.pdf" }, { id: "s-r", path: "A/Rapor.pdf" }];
  const q = "Eski Rapor.pdf ve Rapor.pdf.docx dosyalarını özetle";
  const scan = namedScan(q, entries);
  assert.deepEqual(scan.hits.map((e) => e.id), ["s-old"]);
  assert.ok(scan.namesakes.has("s-r"));
});

test("namedScan review: any separators with an extension; a name also written on its own counts", () => {
  const doc = [{ id: "s-doc", path: "R/KURUM_2025_Raporu.docx" }];
  const a = namedScan("KURUM 2025 Raporu.pdf dosyasını özetle", doc);
  assert.deepEqual(a.hits, []);
  assert.ok(a.namesakes.has("s-doc"));
  const two = [{ id: "s-old", path: "A/Eski 2025 Rapor.pdf" }, { id: "s-r", path: "A/2025 Rapor.pdf" }];
  assert.deepEqual(namedScan("Eski 2025 Rapor.pdf ve 2025 Rapor karşılaştır", two).hits.map((e) => e.id).sort(), ["s-old", "s-r"]);
  assert.deepEqual(namedScan("Eski 2025 Rapor.pdf dosyasını özetle", two).hits.map((e) => e.id), ["s-old"]);
});

test("namedScan review: the right extension with other separators is still that file", () => {
  const entries = [{ id: "s-pdf", path: "R/KURUM_2025_Raporu.pdf" }, { id: "s-doc", path: "R/KURUM_2025_Raporu.docx" }];
  assert.deepEqual(namedScan("KURUM 2025 Raporu.pdf özetle", entries).hits.map((e) => e.id), ["s-pdf"]);
  assert.deepEqual(namedScan("kurum-2025-raporu.docx'i özetle", entries).hits.map((e) => e.id), ["s-doc"]);
});

test("namedScan review: an extension written inside a longer name asks for nothing about the shorter one", () => {
  const entries = [{ id: "s-old", path: "A/Eski 2025 Rapor.pdf" }, { id: "s-doc", path: "A/2025 Rapor.docx" }];
  assert.deepEqual(namedScan("Eski 2025 Rapor.pdf ve 2025 Rapor karşılaştır", entries).hits.map((e) => e.id).sort(), ["s-doc", "s-old"]);
  assert.deepEqual(namedScan("Eski 2025 Rapor.pdf dosyasını özetle", entries).hits.map((e) => e.id), ["s-old"]);
});

test("namedScan review: a name written as part of another file name keeps its file out of every route", () => {
  const entries = [{ id: "s-pdf", path: "R/KURUM_2025_Raporu.pdf" }];
  for (const q of ["KURUM_2025_Raporu.pdf.docx dosyasını özetle", "Eski.KURUM_2025_Raporu dosyasını özetle"]) {
    const scan = namedScan(q, entries);
    const others = matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id));
    assert.deepEqual(mergePicks(scan.hits, others), [], q);
  }
  // Written on its own, it's still found.
  assert.deepEqual(namedScan("KURUM_2025_Raporu.pdf dosyasını özetle", entries).hits.map((e) => e.id), ["s-pdf"]);
});

test("namedScan review: '_' and glued '-' join a name: a longer file name's part isn't this file", () => {
  const entries = [{ id: "s-pdf", path: "R/KURUM_2025_Raporu.pdf" }];
  for (const q of ["Eski_KURUM_2025_Raporu.pdf dosyasını özetle", "KURUM_2025_Raporu.pdf_backup dosyasını özetle", "Eski-KURUM_2025_Raporu.pdf özetle", "KURUM_2025_Raporu_v2 dosyasını özetle",
    "KURUM_2025_Raporunun_Eki.pdf dosyasını özetle", "KURUM_2025_Raporunu_v2 özetle", "KURUM_2025_Raporunu-v2 özetle",
    "KURUM_2025_Raporu'nun_Eki.pdf dosyasını özetle", "KURUM_2025_Raporu.pdf'nin_eki özetle"]) {
    const scan = namedScan(q, entries);
    const others = matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id));
    assert.deepEqual(mergePicks(scan.hits, others), [], q);
  }
  for (const q of ["KURUM_2025_Raporu.pdf'yi özetle", "KURUM 2025 Raporunu özetle", "KURUM_2025_Raporu'nu özetle", "(KURUM_2025_Raporu.pdf) dosyasını özetle", "rapor: KURUM_2025_Raporu.pdf - özetle"]) {
    assert.deepEqual(namedScan(q, entries).hits.map((e) => e.id), ["s-pdf"], q);
  }
});

test("namedScan review: a place read as one file's name with its extension isn't also another file's plain name", () => {
  const entries = [{ id: "s-pdf", path: "R/KURUM_2025_Raporu.pdf" }, { id: "s-pd", path: "R/KURUM_2025_Raporu.pdf.docx" }];
  const scan = namedScan("KURUM_2025_Raporu.pdf'yi özetle", entries);
  const others = matchByName("KURUM_2025_Raporu.pdf'yi özetle", entries).filter((e) => !scan.namesakes.has(e.id));
  assert.deepEqual(mergePicks(scan.hits, others).map((e) => e.id), ["s-pdf"]);
  assert.deepEqual(namedScan("KURUM_2025_Raporu.pdf.docx'i özetle", entries).hits.map((e) => e.id), ["s-pd"]);
});
