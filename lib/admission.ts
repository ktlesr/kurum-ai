import "server-only";
import { RateLimiter, Semaphore } from "./limits";

// One set per process (lib/boot: one instance per database); globalThis keeps them across dev hot reloads.
const num = (name: string, def: number) => Number(process.env[name]) || def;
const g = globalThis as typeof globalThis & { __admission?: ReturnType<typeof make> };

function make() {
  return {
    /** Every Ollama/vLLM call: chat, classify, scan, embeddings, vision. */
    model: new Semaphore(num("MODEL_CONCURRENCY", 2), num("MODEL_QUEUE", 32)),
    /** Docling runs (CPU/GPU heavy, minutes per document). */
    docling: new Semaphore(num("DOCLING_CONCURRENCY", 1), num("DOCLING_QUEUE", 8)),
    chatPerUser: new RateLimiter(num("CHAT_PER_MIN", 20), 60_000),
    uploadPerUser: new RateLimiter(num("UPLOAD_PER_MIN", 20), 60_000),
  };
}

export const admission = (g.__admission ??= make());
export const DOCLING_TIMEOUT_MS = num("DOCLING_TIMEOUT_MS", 20 * 60_000);
export const tooMany = (what: string) =>
  Response.json({ error: `Çok fazla ${what} isteği. Bir dakika sonra tekrar deneyin.` }, { status: 429, headers: { "Retry-After": "60" } });
export const busy = () =>
  Response.json({ error: "Sunucu şu an çok yoğun. Biraz sonra tekrar deneyin." }, { status: 429, headers: { "Retry-After": "30" } });
