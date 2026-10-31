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
  rapor: { label: "Rapor Kapağı", hint: "Koyu sırt, büyük yıl ya da etiket", kind: "gorsel", fonts: ["merriweather", "inter"] },
  mozaik: { label: "Mozaik", hint: "Fotoğraf ve renk karoları", kind: "gorsel", fonts: ["raleway"] },
  ilke: { label: "İlke", hint: "Çizgiler arasında tek cümle", kind: "gorsel", fonts: ["playfair-display", "lato"] },
  sahne: { label: "Sahne", hint: "Dev etiket, kemer biçimli fotoğraf", kind: "gorsel", fonts: ["anton", "open-sans"] },
  kanca: { label: "Kanca", hint: "İlk 3 saniye: dev başlık", kind: "reels", fonts: ["anton", "rubik"] },
  perde: { label: "Perde", hint: "Tam ekran fotoğraf, alt yazı", kind: "reels", fonts: ["oswald", "rubik"] },
  adim: { label: "Adım", hint: "Numara ve kısa açıklama", kind: "reels", fonts: ["bebas-neue", "manrope"] },
  rakamr: { label: "Dev Rakam", hint: "Tek rakam, ortada", kind: "reels", fonts: ["anton", "dm-sans"] },
  soz: { label: "Söz", hint: "Karanlık zeminde alıntı", kind: "reels", fonts: ["playfair-display", "dm-sans"] },
  kapanis: { label: "Kapanış", hint: "Logo ve çağrı", kind: "reels", fonts: ["montserrat"] },
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
  rapor: { tag: "2026", title: "Faaliyet Raporu", subtitle: "Bölgesel kalkınma çalışmalarının bir yıllık özeti.", detail: "Yayın: Kasım 2026" },
  mozaik: { tag: "Galeri", title: "Bölgemizden kareler", subtitle: "Bir yılın saha çalışmaları, buluşmaları ve üretim hikâyeleri.", detail: "Sergi: 20-30 Kasım" },
  ilke: { tag: "İlkemiz", title: "Kalkınma, herkesin katıldığı bir çalışmadır.", subtitle: "", detail: "Kurumsal değerlerimiz" },
  sahne: { tag: "Canlı", title: "Gençlik Zirvesi", subtitle: "Girişimciler, kamu kurumları ve üniversiteler aynı sahnede.", detail: "22 Kasım · Kongre Merkezi" },
  kanca: { tag: "Duyuru", title: "Bunu kaçırmayın", subtitle: "30 saniyede öğrenin", detail: "" },
  perde: { tag: "Bölgemiz", title: "Başvurular artık tek adresten", subtitle: "Süreç 45 günden 20 güne iniyor.", detail: "" },
  adim: { tag: "1", title: "Hesabınızı açın", subtitle: "Kimlik bilgilerinizle giriş yapın.", detail: "" },
  rakamr: { tag: "2026", title: "%42", subtitle: "Destek başvurularındaki artış", detail: "Kaynak: faaliyet raporu" },
  soz: { tag: "", title: "Kalkınma, birlikte yürüttüğümüz bir yolculuktur.", subtitle: "Ad Soyad", detail: "Genel Sekreter" },
  kapanis: { tag: "", title: "Hemen başvurun", subtitle: "Ayrıntılar web sitemizde", detail: "kurum.gov.tr" },
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
  rapor: "Şablon: rapor kapağı. etiket yıl ya da dönem olsun, baslik raporun adı.",
  mozaik: "Şablon: fotoğraf galerisi. baslik en fazla 4 kelime.",
  ilke: "Şablon: tek cümlelik ilke. baslik en fazla 10 kelimelik cümle, altBaslik boş kalabilir.",
  sahne: "Şablon: sahne etkinliği. etiket tek kelime, baslik etkinliğin adı, detay tarih ve yer.",
  kanca: "Şablon: Reels açılışı. baslik en fazla 4 kelime, merak uyandıran; altBaslik en fazla 5 kelime.",
  perde: "Şablon: Reels fotoğraf sahnesi. baslik en fazla 6 kelime, altBaslik tek kısa cümle.",
  adim: "Şablon: Reels adımı. etiket adımın numarası, baslik en fazla 3 kelime, altBaslik tek kısa cümle.",
  rakamr: "Şablon: Reels rakamı. baslik yalnızca rakam, altBaslik rakamın ne anlattığı; rakam uydurma.",
  soz: "Şablon: Reels alıntısı. baslik en fazla 12 kelimelik söz, altBaslik söyleyen, detay unvanı.",
  kapanis: "Şablon: Reels kapanışı. baslik en fazla 3 kelimelik çağrı, detay web adresi; kullanıcı vermediyse boş bırak.",
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

