// Görsel Stüdyo (plan §6.1): a template is a function from canvas size, content and brand to positioned layers; the
// layers become one SVG string, which is both the preview and every export (the browser rasterises it for PNG/JPEG/
// WebP). The model only suggests text (parseFill); drawing is deterministic. Pure: runs in the browser and node --test.

export const FORMATS = {
  kare: { w: 1080, h: 1080, label: "Kare", hint: "1:1 · gönderi" },
  dikey: { w: 1080, h: 1350, label: "Dikey", hint: "4:5 · gönderi" },
  hikaye: { w: 1080, h: 1920, label: "Hikâye", hint: "9:16 · story, Reels kapağı" },
  yatay: { w: 1920, h: 1080, label: "Yatay", hint: "16:9 · sunum, web" },
} as const;
export type FormatId = keyof typeof FORMATS;

export const TEMPLATES = {
  duyuru: { label: "Duyuru", hint: "Başlık, açıklama ve tarih/yer" },
  etkinlik: { label: "Etkinlik", hint: "Tam sayfa fotoğraf üzerinde metin" },
  bilgi: { label: "Bilgi / rakam", hint: "Öne çıkan rakam ya da kısa mesaj" },
  alinti: { label: "Alıntı", hint: "Söz ve söyleyen" },
} as const;
export type TemplateId = keyof typeof TEMPLATES;

/** Field caps: the model's suggestion is cut to these, and the inputs use them as maxLength. */
export const LIMITS = { tag: 24, title: 90, subtitle: 180, detail: 90 } as const;

export interface Content { tag: string; title: string; subtitle: string; detail: string }
/** An image the user chose, as a data: URL with its pixel size (the size keeps the aspect ratio exact). */
export interface Picture { src: string; w: number; h: number }
export interface Brand { primary: string; accent: string; logo?: Picture }
export interface Design { template: TemplateId; format: FormatId; content: Content; brand: Brand; photo?: Picture }

export const DEFAULT_BRAND: Brand = { primary: "#14263d", accent: "#2e5e8c" };

/** Width of `text` at `size` px and `weight`; the browser passes canvas measureText with the embedded font. */
export type Measure = (text: string, size: number, weight: number, font?: string) => number;

type Box = { x: number; y: number; w: number; h: number };
type Layer =
  | (Box & { kind: "rect"; fill: string; radius?: number })
  | (Box & { kind: "fade"; color: string; from: number; to: number })
  | (Box & { kind: "gradient"; a: string; b: string })
  | (Box & { kind: "image"; pic: Picture; fit: "cover" | "contain"; logo?: boolean })
  | {
      kind: "text"; x: number; y: number; w: number; size: number; lines: string[]; weight: number; color: string; leading: number; tracking?: number;
      /** Which content field it shows ("deco": the quote mark); `bg`: a pill behind it (the tag), the box's height. */
      role?: Role; bg?: { fill: string; h: number };
    };
export type Role = "tag" | "title" | "subtitle" | "detail" | "deco";
export type { Layer };

const HEX = /^#[0-9a-f]{6}$/i;
/** Colours come from a colour input or local storage: anything else falls back rather than reaching the SVG. */
export const safeColor = (c: unknown, fallback: string) => (typeof c === "string" && HEX.test(c) ? c.toLowerCase() : fallback);
const IMG = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
const dim = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100_000;
export const safePicture = (p: unknown): Picture | undefined => {
  const q = p as Picture | undefined;
  return q && typeof q.src === "string" && IMG.test(q.src) && dim(q.w) && dim(q.h) ? { src: q.src, w: q.w, h: q.h } : undefined;
};

/** Pixels a picture may decode to (the same cap as for a picked file). */
export const MAX_PIXELS = 50_000_000;
/**
 * A picture from storage or a project file (not picked just now): besides safePicture, a raster's real size is read
 * from its header and must be within MAX_PIXELS, and the stored size must have its ratio. An SVG is vector.
 */
export function storedPicture(p: unknown): Picture | undefined {
  const q = safePicture(p);
  if (!q || q.src.startsWith("data:image/svg+xml")) return q;
  try {
    const b64 = q.src.slice(q.src.indexOf(",") + 1, q.src.indexOf(",") + 1 + 349_528); // ≈ 256 KiB of bytes
    const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
    const size = rasterSize(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    if (!size || size.w <= 0 || size.h <= 0 || size.w * size.h > MAX_PIXELS) return undefined;
    // The stored size is what the browser showed (EXIF-rotated photos swap the axes): kept when it matches the
    // header either way round, otherwise the header's size is used.
    const close = (a: number, b: number) => Math.abs(a - b) <= 0.02 * b;
    const r = q.w / q.h;
    return close(r, size.w / size.h) || close(r, size.h / size.w) ? q : { src: q.src, w: size.w, h: size.h };
  } catch {
    return undefined;
  }
}

/** WCAG relative luminance; picks the text colour that reads on a background. */
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const inkOn = (bg: string) => (luminance(bg) > 0.4 ? "#14263d" : "#ffffff");
/** Mixes `hex` toward black (amount < 0) or white (> 0). */
export function shade(hex: string, amount: number) {
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - p) + t * p).toString(16).padStart(2, "0")).join("");
}

/**
 * Wraps `text` into at most `lines` lines of `w` px, shrinking from `size` to `min`. Still too long at `min`: the last
 * line ends in "…". Explicit line breaks are kept.
 */
export function fitText(text: string, w: number, h: number, size: number, min: number, lines: number, weight: number, measure: Measure, leading = 1.15) {
  const words = (s: string) => s.split(/\s+/).filter(Boolean);
  const wrap = (sz: number) => {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of words(para)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, sz, weight) > w) {
          out.push(line);
          line = word;
        } else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  };
  // ~6% steps: a handful of tries from the largest to the smallest size
  for (let sz = size; ; sz = Math.max(min, sz - Math.max(1, sz * 0.06))) {
    const out = wrap(sz);
    if (out.length <= lines && out.length * sz * leading <= h && out.every((l) => measure(l, sz, weight) <= w)) return { size: sz, lines: out };
    if (sz <= min) break;
  }
  // Also fits by height: fewer lines when even `min` px doesn't leave room for all of them.
  const all = wrap(min);
  const keep = Math.max(1, Math.min(lines, Math.floor(h / (min * leading))));
  const out = all.slice(0, keep).map((line, i) => {
    const cut = (i === keep - 1 && all.length > keep) || measure(line, min, weight) > w; // dropped lines, or one long word
    if (!cut) return line;
    while (line && measure(`${line}…`, min, weight) > w) line = line.slice(0, -1).trimEnd();
    return `${line}…`;
  });
  return { size: min, lines: out };
}

/** One item of a vertical stack; `before` is the gap above it, dropped together with an empty item. */
type Item = { before?: number } & (
  | { t: "text"; role?: Role; text: string; size: number; min: number; lines: number; weight: number; color: string; leading?: number; flex?: boolean }
  | { t: "pill"; text: string; size: number; fill: string; color: string }
  | { t: "bar"; w: number; h: number; fill: string }
  | { t: "logo"; pic?: Picture; h: number; plate?: boolean }
);

