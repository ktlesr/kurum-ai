// Run: pnpm test. A deck from a document: what the model says is typed, checked against the document, laid out in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanContent, completeGroups, parseBlocks, parsePlan, pickSource, sampleSource, verifyBlocks } from "./deck-doc.ts";
import { SAMPLE_DECK, composeDeck, dropRepeats } from "./deck-compose.ts";
import { DESIGNS, contrast, designFromFamily } from "./deck-design.ts";
import { DEFAULT_MASTER, applyMaster, cleanMaster, setPick, splitMaster, withoutMaster } from "./deck-master.ts";
import { cleanEls, type El } from "./studio.ts";

const DOC = `# Amaç
Madde 1- (1) Bu Kararın amacı üretimi artırmaktır.

# Bölgeler
Madde 3- (1) İller EK-2'de belirtilen altı bölgeye ayrılmıştır.

# Faiz desteği
Madde 15- (1) Destek oranı %25'tir ve tutar 12 milyon TL'yi geçemez.

# EK-2 BÖLGELER
1. Bölge illeri: Ankara, Antalya, Bursa, Eskişehir
2. Bölge illeri: Aydın, Balıkesir, Bolu,
Tekirdağ, Yalova

# EK-5 İLÇELER
Adana ilçeleri: Aladağ, Feke, Karataş
Bursa ilçeleri: Büyükorhan, Harmancık, Keles
`;

test("parsePlan: sections in order; nothing usable is null", () => {
  const p = parsePlan(`x {"baslik":"B","altbaslik":"A","bolumler":[{"baslik":"Amaç","sorgu":"amaç"},{"baslik":"Kapsam"},{"sorgu":"yok"}]}`);
  assert.deepEqual(p?.sections.map((s) => [s.title, s.query]), [["Amaç", "amaç"], ["Kapsam", "Kapsam"]]);
  assert.equal(parsePlan("yok"), null);
  assert.equal(parsePlan(`{"bolumler":[]}`), null);
});

test("parseBlocks: all four kinds; a list under another key or on the block itself; lists in a row become one", () => {
  const b = parseBlocks(JSON.stringify({ kaynak: "Madde 1", bloklar: [
    { tur: "maddeler", baslik: "M", metin: [{ baslik: "a", metin: "b" }] },
    { tur: "rakamlar", baslik: "R", rakamlar: [{ deger: "%25", aciklama: "oran" }, { aciklama: "değersiz" }] },
    { tur: "tablo", baslik: "T", sutunlar: ["x", "y"], satirlar: [["1"], ["2", "3", "fazla"], []] },
    { tur: "gruplar", baslik: "1. Bölge", ogeler: ["Ankara"] },
    { tur: "gruplar", baslik: "G", gruplar: [{ ad: "2. Bölge", ogeler: ["Aydın"] }] },
    { tur: "kötü" },
  ] }));
  assert.deepEqual(b?.blocks.map((x) => x.kind), ["points", "figures", "table", "groups"]);
  const t = b?.blocks[2];
  assert.deepEqual(t?.kind === "table" && t.rows, [["1", ""], ["2", "3"]]);
  const g = b?.blocks[3];
  assert.deepEqual(g?.kind === "groups" && g.groups.map((x) => x.name), ["1. Bölge", "2. Bölge"]);
});

test("parseBlocks: an answer cut off at the length limit keeps what was complete", () => {
  const cut = `{"kaynak":"Ek-5","bloklar":[{"tur":"gruplar","baslik":"İlçeler","gruplar":[{"ad":"Adana","ogeler":["Feke","Karataş"]},{"ad":"Bursa","ogeler":["Kel`;
  const b = parseBlocks(cut);
  const g = b?.blocks[0];
  assert.deepEqual(g?.kind === "groups" && g.groups.map((x) => x.name), ["Adana"]);
  assert.equal(parseBlocks("{"), null);
});

test("pickSource: finds the part by its heading and brings the annex its rule refers to", () => {
  const s = pickSource(DOC, "Bölgeler bölge", 500);
  assert.ok(s.includes("altı bölgeye") && s.includes("Ankara"), s);
  assert.ok(!s.includes("12 milyon"), s);
  assert.ok(pickSource(DOC, "amaç", 300).includes("üretimi artırmaktır"));
  assert.ok(pickSource(DOC, "zzzz", 40).length <= 40);
  assert.ok(pickSource(DOC, "bölge", 60).length <= 60);
});

