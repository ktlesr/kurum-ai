// Run: pnpm test. Görsel Stüdyo layers → SVG, text fitting, the model's suggestion parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMATS, SHAPES, TEMPLATES, cleanEls, fitText, fromTemplate, refit, shapeFrom, svgOf, inkOn, layout, rasterSize, parseFill, safeColor, safePicture, toSvg, type Design, type Measure } from "./studio.ts";

// Monospace stand-in for canvas measureText: every character is 0.55 em.
const measure: Measure = (t, size) => t.length * size * 0.55;
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const design = (over: Partial<Design> = {}): Design => ({
  template: "duyuru",
  format: "kare",
  content: { tag: "Duyuru", title: "Yeni hizmet binamız açıldı", subtitle: "Tüm birimlerimiz artık tek adreste.", detail: "1 Kasım 2026 · Ankara" },
  brand: { primary: "#14263d", accent: "#2e5e8c" },
  ...over,
});

test("fitText: wraps, shrinks, then cuts with …", () => {
  const a = fitText("kısa", 1000, 200, 100, 40, 2, 700, measure);
  assert.deepEqual(a, { size: 100, lines: ["kısa"] });
  const b = fitText("bir iki üç dört beş altı yedi sekiz", 300, 1000, 60, 20, 3, 700, measure);
  assert.ok(b.lines.length <= 3 && b.lines.every((l) => measure(l, b.size, 700) <= 300), JSON.stringify(b));
  const c = fitText("kelime ".repeat(200), 300, 100, 40, 20, 2, 700, measure);
  assert.ok(c.lines.length <= 2 && c.lines.at(-1)!.endsWith("…"), JSON.stringify(c));
  assert.ok(c.lines.every((l) => measure(l, c.size, 700) <= 300));
  const d = fitText("x".repeat(500), 300, 100, 40, 20, 2, 700, measure); // one word wider than the box
  assert.ok(d.lines.every((l) => measure(l, d.size, 700) <= 300), JSON.stringify(d));
  assert.deepEqual(fitText("satır bir\nsatır iki", 1000, 500, 50, 20, 3, 400, measure).lines, ["satır bir", "satır iki"]);
});

