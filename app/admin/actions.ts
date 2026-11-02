"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { MAX_BULK, generatePassword, parseBulk } from "@/lib/admin-users";
import { EMAIL_RE } from "@/lib/credentials-mail";
import { db } from "@/lib/db";
import { sendCredentials, type MailOutcome } from "@/lib/iletisim";
import { providerOf, saveModelConfig } from "@/lib/model-config";
import { USERNAME_RE, hashPassword, passwordProblem } from "@/lib/password";
import { envConfig, buildConfig, presets, serverOf, type ModelConfig, type Server } from "@/lib/models";

export type Result = { ok: boolean; lines: string[] };

const admin = async () => {
  const me = await getUser();
  return me?.role === "admin" && !me.mustChange;
};
const endpoint = (server: Server) => {
  const p = presets(process.env);
  return server === "vllm" ? { kind: "openai" as const, url: p.vllm } : { kind: "ollama" as const, url: p.ollama };
};

/** What the chosen server serves right now (the admin page's checkboxes). Errors stay in the server log. */
export async function listModels(server: Server): Promise<{ ok: boolean; models: string[]; embeds: string[] | null }> {
  if (!(await admin()) || (server !== "vllm" && server !== "ollama")) return { ok: false, models: [], embeds: null };
  try {
    const p = providerOf(endpoint(server));
    // Each on its own: not knowing the embedding models says nothing about the chat models.
    const [models, embeds] = await Promise.all([p.models(), p.embedModels().catch(() => null)]);
    return { ok: true, models: models.sort(), embeds: embeds && embeds.sort() };
  } catch (e) {
    console.error(`models ${server} ${endpoint(server).url}: ${(e as Error).name}: ${(e as Error).message}`);
    return { ok: false, models: [], embeds: null };
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

export type CreateResult = { error?: string; rows?: { username: string; ok: boolean; password?: string; reason?: string; email?: string; mail?: MailOutcome }[] };

/**
 * One new active user, whose details are mailed if there is an address. An existing name is left alone: this never changes
 * anyone's password or role, and only fills in an address that is missing. A generated password that reached its owner by mail
 * isn't shown: the one who made the account has no need to see it. One that didn't is, or nobody would have it.
 */
async function insertUser(username: string, password: string | undefined, role: "user" | "admin", email?: string): Promise<NonNullable<CreateResult["rows"]>[number]> {
  const pass = password ?? generatePassword();
  const sql = await db();
  const [made] = await sql`INSERT INTO users (username, pass_hash, role, status, email, must_change_password) VALUES (${username}, ${await hashPassword(pass)}, ${role}, 'active', ${email ?? null}, ${!!email}) ON CONFLICT (username) DO NOTHING RETURNING id`;
  if (!made) {
    // Active accounts only: anyone can ask for a name at sign-up, and a pending request must not gain an address from a list.
    // Nor admins': their address decides who can be sent their password.
    const [filled] = email ? await sql`UPDATE users SET email = ${email} WHERE username = ${username} AND email IS NULL AND status = 'active' AND role = 'user' RETURNING id` : [];
    return { username, ok: false, reason: filled ? "Zaten var; e-postası kaydedildi, e-posta gönderilmedi" : "Bu kullanıcı zaten var" };
  }
  const shown = password ? {} : { password: pass };
  if (!email) return { username, ok: true, ...shown };
  const mail = await sendCredentials({ email, username, password: pass, changeOnSignIn: true });
  return { username, ok: true, email, mail, ...(mail === "sent" ? {} : shown) };
}

export async function createUser(_: CreateResult, form: FormData): Promise<CreateResult> {
  if (!(await admin())) return { error: "Yetkiniz yok." };
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const role = form.get("role") === "admin" ? "admin" : "user";
  if (!USERNAME_RE.test(username)) return { error: "Kullanıcı adı 3–32 karakter olmalı; yalnızca küçük harf, rakam, nokta, tire, alt çizgi." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { error: "E-posta adresi geçersiz." };
  const problem = password ? passwordProblem(password) : null;
  if (problem) return { error: problem };
  const row = await insertUser(username, password || undefined, role, email || undefined);
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
    else out.push(await insertUser(r.username, r.password, "user", r.email).catch(() => ({ username: r.username, ok: false, reason: "Oluşturulamadı" })));
  }
  revalidatePath("/admin/kullanicilar");
  return { rows: out };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function saveEmail(id: string, email: string): Promise<{ ok: boolean; message: string }> {
  const me = await getUser();
  if (me?.role !== "admin" || me.mustChange || !UUID_RE.test(id)) return { ok: false, message: "Yetkiniz yok." };
  const value = email.trim().toLowerCase();
  if (value && !EMAIL_RE.test(value)) return { ok: false, message: "E-posta adresi geçersiz." };
  const sql = await db();
  // Another admin's address stays theirs: changing it and sending a new password would be taking over their account.
  const [saved] = await sql`UPDATE users SET email = ${value || null} WHERE id = ${id} AND (role = 'user' OR id = ${me.id}) RETURNING id`;
  if (!saved) return { ok: false, message: "Başka bir yöneticinin e-postası değiştirilemez." };
  revalidatePath("/admin/kullanicilar");
  return { ok: true, message: "Kaydedildi." };
}

const NOT_SENT: Record<Exclude<MailOutcome, "sent">, string> = {
  off: "E-posta gönderimi bu kurulumda ayarlı değil. Eski parola geçerli.",
  refused: "E-posta gönderilemedi. Eski parola geçerli.",
  unknown: "Sağlayıcıdan net cevap alınamadı; e-posta gitmiş olabilir. Eski parola geçerli, gelen e-postadaki parola geçmez. Yeniden deneyin.",
};

// ponytail: per-process, like the sign-in limits; one app instance. Two at once could leave valid the password not last mailed.
const renewing = new Set<string>();

/** A new password, mailed. Only once it has gone does it replace the old one: a failed mail must not lock anyone out. */
export async function sendNewPassword(id: string): Promise<{ ok: boolean; message: string }> {
  const me = await getUser();
  if (me?.role !== "admin" || me.mustChange || !UUID_RE.test(id) || id.toLowerCase() === me.id) return { ok: false, message: "Yetkiniz yok." };
  const sql = await db();
  const [u] = await sql<{ username: string; email: string | null }[]>`SELECT username, email FROM users WHERE id = ${id} AND status = 'active' AND role = 'user'`;
  if (!u?.email) return { ok: false, message: "Bu hesaba parola gönderilemez: e-postası yok, etkin değil ya da yönetici." };
  const key = id.toLowerCase();
  if (renewing.has(key)) return { ok: false, message: "Bu kullanıcıya gönderim sürüyor." };
  renewing.add(key);
  try {
    const password = generatePassword();
    const outcome = await sendCredentials({ email: u.email, username: u.username, password, renewed: true, changeOnSignIn: true });
    if (outcome !== "sent") return { ok: false, message: NOT_SENT[outcome] };
    await sql`UPDATE users SET pass_hash = ${await hashPassword(password)}, must_change_password = true WHERE id = ${id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${id}`;
    return { ok: true, message: "Yeni parola gönderildi." };
  } finally {
    renewing.delete(key);
  }
}