test("verifyBlocks: a number or a name the document doesn't hold goes, and is reported", () => {
  const { blocks, dropped } = verifyBlocks([
    { kind: "figures", title: "", items: [{ value: "%25", label: "oran" }, { value: "%99", label: "uydurma" }] },
    { kind: "points", title: "", items: [{ head: "Tutar", text: "12 milyon TL" }, { head: "Tutar", text: "15,1 milyon TL" }] },
    { kind: "groups", title: "", groups: [{ name: "1", items: ["Ankara", "Atlantis"] }] },
    { kind: "figures", title: "", items: [{ value: "%70", label: "yok" }] },
  ], DOC);
  assert.equal(blocks.length, 3);
  assert.equal(dropped.length, 4);
  assert.ok(dropped.some((d) => d.includes("Atlantis")) && dropped.some((d) => d.includes("15,1")));
});

test("completeGroups: a shortened list is made whole; a passed-over list comes from the document", () => {
  const short = completeGroups([{ kind: "groups", title: "", groups: [{ name: "2. Bölge", items: ["Aydın"] }] }], DOC);
  const g = short[0];
  assert.deepEqual(g.kind === "groups" && g.groups[0].items, ["Aydın", "Balıkesir", "Bolu", "Tekirdağ", "Yalova"]);
  const auto = completeGroups([{ kind: "points", title: "", items: [{ head: "a", text: "b" }] }], DOC, "ilçe bazlı");
  const last = auto[auto.length - 1];
  assert.deepEqual(last.kind === "groups" && last.groups.map((x) => x.name), ["Adana ilçeleri", "Bursa ilçeleri"]);
  assert.equal(completeGroups([], DOC, "faiz desteği").length, 0);
});

const measure = (t: string, s: number) => t.length * s * 0.52;

test("composeDeck: long lists and tables page without leaving the slide; empty sections are named, not drawn", () => {
  const long = Array.from({ length: 900 }, (_, i) => `İlçe ${i}`);
  const { slides, missing } = composeDeck(
    { title: "Sunum", subtitle: "Alt", sections: [] },
    [
      { title: "Liste", source: "Ek-5", dropped: [], blocks: [{ kind: "groups", title: "", groups: [{ name: "Tek", items: long }, ...Array.from({ length: 30 }, (_, i) => ({ name: `İl ${i}`, items: ["a", "b", "c"] }))] }] },
      { title: "Tablo", source: "", dropped: [], blocks: [{ kind: "table", title: "", columns: ["A", "B"], rows: Array.from({ length: 60 }, (_, i) => [`satır ${i}`, "açıklama ".repeat(12)]) }] },
      { title: "Maddeler", source: "", dropped: [], blocks: [{ kind: "points", title: "", items: Array.from({ length: 16 }, (_, i) => ({ head: `B ${i}`, text: "metin ".repeat(30) })) }] },
      { title: "Rakam", source: "", dropped: [], blocks: [{ kind: "figures", title: "", items: Array.from({ length: 9 }, (_, i) => ({ value: `%${i}`, label: "oran" })) }] },
      { title: "Boş", source: "", dropped: [], blocks: [] },
    ],
    "Belge",
    measure,
  );
  assert.deepEqual(missing, ["Boş"]);
  const all = slides.flat();
  for (const e of all) if (e.kind === "text") assert.ok(e.y + e.h <= 1081 && e.x + e.w <= 1921, `${e.text.slice(0, 30)} y=${e.y + e.h}`);
  const shown = all.flatMap((e) => (e.kind === "text" ? [e.text.replace(/\s+/g, " ")] : [])).join(" ");
  for (const i of [0, 450, 899]) assert.ok(new RegExp(`İlçe ${i}( |$)`).test(shown), `İlçe ${i} is on a slide`);
  assert.ok(shown.includes("satır 59"));
  assert.ok(slides.every((s) => s.length <= 200));
  assert.ok(!all.some((e) => e.kind === "image"), "no picture holder left empty");
});

test("dropRepeats: a list asked twice is shown once under both names", () => {
  const list = { kind: "groups" as const, title: "", groups: [{ name: "1", items: ["a"] }] };
  const out = dropRepeats([{ title: "Bölgeler", source: "", dropped: [], blocks: [list] }, { title: "İller", source: "", dropped: [], blocks: [{ ...list }] }]);
  assert.equal(out[0].title, "Bölgeler ve İller");
  assert.equal(out[1].blocks.length, 0);
  const { missing } = composeDeck({ title: "t", subtitle: "", sections: [] }, [{ title: "Bölgeler", source: "", dropped: [], blocks: [list] }, { title: "İller", source: "", dropped: [], blocks: [{ ...list }] }], "", measure);
  assert.deepEqual(missing, []);
});

