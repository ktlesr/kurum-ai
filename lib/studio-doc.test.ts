// Run: pnpm test. Görsel Stüdyo editable design: template → elements, drawing, boxes hugging text, project import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEls, draw, editedText, fromTemplate, hug, setTextStyle, svgOf, textStyleAt, type Design, type El, type Measure, type TextEl } from "./studio.ts";

const measure: Measure = (t, size) => t.length * size * 0.55;
const PNG = "data:image/png;base64,iVBORw0KGgo=";
/** A real 1×1 PNG (project import reads the size from the header). */
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const design: Design = {
  template: "duyuru", format: "kare",
  content: { tag: "Duyuru", title: "Yeni hizmet binamız", subtitle: "Tüm birimler tek adreste.", detail: "1 Kasım 2026" },
  brand: { primary: "#14263d", accent: "#2e5e8c", logo: { src: PNG, w: 300, h: 100 } },
  photo: { src: PNG, w: 4, h: 3 },
};

test("fromTemplate: every content field is its own editable element; the background is locked; the logo is marked", () => {
  const els = fromTemplate(design, measure);
  const byRole = (r: string) => els.find((e) => e.kind === "text" && e.role === r) as TextEl | undefined;
  assert.equal(byRole("title")?.text, "Yeni hizmet binamız");
  assert.equal(byRole("subtitle")?.text, "Tüm birimler tek adreste.");
  assert.equal(byRole("detail")?.text, "1 Kasım 2026");
  assert.equal(byRole("tag")?.text, "Duyuru", "stored as typed, drawn in capitals");
  assert.ok(byRole("tag")?.upper && byRole("tag")?.bg);
  assert.ok(els.some((e) => e.kind === "shape" && e.locked && e.name === "Arka plan"));
  assert.equal(els.filter((e) => e.kind === "image" && e.logo).length, 1);
  assert.equal(new Set(els.map((e) => e.id)).size, els.length, "unique ids");
  assert.match(svgOf("kare", els, measure), />DUYURU</, "tag drawn upper-case the Turkish way");
});

test("draw: a moved and resized element is drawn where it now is; the logo stays undistorted", () => {
  const els = fromTemplate(design, measure).map((e): El => (e.kind === "image" && e.logo ? { ...e, x: 500, y: 600, w: 300, h: 300 } : e));
  const logo = draw(els, measure).find((p) => p.kind === "image" && p.pic.w === 300)!;
  assert.ok(logo.kind === "image");
  assert.ok(Math.abs(logo.w / logo.h - 3) < 1e-9, "contain keeps 3:1 inside a square box");
  assert.ok(logo.x === 500 && Math.abs(logo.y - (600 + (300 - 100) / 2)) < 1e-9, "centred in its box");
});

test("hug: without 'Kutuya sığdır' a text box grows with its text; auto boxes and pills keep their size", () => {
  const base: TextEl = { id: "t", kind: "text", name: "Metin", x: 0, y: 0, w: 500, h: 50, text: "kısa", size: 40, weight: 700, color: "#000000", align: "start", leading: 1.2, tracking: 0, auto: false };
  const [one] = hug([base], measure) as TextEl[];
  assert.equal(one.h, 48);
  const [many] = hug([{ ...base, text: "kelime ".repeat(30) }], measure) as TextEl[];
  assert.ok(many.h > 48 * 3, String(many.h));
  const svg = svgOf("kare", [{ ...base, text: "kelime ".repeat(30), h: many.h }], measure);
  assert.ok(!svg.includes("…"), "nothing cut once the box follows the text");
  assert.equal((hug([{ ...base, auto: true, text: "kelime ".repeat(30) }], measure)[0] as TextEl).h, 50);
});

test("text alignment: centred and right-aligned lines anchor in the box", () => {
  const t: TextEl = { id: "t", kind: "text", name: "M", x: 100, y: 0, w: 400, h: 60, text: "abc", size: 40, weight: 400, color: "#000000", align: "middle", leading: 1.2, tracking: 0, auto: false };
  const p = draw([t], measure)[0];
  assert.ok(p.kind === "text" && p.x === 300 && p.anchor === "middle");
  const q = draw([{ ...t, align: "end" }], measure)[0];
  assert.ok(q.kind === "text" && q.x === 500 && q.anchor === "end");
  assert.match(svgOf("kare", [t], measure), /text-anchor="middle"/);
});

