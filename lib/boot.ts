import "server-only";
import { db } from "./db";
import { sweepOnBoot } from "./server";

const g = globalThis as typeof globalThis & { __instanceLock?: unknown };

/**
 * Called once from instrumentation.ts before the server takes requests.
 * One app instance per database: the startup sweep deletes "crash leftovers", which would be live work of a second
 * instance. A Postgres session advisory lock is atomic and is released by the database when this process dies
 * (no stale-lock takeover to get wrong). Lock busy → refuse to start.
 */
export async function boot() {
  const conn = await (await db()).reserve(); // held for the process lifetime: the lock lives on this session
  const [{ ok }] = await conn<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(7712002) AS ok`;
  if (!ok) {
    console.error("boot: aynı veritabanında başka bir Kurum AI instance'ı çalışıyor; bu instance başlatılmadı.");
    process.exit(1);
  }
  g.__instanceLock = conn;
  sweepOnBoot();
}
