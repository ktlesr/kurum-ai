// The studio's own image templates. Each has its own grid, type pairing and way of using a photo, not a recolour of the
// others. A family only arranges: text fitting, colours and fonts come through `Ctx`, so this file holds no runtime import
// of lib/studio.ts (which calls it). Every colour derives from the brand or is one of the fixed neutrals below, so a brand
// change follows (recolor in app/studio/studio.tsx lists the same shades).
import type { Content, Item, Layer, Picture, ShapeEl } from "./studio.ts";

export const FAMILY_TEMPLATES = {
  atlas: { label: "Kent Atlası", hint: "Pafta ızgarası, odak dairesi", kind: "gorsel", fonts: ["manrope"] },
  manset: { label: "Manşet", hint: "Gazete birinci sayfası", kind: "gorsel", fonts: ["playfair-display", "work-sans"] },
  etki: { label: "Etki Raporu", hint: "Dev rakam, ölçü cetveli", kind: "gorsel", fonts: ["archivo-black", "dm-sans"] },
  muhur: { label: "Resmî Duyuru", hint: "Çift çerçeve ve mühür", kind: "gorsel", fonts: ["lora"] },
  ajanda: { label: "Kültür Ajandası", hint: "Geometrik afiş blokları", kind: "gorsel", fonts: ["poppins"] },
  isik: { label: "Işık", hint: "Tam sayfa çift tonlu fotoğraf", kind: "gorsel", fonts: ["montserrat"] },
  pano: { label: "Pano", hint: "Eğik kesimli renk paneli", kind: "gorsel", fonts: ["oswald", "rubik"] },
  takvim: { label: "Takvim", hint: "Önce tarih, sonra konu", kind: "gorsel", fonts: ["bebas-neue", "nunito"] },
} as const;
export type FamilyId = keyof typeof FAMILY_TEMPLATES;

export const FAMILY_SAMPLES: Record<FamilyId, Content> = {
  atlas: { tag: "Şehir", title: "Sanayi alanları yeniden planlanıyor", subtitle: "Üç ilçede ortak yol haritası için paydaş görüşmeleri başladı.", detail: "Kasım 2026 · Bölge Ofisi" },
  manset: { tag: "Gündem", title: "Yeni destek programı açıklandı", subtitle: "Başvurular bu yıl tek pencereden alınacak; süreç 45 günden 20 güne iniyor.", detail: "Basın Bülteni · 1 Kasım 2026" },
  etki: { tag: "Etki", title: "%42", subtitle: "Destek başvurularında geçen yıla göre artış.", detail: "Kaynak: 2026 faaliyet raporu" },
  muhur: { tag: "Duyuru", title: "Çalışma saatlerinde düzenleme", subtitle: "Hizmet binamız 3 Kasım'dan itibaren hafta içi 08.30-17.30 saatleri arasında açıktır.", detail: "Genel Sekreterlik" },
  ajanda: { tag: "Etkinlik", title: "Kent Kitap Günleri", subtitle: "Yazar buluşmaları, atölyeler ve çocuk etkinlikleri üç gün boyunca sizleri bekliyor.", detail: "14-16 Kasım · Kültür Merkezi" },
  isik: { tag: "Fotoğraf", title: "Bölgenin geleceğine birlikte bakıyoruz", subtitle: "Genç girişimciler kalkınma buluşmasında bir araya geldi.", detail: "12 Kasım 2026" },
  pano: { tag: "Çağrı", title: "Başvurular açıldı", subtitle: "Proje fikrinizi son başvuru tarihine kadar çevrim içi olarak iletebilirsiniz.", detail: "Son gün: 30 Kasım" },
  takvim: { tag: "Takvim", title: "Yatırım Danışma Günü", subtitle: "Uzmanlarımızla birebir görüşme için yerinizi ayırtın.", detail: "12 Kasım 2026" },
};

