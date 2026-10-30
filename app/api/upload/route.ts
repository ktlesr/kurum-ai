import { createHash } from "node:crypto";
import { extractDir, holdExtract } from "@/lib/workspace";
import { deleteDoc, dropExtractIfUnused, docsOf, getDoc, MAX_BYTES, MAX_DOCS_PER_USER, saveDoc, toMeta, uniqueName, type Doc } from "@/lib/server";
import { docSections } from "@/lib/context";
import { isSharedId, sharedDoc, sharedEntry } from "@/lib/library";
import { requireApiUser } from "@/lib/auth";
import { parseFile, UserError } from "@/lib/parse";
import { logError } from "@/lib/log";
import { admission, busy, tooMany } from "@/lib/admission";
import { Busy } from "@/lib/limits";
import type { User } from "@/lib/auth";
import { contentProblem, readLimited } from "@/lib/filetype";

export const runtime = "nodejs";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

// Uploads still being parsed, per user. Counted against the doc cap so parallel uploads can't overshoot it.
// ponytail: per-process, like the doc map itself; one app instance.
const inflight = new Map<string, number>();

/**
 * Streams NDJSON: {type:"progress",stage,done,total}… then {type:"done",doc} or {type:"error",error}.
 * Extraction with table verification can take minutes, so the card needs live progress.
 */
const MAX_BODY = MAX_BYTES + 1024 * 1024; // file + multipart overhead
const tooBig = () => fail("Dosya 25 MB sınırını aşıyor.", 413);

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  if (!admission.uploadPerUser.allow(user.id)) return tooMany("yükleme");
  // Refuse by header before taking a slot or reading anything (audit S5).
  if (Number(req.headers.get("content-length")) > MAX_BODY) return tooBig();

  // A global upload slot is held from reading the body until the last progress event: it bounds how many
  // bodies and their copies are in memory at once. Released here on early returns, by the stream otherwise.
  let releaseSlot: () => void;
  try {
    releaseSlot = await admission.upload.acquire(req.signal);
  } catch (e) {
    if (e instanceof Busy) return busy();
    throw e;
  }
  const out = await accept(req, user, releaseSlot).catch((e) => {
    releaseSlot();
    throw e;
  });
  if (!out.streaming) releaseSlot();
  return out.res;
}

async function accept(req: Request, user: User, releaseSlot: () => void): Promise<{ res: Response; streaming: boolean }> {
  const done = (res: Response) => ({ res, streaming: false });
  const raw = await readLimited(req.body, MAX_BODY).catch(() => undefined);
  if (raw === null) return done(tooBig());
  const form = raw && (await new Response(raw, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null));
  const file = form?.get("file");
  if (!(file instanceof File)) return done(fail("Dosya bulunamadı."));
  if (file.size > MAX_BYTES) return done(tooBig());
  if (file.size === 0) return done(fail("Dosya boş."));
  // Check and reserve in one synchronous step (no await between), released when parsing ends either way.
  const pending = inflight.get(user.id) ?? 0;
  if (docsOf(user.id).length + pending >= MAX_DOCS_PER_USER) return done(fail(`En fazla ${MAX_DOCS_PER_USER} dosya yüklenebilir. Önce bir dosyayı kaldırın.`, 409));
  inflight.set(user.id, pending + 1);
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
  // The extension picks the parser; the bytes must agree (and a docx/xlsx must not inflate into a bomb).
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const problem = await contentProblem(ext, buf).catch(() => "Dosya okunamadı. Bozuk olabilir.");
  if (problem) {
    release();
    return done(fail(problem, 415));
  }
  // Docling queue already full: a clean 429 now beats an error event minutes later.
  if ((ext === "pdf" || ext === "docx") && admission.docling.saturated) {
    release();
    return done(busy());
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
        const doc: Doc = { id: crypto.randomUUID(), ownerId: user.id, sourceHash, name: uniqueName(user.id, file.name), size: file.size, chars: parsed.text.length, ...parsed };
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
        releaseSlot();
      }
      try { ctrl.close(); } catch {}
    },
  });
  return { res: new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } }), streaming: true };
}

/** Moves a doc of the user's to a folder of their library. */
export async function PATCH(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const d = getDoc(user.id, new URL(req.url).searchParams.get("id") ?? "");
  if (!d) return fail("Dosya bulunamadı.", 404);
  const b = (await req.json().catch(() => null)) as { folder?: unknown } | null;
  if (typeof b?.folder !== "string") return fail("Geçersiz klasör.");
  const folder = b.folder.split("/").map((p) => p.replace(/[\u0000-\u001f"<>\\]/g, "").trim().slice(0, 60)).filter((p) => p && p !== "." && p !== "..").slice(0, 4).join("/");
  saveDoc({ ...d, folder: folder || undefined });
  return Response.json(toMeta(getDoc(user.id, d.id)!));
}

/** Docs uploaded earlier (they survive restarts), so the page can restore its file list. */
export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  // ?id=…: one doc's extracted text by page/sheet, for the source panel. Someone else's doc is a plain 404.
  const id = new URL(req.url).searchParams.get("id");
  if (id && isSharedId(id)) {
    const e = sharedEntry(id);
    if (!e) return fail("Dosya bulunamadı.", 404);
    try {
      const d = await sharedDoc(e, () => {}, req.signal);
      return Response.json({ ...toMeta(d), sections: docSections(d.text) });
    } catch {
      return fail("Dosya okunamadı.", 422);
    }
  }
  if (id) {
    const d = getDoc(user.id, id);
    return d ? Response.json({ ...toMeta(d), sections: docSections(d.text) }) : fail("Dosya bulunamadı.", 404);
  }
  return Response.json(docsOf(user.id).map(toMeta));
}

export async function DELETE(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const found = deleteDoc(user.id, new URL(req.url).searchParams.get("id") ?? "");
  return found ? new Response(null, { status: 204 }) : fail("Dosya bulunamadı.", 404);
}
