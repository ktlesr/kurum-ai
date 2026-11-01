"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { MAX_BULK, generatePassword, parseBulk } from "@/lib/admin-users";
import { db } from "@/lib/db";
import { providerOf, saveModelConfig } from "@/lib/model-config";
import { USERNAME_RE, hashPassword, passwordProblem } from "@/lib/password";
import { envConfig, buildConfig, presets, serverOf, type ModelConfig, type Server } from "@/lib/models";

export type Result = { ok: boolean; lines: string[] };

const admin = async () => (await getUser())?.role === "admin";
const endpoint = (server: Server) => {
  const p = presets(process.env);
  return server === "vllm" ? { kind: "openai" as const, url: p.vllm } : { kind: "ollama" as const, url: p.ollama };
};

/** What the chosen server serves right now (the admin page's checkboxes). Errors stay in the server log. */
export async function listModels(server: Server): Promise<{ ok: boolean; models: string[]; embeds: string[] }> {
  if (!(await admin()) || (server !== "vllm" && server !== "ollama")) return { ok: false, models: [], embeds: [] };
  try {
    const p = providerOf(endpoint(server));
    const [models, embeds] = await Promise.all([p.models(), p.embedModels()]);
    return { ok: true, models: models.sort(), embeds: embeds.sort() };
  } catch (e) {
    console.error(`models ${server} ${endpoint(server).url}: ${(e as Error).name}: ${(e as Error).message}`);
    return { ok: false, models: [], embeds: [] };
  }
}

// Typed for the form; validated as unknown (buildConfig), since anyone can call a server action with anything.
export async function saveModels(x: { server: Server; models: string[]; defaultModel: string; embedModel: string; visionModel: string }): Promise<Result> {
  if (!(await admin())) return { ok: false, lines: ["Yetkiniz yok."] };
  const cfg = buildConfig(x, presets(process.env));
  if (typeof cfg === "string") return { ok: false, lines: [cfg] };
  await saveModelConfig(cfg);
  revalidatePath("/admin/ayarlar");
  return { ok: true, lines: ["Kaydedildi; yeni sorulardan itibaren geçerli."] };
}

/** Also returns what is now in effect, so the form shows it without a remount (which would drop the message). */
export async function resetModels(): Promise<Result & { cfg?: ModelConfig; server?: Server }> {
  if (!(await admin())) return { ok: false, lines: ["Yetkiniz yok."] };
  await saveModelConfig(null);
  revalidatePath("/admin/ayarlar");
  const cfg = envConfig(process.env);
  return { ok: true, lines: ["Kurulumdaki ayarlara dönüldü."], cfg, server: serverOf(cfg) };
}

export type CreateResult = { error?: string; rows?: { username: string; ok: boolean; password?: string; reason?: string }[] };

/** One new active user. An existing name is left alone: this never changes anyone's password or role. */
async function insertUser(username: string, password: string | undefined, role: "user" | "admin"): Promise<NonNullable<CreateResult["rows"]>[number]> {
  const pass = password ?? generatePassword();
  const sql = await db();
  const [made] = await sql`INSERT INTO users (username, pass_hash, role, status) VALUES (${username}, ${await hashPassword(pass)}, ${role}, 'active') ON CONFLICT (username) DO NOTHING RETURNING id`;
  if (!made) return { username, ok: false, reason: "Bu kullanıcı zaten var" };
  return { username, ok: true, ...(password ? {} : { password: pass }) };
}

export async function createUser(_: CreateResult, form: FormData): Promise<CreateResult> {
  if (!(await admin())) return { error: "Yetkiniz yok." };
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const role = form.get("role") === "admin" ? "admin" : "user";
  if (!USERNAME_RE.test(username)) return { error: "Kullanıcı adı 3–32 karakter olmalı; yalnızca küçük harf, rakam, nokta, tire, alt çizgi." };
  const problem = password ? passwordProblem(password) : null;
  if (problem) return { error: problem };
  const row = await insertUser(username, password || undefined, role);
  revalidatePath("/admin/kullanicilar");
  return { rows: [row] };
}

/** Always as regular users: making someone an admin is done one at a time, on purpose. */
export async function createUsersBulk(_: CreateResult, form: FormData): Promise<CreateResult> {
  if (!(await admin())) return { error: "Yetkiniz yok." };
  const rows = parseBulk(String(form.get("list") ?? ""));
  if (!rows.length) return { error: "Liste boş." };
  if (rows.length > MAX_BULK) return { error: `Tek seferde en fazla ${MAX_BULK} kullanıcı oluşturulabilir; listede ${rows.length} satır var.` };
  const out: NonNullable<CreateResult["rows"]> = [];
  // One by one: hashing a password is deliberately heavy, and a bad line must not cost the others.
  for (const r of rows) {
    if (r.error) out.push({ username: r.username, ok: false, reason: r.error });
    else out.push(await insertUser(r.username, r.password, "user").catch(() => ({ username: r.username, ok: false, reason: "Oluşturulamadı" })));
  }
  revalidatePath("/admin/kullanicilar");
  return { rows: out };
}