/**
 * Lays items out top to bottom in a column (x, w) of height `avail`, starting at `y` ("down") or ending at `y`
 * ("up"). Each text gets the height it needs; the one `flex` text gets what is left. So a short title pulls the
 * rest up and a long one pushes it down, and nothing overlaps.
 */
function stack(items: Item[], x: number, w: number, y: number, avail: number, dir: "down" | "up", measure: Measure): Layer[] {
  const live = items.filter((i) => (i.t === "text" || i.t === "pill" ? i.text.trim() : i.t === "logo" ? i.pic : true));
  type Placed = { h: number; draw: (top: number) => Layer[] };
  const gaps = live.reduce((s, i, k) => s + (k ? (i.before ?? 0) : 0), 0);
  const place = (i: Item, room: number): Placed => {
    if (i.t === "bar") return { h: i.h, draw: (top) => [{ kind: "rect", fill: i.fill, x, y: top, w: i.w, h: i.h, radius: i.h / 2 }] };
    if (i.t === "logo") {
      const pic = i.pic!;
      const pad = i.plate ? i.h * 0.22 : 0;
      const lh = i.h - 2 * pad;
      const lw = Math.min(lh * (pic.w / pic.h), w * 0.5 - 2 * pad);
      const ih = lw / (pic.w / pic.h);
      return {
        h: i.h,
        draw: (top) => [
          ...(i.plate ? [{ kind: "rect" as const, fill: "#ffffff", x, y: top, w: lw + 2 * pad, h: i.h, radius: pad }] : []),
          { kind: "image", pic, fit: "contain", logo: true, x: x + pad, y: top + (i.h - ih) / 2, w: lw, h: ih },
        ],
      };
    }
    if (i.t === "pill") {
      const t = i.text.trim().toLocaleUpperCase("tr");
      const tracking = i.size * 0.08;
      const tw = Math.min(measure(t, i.size, 700) + tracking * t.length, w - i.size * 1.6);
      const ph = i.size * 1.9;
      return {
        h: ph,
        draw: (top) => [{ kind: "text", role: "tag", x, y: top, w: tw + i.size * 1.6, size: i.size, lines: [t], weight: 700, color: i.color, leading: 1, tracking, bg: { fill: i.fill, h: ph } }],
      };
    }
    const leading = i.leading ?? 1.15;
    if (room < i.min * leading) return { h: 0, draw: () => [] };
    const fit = fitText(i.text.trim(), w, room, i.size, i.min, i.lines, i.weight, measure, leading);
    return { h: fit.lines.length * fit.size * leading, draw: (top) => [{ kind: "text", role: i.role, x, y: top, w, size: fit.size, lines: fit.lines, weight: i.weight, color: i.color, leading }] };
  };
  // Fixed items first, in order, each within what is still free; the flex text then gets the rest. A text with no
  // room for one line is left out, so the column never grows past `avail`.
  // Each item also leaves room for one line (or the fixed size) of every item not placed yet: a long title shrinks
  // so the description and the date under it still fit.
  const need = (i: Item) => (i.t === "text" ? i.min * (i.leading ?? 1.15) : i.t === "pill" ? i.size * 1.9 : i.h);
  const isFlex = (i: Item) => i.t === "text" && !!i.flex;
  // Not placed yet when item k is: every later item, and a flex text before it (placed last).
  const reserve = live.map((_, k) => live.reduce((s, i, j) => s + (j > k || (j < k && isFlex(i)) ? need(i) : 0), 0));
  let used = gaps;
  const fixed = live.map((i, k) => {
    if (isFlex(i)) return null;
    const p = place(i, avail - used - reserve[k]);
    used += p.h;
    return p;
  });
  const placed = live.map((i, k) => fixed[k] ?? place(i, avail - used));
  const total = placed.reduce((s, p) => s + p.h, 0) + gaps;
  let top = dir === "down" ? y : y - total;
  const out: Layer[] = [];
  placed.forEach((p, k) => {
    if (k) top += live[k].before ?? 0;
    out.push(...p.draw(top));
    top += p.h;
  });
  return out;
}

