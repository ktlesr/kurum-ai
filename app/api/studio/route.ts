// Görsel Stüdyo text suggestion (plan §6.1): the user's brief in, JSON text fields out. Only text goes to the model;
// photos and the logo never leave the browser.
import { admission, busy, tooMany } from "@/lib/admission";
import { requireApiUser } from "@/lib/auth";
import { readLimited } from "@/lib/filetype";
import { modelConfig, providerOf } from "@/lib/model-config";
import { FILL_PROMPT, TEMPLATE_HINT, TEMPLATES, parseFill, type TemplateId } from "@/lib/studio";

const MAX_BRIEF = 2000;
/** The JSON body: the brief (at most 6 bytes a character, as a JSON unicode escape) plus template and field names. */
const MAX_BODY = MAX_BRIEF * 6 + 1024;
const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  if (!admission.chatPerUser.allow(user.id)) return tooMany("metin önerisi");
  if (admission.model.saturated) return busy();

  if (Number(req.headers.get("content-length")) > MAX_BODY) return fail("İstek çok büyük.", 413);
  const raw = await readLimited(req.body, MAX_BODY).catch(() => undefined);
  if (raw === null) return fail("İstek çok büyük.", 413);
  let body: { template?: unknown; brief?: unknown } | null = null;
  try {
    body = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
  } catch {}
  const template = typeof body?.template === "string" && Object.hasOwn(TEMPLATES, body.template) ? (body.template as TemplateId) : null;
  const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  if (!template) return fail("Geçersiz şablon.", 400);
  if (!brief) return fail("Görselin konusunu yazın.", 400);
  if (brief.length > MAX_BRIEF) return fail(`Açıklama en fazla ${MAX_BRIEF} karakter olabilir.`, 400);

  const cfg = await modelConfig();
  const chat = providerOf(cfg.chat);
  if (!(await chat.healthy())) return fail("Model sunucusu çalışmıyor. Yöneticinize bildirin.", 503);
  try {
    const r = await admission.model.run(
      () =>
        chat.chat({
          model: cfg.defaultModel,
          think: false,
          maxTokens: 400,
          signal: req.signal,
          messages: [
            { role: "system", content: `${FILL_PROMPT}\n${TEMPLATE_HINT[template]}` },
            // The brief is data, not instructions (same rule as documents in chat).
            { role: "user", content: `<konu>\n${brief}\n</konu>` },
          ],
        }),
      req.signal,
    );
    const content = parseFill(r.text);
    if (!content) return fail("Model uygun bir öneri döndürmedi. Tekrar deneyin ya da metni kendiniz yazın.", 502);
    return Response.json({ content });
  } catch (e) {
    if (req.signal.aborted) return fail("İptal edildi.", 499);
    console.error(`studio: ${(e as Error).name}`);
    return fail("Öneri alınamadı. Biraz sonra tekrar deneyin.", 502);
  }
}