export const FAMILY_HINTS: Record<FamilyId, string> = {
  atlas: "Şablon: kent atlası. Şehir, bölge ya da planlama konularına uygun kısa bir başlık.",
  manset: "Şablon: gazete manşeti. baslik bir haber başlığı gibi yazılsın, altBaslik haberin özeti olsun.",
  etki: "Şablon: etki raporu. baslik öne çıkan rakam ya da 2-4 kelimelik çok kısa mesaj olsun, altBaslik rakamın ne anlattığını açıklasın.",
  muhur: "Şablon: resmî duyuru. Ciddi ve kurumsal bir dil kullan; detay duyuruyu yapan birim olsun.",
  ajanda: "Şablon: kültür etkinliği afişi. baslik etkinliğin adı, detay tarih ve yer.",
  isik: "Şablon: tam sayfa fotoğraf. baslik kısa ve etkileyici, en fazla 6 kelime.",
  pano: "Şablon: çağrı panosu. baslik 2-3 kelimelik güçlü bir çağrı, altBaslik yapılacak işi söylesin.",
  takvim: "Şablon: takvim. detay tarih olsun ve kullanıcı vermediyse boş kalsın, baslik etkinliğin ya da işin adı.",
};

export interface Ctx {
  w: number; h: number; u: number; m: number; wide: boolean; tall: boolean;
  primary: string; accent: string; photo?: Picture; logo?: Picture; c: Content;
  inkOn: (bg: string) => string;
  shade: (hex: string, amount: number) => string;
  /** Head from `top` down, foot from `bottom` up, body in what is left between them. */
  flow: (x: number, cw: number, top: number, bottom: number, parts: { head?: Item[]; body?: Item[]; foot?: Item[]; gap?: number; footShare?: number }) => Layer[];
}

const PAPER = "#f5f1e8";
const WHITE = "#ffffff";

const el = (x: number, y: number, w: number, h: number, name: string, color: string, rest: Pick<Partial<ShapeEl>, "shape" | "points" | "noFill" | "stroke" | "opacity" | "radius"> = {}): Layer =>
  ({ kind: "el", x, y, w, h, name, fill: { kind: "solid", color }, ...rest });
const rect = (x: number, y: number, w: number, h: number, fill: string, radius?: number): Layer => ({ kind: "rect", x, y, w, h, fill, radius });
const ring = (x: number, y: number, s: number, name: string, color: string, width: number, opacity = 1): Layer =>
  el(x, y, s, s, name, color, { shape: "ellipse", noFill: true, stroke: { color, width }, opacity });
const disc = (x: number, y: number, s: number, name: string, color: string, opacity = 1): Layer => el(x, y, s, s, name, color, { shape: "ellipse", opacity });
const poly = (x: number, y: number, w: number, h: number, name: string, color: string, points: [number, number][], opacity = 1): Layer =>
  el(x, y, w, h, name, color, { shape: "poly", points, opacity });
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const arc = (from: number, to: number, cx: number, cy: number, steps = 24): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [round4(cx + Math.cos(a)), round4(cy + Math.sin(a))] as [number, number];
  });
const seal = (k: number, inner: number): [number, number][] =>
  Array.from({ length: 2 * k }, (_, i) => {
    const r = i % 2 ? 0.5 * inner : 0.5;
    const a = -Math.PI / 2 + (i * Math.PI) / k;
    return [round4(0.5 + r * Math.cos(a)), round4(0.5 + r * Math.sin(a))] as [number, number];
  });

const pill = (x: Ctx, fill: string, color: string, font?: string, before?: number): Item => ({ t: "pill", text: x.c.tag, size: 26 * x.u, fill, color, font, before });
const title = (x: Ctx, o: { size: number; min?: number; lines?: number; weight?: number; color: string; font?: string; leading?: number; before?: number; align?: "middle" }): Item =>
  ({ t: "text", role: "title", text: x.c.title, min: o.min ?? 44 * x.u, lines: o.lines ?? 4, weight: o.weight ?? 800, leading: o.leading ?? 1.08, ...o });
const sub = (x: Ctx, o: { color: string; font?: string; size?: number; lines?: number; before?: number; align?: "middle" }): Item =>
  ({ t: "text", role: "subtitle", text: x.c.subtitle, size: o.size ?? 36 * x.u, min: 24 * x.u, lines: o.lines ?? 5, weight: 400, leading: 1.34, flex: true, ...o });
const detail = (x: Ctx, o: { color: string; font?: string; weight?: number; size?: number; before?: number; align?: "middle" }): Item =>
  ({ t: "text", role: "detail", text: x.c.detail, size: o.size ?? 30 * x.u, min: 22 * x.u, lines: 2, weight: o.weight ?? 600, ...o });
