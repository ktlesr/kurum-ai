"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { providerOf, saveModelConfig } from "@/lib/model-config";
import { validateConfig, type Endpoint, type ModelConfig } from "@/lib/models";

/** values: what was entered, so the form shows it again (React resets a form after its action runs). */
// at: each result remounts the form fields, so selects pick up their new defaults too (React resets the form).
export type ModelsState = { ok: boolean; lines: string[]; values?: Record<string, string>; at?: number } | undefined;

const FIELDS = ["chat_kind", "chat_url", "models", "default_model", "embed_kind", "embed_url", "embed_model", "vision_kind", "vision_url", "vision_model"];
// 4000: above 20 models × 128 characters with ", " separators (2598); only a cap on what is shown back.
const entered = (f: FormData) => Object.fromEntries(FIELDS.map((k) => [k, String(f.get(k) ?? "").slice(0, 4000)]));

const fromForm = (f: FormData) => {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  return {
    chat: { kind: s("chat_kind"), url: s("chat_url") },
    models: s("models").split(",").map((m) => m.trim()).filter(Boolean),
    defaultModel: s("default_model"),
    embed: { kind: s("embed_kind"), url: s("embed_url"), model: s("embed_model") },
    vision: { kind: s("vision_kind"), url: s("vision_url"), model: s("vision_model") },
  };
};

/** Asks each server for its model list; says which chosen models it doesn't serve. */
async function test(cfg: ModelConfig): Promise<ModelsState> {
  const roles: [string, Endpoint, string[]][] = [
    ["Sohbet", cfg.chat, cfg.models],
    ["Embedding", cfg.embed, [cfg.embed.model]],
    ["Tablo okuma", cfg.vision, [cfg.vision.model]],
  ];
  let ok = true;
  const lines = await Promise.all(roles.map(async ([what, e, want]) => {
    try {
      const have = await providerOf(e).models();
      const missing = want.filter((m) => !have.includes(m));
      if (missing.length) ok = false;
      return `${what} (${e.url}): bağlandı. ${missing.length ? `Sunucuda olmayan: ${missing.join(", ")}. ` : ""}Sunucudaki modeller: ${have.slice(0, 15).join(", ") || "yok"}`;
    } catch {
      ok = false;
      return `${what} (${e.url}): bağlanılamadı.`;
    }
  }));
  return { ok, lines };
}

/** One form, three buttons (intent): test the entered servers, save, or go back to the env defaults. */
export async function modelsAction(prev: ModelsState, form: FormData): Promise<ModelsState> {
  return { ...(await run(form)), at: Date.now() } as ModelsState;
}

async function run(form: FormData): Promise<ModelsState> {
  const me = await getUser();
  if (me?.role !== "admin") return { ok: false, lines: ["Yetkiniz yok."] };
  const intent = form.get("intent");
  if (intent === "reset") {
    await saveModelConfig(null);
    revalidatePath("/admin");
    return { ok: true, lines: ["Kurulumdaki (ortam değişkenleri) ayarlara dönüldü."] };
  }
  const values = entered(form);
  const cfg = validateConfig(fromForm(form));
  if (typeof cfg === "string") return { ok: false, lines: [cfg], values };
  if (intent === "test") return { ...(await test(cfg))!, values };
  if (intent !== "save") return { ok: false, lines: ["Bilinmeyen işlem."], values };
  await saveModelConfig(cfg);
  revalidatePath("/admin");
  const t = await test(cfg);
  return { ok: !!t?.ok, lines: ["Kaydedildi; yeni sorulardan itibaren geçerli.", ...(t?.lines ?? [])], values };
}
