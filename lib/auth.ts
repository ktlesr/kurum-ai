import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
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
  const [u] = await sql<User[]>`
    SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now() AND u.status = 'active'`;
  return u ?? null;
});

/**
 * Route handler guard: the user, or a 401/403 Response to return as-is.
 * Mutations must come from this origin (SameSite=lax already stops cross-site POST cookies; this is the second layer).
 */
export async function requireApiUser(req: Request): Promise<User | Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const user = await getUser().catch((e) => {
    console.error("auth:", (e as Error).message);
    return null;
  });
  return user ?? Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
}
