// Writes public/slides/zafer.json, the app's own presentation family, and puts it first in index.json.
// Run: node scripts/make-deck-zafer.mjs
// One language throughout: warm paper, a serif headline over a hairline, a page rule on the left, one accent.
import fs from "node:fs";

const NAVY = "#14263d", ACCENT = "#c8553d", PAPER = "#f5f1e8", INK = "#2b3440", MUTE = "#6a7380", WHITE = "#ffffff", PALE = "#ebe5d8";
const HEAD = "playfair-display", BODY = "work-sans";
let n = 0;
const id = () => `z${++n}`;
const round = (v) => Math.round(v * 10) / 10;

function text(slot, x, y, w, h, value, o = {}) {
  return { id: id(), kind: "text", name: slot, x, y, w, h, text: value, size: (o.size ?? 28) < 50 ? Math.round((o.size ?? 28) * 1.2) : o.size, weight: o.weight ?? 400, color: o.color ?? INK, align: o.align ?? "start", leading: o.leading ?? 1.3, tracking: o.tracking ?? 0, auto: true, font: o.font ?? BODY, slot, ...(o.grp ? { grp: o.grp } : {}), ...(o.upper ? { upper: true } : {}) };
}
const headline = (slot, x, y, w, h, value, size = 72, color = NAVY) => text(slot, x, y, w, h, value, { size, weight: 700, font: HEAD, color, leading: 1.08 });
const box = (name, x, y, w, h, color, o = {}) => ({ id: id(), kind: "shape", name, x, y, w, h, fill: { kind: "solid", color }, ...o });
const ring = (name, x, y, s, color, width, o = {}) => box(name, x, y, s, s, color, { shape: "ellipse", noFill: true, stroke: { color, width }, ...o });
const disc = (name, x, y, s, color, o = {}) => box(name, x, y, s, s, color, { shape: "ellipse", ...o });
const photo = (x, y, w, h, radius = 0) => ({ id: id(), kind: "image", name: "Görsel", x, y, w, h, fit: "cover", ...(radius ? { radius } : {}), pic: { placeholder: true, src: "", w: 400, h: 300 } });
const page = () => box("Zemin", 0, 0, 1920, 1080, PAPER, { locked: true });
const rule = () => box("Sayfa çizgisi", 96, 96, 6, 888, ACCENT);
/** The header most inner slides share: title, a hairline under it. */
const head = (title) => [page(), rule(), headline("baslik", 150, 92, 1620, 130, title, 68), box("Çizgi", 150, 232, 1620, 2, NAVY)];