/** The layers of one design, back to front: background, photo, shading, then text and the logo. */
export function layout(d: Design, measure: Measure): Layer[] {
  const { w, h } = FORMATS[d.format];
  const primary = safeColor(d.brand.primary, DEFAULT_BRAND.primary);
  const accent = safeColor(d.brand.accent, DEFAULT_BRAND.accent);
  const photo = safePicture(d.photo);
  const logo = safePicture(d.brand.logo);
  const wide = w > h;
  // Sizes below are for a 1080 px short side; tall formats (9:16) have room for larger text.
  const u = (Math.min(w, h) / 1080) * (h / w > 1.5 ? 1.16 : 1);
  const m = Math.round(72 * u * (wide ? 1.2 : 1));
  const c = d.content;
  const col = (x: number, cw: number, y: number, avail: number, dir: "down" | "up", items: Item[]) => stack(items, x, cw, y, avail, dir, measure);
  const pill = (fill: string, color: string, before?: number): Item => ({ t: "pill", text: c.tag, size: 28 * u, fill, color, before });

  if (d.template === "etkinlik") {
    const L: Layer[] = [{ kind: "gradient", a: shade(primary, -0.25), b: accent, x: 0, y: 0, w, h }];
    if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: 0, y: 0, w, h });
    const base = shade(primary, -0.6);
    L.push({ kind: "fade", color: base, from: 0, to: 0.94, x: 0, y: h * 0.3, w, h: h * 0.7 });
    L.push(...col(m, w - 2 * m, m, 120 * u, "down", [{ t: "logo", pic: logo, h: 104 * u, plate: true }]));
    L.push(
      ...col(m, (wide ? w * 0.62 : w) - 2 * m, h - m, h * 0.62, "up", [
        pill(accent, inkOn(accent)),
        { t: "text", role: "title", text: c.title, size: (wide ? 92 : 100) * u, min: 48 * u, lines: 3, weight: 800, color: "#ffffff", leading: 1.06, before: 30 * u },
        { t: "text", role: "subtitle", text: c.subtitle, size: 38 * u, min: 26 * u, lines: 4, weight: 400, color: "#e3eaf2", leading: 1.3, flex: true, before: 26 * u },
        { t: "bar", w: 96 * u, h: 8 * u, fill: accent, before: 36 * u },
        { t: "text", role: "detail", text: c.detail, size: 34 * u, min: 24 * u, lines: 2, weight: 700, color: "#ffffff", before: 22 * u },
      ]),
    );
    return L;
  }

  if (d.template === "alinti") {
    const ink = inkOn(primary);
    const soft = ink === "#ffffff" ? "#c9d6e3" : "#4e6075";
    const cw = (wide ? w * 0.78 : w) - 2 * m;
    const L: Layer[] = [
      { kind: "rect", fill: primary, x: 0, y: 0, w, h },
      { kind: "rect", fill: accent, x: 0, y: 0, w: 16 * u, h },
      { kind: "text", role: "deco", x: m - 6 * u, y: m - 40 * u, w: 160 * u, size: 260 * u, lines: ["“"], weight: 800, color: accent, leading: 1 },
      ...col(w - m - 260 * u, 260 * u, m, 120 * u, "down", [{ t: "logo", pic: logo, h: 92 * u }]).map((l) => (l.kind === "image" ? { ...l, x: w - m - l.w } : l)),
    ];
    const foot = col(m, cw, h - m, 200 * u, "up", [
      { t: "bar", w: 64 * u, h: 6 * u, fill: accent },
      { t: "text", role: "subtitle", text: c.subtitle, size: 38 * u, min: 28 * u, lines: 1, weight: 700, color: ink, before: 26 * u },
      { t: "text", role: "detail", text: c.detail, size: 30 * u, min: 24 * u, lines: 2, weight: 400, color: soft, before: 10 * u },
    ]);
    const footTop = Math.min(h - m, ...foot.map((l) => l.y));
    const top = m + 230 * u;
    L.push(...col(m, cw, top, footTop - top - 60 * u, "down", [{ t: "text", role: "title", text: c.title, size: (wide ? 72 : 78) * u, min: 36 * u, lines: 9, weight: 600, color: ink, leading: 1.25, flex: true }]));
    L.push(...foot);
    return L;
  }

  if (d.template === "bilgi") {
    const ink = inkOn(primary);
    const cw = (wide ? w * 0.7 : w) - 2 * m;
    const L: Layer[] = [{ kind: "gradient", a: primary, b: shade(accent, -0.2), x: 0, y: 0, w, h }];
    const head = col(m, cw, m, 240 * u, "down", [{ t: "logo", pic: logo, h: 92 * u }, pill("#ffffff", primary, 36 * u)]);
    const foot = col(m, cw, h - m, 160 * u, "up", [
      { t: "bar", w: 120 * u, h: 8 * u, fill: accent === primary ? "#ffffff" : accent },
      { t: "text", role: "detail", text: c.detail, size: 30 * u, min: 22 * u, lines: 2, weight: 600, color: ink, before: 24 * u },
    ]);
    const headEnd = head.length ? Math.max(...head.map((l) => l.y + (l.kind === "text" ? (l.bg ? l.bg.h : l.size * 1.2) : l.h))) : m;
    const top = Math.max(headEnd + 60 * u, h * (wide ? 0.3 : h / w > 1.5 ? 0.32 : 0.26));
    const footTop = Math.min(h - m, ...foot.map((l) => l.y));
    L.push(...head, ...foot);
    L.push(
      ...col(m, cw, top, footTop - top - 50 * u, "down", [
        { t: "text", role: "title", text: c.title, size: (wide ? 190 : 210) * u, min: 64 * u, lines: 2, weight: 800, color: ink, leading: 1.02 },
        { t: "text", role: "subtitle", text: c.subtitle, size: 46 * u, min: 28 * u, lines: 5, weight: 400, color: ink, leading: 1.3, flex: true, before: 34 * u },
      ]),
    );
    return L;
  }

  // duyuru: photo band on top (on the right when wide), white page, brand strip at the bottom.
  const band = photo ? (wide ? w * 0.42 : h * ({ kare: 0.36, dikey: 0.4, hikaye: 0.44 } as const)[d.format as "kare"]) : 0;
  const strip = 22 * u;
  const L: Layer[] = [{ kind: "rect", fill: "#ffffff", x: 0, y: 0, w, h }];
  if (photo) L.push(wide ? { kind: "image", pic: photo, fit: "cover", x: w - band, y: 0, w: band, h } : { kind: "image", pic: photo, fit: "cover", x: 0, y: 0, w, h: band });
  L.push({ kind: "rect", fill: primary, x: 0, y: h - strip, w, h: strip });
  const top = !wide && photo ? band + m * 0.75 : m;
  const cw = (wide && photo ? w - band : w) - 2 * m;
  L.push(
    ...col(m, cw, top, h - strip - m * 0.8 - top, "down", [
      { t: "logo", pic: logo, h: 84 * u },
      pill(accent, inkOn(accent), 34 * u),
      { t: "text", role: "title", text: c.title, size: (wide ? 88 : 92) * u, min: 44 * u, lines: 3, weight: 800, color: primary, leading: 1.08, before: 30 * u },
      { t: "bar", w: 104 * u, h: 9 * u, fill: accent, before: 30 * u },
      { t: "text", role: "subtitle", text: c.subtitle, size: 38 * u, min: 26 * u, lines: 6, weight: 400, color: "#334a63", leading: 1.32, flex: true, before: 28 * u },
      { t: "text", role: "detail", text: c.detail, size: 32 * u, min: 24 * u, lines: 2, weight: 700, color: accent, before: 26 * u },
    ]),
  );
  return L;
}

// ---- editable design ----------------------------------------------------------------------------------------------
// A template gives the first layout; from then on the design is a list of elements the user moves, resizes and edits.
// Elements → primitives (draw) → the SVG string (svgOf) for export and the same primitives as React SVG in the editor,
// so what is on screen is what gets saved.

export type Fill = { kind: "solid"; color: string } | { kind: "linear"; dir: "diag" | "down"; stops: [{ color: string; opacity: number }, { color: string; opacity: number }] };
export type Stroke = { color: string; width: number; dash?: "dash" | "dot" };
export type Shadow = { color: string; blur: number; x: number; y: number; opacity: number };
type Common = {
  id: string; name: string; x: number; y: number; w: number; h: number; locked?: boolean; opacity?: number;
  /** Degrees clockwise around the box centre; flips mirror pictures and shapes (not text). */
  rotation?: number; flipX?: boolean; flipY?: boolean; shadow?: Shadow;
};
export type TextEl = Common & {
  kind: "text"; text: string; role?: Role; size: number; weight: number; color: string; align: "start" | "middle" | "end";
  leading: number; tracking: number; upper?: boolean; italic?: boolean; underline?: boolean;
  /** A font id (app/studio/fonts); none: the default font. */
  font?: string;
  /** Shrink the size (down to 40%) until the text fits the box; off once the user sets a size. */
  auto: boolean;
  /** A filled, rounded box behind the text (the tag pill). */
  bg?: { fill: string; radius: number };
};
export type ImageEl = Common & { kind: "image"; pic: Picture; fit: "cover" | "contain"; logo?: boolean; radius?: number };
/**
 * rect (radius rounds the corners, up to a pill), ellipse, poly (points as 0–1 fractions of the box) or line (left to
 * right through the middle of the box, `arrow` heads). noFill: only the outline is drawn.
 */
