import { requireApiUser } from "@/lib/auth";
import { ALLOWED_MODELS, charsPerToken, DEFAULT_MODEL, NUM_CTX, OLLAMA_URL } from "@/lib/server";

export const dynamic = "force-dynamic";

interface Tag {
  name: string;
  remote_host?: string;
  capabilities?: string[];
}

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const { models } = (await res.json()) as { models: Tag[] };
    const names = models
      .filter(
        (m) =>
          ALLOWED_MODELS.has(m.name) &&
          // cloud models would send the document off this machine (belt and braces with the allowlist)
          !m.remote_host &&
          (m.capabilities ?? ["completion"]).includes("completion"),
      )
      .map((m) => m.name)
      .sort();
    return Response.json({ ok: true, models: names, defaultModel: DEFAULT_MODEL, numCtx: NUM_CTX, charsPerToken: Object.fromEntries(charsPerToken) });
  } catch {
    return Response.json({ ok: false, models: [], defaultModel: DEFAULT_MODEL, numCtx: NUM_CTX, charsPerToken: Object.fromEntries(charsPerToken) });
  }
}
