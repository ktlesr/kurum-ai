// Run: pnpm test. Görsel Stüdyo editable design: template → elements, drawing, boxes hugging text, project import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEls, draw, fromTemplate, hug, svgOf, type Design, type El, type Measure, type TextEl } from "./studio.ts";

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
