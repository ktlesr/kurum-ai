// States each slide family's main and accent colour in its file (`roles`), so a theme doesn't guess them from what a deck
// happens to use: its two most used colours with a hue, counted over all its layouts. Greys, black and very light tints
// stay out: body text and card backgrounds stay as they are. A family with no such colour gets no roles.
// Run: node scripts/add-deck-roles.mjs
import fs from "node:fs";

const MARK = "#2e5e8c"; // what layouts' accent marks hold until a slide is made: the app's, not the family's
const dir = new URL("../public/slides/", import.meta.url);
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const tinted = (hex) => {
  const c = channels(hex), max = Math.max(...c), min = Math.min(...c);
  return max > 0 && (max - min) / max > 0.2 && max - min > 24;
};
const light = (hex) => channels(hex).every((v) => v > 210);

for (const { id } of JSON.parse(fs.readFileSync(new URL("index.json", dir), "utf8"))) {
  if (id === "zafer") continue; // written by make-deck-zafer.mjs
  const url = new URL(`${id}.json`, dir);
  const family = JSON.parse(fs.readFileSync(url, "utf8"));
  const counts = new Map();
  const count = (c) => {
    if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) return;
    const k = c.toLowerCase();
    if (k !== MARK && tinted(k) && !light(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (const l of family.layouts) for (const e of l.els) {
    count(e.color);
    count(e.bg?.fill);
    count(e.fill?.color);
    for (const s of e.fill?.stops ?? []) count(s.color);
    count(e.stroke?.color);
  }
  const [a, b] = [...counts].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  delete family.roles;
  const { layouts, ...head } = family;
  fs.writeFileSync(url, JSON.stringify({ ...head, ...(a ? { roles: { primary: a, accent: b ?? a } } : {}), layouts }));
  console.log(id, a ?? "-", b ?? "-");
}
