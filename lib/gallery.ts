import "server-only";
// The photo archive: a read-only folder (GALLERY_DIR, a bind mount, possibly a NAS), apart from the documents. Files are named to
// the browser only by id from a scan. Who sees what: lib/folder-access, under the virtual top folder "galeri". What the model saw
// in a photo lives under .cache/gallery, in this building, and is used for searching only. In step with the file: a changed photo
// is seen again, and a deleted one's words go.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { admission } from "./admission";
import { writeFileAtomic } from "./atomic";
import { getSetting } from "./db";
import { exifYear } from "./exif-date";
import { canSee, parseRules } from "./folder-access";
import { ScanFailed, goneLongEnough, readWithin, safeToForget, scanFolder, type Skipped } from "./folder-scan";
import type { GalleryEntry } from "./gallery-search";
import { logError } from "./log";
import { videoFrame } from "./video-frame";
import { modelConfig, providerOf } from "./model-config";
import { Semaphore } from "./limits";

const ROOT = () => process.env.GALLERY_DIR || path.join(process.cwd(), "galeri");
const CACHE = path.join(process.cwd(), ".cache", "gallery");
const THUMBS = path.join(CACHE, "thumbs");
const CAPTIONS = path.join(CACHE, "captions.json");
const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mpg", "mpeg", "mts", "m2ts", "3gp"]);
/** What a browser can play by itself; the rest can still be found, seen by a still, and downloaded. */
const PLAYABLE = new Set(["mp4", "m4v", "webm", "mov"]);
const MAX_PHOTO_BYTES = 80 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024 * 1024; // never read whole: sent piece by piece
const MAX_FILES = Number(process.env.GALLERY_MAX_FILES) || 200_000;
const SCAN_MS = 5 * 60_000; // a large archive isn't walked every few seconds
const DEADLINE_MS = Number(process.env.GALLERY_SCAN_MS) || 10 * 60_000;
const CAPTION_TICK_MS = 30_000;
/** How long the model must have been free before a photo is captioned. */
const CAPTION_IDLE_MS = 60_000;
const CAPTION_TOKENS = 160;
export const THUMB = { thumb: 360, view: 1600 } as const;
export type ImageSize = keyof typeof THUMB;
export const CONTENT_TYPE: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg", mts: "video/mp2t", m2ts: "video/mp2t", "3gp": "video/3gpp" };
export const isPlayable = (ext: string) => PLAYABLE.has(ext);

interface Caption { v: string; c: string; y?: number; fails?: number; /** Since when no clean scan has found the file. */ gone?: number }
interface State {
  at: number;
  list: (GalleryEntry & { ext: string })[];
  scan?: Promise<void>;
  scanned: boolean;
  ok: boolean;
  error?: string;
  skipped: Skipped | null;
  dirs: string[];
  captions?: Map<string, Caption>;
  dirty: number;
  worker?: ReturnType<typeof setInterval>;
  working: boolean;
  lastFail: number;
}
const g = globalThis as typeof globalThis & { __gallery?: State };
const state: State = (g.__gallery ??= { at: 0, list: [], scanned: false, ok: true, skipped: null, dirs: [], dirty: 0, working: false, lastFail: 0 });

function captions(): Map<string, Caption> {
  if (state.captions) return state.captions;
  let map = new Map<string, Caption>();
  try {
    map = new Map(Object.entries(JSON.parse(readFileSync(CAPTIONS, "utf8")) as Record<string, Caption>));
  } catch {}
  return (state.captions = map);
}
function saveCaptions() {
  mkdirSync(CACHE, { recursive: true });
  writeFileAtomic(CAPTIONS, JSON.stringify(Object.fromEntries(captions())));
  state.dirty = 0;
}
const versionOf = (e: { size: number; mtime: number }) => `${e.size}:${e.mtime}`;

