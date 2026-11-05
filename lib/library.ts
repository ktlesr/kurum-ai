import "server-only";
// The shared document library: a read-only folder on the server (SOURCES_DIR, a bind mount, possibly a NAS), organised by the
// institution in subfolders. Files are read and extracted only when a chat asks for them, once per content, and the text is cached
// under .cache/shared. The browser only ever sends ids from a scan, so no path from a request reaches the disk. Who sees what:
// lib/folder-access. A folder named Şablonlar holds blank forms: they are listed apart and never read as a source.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { admission } from "./admission";
import { writeFileAtomic } from "./atomic";
import { getSetting } from "./db";
import { canSee, parseRules, type FolderRule } from "./folder-access";
import { ScanFailed, goneLongEnough, readWithin, safeToForget, scanFolder, type Skipped } from "./folder-scan";
import { contentProblem } from "./filetype";
import { canConvert } from "./convert";
import { logError } from "./log";
import { parseFile, UserError } from "./parse";
import { MAX_BYTES, type Doc, type DocKind } from "./server";
import { withJobDir } from "./workspace";

const ROOT = () => process.env.SOURCES_DIR || path.join(process.cwd(), "kaynaklar");
const CACHE = path.join(process.cwd(), ".cache", "shared");
/** What lib/parse reads as a workbook (parseSheet). */
const SHEET_EXTS = new Set(["xlsx", "xls", "csv"]);
const CACHE_INDEX = path.join(CACHE, "index.json");
const CACHE_GONE = path.join(CACHE, "gone.json"); // cache file → since when no file has pointed to it
// Old .doc / .ppt are read where LibreOffice is installed (lib/convert), else only listed.
const LEGACY = canConvert() ? ["doc", "ppt"] : [];
const EXT = new Set(["pdf", "docx", "pptx", "xlsx", "xls", "csv", "txt", "md", "html", "htm", ...LEGACY]);
const TEMPLATE_EXT = new Set(["xlsx", "docx", "pdf", "json"]);
const MAX_DEPTH = 8;
const MAX_FILES = Number(process.env.SOURCES_MAX_FILES) || 20_000;
/**
 * Listed, never read: old PowerPoint and Word, and other office files (lib/file-search finds them by name, folder and
 * date). A .pptx is read (lib/pptx). A readable type over MAX_BYTES is listed too.
 */
const LIST_ONLY = new Set([...["ppt", "doc"].filter((e) => !LEGACY.includes(e)), "pps", "ppsx", "potx", "rtf", "odt", "odp", "ods", "key", "pages", "numbers", "vsd", "vsdx", "mpp"]);
/** A file the finder names but no chat reads. */
export interface ListedFile { path: string; size: number; mtime: number }
const SCAN_MS = 15_000; // new files appear within this long
const SCAN_DEADLINE_MS = Number(process.env.SOURCES_SCAN_MS) || 60_000;
const SWEEP_MS = 60 * 60_000;
export const READ_MS = 2 * 60_000; // one file off the share
const MAX_LOADED = 50; // documents kept in memory with their search vectors

export const isSharedId = (id: string) => id.startsWith("s-");
export interface SharedEntry { id: string; path: string; name: string; size: number; kind: DocKind; mtime: number }
export type Viewer = { username: string; role: string };

const kindOf = (ext: string): DocKind => (ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : ext === "xlsx" || ext === "xls" || ext === "csv" ? "sheet" : "text");
const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/ş/g, "s");
export const isTemplatePath = (p: string) => p.split("/").slice(0, -1).some((seg) => ["sablonlar", "templates"].includes(fold(seg)));

export interface LibraryStatus { ok: boolean; at: number; count: number; templates: number; skipped: Skipped | null; error?: string; root: string; dirs: string[] }