export type ShapeKind = "rect" | "ellipse" | "poly" | "line";
export type ShapeEl = Common & { kind: "shape"; fill: Fill; radius?: number; shape?: ShapeKind; points?: [number, number][]; stroke?: Stroke; noFill?: boolean; arrow?: "end" | "both" };
export type El = TextEl | ImageEl | ShapeEl;

/** Rotation (degrees around cx, cy) and mirroring of one element's primitives. */
export type Tf = { rot: number; cx: number; cy: number; fx?: boolean; fy?: boolean };
type PrimBase = { opacity: number; tf?: Tf; shadow?: Shadow };
/** What gets drawn; the export and the editor both draw exactly these. */
export type Prim = PrimBase &
  (
    | { kind: "rect"; x: number; y: number; w: number; h: number; fill: Fill | null; radius: number; stroke?: Stroke }
    | { kind: "ellipse"; x: number; y: number; w: number; h: number; fill: Fill | null; stroke?: Stroke }
    | { kind: "poly"; pts: [number, number][]; closed: boolean; fill: Fill | null; stroke?: Stroke }
    | { kind: "image"; x: number; y: number; w: number; h: number; pic: Picture; clip?: { x: number; y: number; w: number; h: number; radius: number } }
    | { kind: "text"; x: number; y: number; anchor: "start" | "middle" | "end"; size: number; lines: string[]; weight: number; color: string; leading: number; tracking: number; italic?: boolean; underline?: boolean; font?: string }
  );

/** SVG transform for a Tf (numbers only): rotate, then mirror around the same centre. */
export function tfAttr(t: Tf | undefined) {
  if (!t) return undefined;
  const parts: string[] = [];
  if (t.rot) parts.push(`rotate(${n(t.rot)} ${n(t.cx)} ${n(t.cy)})`);
  if (t.fx || t.fy) parts.push(`translate(${n(t.cx)} ${n(t.cy)}) scale(${t.fx ? -1 : 1} ${t.fy ? -1 : 1}) translate(${n(-t.cx)} ${n(-t.cy)})`);
  return parts.join(" ") || undefined;
}
/** The SVG stroke attributes of a Stroke. */
export const dashOf = (s: Stroke) => (s.dash === "dash" ? `${n(s.width * 3)} ${n(s.width * 2)}` : s.dash === "dot" ? `0 ${n(s.width * 2)}` : undefined);

// ---- shape library (the "Şekil" menu): each a kind, points for polygons, a default width:height ----------------
const regular = (k: number, inner = 0): [number, number][] =>
  Array.from({ length: inner ? 2 * k : k }, (_, i) => {
    const r = inner && i % 2 ? inner * 0.5 : 0.5;
    const a = -Math.PI / 2 + (i * Math.PI * 2) / (inner ? 2 * k : k);
    return [Math.round((0.5 + r * Math.cos(a)) * 1e4) / 1e4, Math.round((0.5 + r * Math.sin(a)) * 1e4) / 1e4];
  });
export const SHAPES = {
  rect: { label: "Dikdörtgen", shape: "rect", ratio: 1.6 },
  rounded: { label: "Yuvarlak köşeli", shape: "rect", ratio: 1.6, round: 0.18 },
  pill: { label: "Hap", shape: "rect", ratio: 3, round: 0.5 },
  ellipse: { label: "Daire", shape: "ellipse", ratio: 1 },
  triangle: { label: "Üçgen", shape: "poly", ratio: 1.15, points: [[0.5, 0], [1, 1], [0, 1]] },
  rtriangle: { label: "Dik üçgen", shape: "poly", ratio: 1, points: [[0, 0], [1, 1], [0, 1]] },
  diamond: { label: "Eşkenar dörtgen", shape: "poly", ratio: 1, points: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  pentagon: { label: "Beşgen", shape: "poly", ratio: 1, points: regular(5) },
  hexagon: { label: "Altıgen", shape: "poly", ratio: 1, points: regular(6) },
  octagon: { label: "Sekizgen", shape: "poly", ratio: 1, points: regular(8) },
  star: { label: "Yıldız", shape: "poly", ratio: 1, points: regular(5, 0.45) },
  burst: { label: "Patlama", shape: "poly", ratio: 1, points: regular(12, 0.72) },
  arrow: { label: "Ok", shape: "poly", ratio: 1.8, points: [[0, 0.3], [0.62, 0.3], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.7], [0, 0.7]] },
  chevron: { label: "Köşeli ok", shape: "poly", ratio: 1.4, points: [[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]] },
  parallelogram: { label: "Paralelkenar", shape: "poly", ratio: 1.8, points: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]] },
  trapezoid: { label: "Yamuk", shape: "poly", ratio: 1.6, points: [[0.2, 0], [0.8, 0], [1, 1], [0, 1]] },
  plus: { label: "Artı", shape: "poly", ratio: 1, points: [[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]] },
  bubble: { label: "Konuşma balonu", shape: "poly", ratio: 1.4, points: [[0, 0], [1, 0], [1, 0.75], [0.4, 0.75], [0.2, 1], [0.22, 0.75], [0, 0.75]] },
  line: { label: "Çizgi", shape: "line", ratio: 12 },
  arrowLine: { label: "Oklu çizgi", shape: "line", ratio: 12, arrow: "end" },
} as const satisfies Record<string, { label: string; shape: ShapeKind; ratio: number; round?: number; points?: [number, number][]; arrow?: "end" | "both" }>;
export type ShapeId = keyof typeof SHAPES;

/** A new shape from the library, `size` on its longer side, centred on (cx, cy). */
export function shapeFrom(id: ShapeId, cx: number, cy: number, size: number, color: string): ShapeEl {
  const d: { label: string; shape: ShapeKind; ratio: number; round?: number; points?: readonly (readonly [number, number])[]; arrow?: "end" | "both" } = SHAPES[id];
  const isLine = d.shape === "line";
  const w = d.ratio >= 1 ? size : size * d.ratio;
  const h = isLine ? Math.max(8, size / 40) * 3 : d.ratio >= 1 ? size / d.ratio : size;
  return {
    id: newId(), kind: "shape", name: d.label, x: cx - w / 2, y: cy - h / 2, w, h, fill: { kind: "solid", color },
    ...(d.shape === "rect" ? {} : { shape: d.shape }),
    ...(d.round ? { radius: Math.min(w, h) * d.round } : {}),
    ...(d.points ? { points: d.points.map(([x, y]) => [x, y] as [number, number]) } : {}),
    ...(isLine ? { stroke: { color, width: Math.max(2, size / 60) }, noFill: true } : {}),
    ...(d.arrow ? { arrow: d.arrow } : {}),
  };
}

let seq = 0;
export const newId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
const NAMES: Record<Role, string> = { tag: "Etiket", title: "Başlık", subtitle: "Açıklama", detail: "Detay", deco: "Tırnak" };

