// Where server-side document bytes and derived text live while a user's doc exists (plan §4.3, audit S3/S4/S9/N3).
// No "server-only": pure fs so node --test can exercise it.
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmdirSync, rmSync, writeSync } from "node:fs";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Only this app's jobs live here, so sweeping it on start can't touch anyone else's files. Inside the app's own
 * .cache, not the shared OS temp dir: there another local user could pre-create the fixed name as a symlink.
 */
export const JOBS_ROOT = path.join(process.cwd(), ".cache", "jobs");
export const EXTRACT_ROOT = path.join(process.cwd(), ".cache", "extract");

/**
 * Per user and per source file: Docling result and vision reads. Never shared across users (no "is this file on
 * the server?" side channel), and deleted together with the user's last doc of that content.
 */
export function extractDir(userId: string, sourceHash: string, root = EXTRACT_ROOT): string {
  if (!UUID.test(userId) || !SHA256.test(sourceHash)) throw new Error("bad_extract_key");
  return path.join(root, userId, sourceHash);
}

/**
 * Runs fn with a fresh private directory (random name, owner-only) and removes it afterwards, whatever happens —
 * including a failed write of the input file inside fn.
 */
export async function withJobDir<T>(fn: (dir: string) => Promise<T>, root = JOBS_ROOT): Promise<T> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(path.join(root, "job-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** On start no job can be running yet: anything left in JOBS_ROOT is from a crash (raw uploaded files). */
export function sweepJobs(root = JOBS_ROOT): number {
  let n = 0;
  for (const d of safeList(root)) {
    rmSync(path.join(root, d), { recursive: true, force: true });
    n++;
  }
  return n;
}

/** Removes extract dirs no live doc points to ("<userId>/<hash>" keys). Only touches well-formed names. */
export function sweepExtract(live: Set<string>, root = EXTRACT_ROOT): number {
  let n = 0;
  for (const user of safeList(root).filter((u) => UUID.test(u))) {
    for (const hash of safeList(path.join(root, user)).filter((h) => SHA256.test(h))) {
      if (!live.has(`${user}/${hash}`)) {
        rmSync(path.join(root, user, hash), { recursive: true, force: true });
        n++;
      }
    }
    removeIfEmpty(path.join(root, user));
  }
  return n;
}

/** Drops a per-user directory once nothing is left in it (an empty dir still says "this user stored data here"). */
export function removeIfEmpty(dir: string) {
  try {
    rmdirSync(dir); // fails unless empty: exactly what we want
  } catch {
    // not empty, or already gone
  }
}

// Uploads currently writing into an extract dir ("<userId>/<hash>" → count). Deleting the user's last doc of that
// content must not remove the dir under a running upload; the last upload to finish cleans up instead.
const active = new Map<string, number>();
export const extractBusy = (key: string) => (active.get(key) ?? 0) > 0;
/** Marks key busy; the returned release() reports whether this was the last holder. */
export function holdExtract(key: string): () => boolean {
  active.set(key, (active.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return false;
    released = true;
    const n = (active.get(key) ?? 1) - 1;
    if (n > 0) active.set(key, n);
    else active.delete(key);
    return n === 0;
  };
}

/**
 * One app instance per data dir. The startup sweeps assume nothing else is mid-upload; a second instance on the
 * same .cache must skip them. Returns false when another live process holds the lock.
 * ponytail: pid liveness check; good for one host/container. Multiple hosts on shared storage need a real lock.
 */
export function takeInstanceLock(file = path.join(process.cwd(), ".cache", "instance.lock")): boolean {
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      const pid = Number(readFileSync(file, "utf8")) || 0;
      if (pid === process.pid) return true;
      if (pid && alive(pid)) return false;
      rmSync(file, { force: true }); // stale: its process is gone
    }
  }
  return false;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, just not ours to signal
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
