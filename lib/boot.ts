import "server-only";
import postgres from "postgres";
import { db } from "./db";
import { sweepOnBoot } from "./server";

const LOCK_KEY = 7712002;
const g = globalThis as typeof globalThis & { __instanceLock?: postgres.Sql };

/**
 * Called once from instrumentation.ts before the server takes requests.
 * One app instance per database: the startup sweep deletes "crash leftovers", which would be live work of a second
 * instance. A Postgres session advisory lock is atomic and is released by the database when the session ends.
 * The lock lives on its own never-recycled connection; if that session ends while we run, another instance could
 * take the lock and sweep our live uploads, so we exit at once. Lock busy at start → refuse to start.
 */
export async function boot() {
  await db(); // migrations first
  const die = (why: string) => {
    console.error(`boot: ${why}; süreç durduruluyor.`);
    process.exit(1);
  };
  const lock = postgres(process.env.DATABASE_URL!, {
    max: 1,
    idle_timeout: 0, // never close for idleness
    max_lifetime: null, // never recycle: a new connection would not hold the lock
    onclose: () => die("kilit bağlantısı kapandı (instance kilidi kaybedildi)"),
    onnotice: () => {},
  });
  // A just-stopped predecessor (restart, rolling deploy) can hold the lock for a moment after its port closed:
  // keep trying for a while before refusing to start.
  const waitUntil = Date.now() + (Number(process.env.INSTANCE_LOCK_WAIT_MS) || 30_000);
  let ok = false;
  for (;;) {
    [{ ok }] = await lock<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`;
    if (ok || Date.now() >= waitUntil) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ok) die("aynı veritabanında başka bir Kurum AI instance'ı çalışıyor; bu instance başlatılmadı");
  g.__instanceLock = lock;

  // Belt and braces: confirm the lock is still held by this very session (catches a silent reconnect).
  setInterval(async () => {
    try {
      const [{ held }] = await lock<{ held: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = ${LOCK_KEY} AND pid = pg_backend_pid() AND granted) AS held`;
      if (!held) die("instance kilidi artık bu oturumda değil");
    } catch {
      die("instance kilidi doğrulanamadı");
    }
  }, 5_000).unref();

  sweepOnBoot();
}