const logoOf = (x: Ctx, h = 84): Item => ({ t: "logo", pic: x.logo, h: h * x.u });

/** A survey sheet: faint grid, a focus circle like a map's marked area (with the photo in it), text below or beside. */
function atlas(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo } = x;
  const L: Layer[] = [rect(0, 0, w, h, PAPER)];
  const cols = wide ? 8 : 5;
  const cell = w / cols;
  for (let i = 1; i < cols; i++) L.push(el(cell * i, 0, 1.5 * u, h, "Pafta çizgisi", primary, { opacity: 0.14 }));
  for (let i = 1; i * cell < h; i++) L.push(el(0, cell * i, w, 1.5 * u, "Pafta çizgisi", primary, { opacity: 0.14 }));
  const s = wide ? h * 0.72 : x.tall ? w * 0.66 : h * 0.4;
  const cx = wide ? w - m * 1.2 - s / 2 : w - m - s / 2 + s * 0.08;
  const cy = wide ? h / 2 : m + s / 2 + (x.tall ? 200 * u : 0);
  L.push(ring(cx - s * 0.62, cy - s * 0.62, s * 1.24, "Odak halkası", accent, 2 * u, 0.5), ring(cx - s * 0.56, cy - s * 0.56, s * 1.12, "Odak halkası", accent, 4 * u));
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: cx - s / 2, y: cy - s / 2, w: s, h: s, radius: s / 2 });
  else L.push(disc(cx - s / 2, cy - s / 2, s, "Odak", primary), disc(cx - s * 0.09, cy - s * 0.09, s * 0.18, "Nokta", accent));
  const cw = wide ? w * 0.5 - m : w - 2 * m;
  const top = wide ? m : cy + s * 0.62 + 36 * u;
  const font = "manrope";
  return [
    ...L,
    ...(wide ? [] : x.flow(m, w * 0.42, m + (x.tall ? 150 * u : 0), cy, { head: [logoOf(x)] })),
    ...x.flow(m, cw, top, h - m - (x.tall ? 170 * u : 0), {
      head: wide ? [logoOf(x), pill(x, accent, x.inkOn(accent), font, 36 * u)] : [pill(x, accent, x.inkOn(accent), font)],
      body: [title(x, { size: 88 * u, color: primary, font, leading: 1.06, before: 0 }), sub(x, { color: "#3f4c58", font, before: 24 * u })],
      foot: [{ t: "bar", w: cw, h: 3 * u, fill: primary }, detail(x, { color: primary, font, weight: 700, before: 18 * u })],
      gap: 26 * u,
    }),
  ];
}

/** A front page: masthead rules, a large serif headline, the photo as the lead picture. */
function manset(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo } = x;
  const serif = "playfair-display", sans = "work-sans";
  const L: Layer[] = [rect(0, 0, w, h, WHITE)];
  const band = photo ? (wide ? w * 0.4 : h * 0.34) : 0;
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: wide ? w - band : 0, y: wide ? 0 : h - band, w: wide ? band : w, h: wide ? h : band });
  const cw = (wide ? w - band : w) - 2 * m;
  const safe = x.tall ? 150 * u : 0;
  return [
    ...L,
    ...x.flow(m, cw, m + safe, (wide ? h : h - band) - m * 0.8 - (photo ? 0 : safe), {
      head: [
        logoOf(x, 76),
        { t: "bar", w: cw, h: 10 * u, fill: primary, before: 26 * u },
        pill(x, WHITE, accent, sans, 8 * u),
        { t: "bar", w: cw, h: 2 * u, fill: primary, before: 8 * u },
      ],
      body: [
        title(x, { size: (wide ? 112 : 136) * u, min: 48 * u, weight: 700, color: primary, font: serif, leading: 1.04 }),
        sub(x, { color: "#37414b", font: serif, size: 42 * u, before: 32 * u }),
      ],
      foot: [{ t: "bar", w: cw, h: 2 * u, fill: primary }, detail(x, { color: primary, font: sans, size: 26 * u, before: 14 * u })],
      gap: 34 * u,
    }),
  ];
}

