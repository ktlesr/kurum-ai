// Filling a blank template from documents. The template comes with each request and is kept nowhere: "read" streams progress and
// what was found, the user checks it, "fill" returns the template with the values in it.
import { requireApiUser } from "@/lib/auth";
import { cptFor, getDoc, MAX_BYTES, NUM_CTX, type Doc } from "@/lib/server";
import { admission, busy, tooMany } from "@/lib/admission";
import { contextBudget, cptOf } from "@/lib/context";
import { readLimited } from "@/lib/filetype";
import { readWithin } from "@/lib/folder-scan";
import { READ_MS, filePathOf, isSharedId, sharedDoc, sharedEntryFor, sharedTemplatesFor, type SharedEntry } from "@/lib/library";
import { isMyTemplateId, readMyTemplate } from "@/lib/template-store";
import { Busy } from "@/lib/limits";
import { logError } from "@/lib/log";
import { modelConfig, providerOf } from "@/lib/model-config";
import type { Msg } from "@/lib/provider";
import { windows } from "@/lib/rag";
import { LIMITS } from "@/lib/validate";
import { countUsage } from "@/lib/usage";
import { TemplateError } from "@/lib/template";
import { ANSWER_CUT, extractValues, parseAnswer } from "@/lib/template-extract";
import { districtsAsked, focusSheets } from "@/lib/sheet-focus";
import { CONTENT_TYPES, fillTemplate, formatOf, parseValues, readTemplate, templateProblem } from "@/lib/template-file";

export const runtime = "nodejs";

