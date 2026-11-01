// Lays a document's sections out as slides: the content decides how many and what kind. Everything is measured, so text
// fits its box and what doesn't fit goes on to the next slide; nothing is cut and no picture holder is left empty. The
// look is the Zafer family's (public/slides/zafer.json), its colours and fonts, so themes apply as to any Zafer deck.
import { fitText, newId, type El, type Measure, type ShapeEl, type TextEl } from "./studio.ts";
import { DESIGNS, type DeckDesign } from "./deck-design.ts";
import type { Block, DeckPlan, SectionContent } from "./deck-doc.ts";

/** The design in force: composing is synchronous, and every helper below reads it. */
let D: DeckDesign = DESIGNS[0];
const L = 150, R = 1770, CW = R - L, TOP = 236, BOTTOM = 972, GAP = 28;

type Opts = { size: number; min?: number; weight?: number; color?: string; font?: string; leading?: number; align?: TextEl["align"]; lines?: number; tracking?: number; upper?: boolean; name?: string };

/** A shrink-to-fit text and how tall it really came out. */
function textEl(m: Measure, value: string, x: number, y: number, w: number, h: number, o: Opts): { el: TextEl; h: number; size: number } {
  const font = o.font ?? D.bodyFont, weight = o.weight ?? 400, leading = o.leading ?? 1.32;
  const fit = fitText(value, w, h, o.size, o.min ?? o.size * 0.7, o.lines ?? 40, weight, (t, s, wt) => m(t, s, wt, font), leading);
  const out = fit.lines.length * fit.size * leading;
  return {
    el: { id: newId(), kind: "text", name: o.name ?? "Metin", x, y, w, h: out, text: fit.lines.join("\n"), size: fit.size, weight, color: o.color ?? D.ink, align: o.align ?? "start", leading, tracking: o.tracking ?? 0, auto: false, font, ...(o.upper ? { upper: true } : {}) },
    h: out,
    size: fit.size,
  };
}
const box = (name: string, x: number, y: number, w: number, h: number, color: string, rest: Partial<ShapeEl> = {}): ShapeEl => ({ id: newId(), kind: "shape", name, x, y, w, h, fill: { kind: "solid", color }, ...rest });
const ring = (x: number, y: number, s: number, color: string, width: number, opacity = 1) => box("Halka", x, y, s, s, color, { shape: "ellipse", noFill: true, stroke: { color, width }, opacity });
const ground = (color?: string) => box("Zemin", 0, 0, 1920, 1080, color ?? D.bg, { locked: true });

/** Lines needed by a text at a size (for the column and table layouts, before anything is placed). */
const heightOf = (m: Measure, value: string, w: number, size: number, weight: number, font: string, leading: number) => {
  let n = 0;
  for (const para of value.split("\n")) {
    let line = "";
    n++;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && m(next, size, weight, font) > w) {
        n++;
        line = word;
      } else line = next;
    }
  }
  return n * size * leading;
};

/** Cards by the design: filled, outlined, or none at all (then the type and rules carry the page). */
const cardOpts = (): Partial<ShapeEl> => ({
  radius: D.radius,
  ...(D.card === "outline" ? { noFill: true, stroke: { color: D.surfaceAlt, width: 3 } } : {}),
  ...(D.card === "plain" ? { noFill: true } : {}),
});

/** Room kept beside the title and the source for the master's logos, footer and number. */
const TITLE_W = CW - 300, SOURCE_W = 800;

function contentSlide(m: Measure, title: string, eyebrow: string, source: string, body: El[]): El[] {
  const t = textEl(m, title, L, 92, TITLE_W, 104, { size: 58, min: 38, weight: 700, font: D.headFont, color: D.heading, leading: 1.1, lines: 2, name: "Başlık" });
  return [
    ground(),
    ...(D.rule === "left" ? [box("Sayfa çizgisi", 96, 70, 6, 910, D.accent)] : D.rule === "top" ? [box("Üst şerit", 0, 0, 1920, 14, D.accent)] : []),
    textEl(m, eyebrow, L, 54, TITLE_W, 34, { size: 24, min: 18, weight: 700, color: D.accent, tracking: 2, leading: 1.2, lines: 1, upper: true }).el,
    t.el,
    box("Çizgi", L, 208, CW, 2, D.heading),
    ...body,
    ...(source ? [textEl(m, `Kaynak: ${source}`, L, 1000, SOURCE_W, 34, { size: 22, min: 18, color: D.muted, leading: 1.2, lines: 1 }).el] : []),
  ];
}

