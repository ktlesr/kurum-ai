// Run: pnpm test
// Real decks (written by pptxgenjs, as PowerPoint would save them) through lib/pptx.
import { test } from "node:test";
import assert from "node:assert/strict";
import PptxGenJS from "pptxgenjs";
import { chunkText } from "./chunk.ts";
import { pptxText, SlidesError } from "./pptx.ts";

const PNG = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function deck(build: (p: PptxGenJS) => void): Promise<Uint8Array> {
  const p = new PptxGenJS();
  build(p);
  return new Uint8Array((await p.write({ outputType: "nodebuffer" })) as Buffer);
}

test("pptx: each slide in order with its title, text, table and speaker notes; a hidden slide said so; pictures counted", async () => {
  const buf = await deck((p) => {
    // A layout with a title placeholder, as PowerPoint's own: the slide's title goes there.
    p.defineSlideMaster({ title: "M", objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.3, w: 9, h: 1 }, text: "" } }] });
    const s1 = p.addSlide({ masterName: "M" });
    s1.addText("Kütahya Ziyareti 2026", { placeholder: "title" });
    s1.addText("Seramik kümesi\nİhracat 5,8 milyar dolar", { x: 0.5, y: 1.5, w: 9, h: 2 });
    s1.addNotes("Bakan yardımcısına sunulacak; rakamlar 2025 sonu.");
    const s2 = p.addSlide();
    s2.addText("İl Bazlı Projeler", { x: 0.5, y: 0.3, w: 9, h: 1 });
    s2.addTable([["İl", "Proje"], ["Kütahya", "12"], ["Uşak", "7"]].map((r) => r.map((text) => ({ text }))), { x: 0.5, y: 1.5, w: 6 });
    s2.addImage({ data: PNG, x: 7, y: 1.5, w: 1, h: 1 });
    const s3 = p.addSlide();
    s3.addText("Taslak: hidrojen", { x: 0.5, y: 0.3, w: 9, h: 1 });
    (s3 as unknown as { hidden: boolean }).hidden = true;
  });
  const r = await pptxText(buf, 500);
  assert.equal(r.pages, 3);
  const [one, two, three] = r.text.split(/^(?=--- Sayfa \d+ ---$)/mu);
  assert.match(one, /^--- Sayfa 1 ---\nSlayt 1: Kütahya Ziyareti 2026\n/u, "the title placeholder on the slide's first line");
  assert.match(one, /Kütahya Ziyareti 2026/u);
  assert.match(one, /Seramik kümesi\nİhracat 5,8 milyar dolar/u);
  assert.match(one, /Konuşmacı notları:\nBakan yardımcısına sunulacak; rakamlar 2025 sonu\./u);
  assert.match(two, /\| İl \| Proje \|\n\| --- \| --- \|\n\| Kütahya \| 12 \|\n\| Uşak \| 7 \|/u);
  assert.match(three, /^--- Sayfa 3 ---\nSlayt 3.*\(gizli slayt\)/mu);
  assert.match(r.warning ?? "", /1 görsel, grafik ya da diyagramın içi okunmadı/u);
  assert.match(r.warning ?? "", /1 slayt sunumda gizli/u);
  // Searched like a PDF's pages: each slide its own section, labelled by its number.
  assert.deepEqual([...new Set(chunkText("d.pptx", r.text).map((c) => c.label))], ["Sayfa 1", "Sayfa 2", "Sayfa 3"]);
});

test("pptx: more slides than allowed, or not a deck at all, is a clear error", async () => {
  const buf = await deck((p) => {
    for (let i = 0; i < 4; i++) p.addSlide().addText(`S${i}`, { x: 1, y: 1, w: 3, h: 1 });
  });
  await assert.rejects(pptxText(buf, 3), (e: unknown) => e instanceof SlidesError && /en fazla 3/u.test(e.message));
  await assert.rejects(pptxText(new Uint8Array([1, 2, 3, 4]), 10), SlidesError);
});

test("pptx: relationships written from the package root, and a line break inside a paragraph, read right", async () => {
  const JSZip = (await import("jszip")).default;
  const buf = await deck((p) => {
    p.addSlide().addText([{ text: "İhracat", options: { breakLine: false } }, { text: "Hedefi", options: { softBreakBefore: true } }], { x: 1, y: 1, w: 5, h: 1 });
  });
  const zip = await JSZip.loadAsync(buf);
  // Rewrite the deck's slide link the way some tools save it: from the package root.
  const relsName = "ppt/_rels/presentation.xml.rels";
  const rels = (await zip.file(relsName)!.async("string")).replace(/Target="slides\//gu, 'Target="/ppt/slides/');
  zip.file(relsName, rels);
  const r = await pptxText(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), 10);
  assert.equal(r.pages, 1);
  assert.match(r.text, /İhracat Hedefi/u);
});

