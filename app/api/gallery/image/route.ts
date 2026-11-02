// One photo by id. Someone else's closed folder looks exactly like a missing file; no path comes from a request.
import { requireApiUser } from "@/lib/auth";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { CONTENT_TYPE, fileOf, galleryBytes, galleryFor, galleryThumb, THUMB, type ImageSize } from "@/lib/gallery";
import { parseRange } from "@/lib/video-frame";
import { Busy } from "@/lib/limits";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const u = new URL(req.url).searchParams;
  const e = (await galleryFor(user)).find((x) => x.id === u.get("id"));
  if (!e) return new Response(null, { status: 404 });
  const size = u.get("size") ?? "thumb";
  const download = u.get("indir") === "1";
  // The browser keeps a copy but asks every time: the sign-in and folder rights above run on each request, so a closed folder's
  // picture can't come out of its cache for the next person on this computer. Unchanged files answer in a few bytes.
  const etag = `"${e.id}-${e.size}-${Math.round(e.mtime)}-${size}"`;
  const headers: Record<string, string> = { "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  if (req.headers.get("if-none-match") === etag && !req.headers.get("range")) return new Response(null, { status: 304, headers });
  try {
    if (size in THUMB) {
      const out = await galleryThumb(e, size as ImageSize, req.signal);
      return new Response(new Uint8Array(out), { headers: { ...headers, "Content-Type": "image/jpeg" } });
    }
    if (e.kind === "video") {
      // Piece by piece: a video of many gigabytes never sits in memory, and the player can jump anywhere in it.
      const range = parseRange(req.headers.get("range"), e.size);
      if (range === "bad") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${e.size}` } });
      const { start, end } = range ?? { start: 0, end: e.size - 1 };
      const stream = createReadStream(fileOf(e), { start, end, highWaterMark: 256 * 1024 });
      req.signal.addEventListener("abort", () => stream.destroy(), { once: true });
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: range ? 206 : 200,
        headers: {
          ...headers,
          "Content-Type": CONTENT_TYPE[e.ext] ?? "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${e.size}` } : {}),
          ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(e.name)}` } : {}),
        },
      });
    }
    const buf = await galleryBytes(e, req.signal);
    return new Response(new Uint8Array(buf), {
      headers: { ...headers, "Content-Type": CONTENT_TYPE[e.ext] ?? "application/octet-stream", ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(e.name)}` } : {}) },
    });
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (err instanceof Busy) return new Response(null, { status: 429, headers: { "Retry-After": "5" } });
    logError("gallery", err);
    return new Response(null, { status: 503 });
  }
}