type Page = { body: El[] };

/** Whether up to four points fit whole beside (or under) the opening's panel; if not they go on cards, which page. */
function fitsOpening(m: Measure, items: { head: string; text: string }[]) {
  if (D.opening === "none") return false;
  if (D.opening === "top") return items.every((i) => (i.head ? heightOf(m, i.head, (CW - 3 * GAP) / Math.max(items.length, 3) - 20, 36, 700, D.bodyFont, 1.16) + 10 : 0) + (i.text ? heightOf(m, i.text, (CW - 3 * GAP) / Math.max(items.length, 3) - 20, 22, 400, D.bodyFont, 1.36) : 0) <= 500);
  const w = 1920 - 690 - 110 - 110;
  const rh = (BOTTOM - 100) / Math.max(items.length, 3);
  return items.every((i) => (i.head ? heightOf(m, i.head, w, 40, 700, D.bodyFont, 1.16) + 10 : 0) + (i.text ? heightOf(m, i.text, w, 22, 400, D.bodyFont, 1.36) : 0) <= rh - 34);
}

/** A section's opening: its number and name on a panel, up to four points beside it or under it. */
function openingSlide(m: Measure, n: number, section: string, title: string, items: { head: string; text: string }[], source: string): El[] {
  const srcEl = (x: number, w: number) => (source ? [textEl(m, `Kaynak: ${source}`, x, 1000, w, 34, { size: 22, min: 18, color: D.muted, leading: 1.2, lines: 1 }).el] : []);
  const num = String(n).padStart(2, "0");
  if (D.opening === "top") {
    const cols = items.length, cw = (CW - (cols - 1) * 48) / cols;
    const body = items.flatMap((i, k) => {
      const x = L + k * (cw + 48);
      const head = i.head ? textEl(m, i.head, x, 500, cw, 170, { size: 40, min: 28, weight: 700, color: D.heading, leading: 1.16, name: "Başlık" }) : null;
      const top = 500 + (head ? head.h + 16 : 0);
      return [box("Vurgu", x, 470, 72, 7, D.accent), ...(head ? [head.el] : []), ...(i.text ? [textEl(m, i.text, x, top, cw, BOTTOM - top, { size: 32, min: 22, leading: 1.36 }).el] : [])];
    });
    return [
      ground(), box("Panel", 0, 0, 1920, 400, D.primary),
      textEl(m, num, L, 96, 300, 190, { size: 150, weight: 700, font: D.headFont, color: D.accent === D.primary ? D.onPrimary : D.accent, leading: 1.05, lines: 1 }).el,
      textEl(m, section, L + 300, 110, TITLE_W - 300, 180, { size: 66, min: 38, weight: 700, font: D.headFont, color: D.onPrimary, leading: 1.12, lines: 2, name: "Başlık" }).el,
      ...(title && title !== section ? [textEl(m, title, L + 300, 300, TITLE_W - 300, 70, { size: 28, min: 22, color: D.onPrimaryMuted, leading: 1.3, lines: 2 }).el] : []),
      ...body, ...srcEl(L, SOURCE_W),
    ];
  }
  const px = 620, x = px + 70, w = 1920 - x - 110;
  const top0 = 150;
  const rh = (BOTTOM - top0) / Math.max(items.length, 3);
  const body: El[] = items.flatMap((i, k) => {
    const y = top0 + k * rh;
    const no = textEl(m, String(k + 1).padStart(2, "0"), x, y + 6, 100, 70, { size: 54, weight: 700, font: D.headFont, color: D.accent, leading: 1.1, lines: 1 });
    const head = i.head ? textEl(m, i.head, x + 110, y + 8, w - 110, rh * 0.42, { size: 40, min: 28, weight: 700, color: D.heading, leading: 1.16, name: "Başlık" }) : null;
    const top = y + 8 + (head ? head.h + 10 : 0);
    return [no.el, ...(head ? [head.el] : []), ...(i.text ? [textEl(m, i.text, x + 110, top, w - 110, y + rh - 24 - top, { size: 32, min: 22, leading: 1.36 }).el] : []), ...(k < items.length - 1 ? [box("Çizgi", x, y + rh - 10, w, 1, D.heading, { opacity: 0.25 })] : [])];
  });
  return [
    ground(),
    box("Panel", 0, 0, px, 1080, D.primary),
    ring(-260, 560, 760, D.accent === D.primary ? D.onPrimary : D.accent, 3, 0.55), ring(-120, 700, 480, D.accent === D.primary ? D.onPrimary : D.accent, 6),
    textEl(m, num, 90, 90, 440, 190, { size: 150, weight: 700, font: D.headFont, color: D.accent === D.primary ? D.onPrimary : D.accent, leading: 1.05, lines: 1 }).el,
    textEl(m, section, 90, 290, 450, 420, { size: 62, min: 38, weight: 700, font: D.headFont, color: D.onPrimary, leading: 1.12, name: "Başlık" }).el,
    ...(title && title !== section ? [textEl(m, title, 90, 730, 450, 130, { size: 28, min: 22, color: D.onPrimaryMuted, leading: 1.3 }).el] : []),
    ...body, ...srcEl(x, SOURCE_W - 200),
  ];
}

