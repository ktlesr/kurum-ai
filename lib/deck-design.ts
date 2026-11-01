// A deck's look as data: the same content can be laid out in any of these, so a design can be tried on a finished deck.
// Designs differ in structure (cards, rules, covers, how a section opens), not only in colour. Pure.
export interface DeckDesign {
  id: string; name: string; mood: string;
  bg: string; surface: string; surfaceAlt: string; ink: string; muted: string; heading: string;
  /** Panels and table heads, and what reads on them. */
  primary: string; onPrimary: string; onPrimaryMuted: string;
  accent: string;
  headFont: string; bodyFont: string;
  card: "solid" | "outline" | "plain"; radius: number;
  rule: "left" | "top" | "none";
  cover: "rings" | "panel" | "band" | "grid";
  opening: "side" | "top" | "none";
  /** A Presenton family's layouts go with it: "+ slayt" offers them. */
  template: string;
}

export const DESIGNS: DeckDesign[] = [
  { id: "zafer", name: "Zafer", mood: "Kurumsal", bg: "#f5f1e8", surface: "#ffffff", surfaceAlt: "#ebe5d8", ink: "#2b3440", muted: "#6a7380", heading: "#14263d", primary: "#14263d", onPrimary: "#ffffff", onPrimaryMuted: "#d5dce4", accent: "#c8553d", headFont: "playfair-display", bodyFont: "work-sans", card: "solid", radius: 8, rule: "left", cover: "rings", opening: "side", template: "zafer" },
  { id: "atlas", name: "Atlas", mood: "Analitik", bg: "#ffffff", surface: "#f2f6f7", surfaceAlt: "#e3ecee", ink: "#26363c", muted: "#64777e", heading: "#0f4c5c", primary: "#0f4c5c", onPrimary: "#ffffff", onPrimaryMuted: "#cfe0e4", accent: "#e36414", headFont: "manrope", bodyFont: "manrope", card: "outline", radius: 4, rule: "top", cover: "grid", opening: "top", template: "zafer" },
  { id: "gece", name: "Gece", mood: "Sahne", bg: "#0f1724", surface: "#1b2638", surfaceAlt: "#16202f", ink: "#dbe3ec", muted: "#8d9bab", heading: "#ffffff", primary: "#f2b84b", onPrimary: "#0f1724", onPrimaryMuted: "#3a3016", accent: "#f2b84b", headFont: "montserrat", bodyFont: "inter", card: "solid", radius: 14, rule: "none", cover: "band", opening: "side", template: "zafer" },
  { id: "resmi", name: "Resmî", mood: "Resmî", bg: "#ffffff", surface: "#ffffff", surfaceAlt: "#f6f1ea", ink: "#33282b", muted: "#7b6d70", heading: "#4a1424", primary: "#4a1424", onPrimary: "#ffffff", onPrimaryMuted: "#e8d9dd", accent: "#b08d57", headFont: "lora", bodyFont: "lato", card: "plain", radius: 0, rule: "left", cover: "panel", opening: "none", template: "zafer" },
  { id: "yesil", name: "Yeşil Yol", mood: "Doğa", bg: "#f4f7f2", surface: "#ffffff", surfaceAlt: "#e4ede0", ink: "#27362e", muted: "#65776c", heading: "#0f3d2e", primary: "#0f3d2e", onPrimary: "#ffffff", onPrimaryMuted: "#cfe0d6", accent: "#3f9b6c", headFont: "dm-sans", bodyFont: "nunito", card: "solid", radius: 20, rule: "top", cover: "band", opening: "top", template: "zafer" },
  { id: "manset", name: "Manşet", mood: "Editoryal", bg: "#ffffff", surface: "#ffffff", surfaceAlt: "#f2f2f2", ink: "#222222", muted: "#6b6b6b", heading: "#111111", primary: "#111111", onPrimary: "#ffffff", onPrimaryMuted: "#d9d9d9", accent: "#c8102e", headFont: "playfair-display", bodyFont: "work-sans", card: "plain", radius: 0, rule: "top", cover: "band", opening: "none", template: "zafer" },
  { id: "kobalt", name: "Kobalt", mood: "Canlı", bg: "#f5f8fe", surface: "#ffffff", surfaceAlt: "#e4ebfb", ink: "#26304a", muted: "#667190", heading: "#1e4cd9", primary: "#1e4cd9", onPrimary: "#ffffff", onPrimaryMuted: "#d6e0fb", accent: "#f59e0b", headFont: "poppins", bodyFont: "open-sans", card: "solid", radius: 16, rule: "none", cover: "grid", opening: "side", template: "zafer" },
  { id: "kum", name: "Kum", mood: "Sıcak", bg: "#efe7da", surface: "#f8f3ea", surfaceAlt: "#e4d9c6", ink: "#3b2c25", muted: "#7d6a5e", heading: "#3e2723", primary: "#3e2723", onPrimary: "#ffffff", onPrimaryMuted: "#e6dbd3", accent: "#b5651d", headFont: "merriweather", bodyFont: "raleway", card: "outline", radius: 4, rule: "left", cover: "rings", opening: "top", template: "zafer" },
];

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function luminance(hex: string) {
  const v = channels(hex).map((c) => c / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
};
const HEX = /^#[0-9a-f]{6}$/i;

/** One of the library's families as a design: its colours and fonts, the structure chosen from its name so that families differ. */
export function designFromFamily(info: { id: string; name: string; desc?: string; primary: string; background: string }, family: { roles?: { primary: string; accent: string }; layouts: { els: Record<string, unknown>[] }[] }): DeckDesign {
  const sizes = new Map<string, number>();
  const bodies = new Map<string, number>();
  for (const l of family.layouts) for (const e of l.els) {
    if (typeof e.font !== "string" || typeof e.size !== "number") continue;
    const to = e.size >= 40 ? sizes : bodies;
    to.set(e.font, (to.get(e.font) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  const headFont = top(sizes) ?? "inter", bodyFont = top(bodies) ?? headFont;
  const bg = HEX.test(info.background) ? info.background.toLowerCase() : "#ffffff";
  const dark = luminance(bg) < 0.2;
  const ink = dark ? "#e6ebf1" : "#2b3440";
  const candidates = [family.roles?.primary, info.primary, family.roles?.accent].filter((c): c is string => !!c && HEX.test(c));
  // What panels are drawn in must stand out from the page, or a panel disappears into it.
  const primary = candidates.find((c) => contrast(c, bg) >= 3) ?? (dark ? "#ffffff" : "#14263d");
  const accent = [family.roles?.accent, info.primary, family.roles?.primary].filter((c): c is string => !!c && HEX.test(c)).find((c) => c !== primary && contrast(c, bg) >= 2.2) ?? primary;
  const onPrimary = contrast("#ffffff", primary) >= contrast("#111111", primary) ? "#ffffff" : "#111111";
  const n = [...info.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    id: info.id, name: info.name, mood: "Kütüphane",
    bg, surface: dark ? mix(bg, "#ffffff", 0.08) : "#ffffff", surfaceAlt: dark ? mix(bg, "#ffffff", 0.14) : mix(bg, primary, 0.08),
    ink, muted: dark ? "#9aa7b5" : "#667180", heading: contrast(primary, bg) >= 4.5 ? primary : ink,
    primary, onPrimary, onPrimaryMuted: mix(onPrimary, primary, 0.2), accent, headFont, bodyFont,
    card: (["solid", "outline", "plain"] as const)[n % 3], radius: [0, 6, 12, 18][n % 4],
    rule: (["left", "top", "none"] as const)[n % 3], cover: (["rings", "panel", "band", "grid"] as const)[n % 4], opening: (["side", "top", "none"] as const)[(n >> 1) % 3],
    template: info.id,
  };
}
