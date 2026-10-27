import { deleteDoc, docsOf, MAX_BYTES, MAX_DOCS_PER_USER, saveDoc, toMeta, type Doc } from "@/lib/server";
import { requireApiUser } from "@/lib/auth";
import { parseFile, UserError } from "@/lib/parse";

export const runtime = "nodejs";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

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
  if (docsOf(user.id).length >= MAX_DOCS_PER_USER) return fail(`En fazla ${MAX_DOCS_PER_USER} dosya yüklenebilir. Önce bir dosyayı kaldırın.`, 409);
  const buf = Buffer.from(await file.arrayBuffer());

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: object) => {
        try { ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* client went away */ }
      };
      try {
        const parsed = await parseFile(file.name, buf, (p) => send({ type: "progress", ...p }), req.signal);
        const doc: Doc = { id: crypto.randomUUID(), ownerId: user.id, name: file.name, size: file.size, chars: parsed.text.length, ...parsed };
        if (!doc.chars && !doc.warning) doc.warning = "Dosyadan metin çıkarılamadı.";
        saveDoc(doc);
        send({ type: "done", doc: toMeta(doc) });
      } catch (e) {
        if (req.signal.aborted) return;
        if (!(e instanceof UserError)) console.error(e);
        send({ type: "error", error: e instanceof UserError ? e.message : "Dosya okunamadı. Bozuk ya da parola korumalı olabilir." });
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
