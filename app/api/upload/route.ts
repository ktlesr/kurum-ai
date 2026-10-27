import { createHash } from "node:crypto";
import { extractDir, holdExtract } from "@/lib/workspace";
import { deleteDoc, dropExtractIfUnused, docsOf, MAX_BYTES, MAX_DOCS_PER_USER, saveDoc, toMeta, type Doc } from "@/lib/server";
import { requireApiUser } from "@/lib/auth";
import { parseFile, UserError } from "@/lib/parse";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

// Uploads still being parsed, per user. Counted against the doc cap so parallel uploads can't overshoot it.
// ponytail: per-process, like the doc map itself; one app instance.
const inflight = new Map<string, number>();

/**
 * Streams NDJSON: {type:"progress",stage,done,total}… then {type:"done",doc} or {type:"error",error}.
 * Extraction with table verification can take minutes, so the card needs live progress.
 */
export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Dosya bulunamadı.");
  if (file.size > MAX_BYTES) return fail("Dosya 25 MB sınırını aşıyor.", 413);
  if (file.size === 0) return fail("Dosya boş.");
  // Check and reserve in one synchronous step (no await between), released when parsing ends either way.
  const busy = inflight.get(user.id) ?? 0;
  if (docsOf(user.id).length + busy >= MAX_DOCS_PER_USER) return fail(`En fazla ${MAX_DOCS_PER_USER} dosya yüklenebilir. Önce bir dosyayı kaldırın.`, 409);
  inflight.set(user.id, busy + 1);
  const release = () => {
    const n = (inflight.get(user.id) ?? 1) - 1;
    if (n > 0) inflight.set(user.id, n);
    else inflight.delete(user.id);
  };
  let buf: Buffer;
  try {
    buf = Buffer.from(await file.arrayBuffer());
  } catch (e) {
    release();
    throw e;
  }

  const sourceHash = createHash("sha256").update(buf).digest("hex");
  const releaseExtract = holdExtract(`${user.id}/${sourceHash}`);
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: object) => {
        try { ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* client went away */ }
      };
      try {
        const parsed = await parseFile(file.name, buf, (p) => send({ type: "progress", ...p }), req.signal, extractDir(user.id, sourceHash));
        const doc: Doc = { id: crypto.randomUUID(), ownerId: user.id, sourceHash, name: file.name, size: file.size, chars: parsed.text.length, ...parsed };
        if (!doc.chars && !doc.warning) doc.warning = "Dosyadan metin çıkarılamadı.";
        saveDoc(doc);
        send({ type: "done", doc: toMeta(doc) });
      } catch (e) {
        if (req.signal.aborted) return;
        if (!(e instanceof UserError)) logError("upload", e);
        send({ type: "error", error: e instanceof UserError ? e.message : "Dosya okunamadı. Bozuk ya da parola korumalı olabilir." });
      } finally {
        release();
        // Last upload of this content done: if no doc kept it (failed, cancelled, or deleted meanwhile), drop it.
        if (releaseExtract()) dropExtractIfUnused(user.id, sourceHash);
      }
      try { ctrl.close(); } catch {}
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

/** Docs uploaded earlier (they survive restarts), so the page can restore its file list. */
export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  return Response.json(docsOf(user.id).map(toMeta));
}

export async function DELETE(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const found = deleteDoc(user.id, new URL(req.url).searchParams.get("id") ?? "");
  return found ? new Response(null, { status: 204 }) : fail("Dosya bulunamadı.", 404);
}
