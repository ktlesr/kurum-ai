import "server-only";
// Fills the content index (lib/doc-index) in the background and searches it. One file at a time, only while nobody is
// using the model or Docling, and a read stops as soon as someone does (someoneWaits): people come first, whatever the
// folder's size. A file is read through sharedDoc, so the
// text indexed is the very text a chat reads later, and the extraction a chat would have waited for is already cached.
// Search goes only over what this person may see (sharedFor) and only over a file's current version: a changed file is
// out of the results until it is indexed again, never mixed with its old text.
import { stat } from "node:fs/promises";
import { admission } from "./admission";
import { db } from "./db";
import { CONTENT_TOOL, contentArgs, forgetGone, indexRows, INDEXING, indexStateOf, searchFiles, someoneWaits, storeFile } from "./doc-index";
import { cleanScanIds, filePathOf, libraryDown, sharedDoc, sharedFor, type SharedEntry, type Viewer } from "./library";
import { asBackground } from "./limits";
import { logError } from "./log";
import { countUsage } from "./usage";

const TICK_MS = 5_000;
/** Nobody on the model or Docling for this long: a chat answer is several calls in a row, an index read between them slows it. */
const IDLE_MS = Number(process.env.DOC_INDEX_IDLE_MS) || 20_000;
const PAUSE_AFTER_FAIL_MS = 10 * 60_000;
/** After stepping aside for someone: the next file waits at least this long (and for the idle time). */
const PAUSE_AFTER_YIELD_MS = 60_000;
const SWEEP_MS = 60 * 60_000;
const MAX_FAILS = 3;
const HEAVY = new Set(["pdf", "docx", "doc", "ppt"]); // Docling or LibreOffice: minutes each, so the cheap files go first
const ADMIN: Viewer = { username: "", role: "admin" };

type Mark = { v: string; status: "ok" | "failed" | "retry"; fails: number };
interface State {
  marks?: Promise<Map<string, Mark>>; worker?: NodeJS.Timeout; working: boolean; lastFail: number; pauseUntil?: number; swept?: number;
  /** For the admin page (indexStatus): the file being read now, and when the last ones were done. */
  current?: { path: string; since: number };
  doneAt?: number[];
  last?: { path: string; at: number; ok: boolean };
}
const g = globalThis as typeof globalThis & { __docIndex?: State };
const state: State = (g.__docIndex ??= { working: false, lastFail: 0 });

const versionOf = (e: SharedEntry) => `${INDEXING}:${e.size}:${e.mtime}`;
const extOf = (e: SharedEntry) => e.name.toLowerCase().split(".").pop() ?? "";

function marks(): Promise<Map<string, Mark>> {
  return (state.marks ??= (async () => {
    const sql = await db();
    const rows = await sql<{ file_id: string; version: string; status: Mark["status"]; fails: number }[]>`SELECT file_id, version, status, fails FROM doc_files`;
    return new Map(rows.map((r) => [r.file_id, { v: r.version, status: r.status, fails: r.fails }]));
  })().catch((e) => {
    state.marks = undefined; // tried again on the next call
    throw e;
  }));
}

const needs = (e: SharedEntry, m: Mark | undefined) => !m || m.v !== versionOf(e) || (m.status === "retry" && m.fails < MAX_FAILS);

