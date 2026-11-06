// Run: pnpm test. Which documents a message asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchByName, parsePicked, wantsSources } from "./sources.ts";
import { MAX_NAMED, mergePicks, namedFiles, namedScan, NAMED_MAX_CHARS } from "./sources.ts";

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
  // Two plain words with no figure are words of a sentence, not a file name; with the extension they are the file.
  assert.deepEqual(ids("Faaliyet Değerlendirme'deki hedefler neler"), []);
  assert.deepEqual(ids("Faaliyet Değerlendirme.docx'teki hedefler neler"), ["s-2"]);
  // A single word is read only with its extension: in prose it's a word ("bir değerlendirme yaz"), not a file.
  assert.deepEqual(ids("kooperatifcilik hakkında ne yazıyor"), []);
  assert.deepEqual(ids("Kooperatifcilik.pdf hakkında ne yazıyor"), ["s-4"]);
  assert.deepEqual(ids("bu raporu özetle"), [], "a common short name isn't a pick");
  assert.deepEqual(ids("faaliyet raporlarını değerlendir"), [], "words of a name, not the name");
  // Review: a name ending in a figure isn't the start of another number.
  const num = [{ id: "s-9", path: "Arşiv/202.pdf" }];
  assert.deepEqual(namedFiles("2026 yılı için e-posta yaz", num), []);
  assert.deepEqual(namedFiles("202 dosyasını özetle", num), [], "a lone figure is read only with its extension");
  assert.deepEqual(namedFiles("202.pdf dosyasını özetle", num).map((e) => e.id), ["s-9"]);
});

test("namedFiles: with the attached ones left out first, a newly named file isn't crowded out by them", () => {
  const all = [2022, 2023, 2024, 2025].map((y) => ({ id: `s-${y}`, path: `Raporlar/KURUM_${y}_Faaliyet_Raporu.pdf` })).concat([{ id: "s-new", path: "Raporlar/2026.pdf" }]);
  const q = "KURUM_2022_Faaliyet_Raporu, KURUM_2023_Faaliyet_Raporu, KURUM_2024_Faaliyet_Raporu, KURUM_2025_Faaliyet_Raporu ve 2026.pdf dosyasını karşılaştır";
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

test("namedScan security: a large share stays fast; a long pasted message reads no file by name (as before)", () => {
  const entries = Array.from({ length: 20_000 }, (_, i) => ({ id: `s-${i}`, path: `Arşiv/${i % 50}/Belge_${i}_Rapor_Taslak.pdf` }));
  entries.push({ id: "s-hit", path: "R/KURUM_2025_Raporu.pdf" });
  const q = `KURUM_2025_Raporu.pdf'yi özetle. ${"taslak rapor belge 2025 _-._ ".repeat(120)}`;
  assert.ok(q.length <= NAMED_MAX_CHARS);
  const t0 = performance.now();
  const scan = namedScan(q, entries);
  assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
  assert.deepEqual(scan.hits.map((e) => e.id), ["s-hit"]);
  const long = namedScan(`${"x ".repeat(NAMED_MAX_CHARS)} KURUM_2025_Raporu.pdf`, entries.slice(-1));
  assert.deepEqual([long.hits, [...long.namesakes]], [[], []], "off for a long message: the routes before this feature decide");
});

test("namedScan security: one name in thousands of folders is matched once", () => {
  const entries = Array.from({ length: 20_000 }, (_, i) => ({ id: `s-${i}`, path: `Arşiv/${i}/Faaliyet Raporu.pdf` }));
  const t0 = performance.now();
  const scan = namedScan(`${"faaliyet raporu hakkında ".repeat(150)}`, entries);
  assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
  // Which of the 20,000 isn't said: none is read by name, none kept out (the person may name the folder).
  assert.deepEqual([scan.hits.length, scan.namesakes.size], [0, 0]);
});

test("namedScan review: long last words count whole", () => {
  const longWord = "a".repeat(41);
  const entries = [{ id: "s-long", path: `R/Proje_${longWord}.pdf` }];
  assert.deepEqual(namedScan(`Proje_${longWord}.pdf dosyasını özetle`, entries).hits.map((e) => e.id), ["s-long"]);
});

test("namedScan review: a long continuation still marks a name as part of another", () => {
  const k = [{ id: "s-k", path: "R/KURUM_2025_Raporu.pdf" }];
  const q2 = "KURUM_2025_Raporuabcdefghijklmn_Eki.pdf dosyasını özetle";
  const s2 = namedScan(q2, k);
  assert.deepEqual(mergePicks(s2.hits, matchByName(q2, k).filter((e) => !s2.namesakes.has(e.id))), []);
});

test("namedScan review: a long last word continued into another name keeps the shorter file out", () => {
  const w = "a".repeat(41);
  const entries = [{ id: "s-p", path: `R/Proje_${w}.pdf` }];
  const q = `Proje_${w}abcdefghijklmn_Eki.pdf dosyasını özetle`;
  const scan = namedScan(q, entries);
  assert.deepEqual(mergePicks(scan.hits, matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id))), []);
  assert.deepEqual(namedScan(`Proje_${w}'yı özetle`, entries).hits.map((e) => e.id), ["s-p"]);
});