test("toSvg: every template and format renders, size and text are right", () => {
  for (const template of Object.keys(TEMPLATES) as Design["template"][]) {
    for (const format of Object.keys(FORMATS) as Design["format"][]) {
      const svg = toSvg(design({ template, format, photo: { src: PNG, w: 400, h: 300 }, brand: { primary: "#14263d", accent: "#c8102e", logo: { src: PNG, w: 200, h: 100 } } }), measure);
      const { w, h } = FORMATS[format];
      assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`), `${template}/${format}`);
      assert.ok(svg.includes("Yeni hizmet") || svg.includes("Yeni"), `${template}/${format} title`);
      assert.ok(!/NaN|undefined/.test(svg), `${template}/${format}: ${svg.match(/.{40}(NaN|undefined).{20}/)?.[0]}`);
    }
  }
});

test("toSvg: text is escaped, tag uppercased the Turkish way", () => {
  const svg = toSvg(design({ content: { tag: "bilgi", title: `<script>alert(1)</script> & "x"`, subtitle: "", detail: "" } }), measure);
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;") && svg.includes("&amp;") && svg.includes("&quot;"));
  assert.ok(svg.includes(">BİLGİ<"), "i → İ");
});

test("toSvg: only data: images, only #rrggbb colours reach the SVG", () => {
  const svg = toSvg(
    design({
      brand: { primary: `red" onload="x`, accent: "#ABCDEF", logo: { src: "https://evil.example/x.png", w: 10, h: 10 } },
      photo: { src: `data:image/png;base64,AAA" onload="x`, w: 10, h: 10 },
    }),
    measure,
  );
  assert.ok(!svg.includes("evil.example") && !svg.includes("onload"));
  assert.ok(svg.includes("#abcdef") && svg.includes("#14263d"), "invalid primary falls back");
  assert.equal(safeColor("#12345", "#000000"), "#000000");
  assert.equal(safePicture({ src: "data:image/svg+xml;base64,PHN2Zz4=", w: 0, h: 5 }), undefined);
  assert.ok(safePicture({ src: "data:image/svg+xml;base64,PHN2Zz4=", w: 5, h: 5 }));
});

test("toSvg: the logo keeps its aspect ratio and is never cropped", () => {
  const svg = toSvg(design({ brand: { primary: "#14263d", accent: "#2e5e8c", logo: { src: PNG, w: 300, h: 100 } } }), measure);
  const m = svg.match(/<image href="data:image\/png[^"]*" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" preserveAspectRatio="xMidYMid meet"\/>/);
  assert.ok(m, "logo without clip-path");
  assert.ok(Math.abs(Number(m![3]) / Number(m![4]) - 3) < 0.05, `${m![3]}x${m![4]}`);
});

test("inkOn: readable text colour on light and dark backgrounds", () => {
  assert.equal(inkOn("#ffffff"), "#14263d");
  assert.equal(inkOn("#14263d"), "#ffffff");
  assert.equal(inkOn("#f2c200"), "#14263d");
});

test("parseFill: JSON in the answer → capped Content; junk → null", () => {
  const c = parseFill('Tabii:\n```json\n{"etiket":"DUYURU","baslik":"\\"Yeni bina\\"","altBaslik":"Açıklama","detay":""}\n```');
  assert.deepEqual(c, { tag: "DUYURU", title: "Yeni bina", subtitle: "Açıklama", detail: "" });
  assert.equal(parseFill("JSON yok"), null);
  assert.equal(parseFill('{"baslik": 5}'), null);
  assert.equal(parseFill('{"baslik":"x", bozuk}'), null);
  const long = parseFill(JSON.stringify({ baslik: "a ".repeat(300), altBaslik: "b\u0000c\nd", etiket: ["x"] }))!;
  assert.ok(long.title.length <= 90 && long.subtitle === "b c d" && long.tag === "");
});

test("layout: with the longest texts no two text blocks overlap and all stay on the canvas", () => {
  const long = { tag: "Duyuru metni", title: "Uzun ".repeat(30), subtitle: "Açıklama ".repeat(40), detail: "Tarih ".repeat(20) };
  for (const template of Object.keys(TEMPLATES) as Design["template"][]) {
    for (const format of Object.keys(FORMATS) as Design["format"][]) {
      const { w, h } = FORMATS[format];
      const logo = { src: PNG, w: 300, h: 100 };
      const texts = layout(design({ template, format, content: long, photo: { src: PNG, w: 4, h: 3 }, brand: { primary: "#14263d", accent: "#2e5e8c", logo } }), measure)
        .filter((l) => l.kind === "text" && l.lines[0] !== "“")
        .map((l) => (l.kind === "text" ? { top: l.y, bottom: l.y + l.lines.length * l.size * l.leading, l } : null)!);
      for (const t of texts) assert.ok(t.top >= 0 && t.bottom <= h + 1 && t.l.x >= 0 && t.l.x < w, `${template}/${format} off canvas`);
      const sorted = texts.sort((a, b) => a.top - b.top);
      for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].top >= sorted[i - 1].bottom - 1, `${template}/${format}: "${sorted[i - 1].l.lines[0]}" overlaps "${sorted[i].l.lines[0]}"`);
    }
  }
});

test("layout: default texts with photo and logo stay inside the square (regression)", () => {
  const sample = { tag: "Duyuru", title: "Yeni hizmet binamız hizmetinizde", subtitle: "Tüm birimlerimiz 1 Kasım itibarıyla tek adreste hizmet veriyor.", detail: "1 Kasım 2026 · Merkez Bina" };
  for (const format of Object.keys(FORMATS) as Design["format"][]) {
    const { h } = FORMATS[format];
    const ls = layout(design({ format, content: sample, photo: { src: PNG, w: 4, h: 3 }, brand: { primary: "#14263d", accent: "#2e5e8c", logo: { src: PNG, w: 300, h: 100 } } }), measure);
    for (const l of ls) {
      const bottom = l.kind === "text" ? l.y + l.lines.length * l.size * l.leading : l.y + l.h;
      assert.ok(bottom <= h + 0.5, `${format}: ${l.kind} ends at ${bottom.toFixed(1)} > ${h}`);
    }
  }
});

test("layout: a long title shrinks instead of pushing out the description and the date", () => {
  const c = { tag: "Duyuru", title: "Şehrimizin geleceği için İŞBİRLİĞİ: ğüşıöç ĞÜŞİÖÇ", subtitle: "Tüm birimlerimiz tek adreste.", detail: "1 Kasım 2026" };
  const ls = layout(design({ content: c, photo: { src: PNG, w: 4, h: 3 }, brand: { primary: "#14263d", accent: "#2e5e8c", logo: { src: PNG, w: 300, h: 100 } } }), measure);
  const shown = ls.flatMap((l) => (l.kind === "text" ? l.lines : [])).join(" ");
  assert.ok(shown.includes("Tüm birimlerimiz") && shown.includes("1 Kasım 2026"), shown);
});

test("layout: a long title and a two-line date still leave the description its line", () => {
  const c = { tag: "Duyuru", title: "Çok uzun bir başlık ".repeat(6), subtitle: "Açıklama satırı burada", detail: "Tarih ve yer bilgisi ".repeat(6) };
  for (const format of Object.keys(FORMATS) as Design["format"][]) {
    const ls = layout(design({ format, content: c, photo: { src: PNG, w: 4, h: 3 }, brand: { primary: "#14263d", accent: "#2e5e8c", logo: { src: PNG, w: 300, h: 100 } } }), measure);
    const shown = ls.flatMap((l) => (l.kind === "text" ? l.lines : [])).join(" ");
    assert.ok(shown.includes("Açıklama"), `${format}: ${shown.slice(0, 120)}`);
  }
});

test("rasterSize: PNG, JPEG and WebP headers, before any decoding", () => {
  const be32 = (v: number) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(40000), ...be32(30000)]);
  assert.deepEqual(rasterSize(png), { w: 40000, h: 30000 });
  // SOI, APP0 (16 bytes), then SOF2 (progressive) with height 1200, width 1600
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc2, 0, 17, 8, 0x04, 0xb0, 0x06, 0x40, 3, 0, 0, 0, 0]);
  assert.deepEqual(rasterSize(jpg), { w: 1600, h: 1200 });
  const riff = (kind: string, body: number[]) => new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP" + kind].map((c) => c.charCodeAt(0)), [0, 0, 0, 0], body, new Array(8).fill(0)));
  assert.deepEqual(rasterSize(riff("VP8X", [0, 0, 0, 0, ...[0x2b, 0x01, 0], ...[199, 0, 0]])), { w: 300, h: 200 });
  assert.deepEqual(rasterSize(riff("VP8L", [0x2f, 0x2b, 0xc1, 49, 0])), { w: 300, h: 200 });
  assert.equal(rasterSize(new Uint8Array([1, 2, 3])), null);
  assert.equal(rasterSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, ...new Array(10).fill(0)])), null);
});

test("rasterSize: VP8 and hostile headers end without reading past the buffer", () => {
  const vp8 = new Uint8Array(40);
  vp8.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  vp8.set([..."WEBPVP8 "].map((c) => c.charCodeAt(0)), 8);
  vp8.set([0x2c, 0x01, 0xc8, 0x00], 26); // 300 x 200
  assert.deepEqual(rasterSize(vp8), { w: 300, h: 200 });
  assert.equal(rasterSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10])), null); // truncated PNG
  assert.equal(rasterSize(new Uint8Array([0xff, 0xd8, ...new Array(64).fill(0xff)])), null); // only fill bytes
  assert.equal(rasterSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, ...new Array(40).fill(0)])), null); // zero length
  assert.equal(rasterSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, ...new Array(40).fill(0)])), null); // past the end
});

test("refit: an edited design keeps its edits in another format", () => {
  const els = fromTemplate(design(), measure).map((e) => (e.kind === "text" && e.role === "title" ? { ...e, text: "Elle yazıldı", size: 90 } : e));
  for (const to of ["dikey", "hikaye", "yatay"] as const) {
    const out = refit(els, "kare", to);
    const { w, h } = FORMATS[to];
    assert.equal(out.length, els.length);
    const bg = out.find((e) => e.name === "Arka plan")!;
    assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [0, 0, w, h], `${to}: background spans the canvas`);
    const title = out.find((e) => e.kind === "text" && e.role === "title");
    assert.ok(title?.kind === "text" && title.text === "Elle yazıldı" && title.size === 90 * Math.min(w / 1080, h / 1080));
    for (const e of out) assert.ok(e.x >= -1 && e.y >= -1 && e.x + e.w <= w + 1 && e.y + e.h <= h + 1, `${to}: ${e.name} inside`);
  }
  assert.equal(refit(els, "kare", "kare"), els);
});

test("shapes: every library shape draws, round-trips through cleanEls, and rotation/flip/shadow reach the SVG", () => {
  for (const id of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
    const e = { ...shapeFrom(id, 540, 540, 400, "#2e5e8c"), rotation: 30, flipX: true, shadow: { color: "#000000", blur: 20, x: 0, y: 8, opacity: 0.3 } };
    const svg = svgOf("kare", [e], measure);
    assert.ok(!/NaN|undefined/.test(svg), `${id}: ${svg}`);
    assert.match(svg, /transform="rotate\(30 540 540\) translate\(540 540\) scale\(-1 1\) translate\(-540 -540\)"/, id);
    assert.match(svg, /filterUnits="userSpaceOnUse"/, id);
    assert.match(svg, /<feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.3"\/>/, id);
    const [back] = cleanEls(JSON.parse(JSON.stringify([e])));
    assert.deepEqual(back, { ...e, locked: false, opacity: 1, radius: e.radius ?? 0 }, id);
  }
  // a line is drawn by its outline, with a filled head at the end
  const arrow = svgOf("kare", [shapeFrom("arrowLine", 540, 540, 400, "#ff0000")], measure);
  assert.match(arrow, /<polyline [^>]*fill="none" stroke="#ff0000"/);
  assert.match(arrow, /<polygon [^>]*fill="#ff0000"/);
  // text never mirrors; italic and underline are attributes
  const t = cleanEls([{ kind: "text", text: "a", x: 0, y: 0, w: 100, h: 40, size: 30, flipX: true, italic: true, underline: true }])[0];
  assert.ok(t.kind === "text" && !t.flipX && t.italic && t.underline);
  assert.match(svgOf("kare", [t], measure), /font-style="italic" text-decoration="underline"/);
  // hostile input: a polygon needs 3 points in 0–1, colours stay #rrggbb
  assert.equal(cleanEls([{ kind: "shape", shape: "poly", points: [[0, 0], [1, 1]], fill: { kind: "solid", color: "#000000" } }]).length, 0);
  const odd = cleanEls([{ kind: "shape", shape: "poly", points: [[-5, 0], [9, 1], [0.5, "x"], [0.5, 0.5]], stroke: { color: "red;x", width: 1e9 }, shadow: { color: "url(#x)" }, fill: { kind: "solid", color: "#000000" } }])[0];
  assert.ok(odd.kind === "shape" && odd.points?.length === 3 && odd.points[0][0] === 0 && odd.points[1][0] === 1 && odd.stroke?.color === "#14263d" && odd.stroke.width === 200 && odd.shadow?.color === "#000000");
});

test("shapes: a dotted line is valid SVG (one linecap); refit scales outline and shadow", () => {
  const l = { ...shapeFrom("line", 540, 540, 400, "#000000"), stroke: { color: "#000000", width: 10, dash: "dot" as const }, shadow: { color: "#000000", blur: 20, x: 4, y: 8, opacity: 0.3 } };
  const svg = svgOf("kare", [l], measure);
  for (const tag of svg.match(/<[a-z]+ [^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/ ([a-z-]+)=/g)].map((m) => m[1]);
    assert.equal(new Set(names).size, names.length, tag);
  }
  const [r] = refit([l], "yatay", "kare") as (typeof l)[];
  assert.ok(r.stroke.width === 10 * 0.5625 && r.shadow.blur === 20 * 0.5625 && r.shadow.y === 8 * 0.5625);
});