function refresh(): Promise<void> {
  return (state.scan ??= (async () => {
    try {
      const r = await scanFolder(ROOT(), { accept: (ext) => PHOTO_EXT.has(ext) || VIDEO_EXT.has(ext), maxBytes: (ext) => (VIDEO_EXT.has(ext) ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES), maxDepth: 12, maxFiles: MAX_FILES, deadlineMs: DEADLINE_MS });
      const seen = captions();
      const before = state.list.length;
      state.list = r.files.map((f) => {
        const id = `g-${createHash("sha256").update(f.path).digest("hex").slice(0, 40)}`;
        const c = seen.get(id);
        const fit = c && c.v === versionOf(f);
        return { id, path: f.path, name: f.name, size: f.size, mtime: f.mtime, ext: f.ext, kind: VIDEO_EXT.has(f.ext) ? ("video" as const) : ("photo" as const), ...(fit && c.c ? { caption: c.c } : {}), ...(fit && c.y ? { year: c.y } : {}) };
      });
      state.skipped = r.skipped;
      state.dirs = r.dirs;
      state.ok = true;
      state.error = undefined;
      // Words about photos no longer there go; but a share half there must not cost a month of model time.
      if (safeToForget(before, state.list.length, r.skipped)) {
        const live = new Set(state.list.map((e) => e.id));
        const now = Date.now();
        for (const [id, c] of seen) {
          if (live.has(id)) {
            if (c.gone) { delete c.gone; state.dirty++; }
          } else if (!c.gone) { c.gone = now; state.dirty++; }
          else if (goneLongEnough(c.gone, now)) { seen.delete(id); state.dirty++; }
        }
        if (state.dirty) saveCaptions();
      }
    } catch (e) {
      const code = e instanceof ScanFailed ? e.message : "unreadable";
      if (code === "ENOENT" && !state.list.length) {
        state.ok = true;
        state.error = undefined;
      } else {
        state.ok = false;
        state.error = code;
        if (!(e instanceof ScanFailed)) logError("gallery", e);
      }
    } finally {
      state.at = Date.now();
      state.scanned = true;
      state.scan = undefined;
    }
  })());
}

async function fresh() {
  if (Date.now() - state.at > SCAN_MS) {
    const p = refresh();
    if (!state.scanned) await Promise.race([p, new Promise((r) => setTimeout(r, 5000))]);
  }
}

export async function galleryFor(who: { username: string; role: string }): Promise<(GalleryEntry & { ext: string })[]> {
  await fresh();
  if (who.role === "admin") return state.list;
  const rules = await getSetting("folder_access").then(parseRules).catch(() => null);
  return rules ? state.list.filter((e) => canSee(`galeri/${e.path}`, who, rules)) : [];
}
export const galleryDown = () => !state.ok;
export const fileOf = (e: { path: string }) => path.join(ROOT(), ...e.path.split("/"));
export const galleryBytes = (e: { path: string }, signal?: AbortSignal) => readWithin(fileOf(e), 2 * 60_000, signal);

const thumbWork = new Semaphore(2, 200);
// @napi-rs/canvas: already what PDF pages are drawn with; loaded on demand so a missing native build fails one picture, not the app.
const canvasLib = () => import("@napi-rs/canvas");

