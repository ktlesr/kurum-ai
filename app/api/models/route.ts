import { requireApiUser } from "@/lib/auth";
import { charsPerToken } from "@/lib/server";
import { modelConfig, NUM_CTX, providerOf } from "@/lib/model-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  // Server-side allowlist (admin page): the client picks among these, never anything else the server happens to
  // have (a `:cloud` model would ship the document off-site — audit S2).
  const cfg = await modelConfig();
  const base = { defaultModel: cfg.defaultModel, numCtx: NUM_CTX, charsPerToken: Object.fromEntries(charsPerToken) };
  try {
    const names = (await providerOf(cfg.chat).models()).filter((m) => cfg.models.includes(m)).sort();
    return Response.json({ ok: true, models: names, ...base });
  } catch {
    return Response.json({ ok: false, models: [], ...base });
  }
}
