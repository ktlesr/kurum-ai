import "server-only";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { writeFileAtomic } from "./atomic";
import { extractBusy, extractDir, removeIfEmpty, sweepExtract, sweepJobs } from "./workspace";
import { logError } from "./log";
import path from "node:path";
import { DEFAULT_CHARS_PER_TOKEN } from "./context";
import type { Chunk } from "./rag";

export { NUM_CTX } from "./model-config";
export const MAX_BYTES = 25 * 1024 * 1024;

export type DocKind = "pdf" | "docx" | "sheet" | "text";

export interface DocMeta {
  id: string;
  name: string;
  kind: DocKind;
  size: number;
  chars: number;
  pages?: number;
  rows?: number;
  sheets?: number;
  warning?: string;
  verify?: { tables: number; numbers: number; uncertain: number; skipped?: string };
}

export interface Doc extends DocMeta {
  ownerId: string;
  /** sha256 of the uploaded bytes: names the doc's extract cache dir. */
  sourceHash?: string;
  text: string;
  chunks?: Chunk[];
  /** Embedding server + model the chunk vectors came from (lib/rag). */
  chunksKey?: string;
  /** Whole-document notes per window, keyed by model (chat route); memory only, like chunks. */
  digests?: Record<string, { label: string; text: string }[]>;
}

// Docs survive restarts as .cache/userdocs/<ownerId>/<id>.json; globalThis keeps the map across dev hot reloads.
// .cache/docs/ holds pre-auth uploads with no owner: quarantined — never loaded, never deleted (audit K4, plan §4.3).
const DOCS_DIR = path.join(process.cwd(), ".cache", "userdocs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const g = globalThis as typeof globalThis & { __docs?: Map<string, Doc>; __cpt?: Map<string, number> };
// Must come after every const loadDocs touches (TDZ: a ReferenceError here used to load zero docs on restart).
const docs = (g.__docs ??= loadDocs());

/**
 * Drops what a crash or a deleted doc left behind. Only lib/boot calls it, after taking the instance lock: then no
 * other process can be mid-upload. Legacy .cache files are not touched.
 */
export function sweepOnBoot() {
  const jobs = sweepJobs();
  const extracts = sweepExtract(new Set([...docs.values()].filter((d) => d.sourceHash).map((d) => `${d.ownerId}/${d.sourceHash}`)));
  if (jobs || extracts) console.error(`cleanup: ${jobs} yarım iş, ${extracts} sahipsiz önbellek silindi`);
}

function loadDocs(): Map<string, Doc> {
  const map = new Map<string, Doc>();
  let owners: string[] = [];
  try {
    owners = readdirSync(DOCS_DIR).filter((o) => UUID.test(o));
  } catch {
    return map; // no saved docs yet
  }
  // One unreadable dir or file must not hide the rest (audit R1). Logs carry no user id or content.
  let failed = 0;
  for (const owner of owners) {
    let files: string[];
    try {
      files = readdirSync(path.join(DOCS_DIR, owner));
    } catch {
      failed++;
      continue;
    }
    for (const f of files.filter((n) => n.endsWith(".json"))) { // skips *.tmp left by a crash mid-write
      try {
        const d = JSON.parse(readFileSync(path.join(DOCS_DIR, owner, f), "utf8")) as Doc;
        if (d.ownerId === owner) map.set(d.id, d);
      } catch {
        failed++;
      }
    }
  }
  if (failed) console.error(`docs: ${failed} kayıt okunamadı, atlandı`);
  return map;
}

/** The doc if it exists AND belongs to userId. Someone else's doc looks exactly like a missing one. */
export function getDoc(userId: string, id: string): Doc | undefined {
  const d = docs.get(id);
  return d?.ownerId === userId ? d : undefined;
}

export const MAX_DOCS_PER_USER = 20; // = chat fileIds limit (lib/validate.ts)
export const docsOf = (userId: string) => [...docs.values()].filter((d) => d.ownerId === userId);

/**
 * Names are unique per user ("rapor.pdf", "rapor (2).pdf"), so a source chip like "rapor.pdf · Sayfa 3" always points
 * at one document. Call it in the same synchronous block as saveDoc: then two uploads can't pick the same name.
 */
export function uniqueName(userId: string, name: string): string {
  const taken = new Set(docsOf(userId).map((d) => d.name));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})${ext}`)) return `${base} (${i})${ext}`;
}

export function saveDoc(doc: Doc) {
  writeFileAtomic(path.join(DOCS_DIR, doc.ownerId, `${doc.id}.json`), JSON.stringify({ ...doc, chunks: undefined, chunksKey: undefined, digests: undefined }));
  // Only after the file is safely on disk: a failed write must not leave a doc that vanishes on restart (audit R3).
  docs.set(doc.id, doc);
}

/** False when the doc doesn't exist or isn't userId's. */
export function deleteDoc(userId: string, id: string): boolean {
  const d = getDoc(userId, id);
  if (!d) return false;
  docs.delete(id);
  rmSync(path.join(DOCS_DIR, d.ownerId, `${d.id}.json`), { force: true });
  removeIfEmpty(path.join(DOCS_DIR, d.ownerId));
  if (d.sourceHash) dropExtractIfUnused(userId, d.sourceHash);
  return true;
}

/** The extract cache goes with the user's last doc of that content (audit S3: deleted means deleted). */
// Never throws: a failed cleanup is logged (no content) and swept on the next start; it must not mask the caller's result.
export function dropExtractIfUnused(userId: string, sourceHash: string) {
  if (extractBusy(`${userId}/${sourceHash}`)) return; // an upload is writing there; it cleans up when it ends
  if (docsOf(userId).some((d) => d.sourceHash === sourceHash)) return;
  try {
    const dir = extractDir(userId, sourceHash);
    rmSync(dir, { recursive: true, force: true });
    removeIfEmpty(path.dirname(dir));
  } catch (e) {
    logError("cleanup", e);
  }
}

/** Chars per token, measured from Ollama's prompt_eval_count per model (tokenizers differ a lot on Turkish). */
export const charsPerToken = (g.__cpt ??= new Map<string, number>());
export const cptFor = (model: string) => charsPerToken.get(model) ?? DEFAULT_CHARS_PER_TOKEN;
export function recordTokens(model: string, chars: number, tokens: number) {
  // Only trust sizeable prompts; small ones are dominated by the chat template.
  if (tokens > 2000) charsPerToken.set(model, (chars / tokens) * 0.95);
}

// Docs saved before PR-1c may carry the raw provider error in their warning ("Görsel model (x) çalışmadı: <body>").
const LEGACY_VISION_WARNING = /^Görsel model \(.*\) çalışmadı:/;

export function toMeta(doc: Doc): DocMeta {
  const meta: DocMeta & Partial<Pick<Doc, "text" | "chunks" | "chunksKey" | "digests" | "ownerId" | "sourceHash">> = { ...doc };
  const safe = "Görsel model çalışmadı; tablolar ikinci kez doğrulanamadı.";
  if (meta.warning && LEGACY_VISION_WARNING.test(meta.warning)) meta.warning = safe;
  // The same raw text was also stored in verify.skipped.
  if (meta.verify?.skipped && LEGACY_VISION_WARNING.test(meta.verify.skipped)) meta.verify = { ...meta.verify, skipped: safe };
  delete meta.text;
  delete meta.chunks;
  delete meta.chunksKey;
  delete meta.digests;
  delete meta.ownerId;
  delete meta.sourceHash;
  return meta;
}