test("verifyBlocks: 2,5 isn't 25; 1.250 is 1250", () => {
  const src = "Oran %2,5 ve adet 1.250 kişi.";
  const { blocks, dropped } = verifyBlocks([{ kind: "figures", title: "", items: [{ value: "%25", label: "x" }, { value: "%2,5", label: "x" }, { value: "1250", label: "x" }] }], src);
  assert.equal(dropped.length, 1);
  assert.deepEqual(blocks[0].kind === "figures" && blocks[0].items.map((i) => i.value), ["%2,5", "1250"]);
});

test("pickSource: a document with no headings still gives the paragraphs on the subject", () => {
  const filler = Array.from({ length: 60 }, (_, i) => `Genel açıklama paragrafı numara ${i}. `.repeat(12)).join("\n\n");
  const doc = `${filler}\n\nBütçe tablosunda personel giderleri ayrıntılı gösterilir.\n\n${filler}`;
  assert.ok(pickSource(doc, "personel giderleri bütçe", 4000).includes("personel giderleri"));
});

test("sampleSource: whole when it fits, else the start, the end and the middle within budget", () => {
  assert.equal(sampleSource("kısa", 100), "kısa");
  const doc = `BAŞ${"x".repeat(5000)}SON`;
  const s = sampleSource(doc, 1000);
  assert.ok(s.length <= 1020 && s.startsWith("BAŞ") && s.endsWith("SON"));
});

test("composeDeck: long points are never cut; past the slide limit the sections left out are named", () => {
  const long = { title: "L", source: "", dropped: [], blocks: [{ kind: "points" as const, title: "", items: Array.from({ length: 6 }, (_, i) => ({ head: `Başlık ${i} `.repeat(6).trim().slice(0, 69), text: `Son${i} ${"uzun metin ".repeat(30)}`.slice(0, 314) })) }] };
  const { slides } = composeDeck({ title: "t", subtitle: "", sections: [] }, [long], "", measure);
  const shown = slides.flat().flatMap((e) => (e.kind === "text" ? [e.text] : [])).join(" ");
  assert.ok(!shown.includes("…"), "nothing ends in an ellipsis");
  for (let i = 0; i < 6; i++) assert.ok(shown.includes(`Son${i}`));
  const big = Array.from({ length: 16 }, (_, k) => ({ title: `B${k}`, source: "", dropped: [], blocks: [{ kind: "table" as const, title: "", columns: ["a"], rows: Array.from({ length: 80 }, (_, i) => [`${k}-${i}`]) }] }));
  const r = composeDeck({ title: "t", subtitle: "", sections: [] }, big, "", measure);
  assert.equal(r.slides.length, 100);
  assert.ok(r.left.length > 0);
  assert.ok(r.slides[99].some((e) => e.kind === "text" && e.text === "Teşekkürler"));
});

