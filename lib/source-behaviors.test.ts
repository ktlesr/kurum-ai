// Run: pnpm test
// What a person expects of an assistant's sources over a conversation, like ChatGPT or Claude: one scenario per normal
// behaviour. A change to how documents are chosen must keep every one; a behaviour noticed later is added here.
// Here: what the code decides (when the picker is asked, what is kept). What the picker itself chooses (a model call:
// "giden" read as "gönderilen", a follow-up told from another subject) is checked on the model: scripts/eval-picker.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PICK_LIST, foldersOf, pickFrom, pickPaged, pickerInput, planSources, readPick, type SourceEntry } from "./sources.ts";

const LIB: SourceEntry[] = [
  "10) Paydaş Veri Tabanı/Paydaş Veri Tabanı.xlsx",
  "Bakanlığa Gönderilen Tablolar/Yazışma Listesi 2026.xlsx",
  "Bakanlığa Gönderilen Tablolar/Yazışma Listesi 2025.xlsx",
  "Bütçe/2025 Bütçe Planı.xlsx",
  "2024/Genel Rapor.pdf",
  "Raporlar/KURUM_2025_Raporu.pdf",
].map((path, i) => ({ id: `s-${i}`, path }));
const id = (name: string) => LIB.find((e) => e.path.includes(name))!.id;
const names = (es: SourceEntry[]) => es.map((e) => e.path.split("/").pop());

/**
 * One conversation as the route runs it: each turn the plan, and where it asks, the picker's answer (`pick`: what the
 * model would say for that turn). Returns the documents the app holds after each turn (hand-picked ones aside).
 */
function talk(turns: { q: string; pick?: string }[], hand: string[] = [], start: string[] = []) {
  let auto = start;
  return turns.map(({ q, pick }) => {
    const p = planSources(q, LIB, { hand, auto, room: 20 - hand.length });
    let picks = p.picks;
    const r = p.askPicker && pick !== undefined ? readPick(pick, LIB) : "keep";
    if (r !== "keep") picks = r;
    auto = picks.map((e) => e.id).filter((x) => !hand.includes(x));
    return { q, asked: p.askPicker, picks: names(picks) };
  });
}

test("a follow-up: the picker sees the documents in use and may keep them", () => {
  const [t] = talk([{ q: "bu tablodaki en son satır ne", pick: '{"devam":true}' }], [], [id("Paydaş")]);
  assert.deepEqual([t.asked, t.picks], [true, ["Paydaş Veri Tabanı.xlsx"]]);
});

test("another place asked for in other words: the picker chooses it and the earlier find is let go", () => {
  const [t] = talk([{ q: "bakanlığa giden tablolardan bak", pick: `{"dosyalar":[${2},${3}]}` }], [], [id("Paydaş")]);
  assert.deepEqual([t.asked, t.picks.sort()], [true, ["Yazışma Listesi 2025.xlsx", "Yazışma Listesi 2026.xlsx"]]);
});

test("a picker that fails or answers nothing usable keeps what the chat had; only an explicit empty list lets it go", () => {
  for (const pick of ["", "bilmiyorum", '{"devam":true}', '{"dosyalar":[99]}']) {
    const [t] = talk([{ q: "yanlış yere bakıyorsun", pick }], [], [id("Paydaş")]);
    assert.deepEqual(t.picks, ["Paydaş Veri Tabanı.xlsx"], pick);
  }
  assert.equal(readPick(null, LIB), "keep", "the call failed");
  const [t] = talk([{ q: "yanlış yere bakıyorsun", pick: '{"dosyalar":[]}' }], [], [id("Paydaş")]);
  assert.deepEqual(t.picks, []);
});

test("the reported conversation: the wrong workbook is let go once the person points elsewhere, and a follow-up keeps the list", () => {
  const ts = talk([
    { q: "en son bakanlığa gönderilen yazışma listesindeki en son şey ne", pick: '{"dosyalar":[2]}' },
    { q: "bakanlığa gönderilen tablolardan bak", pick: '{"devam":true}' },
    { q: "2026 listesinde son satır hangisi", pick: '{"devam":true}' },
  ], [], [id("Paydaş")]);
  assert.ok(ts.every((t) => t.asked), "with documents found before, every turn may look again");
  assert.deepEqual(ts.map((t) => t.picks), [["Yazışma Listesi 2026.xlsx"], ["Yazışma Listesi 2026.xlsx"], ["Yazışma Listesi 2026.xlsx"]]);
});