/** A printed report's cover: a dark spine down one side, the year or period large on it, a serif title on paper. */
function rapor(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo } = x;
  const safe = x.tall ? 150 * u : 0;
  const spine = wide ? w * 0.34 : w * 0.3;
  const L: Layer[] = [rect(0, 0, w, h, PAPER), rect(0, 0, spine, h, primary), rect(spine, 0, 10 * u, h, accent)];
  const px = spine + 10 * u;
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: px, y: 0, w: w - px, h: h * 0.42 });
  const ink = x.inkOn(primary);
  return [
    ...L,
    ...x.flow(m * 0.6, spine - m * 1.1, m + safe, h - m - safe, {
      head: [{ t: "logo", pic: x.logo, h: 76 * u, plate: true }],
      foot: [{ t: "text", role: "tag", text: x.c.tag.trim(), size: 92 * u, min: 34 * u, lines: 2, weight: 800, color: ink, font: "inter", leading: 1.05 }],
    }),
    ...x.flow(px + m * 0.7, w - px - m * 1.4, (photo ? h * 0.42 : safe) + m, h - m - safe, {
      body: [
        title(x, { size: 104 * u, min: 44 * u, lines: 5, weight: 700, color: primary, font: "merriweather", leading: 1.16 }),
        { t: "bar", w: 110 * u, h: 8 * u, fill: accent, before: 34 * u },
        sub(x, { color: "#3a4048", font: "inter", size: 34 * u, before: 30 * u }),
      ],
      foot: [detail(x, { color: primary, font: "inter", size: 26 * u })],
      gap: 24 * u,
    }),
  ];
}

/** Tiles of colour with the photo running through them; the words on a clean band. */
function mozaik(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo, shade } = x;
  const font = "raleway";
  const pale = shade(accent, 0.75);
  const safe = x.tall ? 130 * u : 0;
  const cols = wide ? 3 : 3, rows = wide ? 3 : 2;
  const gap = 12 * u;
  const areaW = wide ? w * 0.56 : w - 2 * m;
  const cell = wide ? (h - 2 * m - 2 * gap) / rows : (areaW - (cols - 1) * gap) / cols;
  const ox = wide ? w - m - cols * cell - (cols - 1) * gap : m, oy = wide ? m : m + safe;
  const L: Layer[] = [rect(0, 0, w, h, WHITE)];
  const tones = [primary, accent, pale, pale, primary, accent, accent, pale, primary];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) L.push(rect(ox + c * (cell + gap), oy + r * (cell + gap), cell, cell, tones[r * cols + c], 14 * u));
  const big = cell * 2 + gap;
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: ox + cell + gap, y: oy, w: big, h: rows > 1 ? big : cell, radius: 14 * u });
  else L.push(disc(ox + cell + gap + big * 0.14, oy + big * 0.14, big * 0.72, "Daire", WHITE, 0.9), ring(ox + cell + gap + big * 0.27, oy + big * 0.27, big * 0.46, "Halka", accent, 12 * u));
  const top = wide ? m : oy + rows * cell + (rows - 1) * gap + m * 0.6;
  return [
    ...L,
    ...x.flow(m, (wide ? ox : w) - 2 * m + (wide ? m * 0.5 : 0), top, h - m * 0.8 - safe * 0.8, {
      head: wide ? [logoOf(x), pill(x, accent, x.inkOn(accent), font, 30 * u)] : [pill(x, accent, x.inkOn(accent), font)],
      body: [title(x, { size: 92 * u, min: 42 * u, weight: 800, color: primary, font, leading: 1.1 }), sub(x, { color: "#3f4c58", font, size: 32 * u, lines: 4, before: 18 * u })],
      foot: [detail(x, { color: primary, font, weight: 700 })],
      gap: 20 * u,
    }),
  ];
}