/** The template's layout as editable elements (text boxes as wide as their column, as tall as their lines). */
export function fromTemplate(d: Design, measure: Measure): El[] {
  const { w: W, h: H } = FORMATS[d.format];
  return layout(d, measure).map((l): El => {
    const id = newId();
    if (l.kind === "text") {
      const role = l.role;
      const h = l.bg ? l.bg.h : Math.max(l.lines.length, 1) * l.size * l.leading;
      return {
        id, kind: "text", name: role ? NAMES[role] : "Metin", role, x: l.x, y: l.y, w: l.w, h,
        // The tag is drawn in capitals; the element keeps what the user typed.
        text: role === "tag" ? d.content.tag.trim() : role === "deco" ? l.lines.join("") : role ? d.content[role].trim() : l.lines.join("\n"),
        upper: role === "tag", size: l.size, weight: l.weight, color: l.color, align: "start", leading: l.leading, tracking: l.tracking ?? 0,
        auto: role !== "deco", ...(l.bg ? { bg: { fill: l.bg.fill, radius: l.bg.h / 2 } } : {}),
      };
    }
    if (l.kind === "image") {
      const isLogo = !!l.logo;
      return { id, kind: "image", name: isLogo ? "Logo" : "Fotoğraf", x: l.x, y: l.y, w: l.w, h: l.h, pic: l.pic, fit: l.fit, ...(isLogo ? { logo: true } : {}) };
    }
    const full = l.x <= 0.5 && l.y <= 0.5 && l.w >= W - 0.5 && l.h >= H - 0.5;
    const fill: Fill =
      l.kind === "rect" ? { kind: "solid", color: l.fill }
      : l.kind === "gradient" ? { kind: "linear", dir: "diag", stops: [{ color: l.a, opacity: 1 }, { color: l.b, opacity: 1 }] }
      : { kind: "linear", dir: "down", stops: [{ color: l.color, opacity: l.from }, { color: l.color, opacity: l.to }] };
    return { id, kind: "shape", name: full ? "Arka plan" : l.kind === "fade" ? "Gölge" : "Şekil", x: l.x, y: l.y, w: l.w, h: l.h, fill, radius: l.kind === "rect" ? l.radius : undefined, ...(full ? { locked: true } : {}) };
  });
}

/**
 * An edited design moved to another format, instead of starting over from the template: everything scales by the
 * smaller of the two ratios around its scaled centre; what touches an edge keeps touching it and what spans the canvas
 * spans the new one (backgrounds, strips, a photo band).
 */
/** The screen-aligned box around an element as drawn (a turned element's corners). */
export function aabb(e: El) {
  const rot = Number.isFinite(e.rotation) ? (e.rotation as number) % 360 : 0;
  if (!rot) return { x: e.x, y: e.y, w: e.w, h: e.h };
  const a = (rot * Math.PI) / 180;
  const w = Math.abs(e.w * Math.cos(a)) + Math.abs(e.h * Math.sin(a));
  const h = Math.abs(e.w * Math.sin(a)) + Math.abs(e.h * Math.cos(a));
  return { x: e.x + e.w / 2 - w / 2, y: e.y + e.h / 2 - h / 2, w, h };
}

export type AlignTo = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
/**
 * Lines the chosen elements up on an edge or centre: of `to` (the canvas) when given, else of the box around them all.
 * Locked ones don't move (and with others chosen, they are the reference like the rest). Only positions change.
 */
export function alignEls(els: El[], ids: string[], how: AlignTo, to?: { w: number; h: number }): El[] {
  const set = new Set(ids);
  const boxes = els.filter((e) => set.has(e.id)).map(aabb);
  if (!boxes.length) return els;
  const ref = to
    ? { x: 0, y: 0, w: to.w, h: to.h }
    : (() => {
        const x = Math.min(...boxes.map((b) => b.x));
        const y = Math.min(...boxes.map((b) => b.y));
        return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
      })();
  return els.map((e) => {
    if (!set.has(e.id) || e.locked) return e;
    const b = aabb(e);
    const dx = how === "left" ? ref.x - b.x : how === "hcenter" ? ref.x + ref.w / 2 - (b.x + b.w / 2) : how === "right" ? ref.x + ref.w - (b.x + b.w) : 0;
    const dy = how === "top" ? ref.y - b.y : how === "vcenter" ? ref.y + ref.h / 2 - (b.y + b.h / 2) : how === "bottom" ? ref.y + ref.h - (b.y + b.h) : 0;
    return dx || dy ? ({ ...e, x: e.x + dx, y: e.y + dy } as El) : e;
  });
}

/**
 * Equal gaps between the chosen elements along an axis (3 or more): the outermost two stay, the ones between move so
 * every gap between neighbouring edges is the same.
 */
export function distributeEls(els: El[], ids: string[], axis: "x" | "y"): El[] {
  const set = new Set(ids);
  // Locked ones aren't part of it: they would stay put in the middle and break the equal gaps.
  const items = els.filter((e) => set.has(e.id) && !e.locked).map((e) => ({ e, b: aabb(e) }));
  if (items.length < 3) return els;
  const pos = (b: ReturnType<typeof aabb>) => (axis === "x" ? b.x : b.y);
  const len = (b: ReturnType<typeof aabb>) => (axis === "x" ? b.w : b.h);
  items.sort((a, b) => pos(a.b) + len(a.b) / 2 - (pos(b.b) + len(b.b) / 2));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - items.reduce((s, i) => s + len(i.b), 0)) / (items.length - 1);
  const moved = new Map<string, number>();
  let at = pos(first);
  for (const i of items) {
    moved.set(i.e.id, at - pos(i.b));
    at += len(i.b) + gap;
  }
  return els.map((e) => {
    const d = moved.get(e.id);
    if (!d || e.locked) return e;
    return { ...e, [axis]: e[axis] + d } as El;
  });
}

export function refit(els: El[], from: FormatId, to: FormatId): El[] {
  const a = FORMATS[from];
  const b = FORMATS[to];
  if (from === to) return els;
  const s = Math.min(b.w / a.w, b.h / a.h);
  const axis = (pos: number, size: number, A: number, B: number) => {
    if (pos <= 0.5 && pos + size >= A - 0.5) return [0, B]; // spans it
    const len = size * s;
    if (pos <= 0.5) return [pos < -0.5 ? pos * s : 0, len]; // starts at the edge (or bleeds over it)
    if (pos + size >= A - 0.5) return [B - len + (pos + size - A) * s, len];
    return [(pos + size / 2) * (B / A) - len / 2, len];
  };
  return els.map((e) => {
    const [x, w] = axis(e.x, e.w, a.w, b.w);
    const [y, h] = axis(e.y, e.h, a.h, b.h);
    const box = { ...e, x, y, w, h };
    // Outline and shadow sizes scale with everything else, so the proportions stay.
    const fx = { ...(e.shadow ? { shadow: { ...e.shadow, blur: e.shadow.blur * s, x: e.shadow.x * s, y: e.shadow.y * s } } : {}) };
    if (e.kind === "text") return { ...box, ...fx, size: e.size * s, tracking: e.tracking * s, ...(e.bg ? { bg: { ...e.bg, radius: e.bg.radius * s } } : {}) } as El;
    if (e.kind === "shape" && e.stroke) Object.assign(fx, { stroke: { ...e.stroke, width: e.stroke.width * s } });
    return (e.radius ? { ...box, ...fx, radius: e.radius * s } : { ...box, ...fx }) as El;
  });
}