test("namedScan: a message naming more than MAX_NAMED files picks none by name (as before the feature)", () => {
  const entries = Array.from({ length: MAX_NAMED + 1 }, (_, i) => ({ id: `s-${i}`, path: `R/Proje_${1000 + i}_Raporu.pdf` }));
  const q = entries.map((e) => e.path.split("/").pop()).join(" ");
  const scan = namedScan(q, entries);
  assert.deepEqual(scan.hits, []);
  assert.equal(scan.namesakes.size, 0, "nothing kept out either: the routes before this feature decide");
});

test("namedScan security: one name in many spellings, repeated as long as a message may be, stays fast", () => {
  const seps = [" ", "_", "-", "."];
  const entries: { id: string; path: string }[] = [];
  for (const a of seps) for (const b of seps) for (const c of seps) entries.push({ id: `s-${entries.length}`, path: `R/A${a}B${b}C${c}D.pdf` });
  const q = "A B C D.pdf ".repeat(Math.floor(NAMED_MAX_CHARS / 12));
  const t0 = performance.now();
  namedScan(q, entries);
  assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
});

test("namedScan review: a name glued to another word is part of another name and stays out of every route", () => {
  const k = [{ id: "s-k", path: "R/KURUM_2025_Raporu.pdf" }];
  const q = "EskiKURUM_2025_Raporu.pdf dosyasını özetle";
  const scan = namedScan(q, k);
  assert.deepEqual(mergePicks(scan.hits, matchByName(q, k).filter((e) => !scan.namesakes.has(e.id))), []);
  assert.deepEqual(namedScan("KURUM_2025_Raporu.pdf dosyasını özetle", k).hits.map((e) => e.id), ["s-k"]);
});

test("namedScan review: the name limit counts names written, not files sharing their words; every place is weighed", () => {
  const words = ["proje", "faaliyet", "2025", "raporu", "taslak"];
  const perms: string[][] = [];
  const perm = (rest: string[], acc: string[]) => (rest.length ? rest.forEach((w, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, w])) : perms.push(acc));
  perm(words, []);
  const entries = perms.slice(0, 65).map((p, i) => ({ id: `s-${i}`, path: `R/${p.join("_")}.pdf` }));
  const asked = entries.find((e) => e.path === "R/proje_faaliyet_2025_raporu_taslak.pdf")!;
  assert.deepEqual(namedScan("Proje_Faaliyet_2025_Raporu_Taslak.pdf özetle", entries).hits.map((e) => e.id), [asked.id]);
  const k = [{ id: "s-k", path: "R/KURUM_2025_Raporu.pdf" }];
  const q = `${"Eski KURUM_2025_Raporu.pdf ".repeat(100)}KURUM_2025_Raporu.pdf dosyasını da özetle`;
  assert.ok(q.length <= NAMED_MAX_CHARS);
  assert.deepEqual(namedScan(q, k).hits.map((e) => e.id), ["s-k"], "written on its own after a hundred times inside another name");
});

