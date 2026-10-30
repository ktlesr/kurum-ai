"use client";

// Fonts of the studio, three sources, one id per family (the id is what a design stores):
// - the app's library (public/fonts/lib, lib/font-list.ts);
// - this computer's fonts (Local Font Access API, Chromium, asks permission): "local-…";
// - a font file the user adds: "file-…", kept in this browser only.
// Everything is loaded as FontFace for the canvas and registered as data: URLs for the SVG (an image can't fetch).
// A design opened where its font isn't available draws in the default font.
import { LIBRARY_FONTS } from "@/lib/font-list";
import { registerFontCss, type Measure } from "@/lib/studio";
import { FONT_FAMILY, familyOf } from "@/lib/studio";

export interface FontOption { id: string; label: string; cat: string }
export const LIBRARY_OPTIONS: FontOption[] = LIBRARY_FONTS.map((f) => ({ id: f.id, label: f.label, cat: f.cat }));

const MAX_FILE = 15 * 1024 * 1024;
const STORE = "fonts";
const loading = new Map<string, Promise<void>>();

const toDataUrl = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });

type Face = { buf: ArrayBuffer; weight: string; range?: string; mime: string };
async function install(id: string, faces: Face[]) {
  const css: string[] = [];
  for (const f of faces) {
    const face = new FontFace(`K-${id}`, f.buf, { weight: f.weight, ...(f.range ? { unicodeRange: f.range } : {}) });
    document.fonts.add(await face.load());
    const url = await toDataUrl(new Blob([f.buf], { type: f.mime }));
    css.push(`@font-face{font-family:K-${id};src:url(${url});font-weight:${f.weight}${f.range ? `;unicode-range:${f.range}` : ""}}`);
  }
  registerFontCss(id, css.join(""));
}