/** A report's key figure: a huge number over a measuring rule. The rule is decoration: every tick the same, no data in it. */
function etki(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, shade } = x;
  const display = "archivo-black", text = "dm-sans";
  const deep = shade(primary, -0.25);
  const ink = x.inkOn(deep);
  const safe = x.tall ? 150 * u : 0;
  const s = Math.min(w, h) * 0.86;
  const L: Layer[] = [
    rect(0, 0, w, h, deep),
    poly(w - s, h - s, s, s, "Çeyrek daire", accent, [[1, 0], ...arc(-Math.PI / 2, -Math.PI, 1, 1), [1, 1]], 0.22),
  ];
  const cw = (wide ? w * 0.72 : w) - 2 * m;
  const ticks = wide ? 48 : 30;
  const gapX = (w - 2 * m) / (ticks - 1);
  const ruleY = m + safe;
  for (let i = 0; i < ticks; i++) L.push(rect(m + i * gapX - 1.5 * u, ruleY, 3 * u, (i % 5 ? 16 : 34) * u, i % 5 ? ink : accent));
  return [
    ...L,
    ...x.flow(m, cw, ruleY + 66 * u, h - m - safe, {
      head: [logoOf(x), pill(x, accent, x.inkOn(accent), text, 28 * u)],
      body: [
        title(x, { size: (wide ? 230 : 250) * u, min: 64 * u, lines: 2, weight: 400, color: ink, font: display, leading: 1 }),
        sub(x, { color: ink, font: text, size: 44 * u, before: 26 * u }),
      ],
      foot: [detail(x, { color: ink, font: text, size: 26 * u, weight: 500 })],
      gap: 54 * u,
    }),
  ];
}

/** An official notice: a double frame, a seal holding the logo, everything centred in a serif. */
function muhur(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent, logo } = x;
  const font = "lora";
  const a = m * 0.42, b = a + 14 * u;
  const safe = x.tall ? 140 * u : 0;
  const s = 170 * u;
  const L: Layer[] = [
    rect(0, 0, w, h, PAPER),
    el(a, a, w - 2 * a, h - 2 * a, "Dış çerçeve", primary, { noFill: true, stroke: { color: primary, width: 7 * u } }),
    el(b, b, w - 2 * b, h - 2 * b, "İç çerçeve", primary, { noFill: true, stroke: { color: primary, width: 2 * u } }),
  ];
  const sx = w / 2 - s / 2, sy = m + 34 * u + safe;
  L.push(poly(sx, sy, s, s, "Mühür", primary, seal(18, 0.9)), ring(sx + s * 0.08, sy + s * 0.08, s * 0.84, "Mühür halkası", WHITE, 2.5 * u));
  if (logo) {
    const lh = s * 0.5, lw = Math.min(s * 0.62, lh * (logo.w / logo.h)), ih = lw / (logo.w / logo.h);
    L.push(disc(sx + s * 0.1, sy + s * 0.1, s * 0.8, "Mühür zemini", WHITE), { kind: "image", pic: logo, fit: "contain", logo: true, x: w / 2 - lw / 2, y: sy + s / 2 - ih / 2, w: lw, h: ih });
  } else L.push(poly(sx + s * 0.32, sy + s * 0.3, s * 0.36, s * 0.36, "Yıldız", WHITE, seal(5, 0.45)));
  const cw = Math.min(w - 2 * b - 2 * m * 0.6, w * 0.8);
  return [
    ...L,
    ...x.flow((w - cw) / 2, cw, sy + s + 30 * u, h - m - 20 * u - safe, {
      head: [pill(x, primary, x.inkOn(primary), font)].map((p) => ({ ...p, center: true })),
      body: [
        title(x, { size: 82 * u, min: 42 * u, weight: 700, color: primary, font, leading: 1.14, align: "middle" }),
        { t: "bar", w: 90 * u, h: 4 * u, fill: accent, before: 28 * u, center: true },
        sub(x, { color: "#3a3a36", font, size: 34 * u, before: 28 * u, align: "middle" }),
      ],
      foot: [detail(x, { color: primary, font, weight: 700, align: "middle" })],
      gap: 26 * u,
    }),
  ];
}