test("namedScan review: one writing fitting many spellings is one name; the exact spelling is the file", () => {
  const seps = [" ", "_", "-", "."];
  const entries: { id: string; path: string }[] = [{ id: "s-exact", path: "R/A_B_C_D_E.pdf" }];
  for (const a of seps) for (const b of seps) for (const c of seps) {
    const name = `A${a}B${b}C${c}D-E.pdf`;
    if (name !== "A_B_C_D_E.pdf") entries.push({ id: `s-${entries.length}`, path: `R/${name}` });
  }
  assert.ok(entries.length > MAX_NAMED);
  const scan = namedScan("A_B_C_D_E.pdf dosyasını özetle", entries);
  assert.deepEqual(scan.hits.map((e) => e.id), ["s-exact"]);
  // Written loosely, with no exact spelling there: the files fitting it, as before.
  // "+" doesn't join a name's words (only spaces, "_", "." and "-" do).
  assert.deepEqual(namedScan("A+B+C+D+E.pdf dosyasını özetle", entries).hits, []);
});

test("namedScan review: the longest name fitting a place is it (a suffix comes after the whole name)", () => {
  const entries = [{ id: "s-short", path: "R/2025 Faaliyet Rapor.pdf" }, { id: "s-long", path: "R/2025 Faaliyet Raporu.pdf" }];
  assert.deepEqual(namedScan("2025 Faaliyet Raporu özetle", entries).hits.map((e) => e.id), ["s-long"]);
  assert.deepEqual(namedScan("2025 Faaliyet Raporunu özetle", entries).hits.map((e) => e.id), ["s-long"]);
  assert.deepEqual(namedScan("2025 Faaliyet Rapor özetle", entries).hits.map((e) => e.id), ["s-short"]);
});

test("namedScan review: names inside one written long name don't count against MAX_NAMED", () => {
  const words = Array.from({ length: 12 }, (_, i) => `kelime${i}`);
  const entries: { id: string; path: string }[] = [];
  for (let a = 0; a < 12; a++) for (let b = a + 1; b <= 12; b++) entries.push({ id: `s-${a}-${b}`, path: `R/${words.slice(a, b).join(" ")}.pdf` });
  assert.ok(entries.length > MAX_NAMED);
  const full = `${words.join(" ")}.pdf`;
  assert.deepEqual(namedScan(`${full} dosyasını özetle`, entries).hits.map((e) => e.id), ["s-0-12"]);
});

test("namedScan review: words scattered over a message make no name; a structured share stays fast", () => {
  const kurum = ["KOSGEB", "TÜBİTAK", "Valilik", "Belediye", "Ajans", "Müdürlük", "Kalkınma"];
  const tur = ["Faaliyet Raporu", "Bütçe", "Stratejik Plan", "Sunum", "Protokol", "Sözleşme"];
  const entries: { id: string; path: string }[] = [];
  for (const k of kurum) for (let y = 2015; y <= 2025; y++) for (const t of tur) for (const ext of ["pdf", "docx"]) entries.push({ id: `${k}-${y}-${t}-${ext}`, path: `Kurumlar/${k}/${y}/${k} ${y} ${t}.${ext}` });
  const q = "KOSGEB, TÜBİTAK, Valilik, Belediye, Ajans, Müdürlük ve Kalkınma kurumlarının 2020, 2021, 2022, 2023 ve 2024 yıllarına ait faaliyet raporu, bütçe, stratejik plan, sunum, protokol ve sözleşme belgelerini karşılaştır. Özellikle KOSGEB 2024 Faaliyet Raporu.pdf'ye odaklan.";
  const t0 = performance.now();
  const scan = namedScan(q, entries);
  assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
  assert.deepEqual(scan.hits.map((e) => e.id), ["KOSGEB-2024-Faaliyet Raporu-pdf"]);
});

test("namedScan review: ordinary single words in a paragraph don't count against MAX_NAMED", () => {
  const words = ["Ek", "İl", "Not", "Form", "Plan", "Rapor", "Karar", "Liste", "Proje", "Bilgi", "Yıl", "Gelir", "Gider", "Dönem", "Kurul", "Üye", "Daire", "Birim"];
  const entries = [...words.map((w) => ({ id: `s-${w}`, path: `Genel/${w}.pdf` })), { id: "s-hit", path: "R/KURUM_2025_Raporu.pdf" }];
  const para = "Birimimizin yıllık planı ve raporları, kurul kararları, gelir gider listeleri, proje bilgileri ve dönem raporlarına ilişkin notlar ile ilgili form ve ek belgeler daire üyelerine iletildi. ".repeat(6);
  assert.deepEqual(namedScan(`${para}Lütfen KURUM_2025_Raporu.pdf'yi de özetle.`, entries).hits.map((e) => e.id), ["s-hit"]);
});