function pointsPages(m: Measure, b: Extract<Block, { kind: "points" }>): Page[] {
  const per = b.items.length <= 3 ? 3 : b.items.length === 4 ? 4 : 6;
  const layoutOf = (n: number) => {
    const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
    return { cols, rows: Math.ceil(n / cols), cw: (CW - (cols - 1) * GAP) / cols };
  };
  // As many cards as fit whole at the smallest type: long points take fewer to a slide, none is cut.
  const fitsAll = (some: { head: string; text: string }[]) => {
    const { rows, cw } = layoutOf(some.length);
    const room = (BOTTOM - TOP - (rows - 1) * GAP) / rows;
    return some.every((i) => 96 + (i.head ? heightOf(m, i.head, cw - 72, 28, 700, D.bodyFont, 1.18) + 16 : 0) + (i.text ? heightOf(m, i.text, cw - 72, 22, 400, D.bodyFont, 1.38) : 0) <= room);
  };
  const pages: Page[] = [];
  for (let at = 0, n = per; at < b.items.length; at += n) {
    n = per;
    while (n > 1 && !fitsAll(b.items.slice(at, at + n))) n--;
    const items = b.items.slice(at, at + n);
    const cols = items.length === 1 ? 1 : items.length === 2 || items.length === 4 ? 2 : 3;
    const rows = Math.ceil(items.length / cols);
    const cw = (CW - (cols - 1) * GAP) / cols;
    // Cards are as tall as they need, so a short text doesn't float in an empty card; the row shares what is there.
    const pad = 36;
    const room = (BOTTOM - TOP - (rows - 1) * GAP) / rows;
    // The largest type at which all of it fits: a few short points fill the slide instead of floating in it.
    const need = (i: { head: string; text: string }, k: number) => pad * 2 + 24 + (i.head ? heightOf(m, i.head, cw - 2 * pad, 38 * k, 700, D.bodyFont, 1.18) + 16 : 0) + (i.text ? heightOf(m, i.text, cw - 2 * pad, 30 * k, 400, D.bodyFont, 1.38) : 0);
    const k = [1.5, 1.35, 1.2, 1.1].find((v) => items.every((i) => need(i, v) <= room)) ?? 1;
    const body: El[] = [];
    let y = TOP;
    for (let r = 0; r < rows; r++) {
      const row = items.slice(r * cols, (r + 1) * cols);
      const h = Math.min(room, Math.max(...row.map((i) => need(i, k) + 40), rows === 1 ? 420 : 260));
      row.forEach((i, c) => {
        const x = L + c * (cw + GAP);
        const dark = D.card === "solid" && rows === 1 && cols === 3 && c === 1;
        body.push(box("Kart", x, y, cw, h, dark ? D.primary : D.surface, cardOpts()), box("Vurgu", x + pad, y + pad, 72, 7, D.accent));
        let ty = y + pad + 24;
        if (i.head) {
          const t = textEl(m, i.head, x + pad, ty, cw - 2 * pad, h * 0.4, { size: 38 * k, min: 28, weight: 700, color: dark ? D.onPrimary : D.heading, leading: 1.18, name: "Başlık" });
          body.push(t.el);
          ty += t.h + 16;
        }
        if (i.text) body.push(textEl(m, i.text, x + pad, ty, cw - 2 * pad, y + h - pad - ty, { size: 30 * k, min: 22, color: dark ? D.onPrimaryMuted : D.ink, leading: 1.38 }).el);
      });
      y += h + GAP;
    }
    pages.push({ body });
  }
  return pages;
}

