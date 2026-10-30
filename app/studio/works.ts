"use client";

// "Çalışmalarım" for the studio (plan §2, module 6): designs saved in this browser's IndexedDB, one database per
// user (a shared browser profile never mixes accounts), separate from the chats' database so their schemas evolve
// apart. What comes back is validated like a project file (cleanEls): storage is the user's, but not trusted code.
import { MAX_SLIDES } from "@/lib/deck";
import { THEMES } from "@/lib/themes";
import { FORMATS, cleanEls, safeColor, type El, type FormatId, type TemplateId, TEMPLATES } from "@/lib/studio";

/** A presentation: its slides (`els` is the first one, for the list) and the layouts' template. */
export interface SavedDeck { template: string; primary: string; slides: El[][]; theme?: string }
export interface Work { id: string; name: string; format: FormatId; template: TemplateId; els: El[]; thumb: string; updatedAt: number; deck?: SavedDeck }
const STORE = "works";
const MAX_WORKS = 200;

const req = <T,>(r: IDBRequest<T>) =>
  new Promise<T>((ok, no) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
const done = (t: IDBTransaction) =>
  new Promise<void>((ok, no) => {
    t.oncomplete = () => ok();
    t.onerror = t.onabort = () => no(t.error);
  });

async function db(user: string) {
  const open = indexedDB.open(`kurum-ai-studio:${user}`, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
  const d = await req(open);
  d.onversionchange = () => d.close();
  return d;
}

/** A deck from storage or a project file: validated like any design; null if it isn't one. */
export function cleanDeck(raw: unknown): SavedDeck | undefined {
  const d = raw as Partial<SavedDeck> | null | undefined;
  if (!d || typeof d.template !== "string" || !/^[\w-]{1,40}$/.test(d.template) || !Array.isArray(d.slides)) return undefined;
  const slides = d.slides.slice(0, MAX_SLIDES).map((s) => cleanEls(s));
  return slides.length ? { template: d.template, primary: safeColor(d.primary, "#14263d"), slides, ...(THEMES.some((t) => t.name === d.theme) ? { theme: d.theme } : {}) } : undefined;
}

/** A stored record → Work, or null if it isn't one (another version, a hand-edited database). */
function clean(r: unknown): Work | null {
  const x = r as Partial<Work> | null;
  if (!x || typeof x.id !== "string" || typeof x.format !== "string" || !Object.hasOwn(FORMATS, x.format)) return null;
  const els = cleanEls(x.els);
  const deck = cleanDeck(x.deck);
  // A deck's open slide may be empty; its other slides aren't lost with it.
  if (!els.length && !deck) return null;
  return {
    id: x.id.slice(0, 64),
    name: typeof x.name === "string" ? x.name.slice(0, 80) : "Adsız tasarım",
    format: x.format as FormatId,
    template: typeof x.template === "string" && Object.hasOwn(TEMPLATES, x.template) ? (x.template as TemplateId) : "duyuru",
    els,
    thumb: typeof x.thumb === "string" && /^data:image\/(png|jpeg);base64,/.test(x.thumb) ? x.thumb : "",
    updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : 0,
    ...(deck ? { deck } : {}),
  };
}

export async function listWorks(user: string): Promise<Work[]> {
  const d = await db(user);
  try {
    const all = await req(d.transaction(STORE, "readonly").objectStore(STORE).getAll());
    return all.map(clean).filter((w): w is Work => !!w).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    d.close();
  }
}

export async function saveWork(user: string, w: Work): Promise<void> {
  const d = await db(user);
  try {
    const t = d.transaction(STORE, "readwrite");
    const s = t.objectStore(STORE);
    const count = await req(s.count());
    const exists = await req(s.getKey(w.id));
    if (!exists && count >= MAX_WORKS) throw new Error(`En fazla ${MAX_WORKS} çalışma saklanabilir; önce eskilerden silin.`);
    s.put(w);
    await done(t);
  } catch (e) {
    throw (e as Error)?.name === "QuotaExceededError" ? new Error("Tarayıcının depolama alanı dolu; bazı çalışmaları silin.") : e;
  } finally {
    d.close();
  }
}

export async function removeWork(user: string, id: string): Promise<void> {
  const d = await db(user);
  try {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(id);
    await done(t);
  } finally {
    d.close();
  }
}

/** A small PNG of the design for the list (the work itself keeps the full elements). */
export async function thumbnail(svg: string, w: number, h: number): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const s = 240 / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
