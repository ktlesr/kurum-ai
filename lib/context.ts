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

export interface ChatMeta {
  mode: "full" | "rag" | "scan" | "truncated";
  sources: string[];
  unverified: string[];
  uncertain: string[];
  note?: string;
}
