import "server-only";
import { getSetting, setSetting } from "./db";
import { envConfig, keyOrigins, validateConfig, type Endpoint, type ModelConfig } from "./models";
import { makeProvider, type Provider } from "./provider";

export const NUM_CTX = Number(process.env.NUM_CTX) || 16384;

// ponytail: 5 s cache per process; one app instance per database (lib/boot), and saving clears it.
let cached: { at: number; cfg: ModelConfig } | undefined;
// Bumped on save: a read that started before it must not put the old choice back into the cache.
let generation = 0;

/** The admin's saved choice (admin page → Ayarlar), or the env defaults if none / unreadable. */
export async function modelConfig(): Promise<ModelConfig> {
  if (cached && Date.now() - cached.at < 5000) return cached.cfg;
  const gen = generation;
  let cfg = envConfig(process.env);
  const raw = await getSetting("models").catch(() => undefined);
  if (raw) {
    try {
      const v = validateConfig(JSON.parse(raw));
      if (typeof v !== "string") cfg = v;
    } catch {}
  }
  if (gen === generation) cached = { at: Date.now(), cfg };
  return cfg;
}

/** null: back to the env defaults. */
export async function saveModelConfig(cfg: ModelConfig | null) {
  await setSetting("models", cfg ? JSON.stringify(cfg) : "");
  generation++;
  cached = undefined;
}

const providers = new Map<string, Provider>();

const KEY_ORIGINS = keyOrigins(process.env);

/**
 * One provider per server. The API key (MODEL_API_KEY) stays in env, never in the database or on the page, and
 * goes only to the deployment's own servers (lib/models keyOrigins): an address typed on the admin page can't
 * collect it.
 */
export function providerOf(e: Endpoint): Provider {
  const key = `${e.kind}|${e.url}`;
  let p = providers.get(key);
  if (!p) {
    const apiKey = KEY_ORIGINS.has(new URL(e.url).origin) ? process.env.MODEL_API_KEY : undefined;
    providers.set(key, (p = makeProvider(e.kind, e.url, { apiKey, numCtx: NUM_CTX })));
  }
  return p;
}
