// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKDROPS, ENTRANCES, REELS_PACKS, SCENE_SECONDS, backdropAt, cleanVideo, ease, entranceAt, type Backdrop, type Entrance } from "./studio-video.ts";
import { TEMPLATES, fromTemplate, shapeFrom } from "./studio.ts";

test("entranceAt: every entrance starts unseen and ends exactly in place", () => {
  for (const k of Object.keys(ENTRANCES) as Entrance[]) {
    assert.equal(entranceAt(k, 0).alpha, 0, k);
    assert.deepEqual(entranceAt(k, 1), { alpha: 1, dx: 0, dy: 0, scale: 1 }, k);
  }
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
});

test("backdropAt: the canvas stays covered at every moment", () => {
  for (const k of Object.keys(BACKDROPS) as Backdrop[]) {
    for (const p of [-1, 0, 0.3, 0.7, 1, 2]) {
      const b = backdropAt(k, p);
      assert.ok(b.scale >= 1 && b.scale <= 1.08 + 1e-9, `${k} ${p}`);
      assert.ok(Math.abs(b.dx) <= (b.scale - 1) / 2 + 1e-9, `${k} ${p}: shows an edge`);
    }
  }
});

test("packs: reels templates only, known presets and durations, and they lay out", () => {
  const measure = (t: string, s: number) => t.length * s * 0.5;
  for (const p of REELS_PACKS) {
    for (const s of p.scenes) {
      assert.equal(TEMPLATES[s.template].kind, "reels", `${p.id}/${s.template}`);
      assert.ok(SCENE_SECONDS.includes(s.seconds), p.id);
      const els = fromTemplate({ template: s.template, format: "hikaye", content: s.content, brand: { primary: "#14263d", accent: "#c8553d" } }, measure);
      assert.ok(els.some((e) => e.kind === "text" && e.role === "title"), `${p.id}/${s.template}`);
    }
  }
});

test("cleanVideo: keeps what it knows, drops or repairs the rest", () => {
  const els = [shapeFrom("rect", 100, 100, 100, "#000000")];
  const v = cleanVideo(JSON.parse(JSON.stringify({ format: "hikaye", transition: "wipe", scenes: [
    { id: "a", els, seconds: 3, caption: "x", enter: "sola", backdrop: "kay" },
    { id: "a", els, seconds: 999, enter: "kötü", backdrop: 5 },
    { id: "c", els: [] },
    null,
  ] })));
  assert.equal(v?.transition, "wipe");
  assert.equal(v?.scenes.length, 2);
  assert.equal(new Set(v?.scenes.map((s) => s.id)).size, 2);
  assert.deepEqual([v?.scenes[1].seconds, v?.scenes[1].enter, v?.scenes[1].backdrop], [4, undefined, undefined]);
  assert.equal(cleanVideo({ format: "yok", scenes: [] }), undefined);
  assert.equal(cleanVideo({ format: "kare", scenes: [] }), undefined);
  assert.equal(cleanVideo(null), undefined);
  assert.equal(cleanVideo({ format: "kare", transition: "x<script>", scenes: [{ els }] })?.transition, "fade");
});