/** A poster of geometric blocks (the photo takes one when there is one); the text on paper beside them. */
function ajanda(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo, shade } = x;
  const font = "poppins";
  const pale = shade(accent, 0.75);
  const cols = wide ? 3 : 4, rows = wide ? 3 : x.tall ? 3 : 2;
  const cell = wide ? h / rows : w / cols;
  const ox = wide ? w - cell * cols : 0;
  const oy = x.tall ? 110 * u : 0;
  const L: Layer[] = [rect(0, 0, w, h, PAPER)];
  const shapes = [
    (a: number, b: number) => [rect(a, b, cell, cell, primary), poly(a, b, cell, cell, "Çeyrek", accent, [[0, 0], ...arc(0, Math.PI / 2, 0, 0)])],
    (a: number, b: number) => [rect(a, b, cell, cell, pale), disc(a + cell * 0.12, b + cell * 0.12, cell * 0.76, "Daire", primary)],
    (a: number, b: number) => [rect(a, b, cell, cell, accent), poly(a, b, cell, cell * 0.5, "Yarım", WHITE, Array.from({ length: 25 }, (_, i) => [round4(0.5 + 0.5 * Math.cos((i * Math.PI) / 24)), round4(Math.sin((i * Math.PI) / 24))] as [number, number]), 0.9)],
    (a: number, b: number) => [rect(a, b, cell, cell, primary), poly(a + cell * 0.2, b + cell * 0.2, cell * 0.6, cell * 0.6, "Dörtlü", pale, seal(4, 0.38))],
    (a: number, b: number) => [rect(a, b, cell, cell, pale), poly(a, b, cell, cell, "Üçgen", accent, [[0, 1], [1, 0], [1, 1]])],
    (a: number, b: number) => [rect(a, b, cell, cell, accent), ring(a + cell * 0.18, b + cell * 0.18, cell * 0.64, "Halka", WHITE, 14 * u)],
  ];
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) L.push(...shapes[(k++ + r) % shapes.length](ox + c * cell, oy + r * cell));
  if (photo) {
    const big = cell * 2;
    L.push({ kind: "image", pic: photo, fit: "cover", x: ox + (wide ? cell : 0), y: oy, w: big, h: big });
  }
  const top = wide ? m : oy + rows * cell + m * 0.6;
  const cw = (wide ? ox : w) - 2 * m;
  return [
    ...L,
    ...x.flow(m, cw, top, h - m * 0.8 - (x.tall ? 130 * u : 0), {
      head: wide ? [logoOf(x), pill(x, primary, x.inkOn(primary), font, 30 * u)] : [pill(x, primary, x.inkOn(primary), font)],
      body: [title(x, { size: (wide ? 92 : 84) * u, min: 40 * u, weight: 800, color: primary, font, leading: 1.08 }), sub(x, { color: "#3f3f3a", font, size: 30 * u, lines: 4, before: 18 * u })],
      foot: [detail(x, { color: accent, font, weight: 700 }), ...(wide ? [] : [logoOf(x, 58)].map((l) => ({ ...l, before: 16 * u })))],
      gap: 20 * u,
    }),
  ];
}

/** The picture is the page: toned in the brand colour, a thin frame set in, the words at its foot. */
function isik(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo, shade } = x;
  const font = "montserrat";
  const deep = shade(primary, -0.6);
  const L: Layer[] = [{ kind: "gradient", x: 0, y: 0, w, h, a: shade(primary, -0.25), b: accent }];
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: 0, y: 0, w, h }, el(0, 0, w, h, "Renk tonu", primary, { opacity: 0.42 }));
  else {
    const s = Math.max(w, h) * 0.9;
    L.push(ring(w - s * 0.72, -s * 0.3, s, "Işık halkası", WHITE, 2 * u, 0.3), ring(w - s * 0.58, -s * 0.16, s * 0.72, "Işık halkası", WHITE, 2 * u, 0.4), ring(w - s * 0.44, -s * 0.02, s * 0.44, "Işık halkası", WHITE, 2 * u, 0.55));
  }
  L.push({ kind: "fade", x: 0, y: h * 0.28, w, h: h * 0.72, color: deep, from: 0, to: 0.92 });
  const a = m * 0.45;
  L.push(el(a, a, w - 2 * a, h - 2 * a, "Çerçeve", WHITE, { noFill: true, stroke: { color: WHITE, width: 3 * u }, opacity: 0.75 }));
  const safe = x.tall ? 180 * u : 0;
  return [
    ...L,
    ...x.flow(m + a * 0.5, (wide ? w * 0.66 : w) - 2 * m - a, m + a * 0.5 + safe, h - m - a * 0.5 - safe, {
      head: [{ t: "logo", pic: x.logo, h: 96 * u, plate: true }],
      foot: [
        pill(x, accent, x.inkOn(accent), font),
        title(x, { size: (wide ? 88 : 96) * u, min: 44 * u, lines: 4, weight: 800, color: WHITE, font, leading: 1.06, before: 26 * u }),
        sub(x, { color: "#e8edf2", font, size: 34 * u, lines: 3, before: 22 * u }),
        detail(x, { color: WHITE, font, weight: 700, before: 26 * u }),
      ],
      footShare: 0.8,
    }),
  ];
}