/**
 * Boxes that follow their text: without "Kutuya sığdır" (and without a pill) a text box is as tall as its wrapped
 * lines, so a bigger size or a longer text grows the box instead of being cut.
 */
export function hug(els: El[], measure: Measure): El[] {
  return els.map((e) => {
    if (e.kind !== "text" || e.auto || e.bg) return e;
    const t = e.upper ? e.text.toLocaleUpperCase("tr") : e.text;
    const width = (s: string, size: number, weight: number) => measure(s, size, weight, e.font) + e.tracking * s.length;
    const lines = fitText(t, Math.max(1, e.w), Number.MAX_SAFE_INTEGER, e.size, e.size, 999, e.weight, width, e.leading).lines.length;
    const h = Math.max(1, lines) * e.size * e.leading;
    return Math.abs(h - e.h) < 0.5 ? e : { ...e, h };
  });
}

/** A pill as wide as its text in its font (a font change shouldn't leave it too wide or cut the word). */
export function fitPill(e: TextEl, measure: Measure): TextEl {
  if (!e.bg) return e;
  const t = (e.upper ? e.text.toLocaleUpperCase("tr") : e.text).replace(/\s+/g, " ");
  return { ...e, w: measure(t, e.size, e.weight, e.font) + e.tracking * t.length + e.size * 1.6 };
}

export function textLines(e: TextEl, measure: Measure) {
  const pad = e.bg ? e.size * 0.8 : 0;
  const t = e.upper ? e.text.toLocaleUpperCase("tr") : e.text;
  const width = (s: string, size: number, weight: number) => measure(s, size, weight, e.font) + e.tracking * (size / e.size) * s.length;
  if (e.bg) return { size: e.size, lines: [t.replace(/\s+/g, " ")], pad };
  return { ...fitText(t, Math.max(1, e.w), e.auto ? Math.max(1, e.h + 0.5) : Math.max(e.size * e.leading, e.h + 0.5), e.size, e.auto ? e.size * 0.4 : e.size, 999, e.weight, width, e.leading), pad };
}