// ---- files the user added (IndexedDB, per user) ------------------------------------------------------------------
const idb = (user: string) =>
  new Promise<IDBDatabase>((ok, no) => {
    const open = indexedDB.open(`kurum-ai-fonts:${user}`, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
    open.onsuccess = () => ok(open.result);
    open.onerror = () => no(open.error);
  });
type Stored = { id: string; label: string; buf: ArrayBuffer };
async function stored<T>(user: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await idb(user);
  try {
    return await new Promise<T>((ok, no) => {
      const t = d.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      t.oncomplete = () => ok(r.result);
      t.onerror = t.onabort = () => no(t.error);
    });
  } finally {
    d.close();
  }
}
export async function uploadedFonts(user: string): Promise<FontOption[]> {
  const all = await stored<Stored[]>(user, "readonly", (s) => s.getAll());
  return all.map((f) => ({ id: f.id, label: f.label, cat: "Yüklediklerim" }));
}
/** Real family names of the fonts that aren't in the library, for files that name them (PPTX). */
export async function familyNames(user: string): Promise<Map<string, string>> {
  const up = await uploadedFonts(user).catch(() => []);
  // ponytail: an uploaded font's label is its file name: the style part is cut; reading the font's name table would be exact.
  const familyOf = (label: string) => label.replace(/[-_ ]?\[.*$/, "").replace(/[-_ ]+(thin|hairline|extra ?light|ultra ?light|light|regular|book|medium|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|bold|black|heavy|italic|oblique|variable|vf)\b.*$/i, "") || label;
  return new Map([...up.map((f) => [f.id, familyOf(f.label)] as const), ...[...(localList ?? [])].map(([id, f]) => [id, f.label] as const)]);
}
/** A font file → stored and loaded; a file the browser can't read as a font is refused here. */
export async function addFontFile(user: string, file: File): Promise<FontOption> {
  if (file.size > MAX_FILE) throw new Error("Yazı tipi dosyası en fazla 15 MB olabilir.");
  const buf = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const id = `file-${hash}`;
  const label = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Yazı tipi";
  try {
    await install(id, [{ buf, weight: "100 900", mime: "application/octet-stream" }]);
  } catch {
    throw new Error("Bu dosya yazı tipi olarak okunamadı (.ttf, .otf, .woff, .woff2).");
  }
  loading.set(id, Promise.resolve());
  await stored(user, "readwrite", (s) => s.put({ id, label, buf } satisfies Stored));
  return { id, label, cat: "Yüklediklerim" };
}

// ---- this computer's fonts ------------------------------------------------------------------------------------------
type LocalFont = { family: string; style: string; blob: () => Promise<Blob> };
type WithLocal = Window & { queryLocalFonts?: () => Promise<LocalFont[]> };
export const localFontsSupported = () => typeof window !== "undefined" && typeof (window as WithLocal).queryLocalFonts === "function";

/** Same family, same id on every visit. */
function localId(family: string) {
  let h = 5381;
  for (const c of family) h = ((h * 33) ^ c.codePointAt(0)!) >>> 0;
  const slug = family.normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  return `local-${slug ? `${slug}-` : ""}${h.toString(36)}`;
}
const WEIGHT: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300], [/medium/i, 500], [/semi ?bold|demi/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
const weightOf = (style: string) => WEIGHT.find(([re]) => re.test(style))?.[1] ?? 400;

let localList: Map<string, { label: string; styles: LocalFont[] }> | null = null;
function collect(all: LocalFont[]) {
  const m = new Map<string, { label: string; styles: LocalFont[] }>();
  for (const f of all) {
    if (/italic|oblique/i.test(f.style)) continue;
    const id = localId(f.family);
    const e = m.get(id) ?? { label: f.family, styles: [] };
    e.styles.push(f);
    m.set(id, e);
  }
  localList = m;
}
/** Asks the browser (permission prompt the first time; call from a click). */
export async function queryLocal(): Promise<FontOption[]> {
  collect(await (window as WithLocal).queryLocalFonts!());
  return [...localList!].map(([id, f]) => ({ id, label: f.label, cat: "Bilgisayarımdaki" })).sort((a, b) => a.label.localeCompare(b.label, "tr"));
}
/** Without a prompt: only if permission was given earlier (a design reopened on this computer). */
async function localSilently() {
  if (localList) return;
  if (!localFontsSupported()) return;
  const p = await navigator.permissions.query({ name: "local-fonts" as PermissionName }).catch(() => null);
  if (p?.state === "granted") collect(await (window as WithLocal).queryLocalFonts!());
}

// ---- loading --------------------------------------------------------------------------------------------------------
async function load(id: string, user: string) {
  const lib = LIBRARY_FONTS.find((f) => f.id === id);
  if (lib) {
    const faces = await Promise.all(
      lib.faces.map(async (f): Promise<Face> => {
        const r = await fetch(`/fonts/lib/${f.file}`);
        if (!r.ok) throw new Error(f.file);
        return { buf: await r.arrayBuffer(), weight: f.weight, range: f.range, mime: "font/woff2" };
      }),
    );
    return install(id, faces);
  }
  if (id.startsWith("file-")) {
    const f = await stored<Stored | undefined>(user, "readonly", (s) => s.get(id));
    if (!f) throw new Error("yok");
    return install(id, [{ buf: f.buf, weight: "100 900", mime: "application/octet-stream" }]);
  }
  if (id.startsWith("local-")) {
    await localSilently();
    const f = localList?.get(id);
    if (!f) throw new Error("yok");
    const faces: Face[] = [];
    // ponytail: at most 6 styles of a family, each under the file cap; a huge family or CJK font would bloat every SVG.
    for (const s of f.styles.slice(0, 6)) {
      const blob = await s.blob();
      if (blob.size <= MAX_FILE) faces.push({ buf: await blob.arrayBuffer(), weight: String(weightOf(s.style)), mime: "application/octet-stream" });
    }
    if (!faces.length) throw new Error("büyük");
    return install(id, faces);
  }
  throw new Error("yok");
}
/** Loads a family once; a failure can be tried again later (permission given, file added). */
export function ensureFont(id: string, user: string): Promise<void> {
  let p = loading.get(id);
  if (!p) {
    p = load(id, user).catch((e) => {
      loading.delete(id);
      throw e;
    });
    loading.set(id, p);
  }
  return p;
}

/** Text width with a family (loaded ones; others measure as the default, as they draw). */
export function measurer(): Measure {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return (t, size, weight, font) => {
    ctx.font = `${weight} ${size}px ${font ? familyOf(font) : `${FONT_FAMILY},Arial,sans-serif`}`;
    return ctx.measureText(t).width;
  };
}
