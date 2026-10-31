"use client";

// The logo library: every logo the user added, in this browser's IndexedDB, one database per user (a logo can be 2 MB,
// too much for local storage to hold many). What comes back is validated like any stored picture.
import { storedPicture, type Picture } from "@/lib/studio";

export interface SavedLogo { id: string; name: string; pic: Picture; addedAt: number }
export const MAX_LOGOS = 40;
const STORE = "logos";

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
  const open = indexedDB.open(`kurum-ai-logos:${user}`, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
  const d = await req(open);
  d.onversionchange = () => d.close();
  return d;
}

export async function listLogos(user: string): Promise<SavedLogo[]> {
  const d = await db(user);
  try {
    const all = (await req(d.transaction(STORE, "readonly").objectStore(STORE).getAll())) as Partial<SavedLogo>[];
    return all
      .flatMap((x): SavedLogo[] => {
        const pic = storedPicture(x?.pic);
        return pic && typeof x.id === "string" ? [{ id: x.id, name: typeof x.name === "string" ? x.name.slice(0, 80) : "Logo", pic, addedAt: typeof x.addedAt === "number" ? x.addedAt : 0 }] : [];
      })
      .sort((a, b) => a.addedAt - b.addedAt);
  } finally {
    d.close();
  }
}

export async function putLogo(user: string, logo: SavedLogo): Promise<void> {
  const d = await db(user);
  try {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(logo);
    await done(t);
  } finally {
    d.close();
  }
}

export async function removeLogo(user: string, id: string): Promise<void> {
  const d = await db(user);
  try {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(id);
    await done(t);
  } finally {
    d.close();
  }
}