function figuresPages(m: Measure, b: Extract<Block, { kind: "figures" }>): Page[] {
  const pages: Page[] = [];
  for (let at = 0; at < b.items.length; at += 6) {
    const items = b.items.slice(at, at + 6);
    const cols = items.length === 4 ? 2 : Math.min(3, items.length);
    const rows = Math.ceil(items.length / cols);
    const cw = (CW - (cols - 1) * GAP) / cols;
    const ch = Math.min(rows === 1 ? 480 : 1000, (BOTTOM - TOP - (rows - 1) * GAP) / rows);
    const body: El[] = [];
    items.forEach((i, k) => {
      const x = L + (k % cols) * (cw + GAP), y = TOP + Math.floor(k / cols) * (ch + GAP);
      const dark = D.card === "solid" && k % (cols + 1) === 0;
      const v = textEl(m, i.value, x + 36, y + 34, cw - 72, ch * 0.42, { size: rows === 1 ? 104 : 84, min: 44, weight: 700, font: D.headFont, color: dark ? D.onPrimary : D.accent, leading: 1.08, lines: 2 });
      body.push(box("Kart", x, y, cw, ch, dark ? D.primary : D.surface, cardOpts()), v.el);
      if (i.label) body.push(textEl(m, i.label, x + 36, y + 34 + v.h + 18, cw - 72, ch - v.h - 90, { size: 32, min: 22, color: dark ? D.onPrimaryMuted : D.ink, leading: 1.36 }).el);
    });
    pages.push({ body });
  }
  return pages;
}

function tablePages(m: Measure, b: Extract<Block, { kind: "table" }>): Page[] {
  const pad = 16, leading = 1.3;
  // A short table reads large; a long one stays dense and pages.
  const size = b.rows.length <= 6 ? 34 : b.rows.length <= 10 ? 30 : 26;
  const lengths = b.columns.map((c, i) => Math.max(c.length, ...b.rows.map((r) => (r[i] ?? "").length)) ** 0.7 + 6);
  const sum = lengths.reduce((a, v) => a + v, 0);
  const widths = lengths.map((v) => (v / sum) * CW);
  const rowH = (cells: string[], weight: number) => Math.max(...cells.map((c, i) => heightOf(m, c || " ", widths[i] - 2 * pad, size, weight, D.bodyFont, leading))) + 2 * pad;
  const headH = rowH(b.columns, 700);
  const cells = (cs: string[], y: number, color: string, weight: number, room = 1000) => {
    let x = L;
    return cs.map((c, i) => {
      const el = textEl(m, c || " ", x + pad, y + pad, widths[i] - 2 * pad, room, { size, min: Math.min(size, 18), weight, color, leading }).el;
      x += widths[i];
      return el;
    });
  };
  const pages: Page[] = [];
  let body: El[] = [], y = TOP, n = 0;
  const start = () => {
    body = [box("Tablo başlığı", L, TOP, CW, headH, D.primary), ...cells(b.columns, TOP, D.onPrimary, 700)];
    y = TOP + headH;
    n = 0;
  };
  start();
  for (const r of b.rows) {
    const h = Math.min(rowH(r, 400), BOTTOM - TOP - headH); // a row taller than a slide shrinks its type to fit
    if (y + h > BOTTOM && n) {
      pages.push({ body });
      start();
    }
    body.push(box("Satır", L, y, CW, h, n % 2 ? D.surfaceAlt : D.surface), ...cells(r, y, D.ink, 400, h - 2 * pad));
    y += h;
    n++;
  }
  pages.push({ body });
  return pages;
}