interface State {
  at: number;
  list: SharedEntry[];
  templates: SharedEntry[];
  /** Files only listed (LIST_ONLY, or readable but too big): for the file finder. */
  listed?: ListedFile[];
  loaded: Map<string, Doc>;
  running: Map<string, Promise<Doc>>;
  scan?: Promise<void>;
  /** A scan has ended, well or not: before that the list can't be told from an empty one. */
  scanned: boolean;
  ok: boolean;
  error?: string;
  skipped: Skipped | null;
  dirs: string[];
  swept: number;
  /** The last scan ended well and may be taken as the folder's contents (safeToForget): what is missing from it is gone. */
  clean?: boolean;
  rules?: { at: number; rules: FolderRule[] };
}
const g = globalThis as typeof globalThis & { __shared2?: State };
const state: State = (g.__shared2 ??= { at: 0, list: [], templates: [], loaded: new Map(), running: new Map(), scanned: false, ok: true, skipped: null, dirs: [], swept: 0 });

const entryOf = (f: { path: string; name: string; ext: string; size: number; mtime: number }): SharedEntry => ({ id: `s-${createHash("sha256").update(f.path).digest("hex").slice(0, 40)}`, path: f.path, name: f.name, size: f.size, kind: kindOf(f.ext), mtime: f.mtime });

/** Runs in the background: readers get the last good list at once, and a share that went away keeps that list. */
function refresh(): Promise<void> {
  return (state.scan ??= (async () => {
    try {
      const r = await scanFolder(ROOT(), {
        accept: (ext, rel) => (isTemplatePath(rel) ? TEMPLATE_EXT.has(ext) : EXT.has(ext) || LIST_ONLY.has(ext)),
        // Only read files need to fit; a listed one is never opened. Readable files over the limit come in to be listed
        // (a template over it is dropped below, as the scan used to: a form is read whole).
        maxBytes: (ext, rel) => (isTemplatePath(rel) ? MAX_BYTES : Number.MAX_SAFE_INTEGER),
        // Three budgets: forms, documents a chat can read, and files only listed (other types, or too big to read).
        groupOf: (ext, size, rel) => (isTemplatePath(rel) ? "templates" : LIST_ONLY.has(ext) || size > MAX_BYTES ? "listed" : "read"),
        maxDepth: MAX_DEPTH,
        maxFiles: MAX_FILES,
        deadlineMs: SCAN_DEADLINE_MS,
      });
      const before = state.list.length;
      state.templates = r.files.filter((f) => isTemplatePath(f.path)).map(entryOf);
      const own = r.files.filter((f) => !isTemplatePath(f.path));
      const readable = (f: (typeof own)[number]) => EXT.has(f.ext) && f.size <= MAX_BYTES;
      state.list = own.filter(readable).map(entryOf);
      state.listed = own.filter((f) => !readable(f)).map(({ path: p, size, mtime }) => ({ path: p, size, mtime }));
      state.skipped = r.skipped;
      state.dirs = r.dirs;
      state.ok = true;
      state.error = undefined;
      state.clean = safeToForget(before, state.list.length, r.skipped);
      if (state.clean) sweepCache();
    } catch (e) {
      // A folder that was never set up is an empty library, as it always was; a share that was there and went away is an outage.
      const code = e instanceof ScanFailed ? e.message : "unreadable";
      if (code === "ENOENT" && !state.list.length) {
        state.ok = true;
        state.error = undefined;
      } else {
        state.ok = false;
        state.clean = false;
        state.error = code;
        if (!(e instanceof ScanFailed)) logError("library", e);
      }
    } finally {
      state.at = Date.now();
      state.scanned = true;
      state.scan = undefined;
    }
  })());
}

/** Waits only when nothing was ever scanned, and not forever: a hung share must not hold up a question. */
async function fresh(): Promise<void> {
  if (Date.now() - state.at > SCAN_MS) {
    const p = refresh();
    if (!state.scanned) await Promise.race([p, new Promise((r) => setTimeout(r, 5000))]);
  }
}

