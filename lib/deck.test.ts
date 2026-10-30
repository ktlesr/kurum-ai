// Run: pnpm test. Sunum mode: imported layouts → slides, the model's answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PLACEHOLDER_PIC, parseOutline, parseSlide, rethemeSlides, slideFrom, type DeckTemplate, type Layout, type TemplateInfo } from "./deck.ts";
import { svgOf, type El, type Measure, type TextEl } from "./studio.ts";

const measure: Measure = (t, size) => t.length * size * 0.55;
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(`../public/slides/${name}`, import.meta.url), "utf8"));

test("every imported layout becomes a slide that draws", () => {
  const index = read("index.json") as TemplateInfo[];
  assert.ok(index.length >= 16);
  let n = 0;
  for (const info of index) {
    const t = read(`${info.id}.json`) as DeckTemplate;
    for (const l of t.layouts) {
      const els = slideFrom(l, undefined, "#123456");
      assert.ok(els.length, `${info.id}/${l.id}`);
      const svg = svgOf("yatay", els, measure);
      assert.ok(!/NaN|undefined|<script/.test(svg), `${info.id}/${l.id}: ${svg.match(/.{60}(NaN|undefined).{20}/)?.[0]}`);
      assert.ok(new Set(els.map((e) => e.id)).size === els.length);
      for (const e of els) if (e.kind === "text") assert.match(e.font ?? "", /^[a-z-]+$/);
      n++;
    }
  }
  assert.ok(n > 200, String(n));
});

const layout: Layout = {
  id: "x", desc: "d",
  slots: [{ key: "head", max: 10 }, { key: "list.0.t", max: 20 }, { key: "list.1.t", max: 20 }],
  els: [
    { id: "a", kind: "text", name: "t", slot: "head", x: 0, y: 0, w: 100, h: 40, text: "Sample", size: 40 },
    { id: "b", kind: "shape", name: "kart", grp: "list.0", x: 0, y: 50, w: 100, h: 40, fill: { kind: "solid", color: "#000000" } },
    { id: "c", kind: "text", name: "t", grp: "list.0", slot: "list.0.t", x: 0, y: 50, w: 100, h: 40, text: "S", size: 20 },
    { id: "d", kind: "shape", name: "kart", grp: "list.1", x: 0, y: 90, w: 100, h: 40, fill: { kind: "solid", color: "#000000" } },
    { id: "e", kind: "text", name: "t", grp: "list.1", slot: "list.1.t", x: 0, y: 90, w: 100, h: 40, text: "S", size: 20 },
    { id: "f", kind: "image", name: "g", x: 0, y: 0, w: 10, h: 10, pic: { placeholder: true }, fit: "cover" },
    { id: "g", kind: "shape", name: "i", accentMark: true, x: 0, y: 0, w: 10, h: 10, fill: { kind: "solid", color: "#000000" } },
  ],
};

test("slideFrom: empty list items go with their card; sample text never stays; placeholder and accent", () => {
  const blank = slideFrom(layout);
  assert.ok(blank.filter((e) => e.kind === "text").every((e) => (e as TextEl).text === "Başlık yazın" || (e as TextEl).text === "Metin yazın"));
  const s = slideFrom(layout, { head: "Başlık", "list.0.t": "Bir" }, "#abcdef");
  assert.deepEqual(s.filter((e) => e.kind === "text").map((e) => (e as TextEl).text), ["Başlık", "Bir"]);
  assert.equal(s.filter((e) => e.name === "kart").length, 1);
  assert.equal(s.find((e) => e.name === "g")?.kind === "image" && (s.find((e) => e.name === "g") as { pic: { src: string } }).pic.src, PLACEHOLDER_PIC.src);
  const mark = s.find((e) => e.name === "i");
  assert.ok(mark?.kind === "shape" && mark.fill.kind === "solid" && mark.fill.color === "#abcdef");
});

test("parseOutline / parseSlide: tolerant, bounded, only what was asked", () => {
  const o = parseOutline('Tabii:\n{"slaytlar":[{"duzen":"a","baslik":"Bir","noktalar":["x"]},{"duzen":"yok","baslik":"İki"},{"baslik":""},{"duzen":"a","baslik":"Üç"}]}', ["a", "b"], 2);
  assert.deepEqual(o, [{ layout: "a", title: "Bir", points: ["x"] }, { layout: "b", title: "İki", points: [] }]);
  assert.equal(parseOutline("hayır", ["a"], 2), null);
  const v = parseSlide('{"head":"123456789012345","list.0.t":"  iki\\nsatır ","__proto__":"x","başka":"y","list.1.t":""}', layout.slots);
  assert.deepEqual(v, { head: "1234567890", "list.0.t": "iki satır" });
  assert.equal(parseSlide("[1]", layout.slots), null);
});

test("rethemeSlides: the main hue and the others change, greys and pale tints stay; a theme can replace a grey theme", () => {
  const shape = (id: string, color: string) => ({ id, kind: "shape", name: id, x: 0, y: 0, w: 1, h: 1, fill: { kind: "solid", color } }) as El;
  const col = (e: El) => (e.kind === "shape" && e.fill.kind === "solid" ? e.fill.color : "");
  const slides = [[shape("a", "#2244cc"), shape("b", "#2244cc"), shape("c", "#ff8800"), shape("d", "#ffffff"), shape("e", "#808080"), shape("f", "#eef2ff")]];
  const t = { primary: "#111111", accent: "#222222", head: "poppins", body: "inter" };
  const out = rethemeSlides(slides, t);
  assert.deepEqual(out[0].map(col), ["#111111", "#111111", "#222222", "#ffffff", "#808080", "#eef2ff"]);
  const again = rethemeSlides(out, { ...t, primary: "#aa0000", accent: "#00aa00" }, ["#111111", "#222222"]);
  assert.deepEqual(again[0].map(col), ["#aa0000", "#aa0000", "#00aa00", "#ffffff", "#808080", "#eef2ff"]);
});
