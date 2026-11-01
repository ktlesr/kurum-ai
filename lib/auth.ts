import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "./db";
import { newToken, tokenHash } from "./password";

export const SESSION_COOKIE = "kai_session";
const TTL_MS = 7 * 24 * 60 * 60_000;
// Plain-http LAN testing with `next start` needs COOKIE_SECURE=false; production sits behind HTTPS.
const SECURE = process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";

export interface User {
  id: string;
  username: string;
  role: "user" | "admin";
}

export async function createSession(userId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + TTL_MS);
  const sql = await db();
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${userId}, ${expires})`;
  // ponytail: expired rows are swept on login; a cron job is overkill at this scale
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", expires });
}

export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const sql = await db();
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`;
  jar.delete(SESSION_COOKIE);
}

/** Signed-in, active user for this request, or null. Disabled users lose access immediately. */
export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Not `(await db())<User[]>`...``: SWC drops the parentheses there and calls db() as the tag.
  const sql = await db();
  const hash = tokenHash(token);
  const [u] = await sql<(User & { fresh: boolean })[]>`
    SELECT u.id, u.username, u.role, s.last_seen > now() - interval '1 minute' AS fresh FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash} AND s.expires_at > now() AND u.status = 'active'`;
  if (!u) return null;
  // Who is online, for the dashboard: at most one write a minute per session, and nothing waits for it.
  if (!u.fresh) void Promise.resolve(sql`UPDATE sessions SET last_seen = now() WHERE token_hash = ${hash}`).catch(() => {});
  return { id: u.id, username: u.username, role: u.role };
});

/** For admin pages: the signed-in admin; others go to login, or get the same 404 as for any unknown page. */
export async function requireAdmin(): Promise<User> {
  const me = await getUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") notFound();
  return me;
}

/**
 * Scheme + host + port users reach us at. No X-Forwarded-* trust: a client that reaches the app directly could forge them.
 * Production must set APP_ORIGIN (behind the proxy req.url is plain http); without it mutations fail closed.
 */
function appOrigin(req: Request): string | null {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    console.error("auth: APP_ORIGIN tanımlı değil; değiştiren istekler reddediliyor.");
    return null;
  }
  return `${new URL(req.url).protocol}//${req.headers.get("host")}`;
}

/**
 * Route handler guard: the user, or a 401/403 Response to return as-is.
 * Mutations must come from this origin (SameSite=lax already stops cross-site POST cookies; this is the second layer).
 */
export async function requireApiUser(req: Request): Promise<User | Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const expected = appOrigin(req); // null = misconfigured production: refuse all mutations, Origin or not
    const origin = req.headers.get("origin");
    if (expected === null || (origin !== null && origin !== expected)) return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const user = await getUser().catch((e) => {
    console.error(`auth: ${(e as Error).name}`);
    return null;
  });
  return user ?? Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
}