async function rules(): Promise<FolderRule[]> {
  if (state.rules && Date.now() - state.rules.at < 5000) return state.rules.rules;
  // Unreadable rules close the folders they may have closed: everyone but admins sees nothing until they can be read.
  const r = parseRules(await getSetting("folder_access"));
  state.rules = { at: Date.now(), rules: r };
  return r;
}
export const dropRulesCache = () => { state.rules = undefined; };

/** What this person may see. */
export async function sharedFor(who: Viewer): Promise<SharedEntry[]> {
  await fresh();
  if (who.role === "admin") return state.list;
  const rs = await rules().catch(() => null);
  return rs ? state.list.filter((e) => canSee(e.path, who, rs)) : [];
}
export async function sharedTemplatesFor(who: Viewer): Promise<SharedEntry[]> {
  await fresh();
  if (who.role === "admin") return state.templates;
  const rs = await rules().catch(() => null);
  return rs ? state.templates.filter((e) => canSee(e.path, who, rs)) : [];
}
export const sharedEntryFor = async (who: Viewer, id: string) => (await sharedFor(who)).find((e) => e.id === id);

/** Every shared file this person may see, readable or only listed, for the file finder (names and dates only). */
export async function sharedFilesFor(who: Viewer): Promise<{ path: string; size: number; mtime: number; readable: boolean }[]> {
  const all = [
    ...(await sharedFor(who)).map((e) => ({ path: e.path, size: e.size, mtime: e.mtime, readable: true })),
    ...(state.listed ?? []).map((f) => ({ ...f, readable: false })),
  ];
  if (who.role === "admin") return all;
  const rs = await rules().catch(() => null);
  // The listed files go through the same folder rules (the readable ones already did, in sharedFor).
  return rs ? all.filter((f) => f.readable || canSee(f.path, who, rs)) : all.filter((f) => f.readable);
}
export const libraryDown = () => !state.ok;
/** The readable files' ids when the last scan may be taken as the folder's contents, else null (lib/doc-indexer's sweep). */
export const cleanScanIds = (): string[] | null => (state.ok && state.clean ? state.list.map((e) => e.id) : null);
export const filePathOf = (e: SharedEntry) => path.join(ROOT(), ...e.path.split("/"));

export async function libraryStatus(): Promise<LibraryStatus> {
  await fresh();
  return { ok: state.ok, at: state.at, count: state.list.length, templates: state.templates.length, skipped: state.skipped, error: state.error, root: ROOT(), dirs: state.dirs };
}

/** cache file → the versions of files it stands for; what no live file points to goes. Text of a deleted file must not stay. */
function readIndex(): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(CACHE_INDEX, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}
function remember(file: string, key: string) {
  const index = readIndex();
  const name = path.basename(file);
  // A file version is in one cache file only: one read again under a new name (spreadsheets, ".tr") leaves its old one
  // pointing at nothing, so the sweep removes it.
  for (const [other, keys] of Object.entries(index)) if (other !== name) index[other] = keys.filter((k) => k !== key);
  index[name] = [...new Set([...(index[name] ?? []), key])];
  writeFileAtomic(CACHE_INDEX, JSON.stringify(index));
}
function sweepCache() {
  if (Date.now() - state.swept < SWEEP_MS) return;
  state.swept = Date.now();
  try {
    mkdirSync(CACHE, { recursive: true });
    const live = new Set(state.list.map((e) => `${e.id}:${e.size}:${e.mtime}`));
    const index = readIndex();
    let gone: Record<string, number> = {};
    try {
      gone = JSON.parse(readFileSync(CACHE_GONE, "utf8")) as Record<string, number>;
    } catch {}
    const now = Date.now();
    const nextGone: Record<string, number> = {};
    let changed = false;
    for (const [name, keys] of Object.entries(index)) {
      if (keys.some((k) => live.has(k))) continue;
      const since = gone[name] ?? now;
      if (goneLongEnough(since, now)) {
        rmSync(path.join(CACHE, path.basename(name)), { force: true });
        delete index[name];
        changed = true;
      } else nextGone[name] = since;
    }
    writeFileAtomic(CACHE_GONE, JSON.stringify(nextGone));
    // Extractions from before the index existed have no entry: they can't be matched to a file, so they are read again once.
    const known = new Set(Object.keys(index));
    for (const f of readdirSync(CACHE)) if (f.endsWith(".json") && f !== "index.json" && f !== "gone.json" && !known.has(f)) { rmSync(path.join(CACHE, f), { force: true }); changed = true; }
    if (changed) writeFileAtomic(CACHE_INDEX, JSON.stringify(index));
    for (const k of state.loaded.keys()) if (!live.has(k)) state.loaded.delete(k);
  } catch (e) {
    logError("library", e);
  }
}