test("a file named by its own name is read without the picker, and replaces the earlier find", () => {
  const [t] = talk([{ q: "KURUM_2025_Raporu.pdf ile karşılaştır" }], [], [id("Paydaş")]);
  assert.deepEqual([t.asked, t.picks], [false, ["KURUM_2025_Raporu.pdf"]]);
});

test("a document picked by hand stays: plain document words keep to it with no picker call", () => {
  const hand = [id("Bütçe Planı")];
  for (const q of ["bu belgeyi özetle", "belgede 2025 hedefi ne", "dosyadaki toplam kaç", "bana bir e-posta yaz", "merhaba"]) {
    const [t] = talk([{ q }], hand);
    assert.deepEqual([t.asked, t.picks], [false, []], q);
  }
  // Pointed elsewhere, documents beside it are chosen; it stays (the route always reads it).
  const [t] = talk([{ q: "ortak klasördeki yazışma belgelerine de bak", pick: '{"dosyalar":[2]}' }], hand);
  assert.deepEqual([t.asked, t.picks], [true, ["Yazışma Listesi 2026.xlsx"]]);
  // A file named mid-chat joins it.
  const [u] = talk([{ q: "KURUM_2025_Raporu.pdf ile karşılaştır" }], hand);
  assert.deepEqual([u.asked, u.picks], [false, ["KURUM_2025_Raporu.pdf"]]);
});

test("a chat without documents: a plain message reads nothing and makes no picker call", () => {
  for (const q of ["merhaba", "2024 yılında ne oldu", "rapor yaz", "bana bir dilekçe yaz", "bunu İngilizceye çevir"]) {
    const [t] = talk([{ q }]);
    assert.deepEqual([t.asked, t.picks], [false, []], q);
  }
});

test("a chat without documents: asking for documents, or writing a path's words, asks the picker", () => {
  for (const q of ["elimizdeki belgelerde kooperatif var mı", "bütçe planı dosyasını bul", "bakanlığa gönderilen yazışma listesi"]) {
    const [t] = talk([{ q }]);
    assert.equal(t.asked, true, q);
  }
});

test("the picker's message: the list first (the same text each time), then the documents in use and the conversation", () => {
  const a = pickerInput(["A/x.pdf", "B/y.xlsx"], ["A/x.pdf"], ["önceki soru"], "son soru");
  const b = pickerInput(["A/x.pdf", "B/y.xlsx"], [], [], "başka soru");
  assert.ok(a.startsWith("<liste>\n1. A/x.pdf\n2. B/y.xlsx\n</liste>"));
  assert.equal(a.slice(0, a.indexOf("<mevcut>")), b.slice(0, b.indexOf("<mevcut>")));
  assert.ok(a.includes("<mevcut>\nA/x.pdf\n</mevcut>") && b.includes("<mevcut>\n(yok)\n</mevcut>"));
  assert.ok(a.endsWith("Son istek: son soru") && a.includes("- önceki soru"));
  assert.ok(!pickerInput(["<x>/y"], [], [], "q").includes("<x>"), "paths can't close the tags");
});

test("a large library is shown by folders first: every file reachable, none cut at the list size", () => {
  const big: SourceEntry[] = Array.from({ length: 3000 }, (_, i) => ({ id: `b-${i}`, path: `Klasör ${i % 60}/Dosya ${i}.pdf` }));
  const dirs = foldersOf(big);
  assert.ok(big.length > PICK_LIST && dirs.length <= PICK_LIST);
  assert.equal(dirs.reduce((n, d) => n + d.files.length, 0), big.length);
  assert.ok(dirs.find((d) => d.path === "Klasör 59")!.files.some((f) => f.id === "b-2999"));
});

test("a file named and a folder asked for in one message: both are read", () => {
  const [t] = talk([{ q: "KURUM_2025_Raporu.pdf ile Bakanlığa Gönderilen Tablolar klasöründeki belgeleri karşılaştır" }]);
  assert.equal(t.asked, false);
  assert.deepEqual(t.picks.sort(), ["KURUM_2025_Raporu.pdf", "Yazışma Listesi 2025.xlsx", "Yazışma Listesi 2026.xlsx"]);
});

test("a garbled picker answer keeps the documents even if it shows an empty list", () => {
  for (const a of ['{"dosyalar":[], bozuk}', '{"dosyalar":"yok"}', '{"başka":1}']) assert.equal(readPick(a, LIB), "keep", a);
  assert.deepEqual(readPick('Seçimim: {"dosyalar":[]}', LIB), []);
});