function groupsPages(m: Measure, b: Extract<Block, { kind: "groups" }>): Page[] {
  const join = (items: string[]) => items.join(" · ");
  // A few groups: a card each, with a count, when all of them fit at a readable size.
  if (b.groups.length <= 6) {
    const cols = b.groups.length <= 2 ? b.groups.length : 3;
    const rows = Math.ceil(b.groups.length / cols);
    const cw = (CW - (cols - 1) * GAP) / cols;
    const ch = (BOTTOM - TOP - (rows - 1) * GAP) / rows;
    const fits = (size: number) => b.groups.every((g) => heightOf(m, join(g.items), cw - 64, size, 400, D.bodyFont, 1.36) <= ch - 130);
    if (fits(24)) {
      const size = [34, 32, 30, 28, 26, 24].find(fits) ?? 24;
      const body: El[] = [];
      b.groups.forEach((g, k) => {
        const x = L + (k % cols) * (cw + GAP), y = TOP + Math.floor(k / cols) * (ch + GAP);
        const dark = D.card === "solid" && k === 0 && b.groups.length > 1; // the first of several stands out; a single list just reads
        body.push(box("Kart", x, y, cw, ch, dark ? D.primary : D.surface, cardOpts()));
        body.push(textEl(m, g.name, x + 32, y + 26, cw - 150, 60, { size: 38, min: 26, weight: 700, font: D.headFont, color: dark ? D.onPrimary : D.heading, leading: 1.15, lines: 1, name: "Başlık" }).el);
        body.push(textEl(m, String(g.items.length), x + cw - 112, y + 26, 80, 50, { size: 38, min: 26, weight: 700, color: D.accent, align: "end", leading: 1.15, lines: 1 }).el);
        body.push(box("Çizgi", x + 32, y + 88, cw - 64, 2, dark ? D.accent : D.surfaceAlt));
        body.push(textEl(m, join(g.items), x + 32, y + 106, cw - 64, ch - 124, { size, min: 22, color: dark ? D.onPrimaryMuted : D.ink, leading: 1.36 }).el);
      });
      return [{ body }];
    }
  }
  // Many or long: running columns, as in an index; a group too long for one column goes on in the next.
  const cols = 3, cw = (CW - (cols - 1) * 40) / cols;
  // Room is reckoned as if a little narrower: fonts aren't embedded in PPTX, and a wider stand-in must not run into the next entry.
  const roomW = cw * 0.88;
  const size = 24, nameSize = 26, nameH = nameSize * 1.2, leading = 1.34;
  const pages: Page[] = [];
  let body: El[] = [], c = 0, y = TOP;
  const next = () => {
    c++;
    y = TOP;
    if (c === cols) {
      pages.push({ body });
      body = [];
      c = 0;
    }
  };
  for (const g of b.groups) {
    const x0 = () => L + c * (cw + 40);
    if (g.name) {
      // A name doesn't stay alone at a column's foot.
      if (y + nameH + size * leading * 2 > BOTTOM) next();
      body.push(textEl(m, g.name, x0(), y, cw, nameH * 2, { size: nameSize, min: 22, weight: 700, color: D.heading, leading: 1.2, lines: 1, name: "Başlık" }).el);
      y += nameH + 2;
    }
    let rest = [...g.items];
    while (rest.length) {
      const room = BOTTOM - y;
      let n = rest.length;
      while (n > 1 && heightOf(m, join(rest.slice(0, n)), roomW, size, 400, D.bodyFont, leading) > room) n--;
      if (heightOf(m, join(rest.slice(0, n)), roomW, size, 400, D.bodyFont, leading) > room) {
        next();
        continue;
      }
      const t = textEl(m, join(rest.slice(0, n)), x0(), y, cw, room, { size, min: size, leading });
      body.push(t.el);
      y += Math.max(t.h, heightOf(m, join(rest.slice(0, n)), roomW, size, 400, D.bodyFont, leading));
      rest = rest.slice(n);
      if (rest.length) next();
    }
    y += 22;
  }
  if (body.length) pages.push({ body });
  return pages;
}

const pagesOf = (m: Measure, b: Block) =>
  b.kind === "points" ? pointsPages(m, b) : b.kind === "figures" ? figuresPages(m, b) : b.kind === "table" ? tablePages(m, b) : groupsPages(m, b);

