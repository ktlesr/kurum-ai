import "server-only";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CHARS_PER_TOKEN } from "./context";
import type { Chunk } from "./rag";

export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "gemma4:12b";
export const NUM_CTX = Number(process.env.NUM_CTX) || 16384;
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
  verify?: { tables: number; numbers: number; uncertain: number };
}

export interface Doc extends DocMeta {
  ownerId: string;
  text: string;
  chunks?: Chunk[];
}

// Docs survive restarts as .cache/userdocs/<ownerId>/<id>.json; globalThis keeps the map across dev hot reloads.
// .cache/docs/ holds pre-auth uploads with no owner: quarantined — never loaded, never deleted (audit K4, plan §4.3).
const DOCS_DIR = path.join(process.cwd(), ".cache", "userdocs");
const g = globalThis as typeof globalThis & { __docs?: Map<string, Doc>; __cpt?: Map<string, number> };
const docs = (g.__docs ??= loadDocs());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function loadDocs(): Map<string, Doc> {
  const map = new Map<string, Doc>();
  let owners: string[] = [];
  try {
    owners = readdirSync(DOCS_DIR).filter((o) => UUID.test(o));
  } catch {
    return map; // no saved docs yet
  }
  for (const owner of owners) {
    for (const f of readdirSync(path.join(DOCS_DIR, owner))) {
      // One unreadable file must not hide the rest (audit R1).
      try {
        const d = JSON.parse(readFileSync(path.join(DOCS_DIR, owner, f), "utf8")) as Doc;
        if (d.ownerId === owner) map.set(d.id, d);
      } catch (e) {
        console.error(`docs: ${owner}/${f} okunamadı: ${(e as Error).message}`);
      }
    }
  }
  return map;
}

/** The doc if it exists AND belongs to userId. Someone else's doc looks exactly like a missing one. */
export function getDoc(userId: string, id: string): Doc | undefined {
  const d = docs.get(id);
  return d?.ownerId === userId ? d : undefined;
}

export const docsOf = (userId: string) => [...docs.values()].filter((d) => d.ownerId === userId);

export function saveDoc(doc: Doc) {
  docs.set(doc.id, doc);
  const dir = path.join(DOCS_DIR, doc.ownerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${doc.id}.json`), JSON.stringify({ ...doc, chunks: undefined }));
}

/** False when the doc doesn't exist or isn't userId's. */
export function deleteDoc(userId: string, id: string): boolean {
  const d = getDoc(userId, id);
  if (!d) return false;
  docs.delete(id);
  rmSync(path.join(DOCS_DIR, d.ownerId, `${d.id}.json`), { force: true });
  return true;
}

/** Chars per token, measured from Ollama's prompt_eval_count per model (tokenizers differ a lot on Turkish). */
export const charsPerToken = (g.__cpt ??= new Map<string, number>());
export const cptFor = (model: string) => charsPerToken.get(model) ?? DEFAULT_CHARS_PER_TOKEN;
export function recordTokens(model: string, chars: number, tokens: number) {
  // Only trust sizeable prompts; small ones are dominated by the chat template.
  if (tokens > 2000) charsPerToken.set(model, (chars / tokens) * 0.95);
}

export function toMeta(doc: Doc): DocMeta {
  const meta: DocMeta & { text?: string; chunks?: Chunk[]; ownerId?: string } = { ...doc };
  delete meta.text;
  delete meta.chunks;
  delete meta.ownerId;
  return meta;
}

// Server-side allowlist: the client picks among these, never anything else Ollama happens to have
// (a `:cloud` model would ship the document off-site — audit S2). Default: just the default model.
export const ALLOWED_MODELS = new Set(
  (process.env.ALLOWED_MODELS ?? DEFAULT_MODEL).split(",").map((m) => m.trim()).filter(Boolean),
);
