// The slide master: what every inner slide carries (logos, footer, date, page number) kept in one place, as in PowerPoint.
// Its elements are flagged `master` on each slide, so canvas and every export show them; changing the master rewrites them
// on all slides, and PPTX puts them in a real slide master. A logo comes in two versions, and each slide takes the one that
// reads on its own background. Pure.
import { contrast, luminance } from "./deck-design.ts";
import { newId, safePicture, type El, type ImageEl, type Picture, type ShapeEl, type TextEl } from "./studio.ts";

export type MasterPick = "auto" | "color" | "white" | "none";
export interface MasterLogo { color: Picture; white?: Picture }
export interface DeckMaster {
  logos: MasterLogo[];
  corner: "tr" | "br" | "tl" | "bl";
  /** Height of the logos in canvas pixels. */
  size: number;
  footer: string; date: string; number: boolean;
  /** The first and last slide carry the master too (off: covers stay clean). */
  onCovers: boolean;
}
export const DEFAULT_MASTER: DeckMaster = { logos: [], corner: "tr", size: 64, footer: "", date: "", number: true, onCovers: false };
export const MASTER_SIZES = { min: 32, max: 140 };

const W = 1920, H = 1080, MARGIN = 44, GAP = 28;

export function cleanMaster(raw: unknown): DeckMaster {
  const m = (raw ?? {}) as Partial<DeckMaster>;
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 120) : "");
  return {
    logos: (Array.isArray(m.logos) ? m.logos : []).slice(0, 6).flatMap((l): MasterLogo[] => {
      const color = safePicture(l?.color), white = safePicture(l?.white);
      return color ? [{ color, ...(white ? { white } : {}) }] : [];
    }),
    corner: (["tr", "br", "tl", "bl"] as const).find((c) => c === m.corner) ?? "tr",
    size: typeof m.size === "number" && Number.isFinite(m.size) ? Math.min(MASTER_SIZES.max, Math.max(MASTER_SIZES.min, m.size)) : DEFAULT_MASTER.size,
    footer: text(m.footer), date: text(m.date), number: m.number !== false, onCovers: m.onCovers === true,
  };
}

/** The colour under a point, if it can be known: the top plain opaque shape there. Picture or gradient: null. */
export function colorUnder(els: El[], x: number, y: number): string | null {
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.master || x < e.x || x > e.x + e.w || y < e.y || y > e.y + e.h) continue;
    if (e.kind === "image") return null;
    if (e.kind !== "shape" || e.noFill || e.shape === "line" || (e.opacity ?? 1) < 1 || e.rotation) continue;
    if (e.picFill || e.fill.kind !== "solid") return null;
    return e.fill.color;
  }
  return "#ffffff";
}

/** Which logo version reads here: white on a dark ground, the coloured one otherwise; a slide can insist. */
export function logoFor(logo: MasterLogo, ground: string | null, pick: MasterPick): Picture {
  if (pick === "color") return logo.color;
  if (pick === "white") return logo.white ?? logo.color;
  return ground && luminance(ground) < 0.25 && logo.white ? logo.white : logo.color;
}

/** The slide without its master elements, and the choice made for it. */
export function splitMaster(els: El[]): { own: El[]; pick: MasterPick } {
  const marker = els.find((e) => e.kind === "shape" && e.master && e.masterPick) as ShapeEl | undefined;
  return { own: els.filter((e) => !e.master), pick: marker?.masterPick ?? "auto" };
}

/** A full-canvas plain shape at the bottom of the slide: its background. */
const isGround = (e: El | undefined) => !!e && e.kind === "shape" && e.x <= 0.5 && e.y <= 0.5 && e.w >= W - 0.5 && e.h >= H - 0.5;