function cover(m: Measure, plan: DeckPlan, docName: string): El[] {
  const dark = D.cover === "panel";
  const titleColor = dark ? D.onPrimary : D.heading;
  const text = (x: number, y: number, w: number): El[] => {
    const t = textEl(m, plan.title, x, y, w, 400, { size: 96, min: 56, weight: 700, font: D.headFont, color: titleColor, leading: 1.08, name: "Başlık" });
    return [
      t.el,
      ...(plan.subtitle ? [textEl(m, plan.subtitle, x, y + t.h + 34, w - 30, 200, { size: 36, min: 26, color: dark ? D.onPrimaryMuted : D.ink }).el] : []),
      ...(docName ? [textEl(m, docName, x, 910, w, 50, { size: 26, min: 20, weight: 600, color: dark ? D.onPrimary : D.heading, leading: 1.2, lines: 1 }).el] : []),
    ];
  };
  if (D.cover === "panel") return [ground(), box("Panel", 0, 0, 1240, 1080, D.primary), box("Şerit", 1240, 0, 24, 1080, D.accent), ...text(120, 280, 1000)];
  if (D.cover === "band") return [ground(), box("Bant", 0, 620, 1920, 460, D.primary), box("Şerit", 0, 606, 1920, 14, D.accent), ...text(120, 150, 1500).map((e) => (e.y >= 900 ? { ...e, color: D.onPrimary } : e))];
  if (D.cover === "grid") {
    const cell = 220;
    const tiles = Array.from({ length: 12 }, (_, i) => box("Karo", 1000 + (i % 4) * cell, 100 + Math.floor(i / 4) * cell * 1.0 + 80, cell - 14, cell - 14, [D.primary, D.accent, D.surfaceAlt, D.surfaceAlt, D.primary][(i * 3 + Math.floor(i / 4)) % 5], { radius: D.radius }));
    return [ground(), ...tiles, ...text(120, 300, 830)];
  }
  return [
    ground(),
    ring(1120, -40, 1000, D.accent, 3, 0.45), ring(1240, 80, 760, D.accent, 6),
    box("Odak", 1370, 210, 500, 500, D.primary, { shape: "ellipse" }), box("Nokta", 1570, 410, 100, 100, D.accent, { shape: "ellipse" }),
    box("Sayfa çizgisi", 96, 96, 6, 888, D.accent),
    box("Çizgi", L, 890, 960, 2, D.heading),
    ...text(L, 300, 960),
  ];
}

function agenda(m: Measure, titles: string[]): El[][] {
  const per = 12;
  const out: El[][] = [];
  for (let at = 0; at < titles.length; at += per) {
    const some = titles.slice(at, at + per);
    const half = Math.ceil(some.length / 2);
    const rh = (BOTTOM - TOP) / Math.max(half, 4);
    const body = some.flatMap((t, i) => {
      const col = i < half ? 0 : 1, row = col ? i - half : i, x = L + col * (CW / 2 + 20), y = TOP + row * rh, w = CW / 2 - 20;
      return [
        textEl(m, String(at + i + 1).padStart(2, "0"), x, y + 8, 100, 80, { size: 56, weight: 700, font: D.headFont, color: D.accent, leading: 1.1, lines: 1 }).el,
        textEl(m, t, x + 110, y + 14, w - 110, rh - 30, { size: 36, min: 26, weight: 600, color: D.heading, leading: 1.18, lines: 2, name: "Başlık" }).el,
        box("Çizgi", x, y + rh - 12, w, 1, D.heading, { opacity: 0.25 }),
      ];
    });
    out.push(contentSlide(m, "Gündem", titles.length > per ? `Gündem ${Math.floor(at / per) + 1}` : "İçindekiler", "", body));
  }
  return out;
}

function closing(m: Measure, docName: string): El[] {
  const dark = D.cover === "panel" || D.cover === "band";
  return [
    dark ? ground(D.primary) : ground(),
    ring(460, 40, 1000, D.accent === D.primary ? D.onPrimary : D.accent, 3, 0.4), ring(520, 100, 880, D.accent === D.primary ? D.onPrimary : D.accent, 6),
    textEl(m, "Teşekkürler", 360, 400, 1200, 170, { size: 112, weight: 700, font: D.headFont, color: dark ? D.onPrimary : D.heading, align: "middle", leading: 1.1, lines: 1, name: "Başlık" }).el,
    ...(docName ? [textEl(m, `Kaynak: ${docName}`, 460, 590, 1000, 110, { size: 30, min: 22, align: "middle", color: dark ? D.onPrimaryMuted : D.ink }).el] : []),
  ];
}

const sameList = (a: Extract<Block, { kind: "groups" }>, b: Extract<Block, { kind: "groups" }>) => {
  const key = (g: Extract<Block, { kind: "groups" }>) => g.groups.map((x) => x.items.join("|")).sort().join("#");
  return key(a) === key(b);
};