export function draw(els: El[], measure: Measure): Prim[] {
  const out: Prim[] = [];
  for (const e of els) {
    const rot = Number.isFinite(e.rotation) ? (e.rotation as number) % 360 : 0;
    const fx = e.kind !== "text" && e.flipX;
    const fy = e.kind !== "text" && e.flipY;
    const base: PrimBase = {
      opacity: e.opacity ?? 1,
      ...(rot || fx || fy ? { tf: { rot, cx: e.x + e.w / 2, cy: e.y + e.h / 2, ...(fx ? { fx } : {}), ...(fy ? { fy } : {}) } } : {}),
      ...(e.shadow ? { shadow: { ...e.shadow, color: safeColor(e.shadow.color, "#000000") } } : {}),
    };
    if (e.kind === "shape") {
      const fill = e.noFill ? null : e.fill;
      const stroke = e.stroke && e.stroke.width > 0 ? { ...e.stroke, color: safeColor(e.stroke.color, "#14263d") } : undefined;
      const shape = e.shape ?? "rect";
      if (shape === "ellipse") out.push({ ...base, kind: "ellipse", x: e.x, y: e.y, w: e.w, h: e.h, fill, stroke });
      else if (shape === "poly") {
        const pts = (e.points ?? []).map(([px, py]) => [e.x + px * e.w, e.y + py * e.h] as [number, number]);
        if (pts.length >= 3) out.push({ ...base, kind: "poly", pts, closed: true, fill, stroke });
      } else if (shape === "line") {
        if (!stroke) continue;
        // Arrow heads are filled triangles at the ends; the line stops at their base so its cap doesn't show.
        const y = e.y + e.h / 2;
        const head = Math.min(stroke.width * 3.5, e.w / 2);
        const [x1, x2] = [e.x + (e.arrow === "both" ? head * 0.9 : 0), e.x + e.w - (e.arrow ? head * 0.9 : 0)];
        out.push({ ...base, kind: "poly", pts: [[x1, y], [x2, y]], closed: false, fill: null, stroke });
        const tip = (x: number, dir: number): Prim => ({ ...base, kind: "poly", closed: true, stroke: undefined, fill: { kind: "solid", color: stroke.color }, pts: [[x, y], [x - dir * head, y - head * 0.6], [x - dir * head, y + head * 0.6]] });
        if (e.arrow) out.push(tip(e.x + e.w, 1));
        if (e.arrow === "both") out.push(tip(e.x, -1));
      } else out.push({ ...base, kind: "rect", x: e.x, y: e.y, w: e.w, h: e.h, fill, radius: Math.min(e.radius ?? 0, e.w / 2, e.h / 2), stroke });
    } else if (e.kind === "image") {
      const pic = safePicture(e.pic);
      if (!pic) continue;
      // cover: fills the box, cut by it; contain: the whole picture inside the box, its ratio kept (the logo).
      const s = e.fit === "cover" ? Math.max(e.w / pic.w, e.h / pic.h) : Math.min(e.w / pic.w, e.h / pic.h);
      const iw = pic.w * s;
      const ih = pic.h * s;
      const x = e.x + (e.w - iw) / 2;
      const y = e.y + (e.h - ih) / 2;
      out.push({ ...base, kind: "image", x, y, w: iw, h: ih, pic, ...(e.fit === "cover" || e.radius ? { clip: { x: e.x, y: e.y, w: e.w, h: e.h, radius: Math.min(e.radius ?? 0, e.w / 2, e.h / 2) } } : {}) });
    } else {
      const { size, lines, pad } = textLines(e, measure);
      const scale = size / e.size;
      if (e.bg) out.push({ ...base, kind: "rect", x: e.x, y: e.y, w: e.w, h: e.h, fill: { kind: "solid", color: safeColor(e.bg.fill, "#2e5e8c") }, radius: Math.min(e.bg.radius, e.h / 2) });
      const x = e.align === "middle" ? e.x + e.w / 2 : e.align === "end" ? e.x + e.w - pad : e.x + pad;
      // With a pill the line sits in the middle of the box; otherwise the first line starts at the top.
      const y = e.bg ? e.y + e.h / 2 - size * 0.54 : e.y;
      // With a pill, its shadow is the pill's; the letters don't get a second one.
      out.push({ ...base, ...(e.bg ? { shadow: undefined } : {}), kind: "text", x, y, anchor: e.align, size, lines, weight: e.weight, color: safeColor(e.color, "#14263d"), leading: e.leading, tracking: e.tracking * scale, ...(e.italic ? { italic: true } : {}), ...(e.underline ? { underline: true } : {}), ...(e.font ? { font: e.font } : {}) });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.round(v * 10) / 10;
export const FONT_FAMILY = "KaiStudio";
/** Stored ids reach CSS and SVG attributes: only these characters. */
export const safeFontId = (v: unknown) => (typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v) ? v : undefined);
/** CSS family list of a font id, the default font as fallback. */
export const familyOf = (font?: string) => `${safeFontId(font) ? `K-${font},` : ""}${FONT_FAMILY},Arial,sans-serif`;
// @font-face blocks of the loaded fonts (data: URLs): a design's SVG embeds those it uses.
const fontsCss = new Map<string, string>();
export const registerFontCss = (id: string, css: string) => void fontsCss.set(id, css);
const fillColor = (c: string) => safeColor(c, "#000000");
const n2 = (v: number) => Math.round(v * 100) / 100; // opacities: 5% steps
const shadowKey = (s: Shadow) => [s.color, n(s.blur), n(s.x), n(s.y), n2(s.opacity)].join("|");
/** feDropShadow attributes (blur is the Gaussian's standard deviation, half the visual spread). */
export const shadowAttrs = (s: Shadow) => `dx="${n(s.x)}" dy="${n(s.y)}" stdDeviation="${n(s.blur / 2)}" flood-color="${fillColor(s.color)}" flood-opacity="${n2(Math.min(1, Math.max(0, s.opacity)))}"`;

/**
 * The design as a standalone SVG. `fontCss` is an @font-face block with the font as a data: URL (an SVG drawn as an
 * image can't load anything else). Images are <image> elements: inside an image no script or link ever runs.
 */
export function svgOf(format: FormatId, els: El[], measure: Measure, css = ""): string {
  const { w, h } = FORMATS[format];
  const defs: string[] = [];
  const body: string[] = [];
  let id = 0;
  const filters = new Map<string, string>();
  // Opacity, rotation/mirroring and the drop shadow of a primitive, as attributes.
  const common = (p: Prim) => {
    let a = p.opacity < 1 ? ` opacity="${n(Math.max(0, p.opacity))}"` : "";
    const t = tfAttr(p.tf);
    if (t) a += ` transform="${t}"`;
    if (p.shadow) {
      const key = shadowKey(p.shadow);
      if (!filters.has(key)) {
        const f = `f${id++}`;
        filters.set(key, f);
        // In canvas units: a straight line has no height, so a region relative to its box would hide it.
        defs.push(`<filter id="${f}" filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow ${shadowAttrs(p.shadow)}/></filter>`);
      }
      a += ` filter="url(#${filters.get(key)})"`;
    }
    return a;
  };
  const paint = (f: Fill | null) => {
    if (!f) return "none";
    if (f.kind === "solid") return fillColor(f.color);
    const g = `g${id++}`;
    const [a, b] = f.stops;
    const dir = f.dir === "diag" ? `x1="0" y1="0" x2="1" y2="1"` : `x1="0" y1="0" x2="0" y2="1"`;
    defs.push(`<linearGradient id="${g}" ${dir}><stop offset="0" stop-color="${fillColor(a.color)}" stop-opacity="${n(a.opacity)}"/><stop offset="1" stop-color="${fillColor(b.color)}" stop-opacity="${n(b.opacity)}"/></linearGradient>`);
    return `url(#${g})`;
  };
  const line = (s?: Stroke) => {
    if (!s) return "";
    const d = dashOf(s);
    return ` stroke="${fillColor(s.color)}" stroke-width="${n(s.width)}" stroke-linejoin="round"${s.dash === "dot" ? ` stroke-linecap="round"` : ""}${d ? ` stroke-dasharray="${d}"` : ""}`;
  };
  for (const p of draw(els, measure)) {
    if (p.kind === "rect") {
      body.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${p.radius ? ` rx="${n(p.radius)}"` : ""} fill="${paint(p.fill)}"${line(p.stroke)}${common(p)}/>`);
    } else if (p.kind === "ellipse") {
      body.push(`<ellipse cx="${n(p.x + p.w / 2)}" cy="${n(p.y + p.h / 2)}" rx="${n(p.w / 2)}" ry="${n(p.h / 2)}" fill="${paint(p.fill)}"${line(p.stroke)}${common(p)}/>`);
    } else if (p.kind === "poly") {
      const pts = p.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
      body.push(`<${p.closed ? "polygon" : "polyline"} points="${pts}" fill="${paint(p.fill)}"${line(p.stroke)}${common(p)}/>`);
    } else if (p.kind === "image") {
      let clip = "";
      if (p.clip) {
        const c = `c${id++}`;
        defs.push(`<clipPath id="${c}"><rect x="${n(p.clip.x)}" y="${n(p.clip.y)}" width="${n(p.clip.w)}" height="${n(p.clip.h)}"${p.clip.radius ? ` rx="${n(p.clip.radius)}"` : ""}/></clipPath>`);
        clip = ` clip-path="url(#${c})"`;
      }
      // The clip goes on a group so a rotated or mirrored picture is cut by its rotated box.
      const img = `<image href="${p.pic.src}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="xMidYMid meet"${clip}/>`;
      body.push(`<g${common(p)}>${img}</g>`);
    } else {
      // y is the top of the first line; the baseline sits ~0.9 em below it (Geist's ascent).
      const spans = p.lines.map((line, i) => `<tspan x="${n(p.x)}" y="${n(p.y + p.size * (0.9 + i * p.leading))}">${esc(line)}</tspan>`).join("");
      const anchor = p.anchor === "start" ? "" : ` text-anchor="${p.anchor}"`;
      const deco = `${p.italic ? ` font-style="italic"` : ""}${p.underline ? ` text-decoration="underline"` : ""}`;
      body.push(`<text font-size="${n(p.size)}" font-weight="${p.weight}" fill="${p.color}"${anchor}${p.tracking ? ` letter-spacing="${n(p.tracking)}"` : ""}${deco}${p.font && safeFontId(p.font) ? ` style="font-family:${familyOf(p.font)}"` : ""}${common(p)}>${spans}</text>`);
    }
  }
  const used = [...new Set(els.flatMap((e) => (e.kind === "text" && e.font ? [e.font] : [])))].map((f) => fontsCss.get(f) ?? "").join("");
  const style = `<style>${css}${used}text{font-family:${FONT_FAMILY},Arial,sans-serif}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${style}${defs.join("")}</defs>${body.join("")}</svg>`;
}

/** A template design straight to SVG (thumbnails, tests). */
export const toSvg = (d: Design, measure: Measure, fontCss = "") => svgOf(d.format, fromTemplate(d, measure), measure, fontCss);

/**
 * Elements from storage or a pasted project: only known kinds and fields, numbers finite, colours and pictures
 * validated (they end up in SVG attributes). Anything else is dropped.
 */
export function cleanEls(raw: unknown): El[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-10000, Math.min(10000, v)) : d);
  const out: El[] = [];
  const ids = new Set<string>();
  for (const r of raw.slice(0, 200) as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    // Ids pick what a click or the inspector changes: each must be unique, so missing or repeated ones are new.
    let id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    const sh = r.shadow as Record<string, unknown> | undefined;
    const base = {
      id, name: typeof r.name === "string" ? r.name.slice(0, 40) : "Öğe", x: num(r.x), y: num(r.y), w: Math.max(1, num(r.w, 100)), h: Math.max(1, num(r.h, 100)), locked: r.locked === true, opacity: Math.min(1, Math.max(0, num(r.opacity, 1))),
      ...(num(r.rotation) % 360 ? { rotation: num(r.rotation) % 360 } : {}),
      ...(r.flipX === true && r.kind !== "text" ? { flipX: true } : {}),
      ...(r.flipY === true && r.kind !== "text" ? { flipY: true } : {}),
      ...(sh && typeof sh === "object" ? { shadow: { color: safeColor(sh.color, "#000000"), blur: Math.min(200, Math.max(0, num(sh.blur, 20))), x: Math.min(200, Math.max(-200, num(sh.x))), y: Math.min(200, Math.max(-200, num(sh.y, 8))), opacity: Math.min(1, Math.max(0, num(sh.opacity, 0.3))) } } : {}),
    };
    if (r.kind === "text") {
      const bg = r.bg as { fill?: unknown; radius?: unknown } | undefined;
      out.push({
        ...base, kind: "text", text: typeof r.text === "string" ? r.text.slice(0, 2000) : "", role: (["tag", "title", "subtitle", "detail", "deco"] as const).find((x) => x === r.role),
        size: Math.max(4, num(r.size, 40)), weight: [300, 400, 500, 600, 700, 800, 900].includes(r.weight as number) ? (r.weight as number) : 400, color: safeColor(r.color, "#14263d"),
        align: r.align === "middle" || r.align === "end" ? r.align : "start", leading: Math.min(3, Math.max(0.8, num(r.leading, 1.2))), tracking: Math.min(50, Math.max(-10, num(r.tracking))),
        upper: r.upper === true, auto: r.auto === true, ...(safeFontId(r.font) ? { font: r.font as string } : {}), ...(r.italic === true ? { italic: true } : {}), ...(r.underline === true ? { underline: true } : {}),
        ...(bg && typeof bg === "object" ? { bg: { fill: safeColor(bg.fill, "#2e5e8c"), radius: Math.max(0, num(bg.radius)) } } : {}),
      });
    } else if (r.kind === "image") {
      const pic = storedPicture(r.pic);
      if (pic) out.push({ ...base, kind: "image", pic, fit: r.fit === "cover" ? "cover" : "contain", logo: r.logo === true, radius: Math.max(0, num(r.radius)) });
    } else if (r.kind === "shape") {
      const f = r.fill as Fill | undefined;
      const stop = (s: unknown) => ({ color: safeColor((s as { color?: unknown })?.color, "#000000"), opacity: Math.min(1, Math.max(0, num((s as { opacity?: unknown })?.opacity, 1))) });
      const fill: Fill = f?.kind === "linear" && Array.isArray(f.stops) ? { kind: "linear", dir: f.dir === "down" ? "down" : "diag", stops: [stop(f.stops[0]), stop(f.stops[1])] } : { kind: "solid", color: safeColor((f as { color?: unknown })?.color, "#14263d") };
      const st = r.stroke as Record<string, unknown> | undefined;
      const shape = (["ellipse", "poly", "line"] as const).find((x) => x === r.shape);
      const points = Array.isArray(r.points)
        ? (r.points as unknown[]).slice(0, 64).filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && q.every((v) => typeof v === "number" && Number.isFinite(v))).map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number])
        : [];
      if (shape === "poly" && points.length < 3) continue;
      out.push({
        ...base, kind: "shape", fill, radius: Math.max(0, num(r.radius)),
        ...(shape ? { shape } : {}), ...(shape === "poly" ? { points } : {}),
        ...(st && typeof st === "object" ? { stroke: { color: safeColor(st.color, "#14263d"), width: Math.min(200, Math.max(0, num(st.width, 2))), ...(st.dash === "dash" || st.dash === "dot" ? { dash: st.dash } : {}) } } : {}),
        ...(r.noFill === true ? { noFill: true } : {}),
        ...(shape === "line" && (r.arrow === "end" || r.arrow === "both") ? { arrow: r.arrow } : {}),
      });
    }
  }
  return out;
}

