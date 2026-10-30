import "server-only";
// The shared document library: a read-only folder on the server (SOURCES_DIR, a bind mount), organised by the
// institution in subfolders. Every signed-in user can read it; files are read and extracted only when a chat asks for
// them, once per content, and the text is cached under .cache/shared. The browser only ever sends ids from a scan, so
// no path from a request reaches the disk. Symlinks are skipped: nothing outside the folder can be read through one.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { admission } from "./admission";
import { writeFileAtomic } from "./atomic";
import { contentProblem } from "./filetype";
import { parseFile, UserError } from "./parse";
import { MAX_BYTES, type Doc, type DocKind } from "./server";
import { withJobDir } from "./workspace";

const ROOT = () => process.env.SOURCES_DIR || path.join(process.cwd(), "kaynaklar");
const CACHE = path.join(process.cwd(), ".cache", "shared");
const EXT = new Set(["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "html", "htm"]);
const MAX_DEPTH = 8;
const MAX_FILES = 5000;
const SCAN_MS = 15_000; // new files appear within this long
const MAX_LOADED = 50; // documents kept in memory with their search vectors

export const isSharedId = (id: string) => id.startsWith("s-");
export interface SharedEntry { id: string; path: string; name: string; size: number; kind: DocKind; mtime: number }

const kindOf = (ext: string): DocKind => (ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : ext === "xlsx" || ext === "xls" || ext === "csv" ? "sheet" : "text");

const g = globalThis as typeof globalThis & { __shared?: { at: number; list: SharedEntry[]; loaded: Map<string, Doc>; running: Map<string, Promise<Doc>> } };
const state = (g.__shared ??= { at: 0, list: [], loaded: new Map(), running: new Map() });

function walk(dir: string, rel: string, depth: number, out: SharedEntry[]) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let names: string[];
  try {
    names = readdirSync(dir).sort((a, b) => a.localeCompare(b, "tr"));
  } catch {
    return; // unreadable or missing: an empty library, not an error
  }
  for (const n of names) {
    if (n.startsWith(".") || out.length >= MAX_FILES) continue;
    const full = path.join(dir, n);
    const st = lstatSync(full, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) continue;
    const r = rel ? `${rel}/${n}` : n;
    if (st.isDirectory()) walk(full, r, depth + 1, out);
    else if (st.isFile() && st.size > 0 && st.size <= MAX_BYTES) {
      const ext = n.toLowerCase().split(".").pop() ?? "";
      if (EXT.has(ext)) out.push({ id: `s-${createHash("sha256").update(r).digest("hex").slice(0, 40)}`, path: r, name: n, size: st.size, kind: kindOf(ext), mtime: st.mtimeMs });
    }
  }
}

export function sharedList(): SharedEntry[] {
  if (Date.now() - state.at > SCAN_MS) {
    const out: SharedEntry[] = [];
    walk(ROOT(), "", 0, out);
    state.list = out;
    state.at = Date.now();
  }
  return state.list;
}
export const sharedEntry = (id: string) => sharedList().find((e) => e.id === id);

/** The document's text, extracted on first use; a changed file (new content) is extracted again. */
export async function sharedDoc(e: SharedEntry, onProgress: (stage: string) => void, signal: AbortSignal): Promise<Doc> {
  // Same size and time: no need to read and hash the file again.
  const key = `${e.id}:${e.size}:${e.mtime}`;
  const had = state.loaded.get(key);
  if (had) return had;
  const running = state.running.get(key);
  if (running) return running;
  // Held from reading the file to the end of extraction: the same global limit as uploads (a full queue is refused).
  const job = admission.upload.run(async () => {
    const buf = readFileSync(path.join(ROOT(), ...e.path.split("/")));
    const hash = createHash("sha256").update(buf).digest("hex");
    const file = path.join(CACHE, `${hash}.json`);
    // The name goes into prompts inside an attribute: no quote or bracket can close it.
    const name = e.path.replace(/["<>]/g, "");
    let doc: Doc | undefined;
    try {
      doc = { ...(JSON.parse(readFileSync(file, "utf8")) as Doc), id: e.id, name };
    } catch {}
    if (!doc) {
      const ext = e.name.toLowerCase().split(".").pop() ?? "";
      const problem = await contentProblem(ext, buf).catch(() => "Dosya okunamadı.");
      if (problem) throw new UserError(problem);
      // One request's cancel must not fail another waiting for the same file: extraction runs to its end.
      const parsed = await withJobDir((dir) => parseFile(e.name, buf, () => {}, new AbortController().signal, dir));
      doc = { id: e.id, ownerId: "shared", sourceHash: hash, name, size: e.size, chars: parsed.text.length, ...parsed } as Doc;
      mkdirSync(CACHE, { recursive: true });
      writeFileAtomic(file, JSON.stringify({ ...doc, chunks: undefined, chunksKey: undefined, digests: undefined }));
    }
    state.loaded.set(key, doc);
    // ponytail: oldest out first; a large library's most used documents are simply loaded again from the cache.
    if (state.loaded.size > MAX_LOADED) state.loaded.delete(state.loaded.keys().next().value as string);
    return doc;
  }, new AbortController().signal).finally(() => state.running.delete(key));
  state.running.set(key, job);
  onProgress(e.path);
  signal.throwIfAborted();
  return job;
}