/** A slanted slab of colour over the photo or a second colour; a call to action in tall condensed letters. */
function pano(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo } = x;
  const display = "oswald", text = "rubik";
  const ink = x.inkOn(primary);
  const L: Layer[] = [rect(0, 0, w, h, accent)];
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: 0, y: 0, w, h });
  // Wide: slanted on its right edge; otherwise on its lower edge.
  L.push(wide
    ? poly(0, 0, w * 0.68, h, "Panel", primary, [[0, 0], [1, 0], [0.84, 1], [0, 1]])
    : poly(0, 0, w, h * 0.76, "Panel", primary, [[0, 0], [1, 0], [1, 0.84], [0, 1]]));
  const safe = x.tall ? 170 * u : 0;
  const cw = (wide ? w * 0.54 : w) - 2 * m + (wide ? m : 0);
  return [
    ...L,
    ...x.flow(m, cw, m + safe, (wide ? h - m : h * 0.76 * 0.84 - m * 0.4), {
      head: [logoOf(x), pill(x, accent, x.inkOn(accent), text, 26 * u)],
      body: [
        title(x, { size: (wide ? 130 : 138) * u, min: 52 * u, lines: 3, weight: 700, color: ink, font: display, leading: 1.04 }),
        sub(x, { color: ink, font: text, size: 32 * u, lines: 4, before: 20 * u }),
      ],
      foot: [detail(x, { color: ink, font: text, weight: 600 })],
      gap: 24 * u,
    }),
  ];
}

/** The date is the headline: a colour block with it in tall letters, the subject under it. */
function takvim(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo } = x;
  const display = "bebas-neue", text = "nunito";
  const ink = x.inkOn(primary);
  const safe = x.tall ? 170 * u : 0;
  const blockW = wide ? w * 0.42 : w;
  const blockH = wide ? h : h * 0.42 + safe;
  const L: Layer[] = [rect(0, 0, w, h, WHITE), rect(0, 0, blockW, blockH, primary)];
  const strip = photo && !wide ? h * 0.2 : 0; // the picture under the text, never over the date
  if (photo) L.push(wide ? { kind: "image", pic: photo, fit: "cover", x: blockW, y: 0, w: w - blockW, h: h * 0.42 } : { kind: "image", pic: photo, fit: "cover", x: 0, y: h - strip, w, h: strip });
  // Calendar rings along the block's top.
  const n = wide ? 5 : 6;
  for (let i = 0; i < n; i++) L.push(rect(m + (i * (blockW - 2 * m - 18 * u)) / (n - 1), safe, 18 * u, 56 * u, accent, 9 * u));
  const blockFlow = x.flow(m, blockW - 2 * m, 56 * u + safe + 34 * u, blockH - m * 0.6, {
    head: [logoOf(x, 70)],
    body: [detail(x, { color: ink, font: display, size: (wide ? 150 : 170) * u, weight: 400, before: 0 })].map((d) => ({ ...d, min: 56 * u, lines: 3, leading: 1 })),
  });
  const below = x.flow(wide ? blockW + m : m, (wide ? w - blockW : w) - 2 * m, wide ? (photo ? h * 0.42 : 0) + m : blockH + m * 0.6, h - strip - (strip ? m * 0.5 : m + safe * 0.7), {
    head: [pill(x, accent, x.inkOn(accent), text)],
    body: [title(x, { size: 104 * u, min: 42 * u, weight: 800, color: primary, font: text, leading: 1.08 }), sub(x, { color: "#3f4c58", font: text, size: 40 * u, before: 24 * u })],
    gap: 26 * u,
  });
  return [...L, ...blockFlow, ...below];
}

export const FAMILIES: Record<FamilyId, (x: Ctx) => Layer[]> = { atlas, manset, etki, muhur, ajanda, isik, pano, takvim };