function textOf(name: string, value: string, x: number, y: number, w: number, align: TextEl["align"], font: string | undefined, ground: string | null): TextEl {
  const onIt = ground ?? "#ffffff";
  const color = contrast("#ffffff", onIt) >= contrast("#3f4c58", onIt) ? "#ffffff" : "#3f4c58";
  return { id: newId(), kind: "text", name, x, y, w, h: 30, text: value, size: 22, weight: 500, color, align, leading: 1.2, tracking: 0, auto: true, locked: true, master: true, ...(font ? { font } : {}) };
}

/** One slide with the master on it: right above its background, so the slide's own content stays on top, as in PowerPoint. */
export function masterOn(els: El[], m: DeckMaster, page: number, covered: boolean, font?: string): El[] {
  const { own, pick } = splitMaster(els);
  const marker: ShapeEl = { id: newId(), kind: "shape", name: "Asıl slayt", x: 0, y: 0, w: 1, h: 1, fill: { kind: "solid", color: "#000000" }, noFill: true, locked: true, master: true, masterPick: pick };
  const items: El[] = [marker];
  if (!covered) {
    const top = m.corner[0] === "t", right = m.corner[1] === "r";
    const y = top ? MARGIN - 14 : H - MARGIN - m.size - 44;
    const pics = pick === "none" ? [] : m.logos.map((l) => {
      // Judged at the corner it will stand in; every logo in the row sees the same ground.
      const gx = right ? W - MARGIN - m.size : MARGIN + m.size, gy = y + m.size / 2;
      return logoFor(l, colorUnder(own, gx, gy), pick);
    });
    const widths = pics.map((p) => (m.size * p.w) / p.h);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, pics.length - 1);
    let x = right ? W - MARGIN - total : MARGIN;
    pics.forEach((pic, i) => {
      const logo: ImageEl = { id: newId(), kind: "image", name: "Logo (asıl slayt)", x, y, w: widths[i], h: m.size, pic, fit: "contain", logo: true, locked: true, master: true };
      items.push(logo);
      x += widths[i] + GAP;
    });
    const ground = colorUnder(own, W / 2, H - 50);
    const line = [m.date, m.footer].filter((s) => s.trim()).join(" · ");
    if (line) items.push(textOf("Altbilgi", line, 980, 1000, 660, "end", font, ground));
    if (m.number) items.push(textOf("Sayfa numarası", String(page), 1660, 1000, 110, "end", font, colorUnder(own, 1760, 1015)));
  }
  const at = isGround(own[0]) ? 1 : 0;
  // A panel of the slide's own over the logo's corner would hide it: then the master goes on top of this slide (PPTX puts
  // such items on the slide itself, since a real master lies under everything).
  const hides = (a: El, b: El) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const hidden = own.slice(at).some((e) => (e.kind === "image" || (e.kind === "shape" && !e.noFill)) && items.some((i) => i.kind !== "shape" && hides(e, i)));
  return hidden ? [...own, ...items] : [...own.slice(0, at), ...items, ...own.slice(at)];
}

export function applyMaster(slides: El[][], m: DeckMaster, font?: string): El[][] {
  return slides.map((s, i) => masterOn(s, m, i + 1, !m.onCovers && slides.length > 1 && (i === 0 || i === slides.length - 1), font));
}

/** A slide's own choice of logo version. */
export function setPick(els: El[], pick: MasterPick): El[] {
  return els.map((e) => (e.kind === "shape" && e.master && e.masterPick ? { ...e, masterPick: pick } : e));
}

/** For storage: pictures repeated on every slide would multiply the file; they come back from the master on opening. */
export const withoutMaster = (slides: El[][]): El[][] =>
  slides.map((s) => {
    const { own, pick } = splitMaster(s);
    return pick === "auto" ? own : [{ id: newId(), kind: "shape", name: "Asıl slayt", x: 0, y: 0, w: 1, h: 1, fill: { kind: "solid", color: "#000000" }, noFill: true, locked: true, master: true, masterPick: pick } as ShapeEl, ...own];
  });