test("namedScan review 2: a single word inside another word is no writing of it; plain two-word phrases read nothing", () => {
  const form = [{ id: "s-form", path: "X/Form.pdf" }];
  const q = "Form belgesindeki performans verilerini özetle";
  const scan = namedScan(q, form);
  assert.deepEqual([scan.hits, [...scan.namesakes]], [[], []], "performans isn't Form; the older routes may still find Form.pdf");
  assert.deepEqual(matchByName(q, form).filter((e) => !scan.namesakes.has(e.id)).map((e) => e.id), ["s-form"]);
  const year = Array.from({ length: 12 }, (_, i) => ({ id: `s-${i}`, path: `Genel/${2015 + i}/Değerlendirme Raporu.pdf` }));
  assert.deepEqual(namedScan("bölgemiz için kapsamlı bir değerlendirme raporu hazırlıyoruz", year).hits, []);
});

test("namedScan security 2: no regex per file — a pasted list over a structured share stays fast", () => {
  const kurum = Array.from({ length: 15 }, (_, i) => `Kurum${i}`);
  const tur = ["Faaliyet Raporu", "Bütçe Planı", "Sektör Analizi", "Stratejik Plan", "Bölge Planı"];
  const entries: { id: string; path: string }[] = [];
  for (const k of kurum) for (let y = 2015; y <= 2026; y++) for (const t of tur) for (const ext of ["pdf", "docx", "xlsx"]) entries.push({ id: `${k}-${y}-${t}-${ext}`, path: `K/${k}/${y}/${k} ${y} ${t}.${ext}` });
  const list = Array.from({ length: 20 }, (_, i) => `${kurum[i % 15]} ${2015 + (i % 12)} ${tur[i % 5]}.pdf`).join("\n");
  const t0 = performance.now();
  const scan = namedScan(`Klasördeki dosyalar şunlar:\n${list}\nBunlardan hangisi en güncel?`, entries);
  assert.ok(performance.now() - t0 < 300, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(scan.hits.length, 20);
});

test("namedScan review 3: a name's own separators written as they are; a lone figure in a sentence is no file", () => {
  const entries = [
    { id: "s-tr", path: "R/Türkiye'nin İhracat Raporu 2024.pdf" },
    { id: "s-r1", path: "R/Rapor (1).pdf" },
    { id: "s-r", path: "R/Rapor.pdf" },
    { id: "s-imz", path: "R/Sözleşme (imzalı).pdf" },
    { id: "s-arge", path: "R/AR&GE Destek Programı 2025.pdf" },
    { id: "s-tut", path: "R/Toplantı Tutanağı, 12.03.2024.docx" },
    { id: "s-but", path: "R/2024 Yılı Bütçe + Ekler.xlsx" },
    { id: "s-5", path: "B/5.pdf" },
    { id: "s-3", path: "B/3.pdf" },
    { id: "s-y", path: "B/2024.xlsx" },
    { id: "s-b1", path: "B/B1.docx" },
  ];
  const ids = (q: string) => namedScan(q, entries).hits.map((e) => e.id);
  assert.deepEqual(ids("Türkiye'nin İhracat Raporu 2024.pdf'yi özetle"), ["s-tr"]);
  assert.deepEqual(ids("Rapor (1).pdf dosyasını özetle"), ["s-r1"]);
  assert.deepEqual(ids("Sözleşme (imzalı).pdf'yi oku"), ["s-imz"]);
  assert.deepEqual(ids("AR&GE Destek Programı 2025.pdf nedir"), ["s-arge"]);
  assert.deepEqual(ids("Toplantı Tutanağı, 12.03.2024.docx'i özetle"), ["s-tut"]);
  assert.deepEqual(ids("2024 Yılı Bütçe + Ekler.xlsx dosyasını incele"), ["s-but"]);
  for (const q of ["Bana 5 tane slogan öner", "3 maddede özetle", "2024 yılı hedefleri neler", "B1 seviyesinde İngilizce bir metin yaz"]) assert.deepEqual(ids(q), [], q);
  assert.deepEqual(ids("5.pdf dosyasını oku"), ["s-5"]);
  assert.deepEqual(ids("B1.docx'i özetle"), ["s-b1"]);
});

test("namedScan codex: a shorter name that is a prefix of the written one isn't read; nested names don't fill MAX_NAMED", () => {
  for (const [a, b, q] of [
    ["R/Faaliyet Rapor.pdf", "R/Faaliyet Raporu.pdf", "Faaliyet Raporu.pdf özetle"],
    ["R/Faaliyet_Rapor.pdf", "R/Faaliyet_Raporu.pdf", "Faaliyet_Raporu özetle"],
    ["R/2025 Faaliyet Rapor.pdf", "R/2025 Faaliyet Raporu.pdf", "2025 Faaliyet Raporu özetle"],
  ]) assert.deepEqual(namedScan(q, [{ id: "short", path: a }, { id: "long", path: b }]).hits.map((e) => e.id), ["long"], q);
  assert.deepEqual(namedScan("Faaliyet Raporu özetle", [{ id: "short", path: "R/Faaliyet Rapor.pdf" }, { id: "long", path: "R/Faaliyet Raporu.pdf" }]).hits, []);
  const w = ["Alfa", "Beta", "Gama", "Delta", "Epsilon", "Zeta", "Eta", "Teta", "Iota", "Kappa", "Lamda", "Mu"];
  const entries: { id: string; path: string }[] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j <= 12; j++) entries.push({ id: `${i}-${j}`, path: `R/${w.slice(i, j).join(" ")}.pdf` });
  assert.deepEqual(namedScan(`${w.join(" ")}.pdf özetle`, entries).hits.map((e) => e.id), ["0-12"]);
  assert.deepEqual(namedScan(`${w.join(" ")} özetle`, entries).hits.map((e) => e.id), ["0-12"]);
});