async function shrink(buf: Buffer, longest: number, quality: number): Promise<Buffer> {
  const { createCanvas, loadImage } = await canvasLib();
  const img = await loadImage(buf);
  const scale = Math.min(1, longest / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; // transparency has nothing to show through in a JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.encode("jpeg", quality);
}

/** A smaller copy, made once per file version. The archive stays as it is: copies live in this app's cache. */
export async function galleryThumb(e: GalleryEntry, size: ImageSize, signal: AbortSignal): Promise<Buffer> {
  const name = `${e.id}-${createHash("sha1").update(versionOf(e)).digest("hex").slice(0, 10)}-${THUMB[size]}.jpg`;
  const file = path.join(THUMBS, name);
  if (existsSync(file)) return readFile(file);
  return thumbWork.run(async () => {
    const source = e.kind === "video" ? await videoFrame(fileOf(e), THUMB.view, signal) : await galleryBytes(e, signal);
    const out = await shrink(source, THUMB[size], size === "thumb" ? 72 : 84);
    mkdirSync(THUMBS, { recursive: true });
    writeFileAtomic(file, out);
    return out;
  }, signal);
}

const CAPTION_PROMPT = `Bu görüntüyü arşivde aranabilmesi için Türkçe tek cümleyle tarif et: ne var, nerede, ne yapılıyor. Görünen yazı varsa (tabela, pankart) ekle.
Kişilerin kim olduğunu tahmin etme, isim verme. Görmediğini yazma. En çok 30 kelime. Yalnızca o cümleyi yaz.`;

export const captionsOn = async () => (await getSetting("gallery_captions").catch(() => undefined)) !== "false";

async function captionOne(e: GalleryEntry) {
  const { vision } = await modelConfig();
  // A video is seen by one still: enough to find it, and the file itself is never read whole.
  const buf = e.kind === "video" ? await videoFrame(fileOf(e), 1024) : await galleryBytes(e);
  const small = await shrink(buf, 1024, 80);
  // Reading and shrinking took a while: a chat may have started meanwhile, and it comes first. Checked again with the
  // same rule as captionTick, and nothing awaited between this check and taking the model slot below.
  if (!admission.model.idleFor(CAPTION_IDLE_MS)) return;
  const year = e.kind === "video" ? undefined : exifYear(buf.subarray(0, 256 * 1024));
  const signal = AbortSignal.timeout(5 * 60_000);
  const r = await admission.model.run(() => providerOf(vision).chat({ model: vision.model, messages: [{ role: "user", content: CAPTION_PROMPT, images: [small.toString("base64")] }], maxTokens: CAPTION_TOKENS, signal }), signal, true);
  const text = r.text.replace(/\s+/g, " ").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 400);
  captions().set(e.id, { v: versionOf(e), c: text, ...(year ? { y: year } : {}) });
  const live = state.list.find((x) => x.id === e.id);
  if (live) Object.assign(live, text ? { caption: text } : {}, year ? { year } : {});
  if (++state.dirty >= 10) saveCaptions();
}

/**
 * Sees one photo at a time, and only while nobody is waiting on the model: people come first, whatever the archive's size.
 * A photo that can't be read is tried three times, then left, so one bad file can't hold up the rest.
 */
async function captionTick() {
  // Only with the model idle for a while: a chat answer is several calls in a row, and a photo between them slows it.
  if (state.working || !admission.model.idleFor(CAPTION_IDLE_MS) || Date.now() - state.lastFail < 10 * 60_000) return;
  state.working = true;
  try {
    if (!(await captionsOn())) return;
    await fresh();
    const seen = captions();
    const next = state.list.find((e) => {
      const c = seen.get(e.id);
      return !c || (c.v !== versionOf(e)) || (!c.c && (c.fails ?? 0) > 0 && (c.fails ?? 0) < 3);
    });
    if (!next) {
      if (state.dirty) saveCaptions();
      return;
    }
    try {
      await captionOne(next);
    } catch (err) {
      state.lastFail = Date.now();
      // The model being away, or ffmpeg missing, says nothing about the photo: it is tried again later, not given up on.
      const { vision } = await modelConfig();
      const noTool = (err as NodeJS.ErrnoException).code === "ENOENT";
      if (noTool || !(await providerOf(vision).healthy())) return;
      const had = seen.get(next.id);
      const fails = (had?.v === versionOf(next) ? (had.fails ?? 0) : 0) + 1;
      seen.set(next.id, { v: versionOf(next), c: "", fails });
      state.dirty++;
      logError("gallery", err);
    }
  } finally {
    state.working = false;
  }
}

/** From lib/boot. The first scan also starts here, so the first person to ask doesn't wait for it. */
export function startGalleryWorker() {
  if (state.worker) return;
  void fresh().catch(() => {});
  state.worker = setInterval(() => void captionTick().catch((e) => logError("gallery", e)), CAPTION_TICK_MS);
  state.worker.unref();
}

export async function galleryStatus() {
  await fresh();
  const seen = captions();
  const done = state.list.filter((e) => {
    const c = seen.get(e.id);
    return c && c.v === versionOf(e) && (c.c || (c.fails ?? 0) >= 3);
  }).length;
  const videos = state.list.filter((e) => e.kind === "video").length;
  return { ok: state.ok, at: state.at, count: state.list.length, videos, captioned: done, skipped: state.skipped, error: state.error, on: await captionsOn(), root: ROOT(), dirs: state.dirs };
}
