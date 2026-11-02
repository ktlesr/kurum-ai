// Searching and browsing the photo archive, as far as this person may see it. Names and ids only; pictures: ./image.
import { requireApiUser } from "@/lib/auth";
import { galleryDown, galleryFor, isPlayable } from "@/lib/gallery";
import { DEFAULT_COUNT, MAX_COUNT, kindAsked, nearFolders, searchGallery, type GalleryKind } from "@/lib/gallery-search";

export const runtime = "nodejs";

const pub = (e: { id: string; path: string; name: string; caption?: string; kind?: GalleryKind; ext: string }) => ({ id: e.id, name: e.name, folder: e.path.split("/").slice(0, -1).join("/"), ...(e.caption ? { caption: e.caption } : {}), ...(e.kind === "video" ? { video: true, ...(isPlayable(e.ext) ? { playable: true } : {}) } : {}) });

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const u = new URL(req.url).searchParams;
  const every = await galleryFor(user);
  // The studio picks stills only.
  const all = u.get("kind") === "photo" ? every.filter((e) => e.kind !== "video") : every;
  const down = galleryDown();
  const offset = Math.max(0, Number(u.get("offset")) || 0);
  const count = Math.min(MAX_COUNT, Math.max(1, Number(u.get("n")) || DEFAULT_COUNT));
  // A folder's photos, for the studio's browser.
  const folder = u.get("folder");
  if (folder !== null) {
    const inside = all.filter((e) => e.path.split("/").slice(0, -1).join("/") === folder);
    return Response.json({ down, total: inside.length, items: inside.slice(offset, offset + count).map(pub) });
  }
  const q = (u.get("q") ?? "").slice(0, 300);
  if (!q.trim()) {
    const dirs = [...new Set(all.map((e) => e.path.split("/").slice(0, -1).join("/")))].sort((a, b) => a.localeCompare(b, "tr"));
    return Response.json({ down, total: all.length, folders: dirs, items: [] });
  }
  const thisYear = new Date().getFullYear();
  const r = searchGallery(all, q, { count, offset, thisYear, kind: kindAsked(q) });
  return Response.json({ down, total: r.total, folder: r.folder, items: r.items.map(pub), near: r.total ? [] : nearFolders(all, q, thisYear) });
}
