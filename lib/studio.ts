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
  | (Box & { kind: "image"; pic: Picture; fit: "cover" | "contain" })
  | { kind: "text"; x: number; y: number; size: number; lines: string[]; weight: number; color: string; leading: number; tracking?: number };

const HEX = /^#[0-9a-f]{6}$/i;
/** Colours come from a colour input or local storage: anything else falls back rather than reaching the SVG. */
export const safeColor = (c: unknown, fallback: string) => (typeof c === "string" && HEX.test(c) ? c.toLowerCase() : fallback);
const IMG = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
export const safePicture = (p: unknown): Picture | undefined => {
  const q = p as Picture | undefined;
  return q && typeof q.src === "string" && IMG.test(q.src) && q.w > 0 && q.h > 0 ? { src: q.src, w: q.w, h: q.h } : undefined;
};

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
  | { t: "text"; text: string; size: number; min: number; lines: number; weight: number; color: string; leading?: number; flex?: boolean }
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
          { kind: "image", pic, fit: "contain", x: x + pad, y: top + (i.h - ih) / 2, w: lw, h: ih },
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
        draw: (top) => [
          { kind: "rect", fill: i.fill, x, y: top, w: tw + i.size * 1.6, h: ph, radius: ph / 2 },
          { kind: "text", x: x + i.size * 0.8, y: top + ph / 2 - i.size * 0.54, size: i.size, lines: [t], weight: 700, color: i.color, leading: 1, tracking },
        ],
      };
    }
    const leading = i.leading ?? 1.15;
    if (room < i.min * leading) return { h: 0, draw: () => [] };
    const fit = fitText(i.text.trim(), w, room, i.size, i.min, i.lines, i.weight, measure, leading);
    return { h: fit.lines.length * fit.size * leading, draw: (top) => [{ kind: "text", x, y: top, size: fit.size, lines: fit.lines, weight: i.weight, color: i.color, leading }] };
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
        { t: "text", text: c.title, size: (wide ? 92 : 100) * u, min: 48 * u, lines: 3, weight: 800, color: "#ffffff", leading: 1.06, before: 30 * u },
        { t: "text", text: c.subtitle, size: 38 * u, min: 26 * u, lines: 4, weight: 400, color: "#e3eaf2", leading: 1.3, flex: true, before: 26 * u },
        { t: "bar", w: 96 * u, h: 8 * u, fill: accent, before: 36 * u },
        { t: "text", text: c.detail, size: 34 * u, min: 24 * u, lines: 2, weight: 700, color: "#ffffff", before: 22 * u },
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
      { kind: "text", x: m - 6 * u, y: m - 40 * u, size: 260 * u, lines: ["“"], weight: 800, color: accent, leading: 1 },
      ...col(w - m - 260 * u, 260 * u, m, 120 * u, "down", [{ t: "logo", pic: logo, h: 92 * u }]).map((l) => (l.kind === "image" ? { ...l, x: w - m - l.w } : l)),
    ];
    const foot = col(m, cw, h - m, 200 * u, "up", [
      { t: "bar", w: 64 * u, h: 6 * u, fill: accent },
      { t: "text", text: c.subtitle, size: 38 * u, min: 28 * u, lines: 1, weight: 700, color: ink, before: 26 * u },
      { t: "text", text: c.detail, size: 30 * u, min: 24 * u, lines: 2, weight: 400, color: soft, before: 10 * u },
    ]);
    const footTop = Math.min(h - m, ...foot.map((l) => l.y));
    const top = m + 230 * u;
    L.push(...col(m, cw, top, footTop - top - 60 * u, "down", [{ t: "text", text: c.title, size: (wide ? 72 : 78) * u, min: 36 * u, lines: 9, weight: 600, color: ink, leading: 1.25, flex: true }]));
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
      { t: "text", text: c.detail, size: 30 * u, min: 22 * u, lines: 2, weight: 600, color: ink, before: 24 * u },
    ]);
    const headEnd = head.length ? Math.max(...head.map((l) => l.y + (l.kind === "text" ? l.size * 1.2 : l.h))) : m;
    const top = Math.max(headEnd + 60 * u, h * (wide ? 0.3 : h / w > 1.5 ? 0.32 : 0.26));
    const footTop = Math.min(h - m, ...foot.map((l) => l.y));
    L.push(...head, ...foot);
    L.push(
      ...col(m, cw, top, footTop - top - 50 * u, "down", [
        { t: "text", text: c.title, size: (wide ? 190 : 210) * u, min: 64 * u, lines: 2, weight: 800, color: ink, leading: 1.02 },
        { t: "text", text: c.subtitle, size: 46 * u, min: 28 * u, lines: 5, weight: 400, color: ink, leading: 1.3, flex: true, before: 34 * u },
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
      { t: "text", text: c.title, size: (wide ? 88 : 92) * u, min: 44 * u, lines: 3, weight: 800, color: primary, leading: 1.08, before: 30 * u },
      { t: "bar", w: 104 * u, h: 9 * u, fill: accent, before: 30 * u },
      { t: "text", text: c.subtitle, size: 38 * u, min: 26 * u, lines: 6, weight: 400, color: "#334a63", leading: 1.32, flex: true, before: 28 * u },
      { t: "text", text: c.detail, size: 32 * u, min: 24 * u, lines: 2, weight: 700, color: accent, before: 26 * u },
    ]),
  );
  return L;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.round(v * 10) / 10;
