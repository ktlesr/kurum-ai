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
export type Measure = (text: string, size: number, weight: number) => number;

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
function shade(hex: string, amount: number) {
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
type Common = { id: string; name: string; x: number; y: number; w: number; h: number; locked?: boolean; opacity?: number };
export type TextEl = Common & {
  kind: "text"; text: string; role?: Role; size: number; weight: number; color: string; align: "start" | "middle" | "end";
  leading: number; tracking: number; upper?: boolean;
  /** Shrink the size (down to 40%) until the text fits the box; off once the user sets a size. */
  auto: boolean;
  /** A filled, rounded box behind the text (the tag pill). */
  bg?: { fill: string; radius: number };
};
export type ImageEl = Common & { kind: "image"; pic: Picture; fit: "cover" | "contain"; logo?: boolean; radius?: number };
export type ShapeEl = Common & { kind: "shape"; fill: Fill; radius?: number };
export type El = TextEl | ImageEl | ShapeEl;

/** What gets drawn; the export and the editor both draw exactly these. */
export type Prim =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: Fill; radius: number; opacity: number }
  | { kind: "image"; x: number; y: number; w: number; h: number; pic: Picture; clip?: { x: number; y: number; w: number; h: number; radius: number }; opacity: number }
  | { kind: "text"; x: number; y: number; anchor: "start" | "middle" | "end"; size: number; lines: string[]; weight: number; color: string; leading: number; tracking: number; opacity: number };

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

/** Text drawn inside its box: wrapped to the width, cut at the height (or shrunk first when `auto`). */
/**
 * Boxes that follow their text: without "Kutuya sığdır" (and without a pill) a text box is as tall as its wrapped
 * lines, so a bigger size or a longer text grows the box instead of being cut.
 */
export function hug(els: El[], measure: Measure): El[] {
  return els.map((e) => {
    if (e.kind !== "text" || e.auto || e.bg) return e;
    const t = e.upper ? e.text.toLocaleUpperCase("tr") : e.text;
    const width = (s: string, size: number, weight: number) => measure(s, size, weight) + e.tracking * s.length;
    const lines = fitText(t, Math.max(1, e.w), Number.MAX_SAFE_INTEGER, e.size, e.size, 999, e.weight, width, e.leading).lines.length;
    const h = Math.max(1, lines) * e.size * e.leading;
    return Math.abs(h - e.h) < 0.5 ? e : { ...e, h };
  });
}

export function textLines(e: TextEl, measure: Measure) {
  const pad = e.bg ? e.size * 0.8 : 0;
  const t = e.upper ? e.text.toLocaleUpperCase("tr") : e.text;
  const width = (s: string, size: number, weight: number) => measure(s, size, weight) + e.tracking * (size / e.size) * s.length;
  if (e.bg) return { size: e.size, lines: [t.replace(/\s+/g, " ")], pad };
  return { ...fitText(t, Math.max(1, e.w), Math.max(e.size * e.leading, e.h + 0.5), e.size, e.auto ? e.size * 0.4 : e.size, 999, e.weight, width, e.leading), pad };
}