/** The same list asked for twice (regions, then the regions' provinces): shown once, under the section that names it most closely. */
export function dropRepeats(sections: SectionContent[]): SectionContent[] {
  const out: (SectionContent & { merged?: boolean })[] = sections.map((s) => ({ ...s, blocks: [...s.blocks] }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      for (const b of out[j].blocks) {
        if (b.kind !== "groups") continue;
        const k = out[i].blocks.findIndex((x) => x.kind === "groups" && sameList(x, b));
        if (k < 0) continue;
        if (out[i].blocks.length > 1) out[i].blocks.splice(k, 1); // the earlier section has something else to say
        else {
          out[j].blocks = out[j].blocks.filter((x) => x !== b);
          // Nothing else in the later one: both were asked for, so the one slide answers to both names.
          if (!out[j].blocks.length) {
            out[i].title = `${out[i].title} ve ${out[j].title}`;
            out[j].merged = true;
          }
        }
      }
    }
  }
  return out;
}

const MAX_DECK = 100;

/** The deck, and the sections the document had nothing on (said to the user, not left as an empty slide). */
export function composeDeck(plan: DeckPlan, sections: SectionContent[], docName: string, m: Measure, design: DeckDesign = DESIGNS[0]): { slides: El[][]; missing: string[]; left: string[] } {
  D = design;
  const kept = dropRepeats(sections);
  const missing = (kept as (SectionContent & { merged?: boolean })[]).filter((s) => !s.blocks.length && !s.merged).map((s) => s.title);
  const shown = kept.filter((s) => s.blocks.length);
  const slides: El[][] = [cover(m, plan, docName), ...agenda(m, shown.map((s) => s.title))];
  const left: string[] = [];
  shown.forEach((s, i) => {
    if (slides.length >= MAX_DECK - 1) return void left.push(s.title);
    const eyebrow = `${String(i + 1).padStart(2, "0")} · ${s.title}`;
    for (const [bi, b] of s.blocks.entries()) {
      // A section opens with its dark panel when its first thing is a few points.
      if (bi === 0 && b.kind === "points" && b.items.length <= 4 && fitsOpening(m, b.items)) {
        slides.push(openingSlide(m, i + 1, s.title, b.title, b.items, [docName, s.source].filter(Boolean).join(", ")));
        continue;
      }
      const pages = pagesOf(m, b);
      pages.forEach((p, k) => {
        if (slides.length >= MAX_DECK - 1) {
          if (!left.includes(s.title)) left.push(s.title);
          return;
        }
        const title = (b.title && b.title !== s.title ? b.title : s.title) + (pages.length > 1 ? ` (${k + 1}/${pages.length})` : "");
        slides.push(contentSlide(m, title, eyebrow, [docName, s.source].filter(Boolean).join(", "), p.body));
      });
    }
  });
  return { slides: [...slides, closing(m, docName)], missing, left };
}

/** What a design looks like before there is a deck: the same short sample on all of them, so they can be compared. */
export const SAMPLE_DECK: { plan: DeckPlan; sections: SectionContent[] } = {
  plan: { title: "Bölgesel Kalkınma Programı", subtitle: "2026 yılı hedefleri, öncelikler ve yol haritası", sections: [] },
  sections: [
    { title: "Öncelikler", source: "", dropped: [], blocks: [{ kind: "points", title: "Program başlıkları", items: [{ head: "Üretimde verimlilik", text: "Sanayide kaynak kullanımını iyileştiren yatırımlar desteklenir." }, { head: "Nitelikli istihdam", text: "Gençlerin ve kadınların işgücüne katılımı artırılır." }, { head: "Dijital dönüşüm", text: "İşletmelerin yeni teknolojilere geçişi hızlandırılır." }] }] },
    { title: "Sonuçlar", source: "", dropped: [], blocks: [{ kind: "figures", title: "Bir bakışta", items: [{ value: "%42", label: "Başvurulardaki artış" }, { value: "1.250", label: "Desteklenen işletme" }, { value: "18", label: "Yeni proje" }] }, { kind: "table", title: "Bölgelere göre", columns: ["Bölge", "Proje", "Destek oranı"], rows: [["1. Bölge", "24", "%15"], ["2. Bölge", "31", "%20"], ["3. Bölge", "42", "%30"]] }] },
  ],
};