const fail = (error: string, status = 400) => Response.json({ error }, { status });
/** A model answer's structure without its content: JSON keys and punctuation stay readable, data doesn't. */
const shape = (s: string) => s.replace(/\p{L}/gu, "a").replace(/\p{N}/gu, "0");
const MAX_BODY = MAX_BYTES + 4 * 1024 * 1024; // the file, and the values typed over it
// A form's values, not an essay: ~50 table records (about 120 tokens each); more and the window is read in halves.
const MAX_ANSWER = 6000;
// ponytail: enough for ~6 hundred pages at this window size; said out loud when a document is longer.
const MAX_WINDOWS = 60;

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  if (!admission.uploadPerUser.allow(user.id)) return tooMany("şablon");
  if (Number(req.headers.get("content-length")) > MAX_BODY) return fail("Şablon 25 MB sınırını aşıyor.", 413);

  let release: () => void;
  try {
    release = await admission.upload.acquire(req.signal);
  } catch (e) {
    if (e instanceof Busy) return busy();
    throw e;
  }
  let streaming = false;
  try {
    const raw = await readLimited(req.body, MAX_BODY).catch(() => undefined);
    if (raw === null) return fail("Şablon 25 MB sınırını aşıyor.", 413);
    const form = raw && (await new Response(raw, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null));
    if (!form) return fail("Şablon dosyası bulunamadı.");
    // A file sent along, or one of the forms this person may use: by id, so no path comes from a request.
    const file = form.get("file");
    const picked = String(form.get("templateId") ?? "");
    let name: string;
    let bytes: Uint8Array;
    if (file instanceof File) {
      if (file.size > MAX_BYTES) return fail("Şablon 25 MB sınırını aşıyor.", 413);
      if (!file.size) return fail("Şablon dosyası boş.");
      name = file.name;
      bytes = new Uint8Array(await file.arrayBuffer());
    } else if (isMyTemplateId(picked)) {
      const mine = await readMyTemplate(user.id, picked);
      if (!mine) return fail("Şablon bulunamadı.", 404);
      name = mine.meta.name;
      bytes = mine.bytes;
    } else if (isSharedId(picked)) {
      const e = (await sharedTemplatesFor(user)).find((t) => t.id === picked);
      if (!e) return fail("Şablon bulunamadı.", 404);
      const buf = await readWithin(filePathOf(e), READ_MS, req.signal).catch(() => null);
      if (!buf) return fail("Ortak klasördeki şablona şu an ulaşılamıyor.", 503);
      name = e.name;
      bytes = new Uint8Array(buf);
    } else return fail("Şablon dosyası bulunamadı.");
    const format = formatOf(name);
    if (!format) return fail("Şablon Excel (.xlsx), Word (.docx), PDF ya da JSON olmalı. Eski .xls ve .doc dosyalarını yeni biçimde kaydedip deneyin.", 415);
    const problem = await templateProblem(format, bytes).catch(() => "Şablon okunamadı. Bozuk olabilir.");
    if (problem) return fail(problem, 415);

    if (form.get("action") === "fill") {
      let values;
      try {
        values = parseValues(JSON.parse(String(form.get("values") ?? "null")));
      } catch (e) {
        if (e instanceof TemplateError) return fail(e.message);
      }
      if (!values) return fail("Geçersiz değerler.");
      try {
        const filled = await fillTemplate(format, bytes, values);
        countUsage("template");
        return new Response(Buffer.from(filled.bytes), {
          headers: {
            "Content-Type": CONTENT_TYPES[format],
            "Content-Disposition": "attachment",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            // Words for the user, encoded: a header carries no Turkish letters as they are.
            "X-Template-Notes": encodeURIComponent(JSON.stringify(filled.notes)),
          },
        });
      } catch (e) {
        if (e instanceof TemplateError) return fail(e.message, 422);
        logError("template", e);
        return fail("Şablon doldurulamadı. Dosya bozuk olabilir.", 422);
      }
    }

    // Reading: which documents, with which model.
    if (admission.model.saturated) return busy();
    const cfg = await modelConfig();
    const model = String(form.get("model") ?? "") || cfg.defaultModel;
    if (!cfg.models.includes(model)) return fail("Bu model kullanılamaz.");
    let ids: unknown;
    try {
      ids = JSON.parse(String(form.get("fileIds") ?? "[]"));
    } catch {}
    if (!Array.isArray(ids) || !ids.length || ids.length > LIMITS.files || !ids.every((x) => typeof x === "string" && x.length <= 64)) return fail("Bilginin alınacağı en az bir belge seçin.");
    const instruction = String(form.get("instruction") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 2000);
    const mine: Doc[] = [];
    const sharedOnes: SharedEntry[] = [];
    for (const id of ids as string[]) {
      if (isSharedId(id)) {
        const e = await sharedEntryFor(user, id);
        if (!e) return fail("Belge sunucuda bulunamadı. Kaldırıp tekrar ekleyin.", 409);
        sharedOnes.push(e);
      } else {
        const d = getDoc(user.id, id);
        if (!d) return fail("Belge sunucuda bulunamadı. Kaldırıp tekrar ekleyin.", 409);
        mine.push(d);
      }
    }
    let layout;
    try {
      layout = await readTemplate(format, bytes);
    } catch (e) {
      if (e instanceof TemplateError) return fail(e.message, 422);
      logError("template", e);
      return fail("Şablon okunamadı. Bozuk olabilir.", 422);
    }
    if (!layout.slots.length && !layout.tables.length) {
      return fail("Bu şablonda doldurulacak bir yer bulunamadı. Boş hücre ya da alan bırakın, ya da doldurulacak yerlere {{ad}} ya da ____ gibi işaret koyun.", 422);
    }
    const chat = providerOf(cfg.chat);
    if (!(await chat.healthy())) return fail("Model sunucusu çalışmıyor. Yöneticinize bildirin.", 503);

    const enc = new TextEncoder();
    const signal = req.signal;
    streaming = true;
    const body = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        const send = (o: object) => {
          try { ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { /* client went away */ }
        };
        try {
          const docs = [...mine];
          for (const e of sharedOnes) {
            send({ type: "progress", stage: `Belge okunuyor: ${e.name}` });
            docs.push(await sharedDoc(e, () => {}, signal));
          }
          // A district of the region asked: of a support workbook only that district's rows are read (lib/sheet-focus),
          // seconds instead of many minutes. Values are still proved against the whole documents.
          const places = districtsAsked(instruction);
          const read = docs.map((d) => ({ name: d.name, text: focusSheets(d.text, places) ?? d.text }));
          // The field list takes its share of what the model can read at once.
          const fieldChars = [...layout.slots.map((s) => s.label.length + 8), ...layout.tables.flatMap((t) => t.columns.map((c) => c.label.length + 8))].reduce((a, b) => a + b, 0);
          // At the documents' own rate: figures take a token per digit (lib/context cptOf), prose its measured rate. The rate
          // is the documents' average, and a window can be denser: 15% kept free (as chat's scan), halving catches the rest.
          const budget = Math.max(4000, contextBudget(NUM_CTX, cptOf(read.map((d) => d.text), cptFor(model))) * 0.85 - fieldChars - 1500);
          const all = windows(read.map((d) => ({ name: d.name, text: d.text })), budget);
          const wins = all.slice(0, MAX_WINDOWS);
          const found = await extractValues(layout, wins, docs.map((d) => d.text), instruction, async (system, user2) => {
            const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: user2 }];
            // JSON mode: the server can only write valid JSON (Gemma wrote figures like 74,520.00 unquoted). A server
            // that refuses the option answers 400, which would read as "too long": asked once more without it.
            const r = await admission.model.run(() => chat.chat({ model, messages, maxTokens: MAX_ANSWER, signal, json: true }), signal).catch((e) => {
              if (!(e instanceof Error && e.message === "model_http_400")) throw e;
              return admission.model.run(() => chat.chat({ model, messages, maxTokens: MAX_ANSWER, signal }), signal);
            });
            if (r.truncated) throw new Error(ANSWER_CUT); // read again in halves, not lost
            // What the model wrote when it isn't JSON: its size and the shape of its edges, letters and digits masked so
            // no name or figure of the document reaches the log ("S2": 00,000.00 still shows why it broke).
            if (!parseAnswer(r.text)) console.info(`template answer unreadable: ${r.text.length} chars, starts ${JSON.stringify(shape(r.text.slice(0, 120)))}, ends ${JSON.stringify(shape(r.text.slice(-120)))}`);
            return r.text;
          }, (done, total) => send({ type: "progress", stage: "Belgeler okunuyor", done, total }));
          if (all.length > wins.length) found.notes.push(`Belgeler çok uzun: ${all.length} bölümün ilk ${wins.length} tanesi okundu. Gerekli bölümü ayrı bir belge olarak verin.`);
          send({ type: "done", layout, found });
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof Busy) send({ type: "error", error: "Sunucu şu an çok yoğun. Biraz sonra tekrar deneyin." });
          else {
            logError("template", e);
            send({ type: "error", error: "Belgeler okunamadı. Tekrar deneyin." });
          }
        } finally {
          release();
        }
        try { ctrl.close(); } catch {}
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } finally {
    if (!streaming) release!();
  }
}
