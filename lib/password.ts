// Pure auth helpers (no DB, no Next) so node --test can import them.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024; // 128·N·r = 32 MB needed

const derive = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((ok, fail) => scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? fail(e) : ok(k))));

/** "scrypt$N$r$p$salt$hash" (base64url), so parameters can be raised later without breaking old hashes. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pw, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await derive(pw, Buffer.from(salt, "base64url"), +n, +r, +p);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Verified against when the username doesn't exist, so timing doesn't reveal which accounts exist. */
export const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Cookie gets the token; the DB only ever sees its hash, so a DB leak doesn't hand out sessions. */
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Parola en az 10 karakter olmalı.";
  if (pw.length > 256) return "Parola en fazla 256 karakter olabilir.";
  return null;
}

// ponytail: per-process memory; one app instance. Move to the DB if the app is ever scaled out.
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60_000, LIMIT = 5;

/** True when `key` (username + IP) has failed LIMIT times within WINDOW. */
export function isLocked(key: string, now = Date.now()): boolean {
  const a = attempts.get(key);
  return !!a && a.until > now && a.n >= LIMIT;
}
export function recordFailure(key: string, now = Date.now()) {
  const a = attempts.get(key);
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + WINDOW });
  else a.n++;
  if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
}
export const clearFailures = (key: string) => attempts.delete(key);
