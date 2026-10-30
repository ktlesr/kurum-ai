// Sunum mode's model calls: one for the outline, one per slide (the browser drives them, so progress and cancelling are
// simple and nothing is kept here). The layout list comes from the client: it only shapes this user's own prompt, and
// the answers are validated against it. A document is the user's own and stays on the institution's model.
import { admission, busy, tooMany } from "@/lib/admission";
import { requireApiUser } from "@/lib/auth";
import { FROM_DOC, OUTLINE_PROMPT, SLIDE_PROMPT, parseOutline, parseSlide, type LayoutSlot } from "@/lib/deck";
import { readLimited } from "@/lib/filetype";
import { modelConfig, providerOf } from "@/lib/model-config";
import { retrieve } from "@/lib/rag";
import { getDoc } from "@/lib/server";

const MAX_BODY = 96 * 1024;
const WHOLE_DOC = 14_000;
const fail = (error: string, status: number) => Response.json({ error }, { status });
const clean = (s: string) => s.replace(/<\/?(konu|belge|slayt|duzenler)/gi, "< $1");
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

  const ask = async (system: string, user: string, maxTokens: number) => {
    const r = await admission.model.run(() => chat.chat({ model: cfg.defaultModel, think: false, maxTokens, signal: req.signal, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), req.signal);
    return r.text;
  };
  const source = async (query: string) => {
    if (!doc) return "";
    const parts = doc.text.length <= WHOLE_DOC ? [doc.text] : (await retrieve([doc], query, req.signal)).chunks.map((c) => `[${c.label}]\n${c.text}`);
    return `\n\n<belge ad="${doc.name.replace(/["<>]/g, "")}">\n${parts.join("\n\n").slice(0, WHOLE_DOC).replace(/<\/?belge/gi, "< belge")}\n</belge>`;
  };

  try {
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