async function indexOne(e: SharedEntry, done: Map<string, Mark>) {
  const sql = await db();
  const v = versionOf(e);
  const stop = new AbortController();
  state.current = { path: e.path, since: Date.now() };
  const watch = setInterval(() => {
    if (someoneWaits(admission.docling, admission.model)) stop.abort(new Error("yielded"));
  }, 500);
  try {
    // Every slot the read takes (Docling, the vision model inside it) is background work: never "someone waiting".
    const doc = await asBackground(() => sharedDoc(e, () => {}, stop.signal, false));
    await storeFile(sql, e.id, v, indexRows(e.path, doc.text));
    done.set(e.id, { v, status: "ok", fails: 0 });
    const now = Date.now();
    state.doneAt = [...(state.doneAt ?? []).filter((t) => now - t < 3_600_000), now].slice(-5_000);
    state.last = { path: e.path, at: now, ok: true };
  } catch (err) {
    // Stepped aside: not the file's fault, nothing counted.
    if (stop.signal.aborted) {
      state.pauseUntil = Date.now() + PAUSE_AFTER_YIELD_MS;
      return;
    }
    state.lastFail = Date.now();
    // Whatever went wrong (a locked or broken file, the share away for a moment): tried again later, given up after a few.
    const had = done.get(e.id);
    const fails = (had?.v === v ? had.fails : 0) + 1;
    const status = fails >= MAX_FAILS ? "failed" : "retry";
    const msg = err instanceof Error ? err.message.slice(0, 300) : "okunamadı";
    await sql`
      INSERT INTO doc_files (file_id, version, status, error, fails) VALUES (${e.id}, ${v}, ${status}, ${msg}, ${fails})
      ON CONFLICT (file_id) DO UPDATE SET version = EXCLUDED.version, status = EXCLUDED.status, error = EXCLUDED.error, fails = EXCLUDED.fails, at = now()`;
    done.set(e.id, { v, status, fails });
    state.last = { path: e.path, at: Date.now(), ok: false };
    if (status === "failed") logError("doc-index", err);
  } finally {
    clearInterval(watch);
    state.current = undefined;
  }
}

/** Once an hour, after a scan that may be taken as the folder's contents: what has been missing for a week goes. */
async function sweep() {
  if (Date.now() - (state.swept ?? 0) < SWEEP_MS) return;
  const live = cleanScanIds();
  if (!live) return;
  state.swept = Date.now();
  const gone = await forgetGone(await db(), live);
  const done = await marks();
  for (const id of gone) done.delete(id);
}

/** The order files are read in: cheap ones (tables, text) before Docling's, the newest first within each. */
const order = (a: SharedEntry, b: SharedEntry) => Number(HEAVY.has(extOf(a))) - Number(HEAVY.has(extOf(b))) || b.mtime - a.mtime;

async function tick() {
  if (state.working || Date.now() - state.lastFail < PAUSE_AFTER_FAIL_MS || Date.now() < (state.pauseUntil ?? 0)) return;
  if (!admission.model.idleFor(IDLE_MS)) return;
  state.working = true;
  try {
    const done = await marks();
    await sweep();
    const next = (await sharedFor(ADMIN)).filter((e) => needs(e, done.get(e.id))).sort(order)[0];
    if (!next) return;
    // Checked again right before the read, nothing awaited in between: someone may have started meanwhile.
    if (!admission.model.idleFor(IDLE_MS) || (HEAVY.has(extOf(next)) && !admission.docling.idleFor(IDLE_MS))) return;
    await indexOne(next, done);
  } finally {
    state.working = false;
  }
}


/**
 * The content index as the admin page shows it, live: how much of the shared folder is in, what is read now or why
 * nothing is, how fast, and the files that couldn't be read (their paths and why: the admin sees every folder).
 */
export async function indexStatus() {
  const done = await marks();
  const all = await sharedFor(ADMIN);
  let indexed = 0, failed = 0, retrying = 0;
  for (const e of all) {
    const m = done.get(e.id);
    if (m?.v !== versionOf(e)) continue;
    if (m.status === "ok") indexed++;
    else if (m.status === "failed") failed++;
    else retrying++;
  }
  const pending = all.length - indexed - failed;
  const now = Date.now();
  const lastHour = (state.doneAt ?? []).filter((t) => now - t < 3_600_000).length;
  const until = Math.max(state.lastFail + PAUSE_AFTER_FAIL_MS, state.pauseUntil ?? 0);
  const why = indexStateOf({ off: process.env.DOC_INDEX === "off", down: libraryDown(), working: !!state.current, pending, now, failUntil: state.lastFail + PAUSE_AFTER_FAIL_MS, yieldUntil: state.pauseUntil ?? 0 });
  const byId = new Map(all.map((e) => [e.id, e]));
  const sql = await db();
  const rows = await sql<{ file_id: string; version: string; error: string | null; at: Date }[]>`
    SELECT file_id, version, error, at FROM doc_files WHERE status = 'failed' ORDER BY at DESC LIMIT 50`;
  // Only a failure of the file as it is now: one changed since is waiting to be read again, not failed.
  const failures = rows.flatMap((r) => {
    const e = byId.get(r.file_id);
    return e && r.version === versionOf(e) ? [{ path: e.path, error: r.error ?? "", at: r.at.getTime() }] : [];
  }).slice(0, 10);
  return {
    state: why, total: all.length, indexed, failed, retrying, pending, lastHour,
    ...(state.current ? { current: state.current } : {}),
    ...(state.last ? { last: state.last } : {}),
    ...(why === "paused_fail" || why === "paused_yield" ? { until } : {}),
    failures,
  };
}