const PIC = (c: string) => ({ src: `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="${c}"/></svg>`)}`, w: 20, h: 10 });

test("designs: every design lays out the same content inside the slide, with text that reads on what it stands on", () => {
  for (const d of DESIGNS) {
    const { slides } = composeDeck(SAMPLE_DECK.plan, SAMPLE_DECK.sections, "Belge", measure, d);
    assert.ok(slides.length >= 5, d.id);
    for (const e of slides.flat()) if (e.kind === "text") assert.ok(e.y + e.h <= 1081 && e.x + e.w <= 1921, `${d.id}: ${e.text.slice(0, 20)}`);
    assert.ok(contrast(d.ink, d.bg) >= 4.5 && contrast(d.heading, d.bg) >= 3 && contrast(d.onPrimary, d.primary) >= 4.5, d.id);
  }
});

test("designFromFamily: a panel stands out from the page and has readable text, even on a dark or pale family", () => {
  for (const info of [{ id: "a", name: "A", primary: "#bff4ff", background: "#bff4ff" }, { id: "b", name: "B", primary: "#c24d12", background: "#171717" }, { id: "c", name: "C", primary: "#000000", background: "#ececec" }]) {
    const d = designFromFamily(info, { layouts: [] });
    assert.ok(contrast(d.primary, d.bg) >= 3, info.id);
    assert.ok(contrast(d.onPrimary, d.primary) >= 4.5, info.id);
    assert.ok(contrast(d.ink, d.bg) >= 4.5, info.id);
  }
});

test("master: covers stay clean; the logo version follows the ground; a slide can insist; re-applying doesn't pile up", () => {
  const master = { ...DEFAULT_MASTER, logos: [{ color: PIC("#ff0000"), white: PIC("#ffffff") }], footer: "Kurum" };
  const paper = [{ id: "z", kind: "shape", name: "Zemin", x: 0, y: 0, w: 1920, h: 1080, fill: { kind: "solid", color: "#ffffff" } }] as El[];
  const night = [{ id: "n", kind: "shape", name: "Zemin", x: 0, y: 0, w: 1920, h: 1080, fill: { kind: "solid", color: "#0f1724" } }] as El[];
  const on = applyMaster([paper, paper, night, paper], master);
  const logoOf = (s: El[]) => s.find((e) => e.kind === "image" && e.master) as Extract<El, { kind: "image" }> | undefined;
  assert.equal(logoOf(on[0]), undefined);
  assert.equal(logoOf(on[3]), undefined);
  assert.equal(logoOf(on[1])?.pic.src, master.logos[0].color.src);
  assert.equal(logoOf(on[2])?.pic.src, master.logos[0].white.src);
  // right above the ground, so the slide's own content stays on top
  assert.equal(on[1][0].id, "z");
  assert.ok(on[1].slice(1).every((e) => e.master));
  assert.ok(on[1].some((e) => e.kind === "text" && e.name === "Sayfa numarası" && e.text === "2"));
  const again = applyMaster(on, master);
  assert.equal(again[1].length, on[1].length);
  const white = setPick(on[1], "white");
  assert.equal(logoOf(applyMaster([paper, white, paper], master)[1])?.pic.src, master.logos[0].white.src);
  assert.equal(logoOf(applyMaster([paper, setPick(on[1], "none"), paper], master)[1]), undefined);
});

test("master: stored without its pictures, and a slide's choice survives", () => {
  const master = { ...DEFAULT_MASTER, logos: [{ color: PIC("#ff0000") }] };
  const paper = [{ id: "z", kind: "shape", name: "Zemin", x: 0, y: 0, w: 1920, h: 1080, fill: { kind: "solid", color: "#ffffff" } }] as El[];
  const on = applyMaster([paper, paper, paper], master);
  const stored = withoutMaster([on[0], setPick(on[1], "none"), on[2]]);
  assert.ok(!JSON.stringify(stored).includes("base64"));
  const back = cleanEls(JSON.parse(JSON.stringify(stored[1])));
  assert.equal(splitMaster(back).pick, "none");
  assert.deepEqual(cleanMaster({ logos: [{ color: { src: "https://evil/x.png", w: 1, h: 1 } }], size: 9999, corner: "x" }).logos, []);
  assert.equal(cleanMaster({ size: 9999 }).size, 140);
});

test("cleanContent: saved content lays out again; bad parts go", () => {
  const c = cleanContent({ plan: { title: "T" }, docName: "D", sections: [{ title: "A", source: "M1", blocks: [{ kind: "figures", title: "", items: [{ value: "%5", label: "x" }] }, { kind: "kötü" }, null] }, { nope: 1 }] });
  assert.equal(c?.sections.length, 1);
  assert.deepEqual(c?.sections[0].blocks.map((b) => b.kind), ["figures"]);
  assert.equal(cleanContent({ sections: "x" }), undefined);
  assert.ok(composeDeck(c!.plan, c!.sections, c!.docName, measure, DESIGNS[2]).slides.length >= 3);
});

test("master: a panel of the slide's own over the logo's corner doesn't hide it, and the white version is taken", () => {
  const master = { ...DEFAULT_MASTER, logos: [{ color: PIC("#ff0000"), white: PIC("#ffffff") }] };
  const slide = [
    { id: "z", kind: "shape", name: "Zemin", x: 0, y: 0, w: 1920, h: 1080, fill: { kind: "solid", color: "#ffffff" } },
    { id: "p", kind: "shape", name: "Panel", x: 0, y: 0, w: 1920, h: 400, fill: { kind: "solid", color: "#0f4c5c" } },
  ] as El[];
  const on = applyMaster([slide, slide, slide], master)[1];
  const at = (id: string) => on.findIndex((e) => e.id === id);
  const logo = on.findIndex((e) => e.kind === "image");
  assert.ok(logo > at("p"), "above the panel");
  assert.equal((on[logo] as { pic: { src: string } }).pic.src, master.logos[0].white.src);
});

