import { requireApiUser } from "@/lib/auth";
import { ALLOWED_MODELS, charsPerToken, PREFERRED_MODEL, NUM_CTX } from "@/lib/server";
import { chatProvider } from "@/lib/provider";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  try {
    const names = (await chatProvider.models()).filter((m) => ALLOWED_MODELS.has(m)).sort();
    return Response.json({ ok: true, models: names, defaultModel: PREFERRED_MODEL, numCtx: NUM_CTX, charsPerToken: Object.fromEntries(charsPerToken) });
  } catch {
    return Response.json({ ok: false, models: [], defaultModel: PREFERRED_MODEL, numCtx: NUM_CTX, charsPerToken: Object.fromEntries(charsPerToken) });
  }
}
