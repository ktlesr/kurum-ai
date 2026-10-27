"use server";

import { redirect } from "next/navigation";
import { createSession, deleteSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clearFailures, DUMMY_HASH, hashPassword, isLocked, passwordProblem, recordFailure, USERNAME_RE, verifyPassword } from "@/lib/password";

export type FormState = { error?: string; info?: string } | undefined;

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const username = field(form, "username").trim().toLowerCase();
  const password = field(form, "password");
  // ponytail: keyed by username alone — stops guessing one account from many IPs; the cost is that
  // someone can lock a user out for 15 min. Revisit with LDAP/SSO.
  const key = `login:${username}`;
  if (isLocked(key)) return { error: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin." };
  // Count the attempt before the first await: check + reserve is then atomic, so parallel requests
  // can't all slip past the lock while their scrypt runs. Refunded on success.
  recordFailure(key);

  const sql = await db();
  const [u] = await sql<{ id: string; pass_hash: string; status: string }[]>`SELECT id, pass_hash, status FROM users WHERE username = ${username}`;
  const ok = await verifyPassword(password, u?.pass_hash ?? DUMMY_HASH);
  if (!u || !ok) return { error: "Kullanıcı adı veya parola hatalı." };
  clearFailures(key);
  if (u.status === "pending") return { error: "Hesabınız yönetici onayı bekliyor." };
  if (u.status !== "active") return { error: "Hesabınız devre dışı. Yöneticinize başvurun." };
  await createSession(u.id);
  redirect("/");
}

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const username = field(form, "username").trim().toLowerCase();
  const password = field(form, "password");
  if (!USERNAME_RE.test(username)) return { error: "Kullanıcı adı 3–32 karakter olmalı; yalnızca küçük harf, rakam, nokta, tire, alt çizgi." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== field(form, "password2")) return { error: "Parolalar eşleşmiyor." };

  const sql = await db();
  // Same reply whether or not the name is taken, so signup can't be used to list accounts.
  await sql`INSERT INTO users (username, pass_hash) VALUES (${username}, ${await hashPassword(password)}) ON CONFLICT (username) DO NOTHING`;
  return { info: "Hesap isteğiniz alındı. Yönetici onayladıktan sonra giriş yapabilirsiniz; kullanıcı adı başkasına aitse yöneticinize başvurun." };
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