test("namedScan security 3: names built from the message's own repeated words stay fast", () => {
  const rep = (w: string, k: number, j = " ") => Array.from({ length: k }, () => w).join(j);
  const cases: [string, { id: string; path: string }[]][] = [
    ["rapor ".repeat(666), Array.from({ length: 20_000 }, (_, i) => ({ id: `${i}`, path: `x/${rep("rapor", 1 + (i % 40))} ${i}.pdf` }))],
    ["a ".repeat(2000), Array.from({ length: 20_000 }, (_, i) => ({ id: `${i}`, path: `x/${rep("a", 1 + (i % 600))}.p${i}` }))],
    ["ab_".repeat(1333), Array.from({ length: 20_000 }, (_, i) => ({ id: `${i}`, path: `x/${rep("ab", 1500, "_")}${i}.pdf` }))],
  ];
  for (const [q, entries] of cases) {
    const t0 = performance.now();
    namedScan(q, entries);
    assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
  }
  // A typographic apostrophe from a phone is the file name's plain one.
  assert.deepEqual(namedScan("Türkiye’nin İhracat Raporu 2024.pdf'yi özetle", [{ id: "s", path: "R/Türkiye'nin İhracat Raporu 2024.pdf" }]).hits.map((e) => e.id), ["s"]);
});