test("pptx: the relationship id under another prefix, a note that is a number, a slide hidden by show=false", async () => {
  const JSZip = (await import("jszip")).default;
  const buf = await deck((p) => {
    const s1 = p.addSlide();
    s1.addText("Bütçe", { x: 1, y: 1, w: 5, h: 1 });
    s1.addNotes("2026");
    p.addSlide().addText("İkinci", { x: 1, y: 1, w: 5, h: 1 });
  });
  const zip = await JSZip.loadAsync(buf);
  const pres = "ppt/presentation.xml";
  // Another prefix for the same namespace: valid XML, the same deck.
  const xml = (await zip.file(pres)!.async("string"))
    .replace(/xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/u, 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:q="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
    .replace(/(<p:sldId [^>]*?)r:id=/gu, "$1q:id=");
  assert.match(xml, /<p:sldId [^>]*q:id=/u, "the deck now names its slides under q:");
  assert.doesNotMatch(xml, /<p:sldId [^>]*r:id=/u);
  zip.file(pres, xml);
  const second = "ppt/slides/slide2.xml";
  zip.file(second, (await zip.file(second)!.async("string")).replace(/<p:sld /u, '<p:sld show="false" '));
  const r = await pptxText(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), 10);
  assert.equal(r.pages, 2);
  assert.match(r.text, /Konuşmacı notları:\n2026/u);
  assert.match(r.text, /Slayt 2 \(gizli slayt\)/u);
});

test("pptx: a shape inside mc:AlternateContent is read from its fallback; shapes nested past the stack are a clear error", async () => {
  const JSZip = (await import("jszip")).default;
  const buf = await deck((p) => {
    p.addSlide().addText("Merhaba", { x: 1, y: 1, w: 5, h: 1 });
  });
  const zip = await JSZip.loadAsync(buf);
  const name = "ppt/slides/slide1.xml";
  const xml = await zip.file(name)!.async("string");
  const sp = /<p:sp>[\s\S]*?<\/p:sp>/u.exec(xml)![0];
  const wrapped = xml.replace(sp, `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a14"><p:sp/></mc:Choice><mc:Fallback>${sp}</mc:Fallback></mc:AlternateContent>`);
  zip.file(name, wrapped);
  assert.match((await pptxText(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), 10)).text, /Merhaba/u);
  const deep = xml.replace(sp, `${"<p:grpSp>".repeat(20000)}${sp}${"</p:grpSp>".repeat(20000)}`);
  zip.file(name, deep);
  await assert.rejects(pptxText(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), 10), SlidesError);
});

test("pptx: a slide part pointed at many times is read once; a table's width is bounded", async () => {
  const JSZip = (await import("jszip")).default;
  const buf = await deck((p) => {
    p.addSlide().addTable([[{ text: "a" }, { text: "b" }], [{ text: "c" }, { text: "d" }]], { x: 1, y: 1, w: 5 });
  });
  const zip = await JSZip.loadAsync(buf);
  const pres = "ppt/presentation.xml";
  const xml = await zip.file(pres)!.async("string");
  const one = /<p:sldId [^>]*\/>/u.exec(xml)![0];
  let n = 1000;
  zip.file(pres, xml.replace(one, one.repeat(300).replace(/ id="\d+"/gu, () => ` id="${n++}"`)));
  const name = "ppt/slides/slide1.xml";
  const slide = await zip.file(name)!.async("string");
  // One row of 5000 cells: the others are not padded to it.
  const wide = slide.replace(/<a:tr [^>]*>/u, (tr) => tr + "<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody></a:tc>".repeat(5000));
  zip.file(name, wide);
  const r = await pptxText(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), 500);
  assert.equal((r.text.match(/^--- Sayfa \d+ ---$/gmu) ?? []).length, 1, "the same slide once");
  assert.ok(r.text.length < 10_000, `${r.text.length} chars`);
});

test("pptx: a table of millions of empty rows is refused before its lines are made", async () => {
  const JSZip = (await import("jszip")).default;
  const buf = await deck((p) => {
    p.addSlide().addTable([[{ text: "a" }, { text: "b" }]], { x: 1, y: 1, w: 5 });
  });
  const zip = await JSZip.loadAsync(buf);
  const name = "ppt/slides/slide1.xml";
  const slide = await zip.file(name)!.async("string");
  zip.file(name, slide.replace("</a:tbl>", `${"<a:tr/>".repeat(1_100_000)}</a:tbl>`));
  const started = Date.now();
  await assert.rejects(pptxText(new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })), 10), SlidesError);
  assert.ok(Date.now() - started < 20_000);
});