/**
 * Pixel size from a PNG, JPEG or WebP header, read before the browser decodes anything (a small file can decode to
 * gigabytes). null: not one of these or a header it can't read.
 */
export function rasterSize(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") return { w: u32(16), h: u32(20) };
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (kind === "VP8L") return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (kind === "VP8X") return { w: 1 + le24(24), h: 1 + le24(27) };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the frame header (SOF0–SOF15 except DHT C4, JPG C8, DAC CC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (m === 0xd9 || m === 0xda) return null; // end of image / scan before any frame header
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

// ---- model suggestion -------------------------------------------------------------------------------------------

export const FILL_PROMPT = `Kurumsal sosyal medya görseli için Türkçe metin yazıyorsun. Kullanıcının anlattığı konuya göre YALNIZCA şu JSON'u döndür, başka hiçbir şey yazma:
{"etiket": "...", "baslik": "...", "altBaslik": "...", "detay": "..."}
Kurallar:
- etiket: en fazla 2 kelime, ör. DUYURU, ETKİNLİK, BİLGİ (boş bırakılabilir).
- baslik: en fazla 8 kelime, dikkat çekici, nokta yok.
- altBaslik: en fazla 25 kelime, tek ya da iki cümle.
- detay: tarih, saat, yer ya da web adresi gibi kısa bilgi; kullanıcı vermediyse boş bırak. Bilgi uydurma.
- Resmî ve anlaşılır kurum dili; emoji ve hashtag yok.`;

export const TEMPLATE_HINT: Record<TemplateId, string> = {
  duyuru: "Şablon: duyuru.",
  etkinlik: "Şablon: etkinlik (fotoğraf üzerinde kısa başlık, detayda tarih/yer).",
  bilgi: "Şablon: bilgi/rakam. baslik öne çıkan rakam ya da 2-4 kelimelik çok kısa mesaj olsun (ör. \"%42 artış\"), altBaslik rakamın ne anlattığını açıklasın.",
  alinti: "Şablon: alıntı. baslik alıntılanan söz (en fazla 30 kelime, tırnaksız), altBaslik söyleyenin adı, detay unvanı/kurumu.",
};

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

/** The model's answer → Content, or null if no usable JSON object came back. Over-long fields are cut. */
export function parseFill(answer: string): Content | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const c = {
    tag: clip(o.etiket, LIMITS.tag),
    title: clip(o.baslik, LIMITS.title).replace(/^["“”']+|["“”']+$/g, ""),
    subtitle: clip(o.altBaslik, LIMITS.subtitle),
    detail: clip(o.detay, LIMITS.detail),
  };
  return c.title ? c : null;
}
