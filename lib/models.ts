// Model servers and models (admin page → Ayarlar). Pure: env defaults and validation, unit-tested directly.
// lib/model-config.ts loads the saved choice and builds the providers.

export type ProviderKind = "ollama" | "openai";
export interface Endpoint {
  /** "openai": vLLM or any OpenAI-compatible server (URL ends in /v1). */
  kind: ProviderKind;
  url: string;
}
export interface ModelConfig {
  chat: Endpoint;
  /** Chat models users may pick; the first one the server actually serves is preselected unless defaultModel is. */
  models: string[];
  defaultModel: string;
  embed: Endpoint & { model: string };
  /** Second reading of table images during document extraction. */
  vision: Endpoint & { model: string };
}

export const kindOf = (v: string | undefined): ProviderKind => (v === "openai" || v === "vllm" ? "openai" : "ollama");

/** The deployment's choice (env, README table): used until an admin saves one, and again after "reset". */
export function envConfig(env: Record<string, string | undefined>): ModelConfig {
  const kind = kindOf(env.MODEL_PROVIDER);
  // `||`, not `??`: an empty variable (compose "X=") means unset.
  const url = env.MODEL_URL || env.OLLAMA_URL || (kind === "openai" ? "http://localhost:8000/v1" : "http://localhost:11434");
  const def = env.DEFAULT_MODEL || "gemma4:12b";
  const models = (env.ALLOWED_MODELS || def).split(",").map((m) => m.trim()).filter(Boolean);
  return {
    chat: { kind, url },
    models,
    defaultModel: models.includes(def) ? def : models[0],
    // One kind for all three, as before: vLLM serves one model per process, so embeddings may come from another
    // OpenAI-compatible server (Ollama's /v1).
    embed: { kind, url: env.EMBED_URL || url, model: env.EMBED_MODEL || "embeddinggemma" },
    vision: { kind, url: env.VISION_URL || url, model: env.VISION_MODEL || "gemma4:12b" },
  };
}

/**
 * Origins MODEL_API_KEY may be sent to: the servers the deployment itself configured (env), plus MODEL_KEY_HOSTS
 * (comma-separated origins). A server an admin adds on the page gets no key.
 */
export function keyOrigins(env: Record<string, string | undefined>): Set<string> {
  const c = envConfig(env);
  const list = [c.chat.url, c.embed.url, c.vision.url, ...(env.MODEL_KEY_HOSTS ?? "").split(",")];
  const out = new Set<string>();
  for (const u of list) {
    try {
      if (u.trim()) out.add(new URL(u.trim()).origin);
    } catch {}
  }
  return out;
}

const MODEL = /^[\w.:/@+-]{1,128}$/;

function endpoint(x: unknown, what: string): Endpoint | string {
  if (typeof x !== "object" || x === null) return `${what}: sunucu bilgisi eksik.`;
  const { kind, url } = x as Record<string, unknown>;
  if (kind !== "ollama" && kind !== "openai") return `${what}: sunucu türü geçersiz.`;
  if (typeof url !== "string" || url.length > 300) return `${what}: adres geçersiz.`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `${what}: adres geçersiz.`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `${what}: adres http:// ya da https:// ile başlamalı.`;
  // A key in the URL would be shown back on the admin page and logged; keys come from MODEL_API_KEY.
  if (u.username || u.password || u.search || u.hash) return `${what}: adreste kullanıcı adı, parola ya da sorgu olmamalı.`;
  return { kind, url: url.replace(/\/+$/, "") };
}

const name = (x: unknown): string | null => (typeof x === "string" && MODEL.test(x.trim()) ? x.trim() : null);

/** An admin's input (or the saved JSON) → a valid config, or a Turkish error message. */
export function validateConfig(x: unknown): ModelConfig | string {
  if (typeof x !== "object" || x === null) return "Ayarlar okunamadı.";
  const o = x as Record<string, unknown>;
  const chat = endpoint(o.chat, "Sohbet");
  if (typeof chat === "string") return chat;
  const embed = endpoint(o.embed, "Embedding");
  if (typeof embed === "string") return embed;
  const vision = endpoint(o.vision, "Tablo okuma");
  if (typeof vision === "string") return vision;
  const list = Array.isArray(o.models) ? o.models : [];
  const names = list.map(name);
  const models = [...new Set(names.filter((m): m is string => !!m))];
  if (!models.length || names.includes(null) || models.length > 20) return "Sohbet modelleri: 1–20 geçerli model adı girin (harf, rakam, . : / @ + - _).";
  const def = name(o.defaultModel);
  if (!def || !models.includes(def)) return "Varsayılan model, sohbet modelleri listesinde olmalı.";
  const em = name((o.embed as Record<string, unknown>).model);
  const vm = name((o.vision as Record<string, unknown>).model);
  if (!em) return "Embedding modeli geçersiz.";
  if (!vm) return "Tablo okuma modeli geçersiz.";
  return { chat, models, defaultModel: def, embed: { ...embed, model: em }, vision: { ...vision, model: vm } };
}
