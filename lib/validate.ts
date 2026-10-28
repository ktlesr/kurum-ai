// Runtime shape check for /api/chat. Pure: no Next, no server-only, so node --test can import it.

export interface ChatRequest {
  model: string;
  fileIds: string[];
  messages: { role: "user" | "assistant"; content: string }[];
  think: boolean;
  /** "all": the whole document is needed; "part": a search is enough (Hızlı profile, no classifier call). */
  scope?: "all" | "part";
}

// files = MAX_DOCS_PER_USER in lib/server.ts; the client sends at most HISTORY messages.
export const LIMITS = { files: 20, messages: 200, messageChars: 100_000 };

/** The parsed request, or a Turkish error message for a 400. */
export function parseChatRequest(body: unknown, allowedModels: ReadonlySet<string>): ChatRequest | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "Geçersiz istek gövdesi.";
  const b = body as Record<string, unknown>;

  if (typeof b.model !== "string" || !allowedModels.has(b.model)) return "Bu model kullanılamaz.";

  if (!Array.isArray(b.fileIds) || b.fileIds.length > LIMITS.files || !b.fileIds.every((id) => typeof id === "string" && id.length <= 64)) {
    return `fileIds en fazla ${LIMITS.files} kimlikten oluşan bir liste olmalı.`;
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > LIMITS.messages) {
    return `messages 1–${LIMITS.messages} mesajlık bir liste olmalı.`;
  }
  for (const m of b.messages as unknown[]) {
    const msg = m as Record<string, unknown> | null;
    if (typeof msg !== "object" || msg === null || (msg.role !== "user" && msg.role !== "assistant") || typeof msg.content !== "string") {
      return "Her mesajın rolü user/assistant, içeriği metin olmalı.";
    }
    if (msg.content.length > LIMITS.messageChars) return `Bir mesaj en fazla ${LIMITS.messageChars.toLocaleString("tr-TR")} karakter olabilir.`;
  }

  if (b.think !== undefined && typeof b.think !== "boolean") return "think true/false olmalı.";
  if (b.scope !== undefined && b.scope !== "all" && b.scope !== "part") return "scope yalnızca \"all\" ya da \"part\" olabilir.";

  return {
    model: b.model,
    fileIds: b.fileIds as string[],
    // Rebuilt, so extra keys smuggled into a message never reach Ollama.
    messages: (b.messages as ChatRequest["messages"]).map(({ role, content }) => ({ role, content })),
    think: b.think === true,
    scope: b.scope as ChatRequest["scope"],
  };
}