test("a long list is shown whole, PICK_LIST at a time: a file past the first page can be chosen", async () => {
  const many: SourceEntry[] = Array.from({ length: 1000 }, (_, i) => ({ id: `f-${i}`, path: `Tek Klasör/Dosya ${i}.pdf` }));
  const seen: number[] = [];
  const r = await pickPaged(many, async (paths) => {
    seen.push(paths.length);
    const at = paths.indexOf("Tek Klasör/Dosya 950.pdf");
    return at >= 0 ? `{"dosyalar":[${at + 1}]}` : '{"dosyalar":[]}';
  });
  assert.deepEqual(seen, [400, 400, 200]);
  assert.deepEqual(r, [many[950]]);
  // Every page says the documents in use serve: kept. One page chose: its choice.
  assert.equal(await pickPaged(many, async () => '{"devam":true}'), "keep");
  assert.deepEqual(await pickPaged(many.slice(0, 500), async (p) => (p.length === 400 ? '{"devam":true}' : '{"dosyalar":[1]}')), [many[400]]);
});

test("a large library: a file behind a folder name that says nothing is still shown, by its words", async () => {
  const lib: SourceEntry[] = [
    ...Array.from({ length: 1000 }, (_, i) => ({ id: `a-${i}`, path: `Arşiv/Evrak ${i}.pdf` })),
    { id: "sunum", path: "Arşiv/Yatırım Ortamı Sunumu.pdf" },
    ...Array.from({ length: 50 }, (_, i) => ({ id: `y-${i}`, path: `Bakanlığa Gönderilen Tablolar/Yazışma ${i}.xlsx` })),
  ];
  const looks: string[][] = [];
  // A model that only chooses what it sees by name: folders say nothing of the presentation.
  const model = async (paths: string[]) => {
    looks.push(paths);
    const at = paths.findIndex((p) => p.includes("Yatırım Ortamı"));
    return at >= 0 ? `{"dosyalar":[${at + 1}]}` : '{"dosyalar":[]}';
  };
  assert.deepEqual(await pickFrom(lib, "yatırım ortamı sunusunu özetle", model), [lib[1000]]);
  assert.ok(looks[0].some((p) => p.startsWith("Arşiv/ (1001 dosya)")) && looks[0].includes("Arşiv/Yatırım Ortamı Sunumu.pdf"));
  // A folder chosen by its meaning ("giden" for "Gönderilen"): its files are looked at next, whole.
  const looks2: string[][] = [];
  const r = await pickFrom(lib, "bakanlığa giden tablolarda son yazışma", async (paths) => {
    looks2.push(paths);
    const dir = paths.findIndex((p) => p.startsWith("Bakanlığa Gönderilen Tablolar/ ("));
    if (dir >= 0) return `{"dosyalar":[${dir + 1}]}`;
    const f = paths.indexOf("Bakanlığa Gönderilen Tablolar/Yazışma 49.xlsx");
    return f >= 0 ? `{"dosyalar":[${f + 1}]}` : '{"dosyalar":[]}';
  });
  assert.deepEqual(r, [lib.find((e) => e.id === "y-49")]);
  // Nothing fits anywhere: none read; told the documents in use serve: kept.
  assert.deepEqual(await pickFrom(lib, "hiçbir şey", async () => '{"dosyalar":[]}'), []);
  assert.equal(await pickFrom(lib, "devam", async () => '{"devam":true}'), "keep");
});

test("paging goes on after the picks are full, and a failed second look keeps the documents in use", async () => {
  const many: SourceEntry[] = Array.from({ length: 1000 }, (_, i) => ({ id: `f-${i}`, path: `Tek Klasör/Dosya ${i}.pdf` }));
  // Each page offers eight; the one asked for is on the last page; the final look chooses it among the offered.
  const r = await pickPaged(many, async (paths) => {
    const at = paths.indexOf("Tek Klasör/Dosya 999.pdf");
    if (at >= 0) return `{"dosyalar":[${at + 1}]}`;
    return paths.length === 400 ? '{"dosyalar":[1,2,3,4,5,6,7,8]}' : '{"dosyalar":[]}';
  });
  assert.ok(r !== "keep" && r.some((e) => e.id === "f-999"), "the last page was shown");
  // First look chooses only a folder; the second look's call fails: kept, not emptied.
  const lib: SourceEntry[] = [...Array.from({ length: 500 }, (_, i) => ({ id: `a-${i}`, path: `Arşiv/Evrak ${i}.pdf` })), { id: "y", path: "Yazışmalar/Liste.xlsx" }];
  let call = 0;
  const kept = await pickFrom(lib, "bakanlığa giden", async (paths) => {
    call++;
    if (call === 1) return `{"dosyalar":[${paths.findIndex((p) => p.startsWith("Yazışmalar/ (")) + 1}]}`;
    return null;
  });
  assert.equal(kept, "keep");
});