const layouts = [
  {
    id: "kapak", desc: "Kapak: sol tarafta büyük başlık, alt başlık ve sunan bilgisi; sağda iç içe halkalar. Sunumun ilk slaytı.",
    els: () => [
      page(), ring("Halka", 1120, -40, 1000, ACCENT, 3, { opacity: 0.45 }), ring("Halka", 1240, 80, 760, ACCENT, 6), disc("Odak", 1370, 210, 500, NAVY), disc("Nokta", 1570, 410, 100, ACCENT),
      rule(),
      text("etiket", 150, 150, 900, 40, "KURUMSAL SUNUM", { size: 26, weight: 700, color: ACCENT, tracking: 3, leading: 1.2 }),
      headline("baslik", 150, 300, 1020, 400, "Bölgesel Kalkınma Programı", 100),
      text("altbaslik", 150, 730, 960, 130, "2026 yılı hedefleri, öncelikler ve yol haritası", { size: 36 }),
      box("Çizgi", 150, 890, 960, 2, NAVY),
      text("sunan", 150, 910, 960, 60, "Genel Sekreterlik · Kasım 2026", { size: 26, weight: 600, color: NAVY, leading: 1.2 }),
    ],
  },
  {
    id: "bolum", desc: "Bölüm girişi: koyu zeminde bölüm numarası ve bölüm başlığı. Konu değişirken kullanılır.",
    els: () => [
      box("Zemin", 0, 0, 1920, 1080, NAVY, { locked: true }), ring("Halka", 1180, 200, 1000, ACCENT, 4), ring("Halka", 1400, 420, 560, WHITE, 2, { opacity: 0.4 }),
      text("numara", 150, 240, 560, 280, "01", { size: 240, weight: 700, font: HEAD, color: ACCENT, leading: 1 }),
      headline("baslik", 150, 540, 1200, 240, "Mevcut durum ve temel bulgular", 92, WHITE),
      text("aciklama", 150, 800, 1050, 120, "Bu bölümde bölgenin güncel göstergelerini ele alıyoruz.", { size: 32, color: "#d5dce4" }),
    ],
  },
  {
    id: "gundem", desc: "Gündem: en fazla 5 numaralı madde, her biri başlık ve kısa açıklama. İçindekiler için.",
    els: () => [
      ...head("Gündem"),
      ...[0, 1, 2, 3, 4].flatMap((i) => {
        const y = 276 + i * 142, g = `madde.${i}`;
        return [
          text(`madde.${i}.no`, 150, y, 110, 90, `0${i + 1}`, { size: 62, weight: 700, font: HEAD, color: ACCENT, leading: 1.1, grp: g }),
          text(`madde.${i}.baslik`, 280, y + 2, 620, 90, ["Bağlam", "Bulgular", "Öncelikler", "Takvim", "Sonraki adımlar"][i], { size: 38, weight: 700, color: NAVY, leading: 1.15, grp: g }),
          text(`madde.${i}.aciklama`, 930, y + 4, 840, 100, "Bu başlıkta ele alınacak konunun tek cümlelik özeti.", { size: 28, grp: g }),
          box("Çizgi", 150, y + 124, 1620, 1, NAVY, { opacity: 0.25, grp: g }),
        ];
      }),
    ],
  },
  {
    id: "iki-sutun", desc: "İki sütun metin: başlık altında yan yana iki konu, her birinin alt başlığı ve paragrafı.",
    els: () => [
      ...head("İki temel öncelik"),
      ...[0, 1].flatMap((i) => {
        const x = 150 + i * 840, g = `sutun.${i}`;
        return [
          box("Vurgu", x, 290, 96, 8, ACCENT, { grp: g }),
          text(`sutun.${i}.baslik`, x, 320, 780, 120, ["Üretimde verimlilik", "Nitelikli istihdam"][i], { size: 46, weight: 700, color: NAVY, leading: 1.15, grp: g }),
          text(`sutun.${i}.metin`, x, 450, 780, 500, "Bu öncelik altında yürütülen çalışmaların amacı, kapsamı ve beklenen sonuçları birkaç cümleyle burada anlatılır.", { size: 32, leading: 1.42, grp: g }),
        ];
      }),
    ],
  },
  {
    id: "uc-kart", desc: "Üç kart: yan yana üç konu kartı, her birinde küçük halka, başlık ve kısa metin.",
    els: () => [
      ...head("Program bileşenleri"),
      ...[0, 1, 2].flatMap((i) => {
        const x = 150 + i * 552, g = `kart.${i}`;
        return [
          box("Kart", x, 286, 516, 680, i === 1 ? NAVY : WHITE, { radius: 8, grp: g }),
          ring("Halka", x + 40, 326, 96, ACCENT, 7, { grp: g }),
          text(`kart.${i}.baslik`, x + 40, 462, 436, 150, ["Altyapı", "Destek", "Kapasite"][i], { size: 50, weight: 700, font: HEAD, color: i === 1 ? WHITE : NAVY, leading: 1.1, grp: g }),
          text(`kart.${i}.metin`, x + 40, 620, 436, 310, "Bileşenin neyi kapsadığını ve kime hitap ettiğini anlatan kısa bir açıklama.", { size: 30, color: i === 1 ? "#d5dce4" : INK, leading: 1.38, grp: g }),
        ];
      }),
    ],
  },
  {
    id: "rakamlar", desc: "Üç rakam: büyük rakamlar ve altlarında ne anlattıkları. Yalnızca gerçek rakam varsa kullanılır.",
    els: () => [
      ...head("Bir bakışta sonuçlar"),
      ...[0, 1, 2].flatMap((i) => {
        const x = 150 + i * 552, g = `rakam.${i}`;
        return [
          text(`rakam.${i}.deger`, x, 340, 510, 220, ["%42", "1.250", "18"][i], { size: 150, weight: 700, font: HEAD, color: i === 1 ? ACCENT : NAVY, leading: 1.05, grp: g }),
          box("Çizgi", x, 580, 510, 3, NAVY, { grp: g }),
          text(`rakam.${i}.aciklama`, x, 610, 510, 260, "Bu rakamın neyi gösterdiğini anlatan kısa açıklama.", { size: 32, leading: 1.36, grp: g }),
        ];
      }),
      text("kaynak", 150, 920, 1620, 50, "Kaynak: 2026 faaliyet raporu", { size: 24, color: MUTE, leading: 1.2 }),
    ],
  },
  {
    id: "zaman", desc: "Zaman çizelgesi: yatay çizgi üzerinde en fazla 4 tarih, her birinin başlığı ve açıklaması.",
    els: () => [
      ...head("Takvim"),
      box("Zaman çizgisi", 150, 470, 1620, 4, NAVY),
      ...[0, 1, 2, 3].flatMap((i) => {
        const x = 150 + i * 414, g = `tarih.${i}`;
        return [
          text(`tarih.${i}.zaman`, x, 320, 380, 120, ["Ocak", "Nisan", "Ağustos", "Aralık"][i], { size: 56, weight: 700, font: HEAD, color: NAVY, leading: 1.1, grp: g }),
          disc("Nokta", x, 454, 36, ACCENT, { grp: g }),
          text(`tarih.${i}.baslik`, x, 520, 380, 110, "Aşama başlığı", { size: 36, weight: 700, color: NAVY, leading: 1.15, grp: g }),
          text(`tarih.${i}.metin`, x, 640, 380, 300, "Bu aşamada yapılacak işin kısa açıklaması.", { size: 28, leading: 1.38, grp: g }),
        ];
      }),
    ],
  },
  {
    id: "surec", desc: "Süreç: soldan sağa ok biçiminde en fazla 4 adım ve altlarında açıklamalar.",
    els: () => [
      ...head("Başvuru süreci"),
      ...[0, 1, 2, 3].flatMap((i) => {
        const x = 150 + i * 408, g = `adim.${i}`;
        return [
          box("Adım", x, 300, 432, 170, i % 2 ? ACCENT : NAVY, { shape: "poly", points: [[0, 0], [0.84, 0], [1, 0.5], [0.84, 1], [0, 1], [0.16, 0.5]], grp: g }),
          text(`adim.${i}.no`, x + 84, 340, 260, 90, `${i + 1}. adım`, { size: 40, weight: 700, color: WHITE, leading: 1.2, grp: g }),
          text(`adim.${i}.baslik`, x + 10, 500, 370, 110, "Adım başlığı", { size: 38, weight: 700, color: NAVY, leading: 1.15, grp: g }),
          text(`adim.${i}.metin`, x + 10, 620, 370, 320, "Bu adımda yapılması gerekenlerin kısa açıklaması.", { size: 29, leading: 1.38, grp: g }),
        ];
      }),
    ],
  },
  {
    id: "karsilastirma", desc: "Karşılaştırma: yan yana iki panel, önce/sonra ya da iki seçenek ve her birinin maddeleri.",
    els: () => [
      ...head("Önce ve sonra"),
      box("Panel", 150, 286, 790, 680, PALE, { radius: 8 }), box("Panel", 980, 286, 790, 680, NAVY, { radius: 8 }),
      text("sol.baslik", 200, 326, 690, 90, "Bugün", { size: 54, weight: 700, font: HEAD, color: NAVY, leading: 1.15 }),
      text("sol.metin", 200, 440, 690, 490, "Mevcut durumu anlatan maddeler burada sıralanır.", { size: 33, leading: 1.45 }),
      text("sag.baslik", 1030, 326, 690, 90, "Hedef", { size: 54, weight: 700, font: HEAD, color: WHITE, leading: 1.15 }),
      text("sag.metin", 1030, 440, 690, 490, "Ulaşılmak istenen durumu anlatan maddeler burada sıralanır.", { size: 33, color: "#e4e9ef", leading: 1.45 }),
    ],
  },
  {
    id: "gorsel-metin", desc: "Görsel ve metin: sağda büyük görsel, solda başlık ve paragraf.",
    els: () => [
      page(), photo(1000, 0, 920, 1080), rule(),
      headline("baslik", 150, 150, 780, 340, "Sahadan görünüm", 80),
      box("Vurgu", 150, 510, 96, 8, ACCENT),
      text("metin", 150, 550, 780, 400, "Görselin anlattığı konuya dair kısa bir açıklama ve öne çıkan birkaç bilgi.", { size: 34, leading: 1.45 }),
    ],
  },
  {
    id: "alinti", desc: "Alıntı: koyu zeminde büyük söz, söyleyen ve unvanı.",
    els: () => [
      box("Zemin", 0, 0, 1920, 1080, NAVY, { locked: true }),
      { id: id(), kind: "text", name: "Tırnak", x: 150, y: 90, w: 300, h: 260, text: "“", size: 300, weight: 700, color: ACCENT, align: "start", leading: 1, tracking: 0, auto: false, font: HEAD },
      text("soz", 150, 330, 1500, 410, "Kalkınma, bölgenin bütün paydaşlarıyla birlikte yürüttüğümüz ortak bir yolculuktur.", { size: 70, weight: 500, font: HEAD, color: WHITE, leading: 1.22 }),
      box("Vurgu", 150, 780, 96, 8, ACCENT),
      text("soyleyen", 150, 815, 1200, 70, "Ad Soyad", { size: 42, weight: 700, color: WHITE, leading: 1.2 }),
      text("unvan", 150, 885, 1200, 60, "Genel Sekreter", { size: 30, color: "#d5dce4", leading: 1.2 }),
    ],
  },
  {
    id: "kapanis", desc: "Kapanış: teşekkür ya da sonraki adım, iletişim bilgisi; ortada halkalar. Sunumun son slaytı.",
    els: () => [
      page(), ring("Halka", 460, 40, 1000, ACCENT, 3, { opacity: 0.4 }), ring("Halka", 520, 100, 880, ACCENT, 6),
      text("baslik", 360, 370, 1200, 200, "Teşekkürler", { size: 112, weight: 700, font: HEAD, color: NAVY, align: "middle", leading: 1.1 }),
      text("mesaj", 460, 590, 1000, 120, "Görüş ve önerilerinizi bekliyoruz.", { size: 36, align: "middle" }),
      text("iletisim", 460, 1000, 1000, 60, "kurum.gov.tr · bilgi@kurum.gov.tr", { size: 28, weight: 600, color: NAVY, align: "middle", leading: 1.2 }),
    ],
  },
];