test("cleanEls: a project file can only bring known, valid elements", () => {
  const els = cleanEls([
    { kind: "text", text: "<b>x</b>", color: `red" onload="x`, size: "9", weight: 650, align: "x", x: 1e9, y: NaN, bg: { fill: "javascript:x" } },
    { kind: "image", pic: { src: "https://evil.example/a.png", w: 1, h: 1 } },
    { kind: "image", pic: { src: PNG1, w: 10, h: 10 }, fit: "cover" },
    { kind: "shape", fill: { kind: "linear", stops: [{ color: "url(#x)" }, { color: "#ABCDEF", opacity: 7 }] } },
    { kind: "script", text: "alert(1)" },
    null, "x", 5,
  ]);
  assert.equal(els.length, 3, JSON.stringify(els.map((e) => e.kind)));
  const [t, img, sh] = els;
  assert.ok(t.kind === "text" && t.color === "#14263d" && t.size === 40 && t.weight === 400 && t.align === "start" && t.x === 10000 && t.y === 0 && t.bg?.fill === "#2e5e8c");
  assert.ok(img.kind === "image" && img.fit === "cover");
  assert.ok(sh.kind === "shape" && sh.fill.kind === "linear" && sh.fill.stops[0].color === "#000000" && sh.fill.stops[1].opacity === 1);
  const svg = svgOf("kare", els, measure);
  assert.ok(!svg.includes("evil.example") && !svg.includes("onload") && !svg.includes("<b>") && !svg.includes("javascript"));
  assert.deepEqual(cleanEls({ not: "an array" }), []);
  assert.equal(cleanEls(Array.from({ length: 500 }, () => ({ kind: "shape" }))).length, 200);
});

test("cleanEls (review): impossible picture sizes, oversized rasters and repeated ids", () => {
  // a real 1×1 PNG header, claimed as 1e999 wide: the real size from the header wins
  const png1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  assert.deepEqual(cleanEls([{ kind: "image", pic: { src: png1, w: 1e999, h: 5 } }]), []);
  const ok = cleanEls([{ kind: "image", pic: { src: png1, w: 300, h: 100 } }]);
  assert.ok(ok[0].kind === "image" && ok[0].pic.w === 1 && ok[0].pic.h === 1, "a ratio the header doesn't have: size from the header");
  const same = cleanEls([{ kind: "image", pic: { src: png1, w: 40, h: 40 } }]);
  assert.ok(same[0].kind === "image" && same[0].pic.w === 40, "a matching ratio is kept as stored");
  // a 2×3 JPEG frame shown rotated (EXIF) as 3×2: kept, not flipped back
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 3, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
  const rot = cleanEls([{ kind: "image", pic: { src: `data:image/jpeg;base64,${jpg}`, w: 300, h: 200 } }]);
  assert.ok(rot[0].kind === "image" && rot[0].pic.w === 300 && rot[0].pic.h === 200, JSON.stringify(rot[0]));
  // header says 100000 × 100000 (10 gigapixels)
  const huge = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 1, 0x86, 0xa0, 0, 1, 0x86, 0xa0, 8, 6, 0, 0, 0]).toString("base64");
  assert.deepEqual(cleanEls([{ kind: "image", pic: { src: `data:image/png;base64,${huge}`, w: 10, h: 10 } }]), []);
  const dup = cleanEls([{ kind: "shape", id: "a" }, { kind: "shape", id: "a" }, { kind: "shape", id: "x".repeat(60) }, { kind: "shape" }]);
  assert.equal(new Set(dup.map((e) => e.id)).size, 4);
  assert.ok(!svgOf("kare", cleanEls([{ kind: "shape", x: 1e999, w: "big" }]), measure).includes("NaN"));
});

