"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { providerOf, saveModelConfig } from "@/lib/model-config";
import { envConfig, buildConfig, presets, serverOf, type ModelConfig, type Server } from "@/lib/models";

export type Result = { ok: boolean; lines: string[] };

const admin = async () => (await getUser())?.role === "admin";
const endpoint = (server: Server) => {
  const p = presets(process.env);
  return server === "vllm" ? { kind: "openai" as const, url: p.vllm } : { kind: "ollama" as const, url: p.ollama };
};

/** What the chosen server serves right now (the admin page's checkboxes). Errors stay in the server log. */
export async function listModels(server: Server): Promise<{ ok: boolean; models: string[] }> {
  if (!(await admin()) || (server !== "vllm" && server !== "ollama")) return { ok: false, models: [] };
  try {
    return { ok: true, models: (await providerOf(endpoint(server)).models()).sort() };
  } catch {
    return { ok: false, models: [] };
  }
}

// Typed for the form; validated as unknown (buildConfig), since anyone can call a server action with anything.
export async function saveModels(x: { server: Server; models: string[]; defaultModel: string; embedModel: string; visionModel: string }): Promise<Result> {
  if (!(await admin())) return { ok: false, lines: ["Yetkiniz yok."] };
  const cfg = buildConfig(x, presets(process.env));
  if (typeof cfg === "string") return { ok: false, lines: [cfg] };
  await saveModelConfig(cfg);
  revalidatePath("/admin");
  return { ok: true, lines: ["Kaydedildi; yeni sorulardan itibaren geçerli."] };
}

/** Also returns what is now in effect, so the form shows it without a remount (which would drop the message). */
export async function resetModels(): Promise<Result & { cfg?: ModelConfig; server?: Server }> {
  if (!(await admin())) return { ok: false, lines: ["Yetkiniz yok."] };
  await saveModelConfig(null);
  revalidatePath("/admin");
  const cfg = envConfig(process.env);
  return { ok: true, lines: ["Kurulumdaki ayarlara dönüldü."], cfg, server: serverOf(cfg) };
}