/** A sentence between two rules, as on a wall: nothing else competes with it. */
function ilke(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent } = x;
  const safe = x.tall ? 170 * u : 0;
  const cw = Math.min(w - 2 * m, 1500 * u);
  const lx = (w - cw) / 2;
  return [
    rect(0, 0, w, h, primary),
    rect(lx, m + safe, cw, 2 * u, accent), rect(lx, h - m - safe, cw, 2 * u, accent),
    ...x.flow(lx, cw, m + safe + 34 * u, h - m - safe - 34 * u, {
      head: [{ ...pill(x, accent, x.inkOn(accent), "lato"), center: true } as Item],
      body: [
        title(x, { size: 112 * u, min: 48 * u, lines: 7, weight: 500, color: WHITE, font: "playfair-display", leading: 1.2, align: "middle", before: 0 }),
        sub(x, { color: "#d5dce4", font: "lato", size: 36 * u, lines: 3, before: 26 * u, align: "middle" }),
      ],
      foot: [{ ...logoOf(x, 70), center: true } as Item, detail(x, { color: "#d5dce4", font: "lato", size: 26 * u, weight: 400, before: 14 * u, align: "middle" })],
      gap: Math.max(50 * u, h * 0.1),
    }),
  ];
}

/** A stage: the photo in an arch, the tag enormous behind the title. */
function sahne(x: Ctx): Layer[] {
  const { w, h, u, m, wide, primary, accent, photo } = x;
  const safe = x.tall ? 150 * u : 0;
  const aw = wide ? h * 0.82 : w * 0.62;
  const ah = wide ? h * 0.94 : h * (x.tall ? 0.44 : 0.46); // short of the edge: arch and photo then refit alike
  const ax = wide ? w - m - aw : w - m - aw, ay = 0;
  const L: Layer[] = [rect(0, 0, w, h, accent)];
  L.push(el(ax, ay - aw * 0.5, aw, ah + aw * 0.5, "Kemer", primary, { radius: aw / 2 }));
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: ax + 18 * u, y: -aw * 0.5, w: aw - 36 * u, h: ah + aw * 0.5 - 18 * u, radius: (aw - 36 * u) / 2 });
  else L.push(ring(ax + aw * 0.2, ah - aw * 0.62, aw * 0.6, "Halka", accent, 10 * u));
  const ink = x.inkOn(accent);
  const top = wide ? m : ah + m * 0.5;
  return [
    ...L,
    ...x.flow(m, (wide ? ax : w) - m - (wide ? 40 * u : m), top + (wide ? safe : 0), h - m - safe, {
      head: wide ? [logoOf(x, 76)] : [],
      body: [
        { t: "text", role: "tag", text: x.c.tag.trim(), size: 150 * u, min: 60 * u, lines: 1, weight: 400, color: primary, font: "anton", leading: 1.08 },
        title(x, { size: 90 * u, min: 42 * u, lines: 3, weight: 800, color: ink, font: "open-sans", leading: 1.1, before: 10 * u }),
        sub(x, { color: ink, font: "open-sans", size: 32 * u, lines: 3, before: 18 * u }),
      ],
      foot: [detail(x, { color: ink, font: "open-sans", weight: 700 }), ...(wide ? [] : [{ ...logoOf(x, 62), before: 14 * u } as Item])],
      gap: 18 * u,
    }),
  ];
}

// ---- Reels: a phone's interface covers the top and the bottom, so the text keeps out of both on tall canvases --------
const safeOf = (x: Ctx) => (x.tall ? { top: x.h * 0.13, bottom: x.h * 0.2 } : { top: x.m, bottom: x.m });

