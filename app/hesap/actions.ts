"use server";

import { redirect } from "next/navigation";
import { deleteOtherSessions, getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clearFailures, hashPassword, isLocked, passwordProblem, recordFailure, verifyPassword } from "@/lib/password";

export type ChangeState = { error?: string } | undefined;

export async function changePassword(_: ChangeState, form: FormData): Promise<ChangeState> {
  const me = await getUser();
  if (!me) redirect("/login");
  const key = `password:${me.id}`;
  if (isLocked(key)) return { error: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin." };
  // Counted before the first await, as at sign-in: parallel requests can't all slip past the lock. Refunded on success.
  recordFailure(key);
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const sql = await db();
  const [u] = await sql<{ pass_hash: string }[]>`SELECT pass_hash FROM users WHERE id = ${me.id}`;
  if (!u || !(await verifyPassword(current, u.pass_hash))) return { error: "Mevcut parola hatalı." };
  clearFailures(key);
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  if (next !== String(form.get("next2") ?? "")) return { error: "Yeni parolalar eşleşmiyor." };
  // By the hash, not the text: passwords are normalized before hashing, so two spellings can be the same password.
  if (await verifyPassword(next, u.pass_hash)) return { error: "Yeni parola mevcut paroladan farklı olmalı." };
  // Only over the password checked above: one an admin has just renewed must not be overwritten.
  const [changed] = await sql`UPDATE users SET pass_hash = ${await hashPassword(next)}, must_change_password = false WHERE id = ${me.id} AND pass_hash = ${u.pass_hash} RETURNING id`;
  if (!changed) return { error: "Parolanız bu sırada değişti. Sayfayı yenileyip tekrar deneyin." };
  // Whoever signed in with the old one, elsewhere, is out now.
  await deleteOtherSessions(me.id);
  redirect("/hesap?degisti=1");
}