const built = layouts.map((l) => {
  const els = l.els().map((e) => JSON.parse(JSON.stringify(e, (_k, v) => (typeof v === "number" ? round(v) : v))));
  // Room for a little more than the sample: about what fits at the design's size, which the box can shrink from.
  const slots = els.filter((e) => e.slot).map((e) => ({ key: e.slot, max: Math.max(12, Math.round(((e.w / (e.size * 0.52)) * Math.max(1, Math.floor(e.h / (e.size * e.leading)))) * 0.9)) }));
  return { id: l.id, desc: l.desc, els, slots };
});

const family = { id: "zafer", name: "Zafer", desc: "Kuruma özel aile: sıcak kâğıt zemin, tırnaklı başlık, ince çizgiler ve tek vurgu rengi. Resmî raporlar ve kurumsal sunumlar için.", roles: { primary: NAVY, accent: ACCENT }, layouts: built };
fs.writeFileSync(new URL("../public/slides/zafer.json", import.meta.url), JSON.stringify(family));
const indexUrl = new URL("../public/slides/index.json", import.meta.url);
const index = JSON.parse(fs.readFileSync(indexUrl, "utf8")).filter((t) => t.id !== "zafer");
fs.writeFileSync(indexUrl, JSON.stringify([{ id: "zafer", name: family.name, desc: family.desc, layouts: built.length, primary: NAVY, background: PAPER }, ...index], null, 0).replace(/},{/g, "},\n{"));
console.log(built.length, "layouts");