/** The hook: one huge line on a diagonal split, read in under a second. */
function kanca(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent } = x;
  const safe = safeOf(x);
  const ink = x.inkOn(primary);
  return [
    rect(0, 0, w, h, primary),
    poly(0, h * 0.58, w, h * 0.42, "Eğik zemin", accent, [[0, 0.3], [1, 0], [1, 1], [0, 1]]),
    ...x.flow(m, w - 2 * m, safe.top, h - safe.bottom, {
      head: [logoOf(x, 80), pill(x, accent, x.inkOn(accent), "rubik", 26 * u)],
      body: [
        title(x, { size: 250 * u, min: 72 * u, lines: 4, weight: 400, color: ink, font: "anton", leading: 1.06 }),
        sub(x, { color: ink, font: "rubik", size: 46 * u, lines: 2, before: 28 * u }),
      ],
      gap: 40 * u,
    }),
  ];
}

/** The photo fills the screen, its words low in the safe area on a dark fade. */
function perde(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent, photo, shade } = x;
  const safe = safeOf(x);
  const L: Layer[] = [{ kind: "gradient", x: 0, y: 0, w, h, a: shade(primary, -0.25), b: accent }];
  if (photo) L.push({ kind: "image", pic: photo, fit: "cover", x: 0, y: 0, w, h });
  else L.push(ring(-w * 0.3, -w * 0.1, w * 1.1, "Halka", WHITE, 3 * u, 0.35), ring(w * 0.2, h * 0.12, w, "Halka", WHITE, 3 * u, 0.25));
  L.push({ kind: "fade", x: 0, y: h * 0.25, w, h: h * 0.75, color: shade(primary, -0.6), from: 0, to: 0.95 });
  L.push(rect(m, h - safe.bottom + 26 * u, 120 * u, 10 * u, accent, 5 * u));
  return [
    ...L,
    ...x.flow(m, w - 2 * m, safe.top, h - safe.bottom, {
      head: [{ t: "logo", pic: x.logo, h: 88 * u, plate: true }],
      foot: [
        pill(x, accent, x.inkOn(accent), "rubik"),
        title(x, { size: 124 * u, min: 52 * u, lines: 4, weight: 700, color: WHITE, font: "oswald", leading: 1.1, before: 26 * u }),
        sub(x, { color: "#eef2f6", font: "rubik", size: 42 * u, lines: 3, before: 22 * u }),
      ],
      footShare: 0.8,
    }),
  ];
}

/** A numbered step: the number as big as the screen allows, in the outline of a ring. */
function adim(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent } = x;
  const safe = safeOf(x);
  const s = Math.min(w, h) * (x.wide ? 0.3 : 0.5);
  const top = safe.top + (x.wide ? 0 : 90 * u);
  return [
    rect(0, 0, w, h, PAPER),
    disc(w - s * 0.7, -s * 0.2 + top * 0.2, s * 1.1, "Daire", accent, 0.16),
    ring(m - 12 * u, top - 12 * u, s, "Halka", accent, 12 * u),
    ...x.flow(m - 12 * u + s * 0.1, s * 0.8, top + s * 0.12, top + s * 0.8, {
      body: [{ t: "text", role: "tag", text: x.c.tag.trim(), size: (x.wide ? 200 : 340) * u, min: 90 * u, lines: 1, weight: 400, color: primary, font: "bebas-neue", leading: 1, align: "middle" }],
    }),
    ...x.flow(m, w - 2 * m, top + s + 50 * u, h - safe.bottom, {
      body: [
        title(x, { size: 124 * u, min: 52 * u, lines: 3, weight: 800, color: primary, font: "manrope", leading: 1.08 }),
        { t: "bar", w: 130 * u, h: 10 * u, fill: accent, before: 28 * u },
        sub(x, { color: "#3f4c58", font: "manrope", size: 46 * u, lines: 4, before: 28 * u }),
      ],
      foot: [logoOf(x, 72)],
      gap: 20 * u,
    }),
  ];
}

