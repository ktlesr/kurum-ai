// Shared by server (routing) and client (warning). Keep in sync = import from here.

// Until a model has been measured (see recordTokens in server.ts): conservative for Turkish.
// Measured: gemma4 ≈ 2.9, gpt-oss ≈ 2.2 chars/token.
export const DEFAULT_CHARS_PER_TOKEN = 2.2;
// Tokens kept free for system prompt, chat history, reasoning and the answer.
export const RESERVED_TOKENS = 8192;

/** How many document characters fit into num_ctx. */
export const contextBudget = (numCtx: number, charsPerToken: number) =>
  Math.max(0, numCtx - RESERVED_TOKENS) * charsPerToken;

/** Fraction (0–1] of the documents that fits into num_ctx. */
export function contextRatio(totalChars: number, numCtx: number, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  const budget = contextBudget(numCtx, charsPerToken);
  return totalChars <= budget ? 1 : budget / totalChars;
}

/** Trailer the chat stream appends after this separator: what the answer was built from and how it checked out. */
export const META_SEP = "\u001e";
/** Progress lines inside the chat stream: STATUS_SEP + text + STATUS_SEP. The client strips them from the answer. */
export const STATUS_SEP = "\u001d";
/** A failure after the stream started: ERROR_SEP + message, then the stream ends. The client shows it as an error turn. */
export const ERROR_SEP = "\u001f";

export interface ChatMeta {
  mode: "full" | "rag" | "scan" | "truncated";
  sources: string[];
  unverified: string[];
  uncertain: string[];
  note?: string;
}

export interface DocSection {
  /** "Sayfa 4", "Sheet: Bütçe", "Başlangıç" (outline before the first page), or "" for unmarked text. */
  label: string;
  text: string;
}

/** The extracted text split on the same page/sheet markers the RAG chunker uses, for the source panel. */
export function docSections(text: string): DocSection[] {
  const parts = text.split(/^(--- Sayfa \d+ ---|## Sheet: .+)$/m);
  const out: DocSection[] = [];
  if (parts[0].trim()) out.push({ label: parts.length > 1 ? "Başlangıç" : "", text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ label: parts[i].startsWith("---") ? parts[i].replace(/-/g, "").trim() : parts[i].slice(3), text: (parts[i + 1] ?? "").trim() });
  }
  return out;
}

/**
 * Which doc and section a source chip points at. Chips look like "Sayfa 4", "Sayfa 3 – 5", "Sheet: X", a doc name
 * (whole document), or "<doc> · <label>" when several docs were in context.
 */
export function parseSource(chip: string, docNames: string[]): { doc: string; label?: string } | null {
  const sep = chip.indexOf(" · ");
  const [doc, rest] = sep >= 0 ? [chip.slice(0, sep), chip.slice(sep + 3)] : docNames.includes(chip) ? [chip, undefined] : [docNames[0], chip];
  if (!doc || !docNames.includes(doc)) return null;
  // A range points at its first page.
  return { doc, label: rest?.replace(/^(Sayfa \d+)\s*–.*$/, "$1") };
}