/**
 * The document's text, extracted on first use; a changed file (new content) is extracted again.
 * `keep: false` (the background content index): read through the same cache, but not kept in memory, so a folder's worth
 * of files doesn't push out the documents chats are using (and the search vectors computed for them); not shared with a
 * chat asking for the same file meanwhile (that one reads on its own), so `signal` can stop it halfway.
 */
export async function sharedDoc(e: SharedEntry, onProgress: (stage: string) => void, signal: AbortSignal, keep = true): Promise<Doc> {
  // Same size and time: no need to read and hash the file again.
  const key = `${e.id}:${e.size}:${e.mtime}`;
  const had = state.loaded.get(key);
  if (had) return had;
  const running = keep ? state.running.get(key) : undefined;
  if (running) return running;
  // Held from reading the file to the end of extraction: the same global limit as uploads (a full queue is refused).
  const job = admission.upload.run(async () => {
    const buf = await readWithin(filePathOf(e), READ_MS, keep ? undefined : signal).catch(() => {
      throw new UserError("ortak klasördeki dosyaya şu an ulaşılamıyor");
    });
    const hash = createHash("sha256").update(buf).digest("hex");
    // Same bytes under another extension are parsed differently (a table, not plain text).
    const ext = e.name.toLowerCase().split(".").pop() ?? "";
    // Spreadsheets are read again once: their number cells are now written the Turkish way (lib/parse, SHEET_TR); the
    // old text read "1,234" as one and a bit. remember() takes the version off the old cache file, and the sweep removes it.
    // ".t2": read again once more, with each row's Excel row number, total and footnote rows told apart (lib/table).
    const file = path.join(CACHE, `${hash}.${ext}${SHEET_EXTS.has(ext) ? ".t2" : ""}.json`);
    // The name goes into prompts inside an attribute: no quote or bracket can close it.
    const name = e.path.replace(/["<>]/g, "");
    let doc: Doc | undefined;
    try {
      doc = { ...(JSON.parse(readFileSync(file, "utf8")) as Doc), id: e.id, name };
    } catch {}
    if (!doc) {
      const problem = await contentProblem(ext, buf).catch(() => "Dosya okunamadı.");
      if (problem) throw new UserError(problem);
      // One request's cancel must not fail another waiting for the same file: extraction runs to its end.
      // A background read stops when told (someone is waiting for Docling): nobody else waits on it, it isn't in `running`.
      const parsed = await withJobDir((dir) => parseFile(e.name, buf, () => {}, keep ? new AbortController().signal : signal, dir));
      doc = { id: e.id, ownerId: "shared", sourceHash: hash, name, size: e.size, chars: parsed.text.length, ...parsed } as Doc;
      mkdirSync(CACHE, { recursive: true });
      writeFileAtomic(file, JSON.stringify({ ...doc, chunks: undefined, chunksKey: undefined, digests: undefined }));
    }
    remember(file, key);
    if (!keep) return doc;
    state.loaded.set(key, doc);
    // ponytail: oldest out first; a large library's most used documents are simply loaded again from the cache.
    if (state.loaded.size > MAX_LOADED) state.loaded.delete(state.loaded.keys().next().value as string);
    return doc;
  }, keep ? new AbortController().signal : signal).finally(() => keep && state.running.delete(key));
  if (keep) state.running.set(key, job);
  onProgress(e.path);
  signal.throwIfAborted();
  return job;
}
