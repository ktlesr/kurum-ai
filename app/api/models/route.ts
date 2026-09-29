import { charsPerToken, DEFAULT_MODEL, NUM_CTX, OLLAMA_URL } from "@/lib/server";

export const dynamic = "force-dynamic";

interface Tag {
  name: string;
  remote_host?: string;
  capabilities?: string[];
}

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const { models } = (await res.json()) as { models: Tag[] };
    const names = models
      .filter(
        (m) =>
          !/embed|whisper/i.test(m.name) &&
          // cloud models would send the document off this machine
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