test("namedScan security 4: many writings of nested names stay fast; common words in prose don't crowd out an exact name", () => {
  const rep = (w: string, k: number) => Array.from({ length: k }, () => w).join(" ");
  const A = "a ".repeat(2000);
  for (const entries of [
    Array.from({ length: 13 }, (_, i) => ({ id: `${i}`, path: `x/${rep("a", i + 1)}.pdf` })),
    Array.from({ length: 99 }, (_, i) => ({ id: `${i}`, path: `x/a.p${i}` })),
    [{ id: "3", path: "x/a a a.pdf" }],
  ]) {
    const t0 = performance.now();
    namedScan(A, entries);
    assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
  }
  const common = ["Rapor", "Plan", "Form", "Liste", "Karar", "Proje", "Bütçe", "Sunum", "Tutanak", "Sözleşme", "Değerlendirme", "Performans", "Kurul", "Toplantı", "Analiz", "Strateji", "Hedef", "Bölge", "Kurum", "Yatırım", "Destek", "Program", "Ek", "Not", "Özet", "Taslak", "Sektör", "Teşvik", "Envanter", "Ajans", "Faaliyet", "Rehber", "Kılavuz", "Mevzuat", "Yönetmelik", "Genelge", "Talimat", "Duyuru", "İlan", "Şartname"];
  const lib = common.flatMap((c) => ["pdf", "docx", "xlsx"].map((x) => ({ id: `${c}.${x}`, path: `G/${c}.${x}` }))).concat([{ id: "kurum", path: "R/KURUM_2025_Raporu.pdf" }]);
  const para = "Bölge planı ve faaliyet raporu kapsamında kurul kararları, bütçe tablosu, proje listesi, sunum notları, toplantı tutanakları, sözleşme taslakları, değerlendirme formları, performans hedefleri, yatırım destek programı, teşvik envanteri, sektör analizleri, strateji belgesi, ajans duyuruları, ilan metinleri, şartname özetleri, mevzuat rehberi, yönetmelik ve genelge talimatları incelendi. ";
  assert.deepEqual(namedScan(para + "KURUM_2025_Raporu.pdf'yi özetle", lib).hits.map((e) => e.id), ["kurum"]);
});

test("namedScan review 6: a shorter name written only inside a longer one stays out of every route", () => {
  const route = (q: string, paths: string[]) => {
    const entries = paths.map((p) => ({ id: p.split("/").pop()!, path: p }));
    const scan = namedScan(q, entries);
    const others = wantsSources(q) ? matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id)) : [];
    return mergePicks(scan.hits, others).map((e) => e.id);
  };
  assert.deepEqual(route("Stratejik Plan 2024-2028.pdf dosyasındaki hedefleri listele", ["P/Stratejik Plan.pdf", "P/Stratejik Plan 2024-2028.pdf"]), ["Stratejik Plan 2024-2028.pdf"]);
  assert.deepEqual(route("Faaliyet Raporu 2024 dosyasını özetle", ["R/Faaliyet Raporu.pdf", "R/Faaliyet Raporu 2024.pdf"]), ["Faaliyet Raporu 2024.pdf"]);
  assert.deepEqual(route("Eski Faaliyet Raporu belgesini özetle", ["R/Eski Faaliyet Raporu.pdf", "R/Faaliyet Raporu.pdf"]), ["Eski Faaliyet Raporu.pdf"]);
  assert.deepEqual(route("Kooperatifcilik Destek Programı 2024.pdf belgesini özetle", ["R/Kooperatifcilik Destek Programı 2024.pdf", "R/Kooperatifcilik.pdf", "R/Destek Programı.pdf"]), ["Kooperatifcilik Destek Programı 2024.pdf"]);
  assert.deepEqual(route("Eski 2025 Faaliyet Raporu.pdf belgesini özetle", ["R/Eski 2025 Faaliyet Raporu.pdf", "R/2025 Faaliyet Raporu.docx"]), ["Eski 2025 Faaliyet Raporu.pdf"]);
  // The prefix file isn't read alone when the longer name is written (even with other separators).
  assert.deepEqual(namedScan("Faaliyet_Raporu özetle", [{ id: "a", path: "R/Faaliyet_Rapor.pdf" }, { id: "b", path: "R/Faaliyet Raporu.pdf" }]).hits, []);
  // A name written on its own is still found by the older route.
  assert.deepEqual(route("faaliyet raporu belgesini özetle", ["R/Faaliyet Raporu.pdf"]), ["Faaliyet Raporu.pdf"]);
});

