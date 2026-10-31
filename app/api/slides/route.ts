// Sunum mode's model calls: one for the outline, one per slide (the browser drives them, so progress and cancelling are
// simple and nothing is kept here). The layout list comes from the client: it only shapes this user's own prompt, and
// the answers are validated against it. A document is the user's own and stays on the institution's model.
import { admission, busy, tooMany } from "@/lib/admission";
import { requireApiUser } from "@/lib/auth";
import { PLAN_PROMPT, SECTION_PROMPT, completeGroups, parseBlocks, parsePlan, pickSource, sampleSource, verifyBlocks } from "@/lib/deck-doc";
import { FROM_DOC, OUTLINE_PROMPT, SLIDE_PROMPT, parseOutline, parseSlide, type LayoutSlot } from "@/lib/deck";
import { readLimited } from "@/lib/filetype";
import { NUM_CTX, modelConfig, providerOf } from "@/lib/model-config";
import { retrieve } from "@/lib/rag";
import { getDoc } from "@/lib/server";

const MAX_BODY = 96 * 1024;
const WHOLE_DOC = 14_000;
/** A section's source and answer share the model's context: long lists need room to be written out whole. */
const SECTION_ANSWER = 5_000;
const SECTION_SOURCE = Math.min(24_000, Math.floor((NUM_CTX - SECTION_ANSWER - 1_000) * 2.2)); // 2.2: the cautious characters per token
const fail = (error: string, status: number) => Response.json({ error }, { status });
const clean = (s: string) => s.replace(/<\/?(konu|belge|slayt|duzenler|istek|basliklar|bolum|diger)/gi, "< $1");
const str = (v: unknown, max: number) => (typeof v === "string" ? clean(v.trim()).slice(0, max) : "");

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  if (!admission.chatPerUser.allow(user.id)) return tooMany("sunum");
  if (admission.model.saturated) return busy();
  if (Number(req.headers.get("content-length")) > MAX_BODY) return fail("İstek çok büyük.", 413);
  const raw = await readLimited(req.body, MAX_BODY).catch(() => undefined);
  if (raw === null) return fail("İstek çok büyük.", 413);
  let b: Record<string, unknown> | null = null;
  try {
    b = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
  } catch {}
  if (!b || typeof b !== "object") return fail("Geçersiz istek.", 400);

  const brief = str(b.brief, 2000);
  const docId = typeof b.docId === "string" && b.docId.length <= 64 ? b.docId : "";
  const doc = docId ? getDoc(user.id, docId) : undefined;
  if (docId && !doc) return fail("Belge bulunamadı. Asistan sayfasından yeniden yükleyin.", 404);
  if (!brief && !doc) return fail("Sunumun konusunu yazın ya da bir belge seçin.", 400);

  const cfg = await modelConfig();
  const chat = providerOf(cfg.chat);
  if (!(await chat.healthy())) return fail("Model sunucusu çalışmıyor. Yöneticinize bildirin.", 503);

  let truncated = false; // the model stopped at its length limit
  const ask = async (system: string, user: string, maxTokens: number) => {
    const r = await admission.model.run(() => chat.chat({ model: cfg.defaultModel, think: false, maxTokens, signal: req.signal, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), req.signal);
    truncated ||= !!r.truncated;
    return r.text;
  };
  const source = async (query: string) => {
    if (!doc) return "";
    const parts = doc.text.length <= WHOLE_DOC ? [doc.text] : (await retrieve([doc], query, req.signal)).chunks.map((c) => `[${c.label}]\n${c.text}`);
    return `\n\n<belge ad="${doc.name.replace(/["<>]/g, "")}">\n${parts.join("\n\n").slice(0, WHOLE_DOC).replace(/<\/?belge/gi, "< belge")}\n</belge>`;
  };

  try {
    if (b.step === "plan") {
      if (!doc) return fail("Belge bulunamadı.", 400);
      const heads = doc.text.split("\n").filter((l) => /^#{1,3}\s/.test(l)).slice(0, 60).join("\n") || doc.text.slice(0, 6_000); // no headings: its beginning
      const plan = parsePlan(await ask(PLAN_PROMPT, `<istek>\n${brief || "Belgenin ana konularını anlatan bir sunum"}\n</istek>\n\n<basliklar>\n${clean(heads)}\n</basliklar>`, 1000));
      // A plan cut at the length limit has lost topics the user asked for.
      return plan && !truncated ? Response.json({ plan }) : fail("Model uygun bir plan döndürmedi. Tekrar deneyin.", 502);
    }
    if (b.step === "section") {
      if (!doc) return fail("Belge bulunamadı.", 400);
      const title = str(b.title, 120);
      const query = `${title} ${str(b.query, 200)}`;
      if (!title) return fail("Bölüm adı yok.", 400);
      const others = (Array.isArray(b.others) ? b.others : []).slice(0, 20).map((o) => str(o, 120)).filter(Boolean).join("; ");
      const asked = (part: string) => ask(SECTION_PROMPT, `<bolum>${title}</bolum>\n<diger>${others}</diger>\n\n<belge>\n${clean(part)}\n</belge>`, SECTION_ANSWER);
      let parsed = parseBlocks(await asked(pickSource(doc.text, query, SECTION_SOURCE)));
      // The search can miss (the document in another language, other words): one more look over all of it before saying "not there".
      if (parsed && !parsed.blocks.length) {
        parsed = parseBlocks(await asked(sampleSource(doc.text, SECTION_SOURCE))) ?? parsed;
      }
      if (!parsed) return fail("Model bu bölüm için uygun içerik döndürmedi.", 502);
      const { blocks, dropped } = verifyBlocks(completeGroups(parsed.blocks, doc.text, query), doc.text);
      return Response.json({ title, source: parsed.source, blocks, dropped, cut: truncated || parsed.capped });
    }
    if (b.step === "outline") {
      const layouts = (Array.isArray(b.layouts) ? b.layouts : []).slice(0, 40).flatMap((l) => {
        const id = typeof l?.id === "string" && /^[\w-]{1,80}$/.test(l.id) ? l.id : "";
        return id ? [{ id, desc: str(l.desc, 240) }] : [];
      });
      if (!layouts.length) return fail("Düzen listesi boş.", 400);
      const count = Math.min(20, Math.max(2, Number(b.count) || 8));
      const list = layouts.map((l) => `- ${l.id}: ${l.desc}`).join("\n");
      const text = await ask(`${OUTLINE_PROMPT}${doc ? `\n${FROM_DOC}` : ""}`, `Slayt sayısı: ${count}\n\n<duzenler>\n${list}\n</duzenler>\n\n<konu>\n${brief || "Belgenin ana içeriğini sun."}\n</konu>${await source(brief || "amaç kapsam sonuç önemli bilgiler")}`, 2000);
      const slides = parseOutline(text, layouts.map((l) => l.id), count);
      return slides ? Response.json({ slides }) : fail("Model uygun bir taslak döndürmedi. Tekrar deneyin.", 502);
    }
    if (b.step === "fill") {
      const slots: LayoutSlot[] = (Array.isArray(b.slots) ? b.slots : []).slice(0, 80).flatMap((s) => (typeof s?.key === "string" && /^[\w.-]{1,120}$/.test(s.key) ? [{ key: s.key, max: Math.min(1000, Math.max(1, Number(s.max) || 80)) }] : []));
      if (!slots.length) return fail("Alan listesi boş.", 400);
      const slide = (b.slide ?? {}) as { title?: unknown; points?: unknown };
      const title = str(slide.title, 200);
      const points = (Array.isArray(slide.points) ? slide.points : []).slice(0, 6).map((p) => str(p, 240)).filter(Boolean);
      const fields = slots.map((s) => `- ${s.key} (${s.max})`).join("\n");
      const content = `<slayt>\nBaşlık: ${title}\n${points.map((p) => `- ${p}`).join("\n")}\n</slayt>`;
      const text = await ask(`${SLIDE_PROMPT}${doc ? `\n${FROM_DOC}` : ""}`, `Alanlar (anahtar ve karakter sınırı):\n${fields}\n\n<konu>\n${brief}\n</konu>\n\n${content}${await source(`${title} ${points.join(" ")}`)}`, 1500);
      const values = parseSlide(text, slots);
      return values ? Response.json({ values }) : fail("Model uygun bir slayt döndürmedi.", 502);
    }
    return fail("Geçersiz istek.", 400);
  } catch (e) {
    if (req.signal.aborted) return fail("İptal edildi.", 499);
    console.error(`slides: ${(e as Error).name}`);
    return fail("Sunum hazırlanamadı. Biraz sonra tekrar deneyin.", 502);
  }
}