export function startDocIndexer() {
  if (state.worker || process.env.DOC_INDEX === "off") return;
  state.worker = setInterval(() => void tick().catch((e) => logError("doc-index", e)), TICK_MS);
  state.worker.unref();
}

/** What a search covers for this person: their readable files, how many are in at their current version, how many failed. */
async function scope(who: Viewer) {
  const done = await marks();
  const all = await sharedFor(who);
  const current = all.filter((e) => done.get(e.id)?.v === versionOf(e));
  return {
    entries: new Map(current.filter((e) => done.get(e.id)!.status === "ok").map((e) => [e.id, e])),
    cov: { total: all.length, indexed: current.filter((e) => done.get(e.id)!.status === "ok").length, failed: current.filter((e) => done.get(e.id)!.status === "failed").length },
  };
}

const STAT_MS = 3_000;

/**
 * The files found, looked at on the share itself before they are shown: the scan list may be older than the folder (a
 * file changed or deleted since, the share gone meanwhile). Same size and time as indexed: shown; else left out. The
 * share not answering for any of them: ShareDown, so old text is never given as current.
 */
async function stillThere(entries: Map<string, SharedEntry>, ids: string[]): Promise<Set<string>> {
  const looks = await Promise.all(ids.map(async (id) => {
    const e = entries.get(id)!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const st = await Promise.race([stat(filePathOf(e)), new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error("timeout")), STAT_MS)))]);
      return st.size === e.size && st.mtimeMs === e.mtime ? "same" : "changed";
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? "changed" : "unreachable";
    } finally {
      clearTimeout(timer);
    }
  }));
  if (looks.length && looks.every((l) => l === "unreachable")) throw new ShareDown();
  return new Set(ids.filter((_, i) => looks[i] === "same"));
}

/**
 * belge_ara over what this person may see, each file found checked on the share (stillThere). Not while the share is
 * known to be down either.
 */
export async function searchContent(who: Viewer, question: string, max = 8, skip?: (path: string) => boolean) {
  if (libraryDown()) throw new ShareDown();
  const { entries, cov } = await scope(who);
  const paths = [...entries].flatMap(([id, e]) => (skip?.(e.path) ? [] : [[id, e.path] as [string, string]]));
  return searchFiles(await db(), new Map(paths), question, cov, max, (ids) => stillThere(entries, ids));
}

/** The tool as a chat runs it. */
export async function contentCall(who: Viewer, args: string): Promise<string> {
  return (await contentSearch(who, args)).out;
}

/** The tool as a chat runs it, with what it found: each file and the section it was best found in, for the answer's links. */
export async function contentSearch(who: Viewer, args: string, skip?: (path: string) => boolean): Promise<{ out: string; found: { id: string; name: string; label?: string }[] }> {
  const q = contentArgs(args);
  if (typeof q !== "string") return { out: q.error, found: [] };
  try {
    const r = await searchContent(who, q, 8, skip);
    countUsage("content_search");
    if (r.strength !== "good") countUsage(r.strength === "none" ? "content_empty" : "content_weak");
    // Only a label the source panel has a section for (a page, a sheet, the front matter); "Bölüm N" of unmarked text isn't one.
    const opens = (l: string | undefined) => !!l && /^(Sayfa \d+|Sheet: .+|Başlangıç)$/u.test(l);
    return { out: r.text, found: r.files.map((f) => ({ id: f.fileId, name: f.path, ...(opens(f.sections[0]?.label) ? { label: f.sections[0].label } : {}) })) };
  } catch (e) {
    if (e instanceof ShareDown) return { out: "HATA: ortak klasöre şu an ulaşılamıyor; içerik araması yapılamadı. Kullanıcıya bunu söyle, eski bilgiyi güncelmiş gibi verme.", found: [] };
    logError("doc-index", e);
    return { out: "HATA: içerik dizinine şu an ulaşılamıyor; dosya_ara ile dosya adına göre aranabilir.", found: [] };
  }
}

class ShareDown extends Error {}

export { CONTENT_TOOL };