test("namedScan review 7: a name also written on its own isn't kept out; a folder or the extension picks among copies", () => {
  const route = (q: string, paths: string[]) => {
    const entries = paths.map((p) => ({ id: p, path: p }));
    const scan = namedScan(q, entries);
    const others = wantsSources(q) ? matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id)) : [];
    return mergePicks(scan.hits, others).map((e) => e.id).sort();
  };
  assert.deepEqual(route("proje belgesini proje takvimi 2025 dosyasına göre güncelle", ["R/Proje.docx", "R/Proje Takvimi 2025.xlsx"]), ["R/Proje Takvimi 2025.xlsx", "R/Proje.docx"]);
  assert.deepEqual(route("bütçe 2025 ve bütçe belgelerini karşılaştır", ["R/Bütçe.xlsx", "R/Bütçe 2025.xlsx"]), ["R/Bütçe 2025.xlsx", "R/Bütçe.xlsx"]);
  assert.deepEqual(route("hizmet içi eğitim planı 2025 ile eğitim planı belgesini karşılaştır", ["R/Eğitim Planı.xlsx", "R/Hizmet İçi Eğitim Planı 2025.xlsx"]), ["R/Eğitim Planı.xlsx", "R/Hizmet İçi Eğitim Planı 2025.xlsx"]);
  const years = [2021, 2022, 2023, 2024].map((y) => `${y}/Faaliyet Raporu.pdf`);
  const ids = (q: string) => namedScan(q, years.map((p) => ({ id: p, path: p }))).hits.map((e) => e.id).sort();
  assert.deepEqual(ids("Faaliyet Raporu.pdf özetle"), years);
  assert.deepEqual(ids("2024/Faaliyet Raporu.pdf özetle"), ["2024/Faaliyet Raporu.pdf"]);
  assert.deepEqual([...namedScan("2024/Faaliyet Raporu.pdf özetle", years.map((p) => ({ id: p, path: p }))).namesakes].sort(), years.slice(0, 3));
});

test("namedScan review 8: a format twin stays out when the name also has a spelling with other separators", () => {
  const route = (q: string, paths: string[]) => {
    const entries = paths.map((p) => ({ id: p, path: p }));
    const scan = namedScan(q, entries);
    const others = wantsSources(q) ? matchByName(q, entries).filter((e) => !scan.namesakes.has(e.id)) : [];
    return mergePicks(scan.hits, others).map((e) => e.id);
  };
  assert.ok(!route("Faaliyet Raporu.pdf belgesini özetle", ["R/Faaliyet Raporu.pdf", "R/Faaliyet Raporu.docx", "A/Faaliyet_Raporu.pdf"]).includes("R/Faaliyet Raporu.docx"));
  assert.ok(!route("Faaliyet Raporu 2024.pdf belgesini özetle", ["R/Faaliyet Raporu 2024.pdf", "R/Faaliyet Raporu 2024.docx", "R/Faaliyet-Raporu-2024.pdf"]).includes("R/Faaliyet Raporu 2024.docx"));
  const picks = route("faaliyet_raporu_2024.pdf belgesini özetle", ["R/Faaliyet Raporu 2024.pdf", "R/Faaliyet_Raporu_2024.pdf", "R/Faaliyet_Raporu_2024.docx"]);
  assert.ok(picks.includes("R/Faaliyet_Raporu_2024.pdf") && !picks.includes("R/Faaliyet_Raporu_2024.docx"), String(picks));
});

test("planSources skip: the support workbook is never read, and naming it picks no namesake or other file", async () => {
  const { planSources } = await import("./sources.ts");
  const files = [
    { id: "b", path: "Veri/ZAFER Destekler - Veriler (Deflatörlü - 2026)-YK.xlsx" },
    { id: "s", path: "Veri/Veriler (Deflatörlü - 2026)-YK.xlsx" },
    { id: "r", path: "Rehber/SOGEP Rehberi.pdf" },
  ];
  const skip = new Set(["b"]);
  const named = planSources("ZAFER Destekler - Veriler (Deflatörlü - 2026)-YK.xlsx dosyasına göre Kütahya'nın desteği", files, { hand: [], auto: [], room: 20, skip });
  assert.deepEqual(named.picks, [], "the shorter name inside it is not read in its place");
  const after = planSources("ZAFER Destekler - Veriler (Deflatörlü - 2026)-YK.xlsx dosyasına göre Kütahya'nın desteği", files, { hand: [], auto: ["r"], room: 20, skip });
  assert.deepEqual([after.picks, after.askPicker], [[], false], "naming it drops the earlier finds and asks no picker (which could keep them)");
  const words = planSources("destekler veriler deflatörlü Kütahya toplamı", files.slice(0, 1).concat(files[2]), { hand: [], auto: [], room: 20, skip });
  assert.equal(words.askPicker, false, "the workbook's own words send no picker after other files");
  assert.deepEqual(planSources("SOGEP Rehberi.pdf özetle", files, { hand: [], auto: [], room: 20, skip }).picks.map((e) => e.id), ["r"], "other files as before");
});
