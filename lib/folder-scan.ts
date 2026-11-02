// Walking a folder that may live on a NAS: nothing here blocks the server, a slow or dead share ends in a clear "couldn't", and
// what is left out is counted, so nobody has to wonder why a file doesn't show. Pure fs: tests drive it.
import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface ScanFile { path: string; name: string; ext: string; size: number; mtime: number }
export interface Skipped { type: Record<string, number>; tooBig: number; tooDeep: number; overLimit: number; unreadable: number }
export interface ScanResult { files: ScanFile[]; skipped: Skipped; dirs: string[] }

export interface ScanOptions {
  accept: (ext: string, rel: string) => boolean;
  maxBytes: number | ((ext: string) => number);
  maxDepth: number;
  maxFiles: number;
  deadlineMs: number;
}

export class ScanFailed extends Error {}

const within = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, no) => { timer = setTimeout(() => no(new ScanFailed("timeout")), ms); })]).finally(() => clearTimeout(timer));
};

/** Throws ScanFailed when the root can't be read or time runs out: the caller keeps its last good list. */
export async function scanFolder(root: string, o: ScanOptions): Promise<ScanResult> {
  const end = Date.now() + o.deadlineMs;
  const left = () => {
    const ms = end - Date.now();
    if (ms <= 0) throw new ScanFailed("timeout");
    return ms;
  };
  const out: ScanResult = { files: [], dirs: [], skipped: { type: {}, tooBig: 0, tooDeep: 0, overLimit: 0, unreadable: 0 } };
  try {
    if (!(await within(stat(root), left())).isDirectory()) throw new ScanFailed("not_a_folder");
  } catch (e) {
    throw e instanceof ScanFailed ? e : new ScanFailed((e as NodeJS.ErrnoException).code ?? "unreadable");
  }
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    let names: string[];
    try {
      names = (await within(readdir(dir), left())).sort((a, b) => a.localeCompare(b, "tr"));
    } catch (e) {
      // The share going away midway is a failed scan, not an empty folder; one closed subfolder only counts.
      if (e instanceof ScanFailed || !rel) throw e instanceof ScanFailed ? e : new ScanFailed("unreadable");
      out.skipped.unreadable++;
      return;
    }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const full = path.join(dir, n);
      let st;
      try {
        st = await within(lstat(full), left());
      } catch (e) {
        if (e instanceof ScanFailed) throw e;
        out.skipped.unreadable++;
        continue;
      }
      if (st.isSymbolicLink()) continue; // nothing outside the folder can be read through one
      const r = rel ? `${rel}/${n}` : n;
      if (st.isDirectory()) {
        if (depth >= o.maxDepth) out.skipped.tooDeep++;
        else {
          out.dirs.push(r);
          await walk(full, r, depth + 1);
        }
      } else if (st.isFile() && st.size > 0) {
        const ext = n.includes(".") ? n.toLowerCase().split(".").pop()! : "";
        if (!o.accept(ext, r)) out.skipped.type[ext || "uzantısız"] = (out.skipped.type[ext || "uzantısız"] ?? 0) + 1;
        else if (st.size > (typeof o.maxBytes === "function" ? o.maxBytes(ext) : o.maxBytes)) out.skipped.tooBig++;
        else if (out.files.length >= o.maxFiles) out.skipped.overLimit++;
        else out.files.push({ path: r, name: n, ext, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  await walk(root, "", 0);
  return out;
}
