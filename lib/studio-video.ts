// What a video's scenes do and how they are kept. Pure, so it runs in the browser's recorder and in node --test; the
// presets are our own short list, written as functions of progress so any frame can be drawn at any time.
import { FORMATS, cleanEls, type Content, type El, type FormatId, type TemplateId } from "./studio.ts";

/** How a scene's text and logo come in. */
export const ENTRANCES = { yuksel: "Yükselerek", yakin: "Yaklaşarak", sola: "Yandan kayarak", belir: "Belirerek" } as const;
export type Entrance = keyof typeof ENTRANCES;
/** What its background does meanwhile. */
export const BACKDROPS = { yaklas: "Yavaş yaklaşma", uzak: "Yavaş uzaklaşma", kay: "Yana kayma", sabit: "Sabit" } as const;
export type Backdrop = keyof typeof BACKDROPS;
export const TRANSITIONS = { fade: "Yumuşak geçiş", slide: "Kaydırma", zoom: "Yakınlaşarak", wipe: "Perde", none: "Kesme" } as const;
export type Transition = keyof typeof TRANSITIONS;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
export const ease = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** Foreground at eased progress `e` (0 to 1): how visible, how far off (share of the canvas), how large. */
export function entranceAt(kind: Entrance, e: number) {
  const left = 1 - e;
  if (kind === "yakin") return { alpha: e, dx: 0, dy: 0, scale: 1 + 0.06 * left };
  if (kind === "sola") return { alpha: e, dx: 0 - 0.06 * left, dy: 0, scale: 1 };
  if (kind === "belir") return { alpha: e, dx: 0, dy: 0, scale: 1 };
  return { alpha: e, dx: 0, dy: 0.04 * left, scale: 1 };
}

/** Background at `p`, the share of the scene gone by: its scale and how far it has moved (share of the canvas). */
export function backdropAt(kind: Backdrop, p: number) {
  const t = clamp01(p);
  if (kind === "uzak") return { scale: 1.08 - 0.08 * t, dx: 0 };
  // Scaled up just enough that the slide never shows an edge.
  if (kind === "kay") return { scale: 1.08, dx: 0.03 - 0.06 * t };
  if (kind === "sabit") return { scale: 1, dx: 0 };
  return { scale: 1 + 0.08 * t, dx: 0 };
}

export interface PackScene { template: TemplateId; seconds: number; enter: Entrance; backdrop: Backdrop; content: Content }
export interface ReelsPack { id: string; label: string; hint: string; transition: Transition; scenes: PackScene[] }