/** One number, centred, in concentric rings. */
function rakamr(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent, shade } = x;
  const safe = safeOf(x);
  const deep = shade(primary, -0.6);
  const ink = x.inkOn(deep);
  const s = Math.min(w, h);
  const cy = safe.top + (h - safe.top - safe.bottom) * 0.42;
  const rings = [1.3, 1, 0.7].map((k, i) => ring(w / 2 - (s * k) / 2, cy - (s * k) / 2, s * k, "Halka", accent, (3 + i * 2) * u, 0.25 + i * 0.25));
  return [
    rect(0, 0, w, h, deep),
    ...rings,
    ...x.flow(m, w - 2 * m, safe.top, h - safe.bottom, {
      head: [pill(x, accent, x.inkOn(accent), "dm-sans")].map((p) => ({ ...p, center: true })),
      body: [
        { t: "bar", w: 2 * u, h: Math.max(0, (cy - safe.top) * 0.4), fill: deep, center: true },
        title(x, { size: 340 * u, min: 90 * u, lines: 2, weight: 400, color: ink, font: "anton", leading: 1.04, align: "middle" }),
        sub(x, { color: ink, font: "dm-sans", size: 48 * u, lines: 3, before: 30 * u, align: "middle" }),
      ],
      foot: [detail(x, { color: ink, font: "dm-sans", size: 28 * u, weight: 500, align: "middle" })],
      gap: 20 * u,
    }),
  ];
}

/** A saying on dark: a large serif, the name under a short rule. */
function soz(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent, shade } = x;
  const safe = safeOf(x);
  const deep = shade(primary, -0.6);
  return [
    rect(0, 0, w, h, deep),
    { kind: "text", role: "deco", x: m - 8 * u, y: safe.top - 20 * u, w: 320 * u, size: 340 * u, lines: ["“"], weight: 700, color: accent, leading: 1, font: "playfair-display" },
    ...x.flow(m, w - 2 * m, safe.top + 220 * u, h - safe.bottom, {
      body: [title(x, { size: 98 * u, min: 46 * u, lines: 8, weight: 600, color: WHITE, font: "playfair-display", leading: 1.22 })],
      foot: [
        { t: "bar", w: 100 * u, h: 6 * u, fill: accent },
        { t: "text", role: "subtitle", text: x.c.subtitle, size: 44 * u, min: 28 * u, lines: 1, weight: 700, color: WHITE, font: "dm-sans", before: 26 * u },
        detail(x, { color: "#cdd6df", font: "dm-sans", weight: 400, before: 10 * u }),
        { ...logoOf(x, 70), before: 26 * u },
      ],
      footShare: 0.4,
      gap: 30 * u,
    }),
  ];
}

/** The last frame: logo plate, a call, the address in a pill-like block. */
function kapanis(x: Ctx): Layer[] {
  const { w, h, u, m, primary, accent, shade } = x;
  const safe = safeOf(x);
  const s = Math.max(w, h) * 0.8;
  const ink = x.inkOn(accent);
  return [
    { kind: "gradient", x: 0, y: 0, w, h, a: accent, b: shade(primary, -0.25) },
    ring(w / 2 - s / 2, h * 0.42 - s / 2, s, "Halka", WHITE, 2.5 * u, 0.3),
    ring(w / 2 - s * 0.35, h * 0.42 - s * 0.35, s * 0.7, "Halka", WHITE, 2.5 * u, 0.4),
    ...x.flow(m, w - 2 * m, safe.top + 60 * u, h - safe.bottom, {
      head: [{ t: "logo", pic: x.logo, h: 130 * u, plate: true, center: true }],
      body: [
        title(x, { size: 150 * u, min: 60 * u, lines: 3, weight: 800, color: ink, font: "montserrat", leading: 1.08, align: "middle" }),
        sub(x, { color: ink, font: "montserrat", size: 44 * u, lines: 3, before: 30 * u, align: "middle" }),
      ],
      foot: [detail(x, { color: ink, font: "montserrat", size: 44 * u, weight: 800, align: "middle" })],
      gap: 90 * u,
    }),
  ];
}

export const FAMILIES: Record<FamilyId, (x: Ctx) => Layer[]> = { atlas, manset, etki, muhur, ajanda, isik, pano, takvim, rapor, mozaik, ilke, sahne, kanca, perde, adim, rakamr, soz, kapanis };