export const FONT_FAMILY = "KaiStudio";

/**
 * The design as a standalone SVG. `fontCss` is an @font-face block with the font as a data: URL (an SVG drawn as an
 * image can't load anything else). Images are <image> elements: inside an image no script or link ever runs.
 */
export function toSvg(d: Design, measure: Measure, fontCss = ""): string {
  const { w, h } = FORMATS[d.format];
  const defs: string[] = [];
  const body: string[] = [];
  let id = 0;
  for (const l of layout(d, measure)) {
    if (l.kind === "rect") {
      body.push(`<rect x="${n(l.x)}" y="${n(l.y)}" width="${n(l.w)}" height="${n(l.h)}"${l.radius ? ` rx="${n(l.radius)}"` : ""} fill="${l.fill}"/>`);
    } else if (l.kind === "gradient" || l.kind === "fade") {
      const g = `g${id++}`;
      defs.push(
        l.kind === "gradient"
          ? `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l.a}"/><stop offset="1" stop-color="${l.b}"/></linearGradient>`
          : `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.color}" stop-opacity="${l.from}"/><stop offset="1" stop-color="${l.color}" stop-opacity="${l.to}"/></linearGradient>`,
      );
      body.push(`<rect x="${n(l.x)}" y="${n(l.y)}" width="${n(l.w)}" height="${n(l.h)}" fill="url(#${g})"/>`);
    } else if (l.kind === "image") {
      // cover: fills the box, clipped; contain: the box already has the picture's aspect ratio (the logo is never cropped).
      if (l.fit === "cover") {
        const c = `c${id++}`;
        defs.push(`<clipPath id="${c}"><rect x="${n(l.x)}" y="${n(l.y)}" width="${n(l.w)}" height="${n(l.h)}"/></clipPath>`);
        const s = Math.max(l.w / l.pic.w, l.h / l.pic.h);
        const iw = l.pic.w * s;
        const ih = l.pic.h * s;
        body.push(`<image href="${l.pic.src}" x="${n(l.x + (l.w - iw) / 2)}" y="${n(l.y + (l.h - ih) / 2)}" width="${n(iw)}" height="${n(ih)}" preserveAspectRatio="none" clip-path="url(#${c})"/>`);
      } else {
        body.push(`<image href="${l.pic.src}" x="${n(l.x)}" y="${n(l.y)}" width="${n(l.w)}" height="${n(l.h)}" preserveAspectRatio="xMidYMid meet"/>`);
      }
    } else {
      // y is the top of the first line; the baseline sits ~0.9 em below it (Geist's ascent).
      const spans = l.lines.map((line, i) => `<tspan x="${n(l.x)}" y="${n(l.y + l.size * (0.9 + i * l.leading))}">${esc(line)}</tspan>`).join("");
      body.push(`<text font-size="${n(l.size)}" font-weight="${l.weight}" fill="${l.color}"${l.tracking ? ` letter-spacing="${n(l.tracking)}"` : ""}>${spans}</text>`);
    }
  }
  const style = `<style>${fontCss}text{font-family:${FONT_FAMILY},Arial,sans-serif}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${style}${defs.join("")}</defs>${body.join("")}</svg>`;
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