export const REELS_PACKS: ReelsPack[] = [
  {
    id: "duyuru", label: "Duyuru Akışı", hint: "Kanca, ayrıntı, kapanış · 11 sn", transition: "wipe",
    scenes: [
      { template: "kanca", seconds: 3, enter: "yakin", backdrop: "yaklas", content: { tag: "Duyuru", title: "Bunu kaçırmayın", subtitle: "30 saniyede öğrenin", detail: "" } },
      { template: "perde", seconds: 4, enter: "yuksel", backdrop: "kay", content: { tag: "Ne değişiyor?", title: "Başvurular artık tek adresten", subtitle: "Süreç 45 günden 20 güne iniyor.", detail: "" } },
      { template: "kapanis", seconds: 4, enter: "belir", backdrop: "sabit", content: { tag: "", title: "Hemen başvurun", subtitle: "Ayrıntılar web sitemizde", detail: "kurum.gov.tr" } },
    ],
  },
  {
    id: "etkinlik", label: "Etkinlik Çağrısı", hint: "Davet, program, buluşma · 12 sn", transition: "zoom",
    scenes: [
      { template: "kanca", seconds: 3, enter: "sola", backdrop: "yaklas", content: { tag: "Davet", title: "Sizi de bekliyoruz", subtitle: "Bölgesel Kalkınma Buluşması", detail: "" } },
      { template: "adim", seconds: 3, enter: "yuksel", backdrop: "sabit", content: { tag: "12", title: "Kasım Çarşamba", subtitle: "Saat 10.00'da başlıyoruz", detail: "" } },
      { template: "perde", seconds: 3, enter: "yakin", backdrop: "uzak", content: { tag: "Program", title: "Panel, atölye ve birebir görüşmeler", subtitle: "", detail: "" } },
      { template: "kapanis", seconds: 3, enter: "belir", backdrop: "sabit", content: { tag: "", title: "Yerinizi ayırtın", subtitle: "Katılım ücretsizdir", detail: "kurum.gov.tr/etkinlik" } },
    ],
  },
  {
    id: "rakam", label: "Rakamla Etki", hint: "Tek rakam, söz, kapanış · 11 sn", transition: "fade",
    scenes: [
      { template: "rakamr", seconds: 4, enter: "yakin", backdrop: "yaklas", content: { tag: "2026", title: "%42", subtitle: "Destek başvurularındaki artış", detail: "Kaynak: faaliyet raporu" } },
      { template: "soz", seconds: 4, enter: "belir", backdrop: "uzak", content: { tag: "", title: "Kalkınma, birlikte yürüttüğümüz bir yolculuktur.", subtitle: "Ad Soyad", detail: "Genel Sekreter" } },
      { template: "kapanis", seconds: 3, enter: "belir", backdrop: "sabit", content: { tag: "", title: "Raporun tamamı", subtitle: "Web sitemizde yayımlandı", detail: "kurum.gov.tr/rapor" } },
    ],
  },
  {
    id: "adimlar", label: "Üç Adımda", hint: "Süreci adım adım anlatın · 13 sn", transition: "slide",
    scenes: [
      { template: "kanca", seconds: 3, enter: "yakin", backdrop: "yaklas", content: { tag: "Rehber", title: "Üç adımda başvuru", subtitle: "", detail: "" } },
      { template: "adim", seconds: 3, enter: "sola", backdrop: "sabit", content: { tag: "1", title: "Hesabınızı açın", subtitle: "Kimlik bilgilerinizle giriş yapın.", detail: "" } },
      { template: "adim", seconds: 3, enter: "sola", backdrop: "sabit", content: { tag: "2", title: "Formu doldurun", subtitle: "Proje özetinizi ekleyin.", detail: "" } },
      { template: "adim", seconds: 2, enter: "sola", backdrop: "sabit", content: { tag: "3", title: "Gönderin", subtitle: "Sonucu e-posta ile alın.", detail: "" } },
      { template: "kapanis", seconds: 2, enter: "belir", backdrop: "sabit", content: { tag: "", title: "Hemen başlayın", subtitle: "", detail: "kurum.gov.tr" } },
    ],
  },
];

export const MAX_SCENES = 20;
export const SCENE_SECONDS = [2, 3, 4, 5, 6, 8, 10];
export interface SavedScene { id: string; els: El[]; seconds: number; caption?: string; enter?: Entrance; backdrop?: Backdrop }
export interface SavedVideo { format: FormatId; transition: Transition; scenes: SavedScene[] }

const own = <T extends object>(table: T, v: unknown): v is keyof T => typeof v === "string" && Object.hasOwn(table, v);

/** A video from storage or a project file, validated like any design; undefined if nothing usable is in it. */
export function cleanVideo(raw: unknown): SavedVideo | undefined {
  const v = raw as Partial<SavedVideo> | null | undefined;
  if (!v || !own(FORMATS, v.format) || !Array.isArray(v.scenes)) return undefined;
  const scenes = v.scenes.slice(0, MAX_SCENES).flatMap((r): SavedScene[] => {
    const s = r as Partial<SavedScene> | null;
    const els = cleanEls(s?.els);
    if (!s || !els.length) return [];
    return [{
      id: typeof s.id === "string" && /^[\w-]{1,40}$/.test(s.id) ? s.id : `s${Math.random().toString(36).slice(2, 12)}`,
      els,
      seconds: SCENE_SECONDS.includes(s.seconds as number) ? (s.seconds as number) : 4,
      ...(typeof s.caption === "string" && s.caption ? { caption: s.caption.slice(0, 240) } : {}),
      ...(own(ENTRANCES, s.enter) ? { enter: s.enter } : {}),
      ...(own(BACKDROPS, s.backdrop) ? { backdrop: s.backdrop } : {}),
    }];
  });
  const ids = new Set(scenes.map((s) => s.id));
  if (!scenes.length || ids.size !== scenes.length) return scenes.length ? { format: v.format, transition: own(TRANSITIONS, v.transition) ? v.transition : "fade", scenes: scenes.map((s, i) => ({ ...s, id: `s${i}` })) } : undefined;
  return { format: v.format, transition: own(TRANSITIONS, v.transition) ? v.transition : "fade", scenes };
}