test("part of a text: its own style, kept through typing, wrapped, drawn and read back", () => {
  const m: Measure = (t, size) => t.length * size * 0.5;
  const base: TextEl = { id: "t", kind: "text", name: "M", x: 0, y: 0, w: 2000, h: 60, text: "kalın normal", size: 40, weight: 400, color: "#000000", align: "start", leading: 1.2, tracking: 0, auto: false };
  const bold = setTextStyle(base, { weight: 700 }, { from: 0, to: 5 });
  assert.deepEqual(bold.runs, [{ from: 0, to: 5, weight: 700 }]);
  assert.equal(bold.weight, 400, "the rest stays");
  assert.equal(textStyleAt(bold, 1).weight, 700);
  assert.equal(textStyleAt(bold, 8).weight, 400);
  // Overlap splits; the same style side by side joins.
  const it = setTextStyle(bold, { italic: true }, { from: 3, to: 8 });
  assert.deepEqual(it.runs, [{ from: 0, to: 3, weight: 700 }, { from: 3, to: 5, weight: 700, italic: true }, { from: 5, to: 8, italic: true }]);
  assert.deepEqual(setTextStyle(setTextStyle(base, { weight: 700 }, { from: 0, to: 3 }), { weight: 700 }, { from: 3, to: 5 }).runs, [{ from: 0, to: 5, weight: 700 }]);
  // Off for a part of a text that has it on.
  assert.equal(setTextStyle({ ...base, italic: true }, { italic: undefined }, { from: 0, to: 5 }).runs?.[0].italic, false);
  // For all of it: the parts give way.
  const all = setTextStyle(it, { weight: 300 });
  assert.equal(all.weight, 300);
  assert.deepEqual(all.runs, [{ from: 3, to: 8, italic: true }]);
  // Typing before a part moves it; typing after doesn't.
  assert.deepEqual(editedText(bold, "çok kalın normal").runs, [{ from: 4, to: 9, weight: 700 }]);
  assert.deepEqual(editedText(bold, "kalın normal!").runs, [{ from: 0, to: 5, weight: 700 }]);
  // Drawn: a part per style on one line, in the SVG too.
  const p = draw([bold], m)[0];
  assert.ok(p.kind === "text" && p.rich);
  assert.deepEqual(p.rich[0].segs.map((s) => [s.text, s.weight]), [["kalın", 700], [" normal", 400]]);
  const svg = svgOf("kare", [bold], m);
  assert.ok(svg.includes('font-weight="700"') && svg.includes(">kalın</tspan>"));
  // A larger part makes its line taller; a narrow box wraps; hug follows.
  const big = setTextStyle({ ...base, w: 150 }, { size: 80 }, { from: 0, to: 5 });
  const [hugged] = hug([big], m) as TextEl[];
  assert.equal(hugged.h, 80 * 1.2 + 40 * 1.2);
  // From a file: bad values go, the good stay.
  const [clean] = cleanEls([{ ...bold, runs: [{ from: 0, to: 5, weight: 700, color: "url(x)", font: "a b" }, { from: 9, to: 2 }, "x"] }]) as TextEl[];
  assert.deepEqual(clean.runs, [{ from: 0, to: 5, weight: 700, color: "#14263d" }]);
  // A long word shrinks and is cut to the box, as plain text is.
  const long = setTextStyle({ ...base, w: 100, h: 48, auto: true, text: "x".repeat(15) }, { weight: 700 }, { from: 0, to: 2 });
  const lp = draw([long], m)[0];
  assert.ok(lp.kind === "text" && lp.rich);
  assert.ok(lp.size < 40);
  assert.ok(lp.rich[0].segs.reduce((w, q) => w + m(q.text, q.size, q.weight, q.font), 0) <= 100);
  assert.ok(lp.lines[0].endsWith("…"));
  // The default font on a part of a text in another font is said out loud.
  const def = setTextStyle({ ...base, font: "inter" }, { font: undefined }, { from: 0, to: 5 });
  assert.ok(/<tspan[^>]*font-family:KaiStudio[^>]*>kalın</.test(svgOf("kare", [def], m)));
  // Without runs nothing changes for plain text.
  const plain = draw([base], m)[0];
  assert.ok(plain.kind === "text" && !plain.rich);
});

