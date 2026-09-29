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
  text: string;
  chunks?: Chunk[];
}

// Uploaded docs survive restarts as .cache/docs/<id>.json; globalThis keeps the map across dev hot reloads.
const DOCS_DIR = path.join(process.cwd(), ".cache", "docs");
const g = globalThis as typeof globalThis & { __docs?: Map<string, Doc>; __cpt?: Map<string, number> };
export const docs = (g.__docs ??= loadDocs());

function loadDocs(): Map<string, Doc> {
  const map = new Map<string, Doc>();
  try {
    for (const f of readdirSync(DOCS_DIR)) {
      const d = JSON.parse(readFileSync(path.join(DOCS_DIR, f), "utf8")) as Doc;
      map.set(d.id, d);
    }
  } catch {
    // no saved docs yet
  }
  return map;
}

export function saveDoc(doc: Doc) {
  docs.set(doc.id, doc);
  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(path.join(DOCS_DIR, `${doc.id}.json`), JSON.stringify({ ...doc, chunks: undefined }));
}

export function deleteDoc(id: string) {
  if (!/^[\w-]+$/.test(id)) return;
  docs.delete(id);
  rmSync(path.join(DOCS_DIR, `${id}.json`), { force: true });
}

/** Chars per token, measured from Ollama's prompt_eval_count per model (tokenizers differ a lot on Turkish). */
export const charsPerToken = (g.__cpt ??= new Map<string, number>());
export const cptFor = (model: string) => charsPerToken.get(model) ?? DEFAULT_CHARS_PER_TOKEN;
export function recordTokens(model: string, chars: number, tokens: number) {
  // Only trust sizeable prompts; small ones are dominated by the chat template.
  if (tokens > 2000) charsPerToken.set(model, (chars / tokens) * 0.95);
}

export function toMeta(doc: Doc): DocMeta {
  const meta: DocMeta & { text?: string; chunks?: Chunk[] } = { ...doc };
  delete meta.text;
  delete meta.chunks;
  return meta;
}