export function draw(els: El[], measure: Measure): Prim[] {
  const out: Prim[] = [];
  for (const e of els) {
    const opacity = e.opacity ?? 1;
    if (e.kind === "shape") out.push({ kind: "rect", x: e.x, y: e.y, w: e.w, h: e.h, fill: e.fill, radius: e.radius ?? 0, opacity });
    else if (e.kind === "image") {
      const pic = safePicture(e.pic);
      if (!pic) continue;
      // cover: fills the box, cut by it; contain: the whole picture inside the box, its ratio kept (the logo).
      const s = e.fit === "cover" ? Math.max(e.w / pic.w, e.h / pic.h) : Math.min(e.w / pic.w, e.h / pic.h);
      const iw = pic.w * s;
      const ih = pic.h * s;
      const x = e.x + (e.w - iw) / 2;
      const y = e.y + (e.h - ih) / 2;
      out.push({ kind: "image", x, y, w: iw, h: ih, pic, opacity, ...(e.fit === "cover" || e.radius ? { clip: { x: e.x, y: e.y, w: e.w, h: e.h, radius: e.radius ?? 0 } } : {}) });
    } else {
      const { size, lines, pad } = textLines(e, measure);
      const scale = size / e.size;
      if (e.bg) out.push({ kind: "rect", x: e.x, y: e.y, w: e.w, h: e.h, fill: { kind: "solid", color: safeColor(e.bg.fill, "#2e5e8c") }, radius: Math.min(e.bg.radius, e.h / 2), opacity });
      const x = e.align === "middle" ? e.x + e.w / 2 : e.align === "end" ? e.x + e.w - pad : e.x + pad;
      // With a pill the line sits in the middle of the box; otherwise the first line starts at the top.
      const y = e.bg ? e.y + e.h / 2 - size * 0.54 : e.y;
      out.push({ kind: "text", x, y, anchor: e.align, size, lines, weight: e.weight, color: safeColor(e.color, "#14263d"), leading: e.leading, tracking: e.tracking * scale, opacity });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.round(v * 10) / 10;
export const FONT_FAMILY = "KaiStudio";
const fillColor = (c: string) => safeColor(c, "#000000");

/**
 * The design as a standalone SVG. `fontCss` is an @font-face block with the font as a data: URL (an SVG drawn as an
 * image can't load anything else). Images are <image> elements: inside an image no script or link ever runs.
 */
export function svgOf(format: FormatId, els: El[], measure: Measure, fontCss = ""): string {
  const { w, h } = FORMATS[format];
  const defs: string[] = [];
  const body: string[] = [];
  let id = 0;
  const op = (o: number) => (o < 1 ? ` opacity="${n(Math.max(0, o))}"` : "");
  for (const p of draw(els, measure)) {
    if (p.kind === "rect") {
      let fill: string;
      if (p.fill.kind === "solid") fill = fillColor(p.fill.color);
      else {
        const g = `g${id++}`;
        const [a, b] = p.fill.stops;
        const dir = p.fill.dir === "diag" ? `x1="0" y1="0" x2="1" y2="1"` : `x1="0" y1="0" x2="0" y2="1"`;
        defs.push(`<linearGradient id="${g}" ${dir}><stop offset="0" stop-color="${fillColor(a.color)}" stop-opacity="${n(a.opacity)}"/><stop offset="1" stop-color="${fillColor(b.color)}" stop-opacity="${n(b.opacity)}"/></linearGradient>`);
        fill = `url(#${g})`;
      }
      body.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${p.radius ? ` rx="${n(p.radius)}"` : ""} fill="${fill}"${op(p.opacity)}/>`);
    } else if (p.kind === "image") {
      let clip = "";
      if (p.clip) {
        const c = `c${id++}`;
        defs.push(`<clipPath id="${c}"><rect x="${n(p.clip.x)}" y="${n(p.clip.y)}" width="${n(p.clip.w)}" height="${n(p.clip.h)}"${p.clip.radius ? ` rx="${n(p.clip.radius)}"` : ""}/></clipPath>`);
        clip = ` clip-path="url(#${c})"`;
      }
      body.push(`<image href="${p.pic.src}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="xMidYMid meet"${clip}${op(p.opacity)}/>`);
    } else {
      // y is the top of the first line; the baseline sits ~0.9 em below it (Geist's ascent).
      const spans = p.lines.map((line, i) => `<tspan x="${n(p.x)}" y="${n(p.y + p.size * (0.9 + i * p.leading))}">${esc(line)}</tspan>`).join("");
      const anchor = p.anchor === "start" ? "" : ` text-anchor="${p.anchor}"`;
      body.push(`<text font-size="${n(p.size)}" font-weight="${p.weight}" fill="${p.color}"${anchor}${p.tracking ? ` letter-spacing="${n(p.tracking)}"` : ""}${op(p.opacity)}>${spans}</text>`);
    }
  }
  const style = `<style>${fontCss}text{font-family:${FONT_FAMILY},Arial,sans-serif}</style>`;
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
    const base = { id, name: typeof r.name === "string" ? r.name.slice(0, 40) : "Öğe", x: num(r.x), y: num(r.y), w: Math.max(1, num(r.w, 100)), h: Math.max(1, num(r.h, 100)), locked: r.locked === true, opacity: Math.min(1, Math.max(0, num(r.opacity, 1))) };
    if (r.kind === "text") {
      const bg = r.bg as { fill?: unknown; radius?: unknown } | undefined;
      out.push({
        ...base, kind: "text", text: typeof r.text === "string" ? r.text.slice(0, 2000) : "", role: (["tag", "title", "subtitle", "detail", "deco"] as const).find((x) => x === r.role),
        size: Math.max(4, num(r.size, 40)), weight: [300, 400, 500, 600, 700, 800, 900].includes(r.weight as number) ? (r.weight as number) : 400, color: safeColor(r.color, "#14263d"),
        align: r.align === "middle" || r.align === "end" ? r.align : "start", leading: Math.min(3, Math.max(0.8, num(r.leading, 1.2))), tracking: Math.min(50, Math.max(-10, num(r.tracking))),
        upper: r.upper === true, auto: r.auto === true, ...(bg && typeof bg === "object" ? { bg: { fill: safeColor(bg.fill, "#2e5e8c"), radius: Math.max(0, num(bg.radius)) } } : {}),
      });
    } else if (r.kind === "image") {
      const pic = storedPicture(r.pic);
      if (pic) out.push({ ...base, kind: "image", pic, fit: r.fit === "cover" ? "cover" : "contain", logo: r.logo === true, radius: Math.max(0, num(r.radius)) });
    } else if (r.kind === "shape") {
      const f = r.fill as Fill | undefined;
      const stop = (s: unknown) => ({ color: safeColor((s as { color?: unknown })?.color, "#000000"), opacity: Math.min(1, Math.max(0, num((s as { opacity?: unknown })?.opacity, 1))) });
      const fill: Fill = f?.kind === "linear" && Array.isArray(f.stops) ? { kind: "linear", dir: f.dir === "down" ? "down" : "diag", stops: [stop(f.stops[0]), stop(f.stops[1])] } : { kind: "solid", color: safeColor((f as { color?: unknown })?.color, "#14263d") };
      out.push({ ...base, kind: "shape", fill, radius: Math.max(0, num(r.radius)) });
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
