// Model server behind one small interface (audit K3): Ollama for development, vLLM (OpenAI-compatible API) on the GB10.
// No "server-only": the test drives it against a fake server.

import { DEFAULT_CHARS_PER_TOKEN } from "./context.ts";
import type { ProviderKind } from "./models";
export type { ProviderKind };
export type Msg = { role: "system" | "user" | "assistant"; content: string; images?: string[] };

export interface ChatOpts {
  model: string;
  messages: Msg[];
  think?: boolean;
  maxTokens: number;
  signal: AbortSignal;
  onText?: (piece: string) => void;
  /** Running count of reasoning chunks (the UI shows "thinking…"). */
  onThinking?: (n: number) => void;
  /** The answer is a JSON object: the server constrains the output to valid JSON (vLLM response_format, Ollama format). */
  json?: boolean;
}

export interface ChatResult {
  text: string;
  /** Stopped at maxTokens. */
  truncated: boolean;
  promptTokens?: number;
  /** Generated tokens, reasoning included. */
  outputTokens?: number;
}

export interface Provider {
  kind: ProviderKind;
  /** Always streamed: long generations would otherwise hit fetch's 5-minute no-data timeout. */
  chat(o: ChatOpts): Promise<ChatResult>;
  embed(model: string, input: string[], signal: AbortSignal): Promise<number[][]>;
  /** Local models this server can chat with. */
  models(): Promise<string[]>;
  /** What this server has for embeddings: `models()` lists only what can chat. */
  embedModels(): Promise<string[]>;
  healthy(): Promise<boolean>;
}

// gpt-oss cannot switch reasoning off, only down
const effort = (think: boolean) => (think ? "high" : "low");
const isGptOss = (model: string) => /gpt-oss/.test(model);

/** Splits a byte stream into lines; the last partial line is handed over at the end. */
async function eachLine(body: ReadableStream<Uint8Array>, onLine: (l: string) => void) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(onLine);
  }
  onLine(buf + decoder.decode());
}

function ollama(base: string, numCtx: number): Provider {
  const post = (path: string, body: object, signal: AbortSignal) => fetch(`${base}${path}`, { method: "POST", signal, body: JSON.stringify(body) });
  return {
    kind: "ollama",
    async chat({ model, messages, think = false, maxTokens, signal, onText, onThinking, json }) {
      const res = await post("/api/chat", {
        model,
        stream: true,
        ...(json ? { format: "json" } : {}),
        think: isGptOss(model) ? effort(think) : think,
        // Same num_ctx on every call: a different value makes Ollama reload the model.
        // Always capped: at temperature 0 a model can fall into a repetition loop and generate until num_ctx
        // (seen: 58k tokens, ~15 min), blocking the server for every later request.
        options: { num_ctx: numCtx, temperature: 0, num_predict: maxTokens },
        messages,
      }, signal);
      if (!res.ok || !res.body) throw new Error(`model_http_${res.status}`);
      const out: ChatResult = { text: "", truncated: false };
      let thought = 0;
      await eachLine(res.body, (line) => {
        if (!line.trim()) return;
        const j = JSON.parse(line) as { message?: { content?: string; thinking?: string }; error?: string; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number };
        if (j.error) throw new Error("model_stream_error");
        if (j.message?.thinking) onThinking?.(++thought);
        if (j.message?.content) {
          out.text += j.message.content;
          onText?.(j.message.content);
        }
        if (j.done_reason === "length") out.truncated = true;
        if (j.done && j.prompt_eval_count) out.promptTokens = j.prompt_eval_count;
        if (j.done && j.eval_count) out.outputTokens = j.eval_count;
      });
      return out;
    },
    async embed(model, input, signal) {
      const res = await post("/api/embed", { model, input, truncate: true }, signal);
      const j = (await res.json()) as { embeddings?: number[][] };
      if (!res.ok || !j.embeddings) throw new Error(`embed_http_${res.status}`);
      return j.embeddings;
    },
    async models() {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
      const { models } = (await res.json()) as { models: { name: string; remote_host?: string; capabilities?: string[] }[] };
      // Cloud models would send the document off this machine (belt and braces with the allowlist).
      return models.filter((m) => !m.remote_host && (m.capabilities ?? ["completion"]).includes("completion")).map((m) => m.name);
    },
    async embedModels() {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
      const { models } = (await res.json()) as { models: { name: string; remote_host?: string; capabilities?: string[] }[] };
      // Without capabilities in the answer nothing tells them apart (bge-m3 has no "embed" in its name): all may be.
      return models.filter((m) => !m.remote_host && (m.capabilities?.includes("embedding") ?? true)).map((m) => m.name);
    },
    healthy: () => fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false),
  };
}

/** Image type from the first base64 characters (PNG, JPEG, WebP signatures). */
const mimeOf = (b64: string) => (b64.startsWith("/9j/") ? "image/jpeg" : b64.startsWith("UklGR") ? "image/webp" : "image/png");

/** vLLM and other OpenAI-compatible servers. `base` includes the /v1 prefix. */
function openai(base: string, apiKey: string | undefined): Provider {
  const headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  const toWire = (m: Msg) =>
    m.images?.length
      ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:${mimeOf(b64)};base64,${b64}` } }))] }
      : { role: m.role, content: m.content };
  return {
    kind: "openai",
    async chat({ model, messages, think = false, maxTokens, signal, onText, onThinking, json }) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify({
          model,
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0,
          max_tokens: maxTokens,
          messages: messages.map(toWire),
          // Qwen/Gemma-style templates read enable_thinking; gpt-oss takes an effort. Unknown kwargs are ignored.
          chat_template_kwargs: { enable_thinking: think },
          ...(isGptOss(model) ? { reasoning_effort: effort(think) } : {}),
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`model_http_${res.status}`);
      const out: ChatResult = { text: "", truncated: false };
      let thought = 0;
      await eachLine(res.body, (line) => {
        const data = line.trim().replace(/^data:\s*/, "");
        if (!data || data === "[DONE]" || line.trim().startsWith(":")) return;
        const j = JSON.parse(data) as {
          error?: unknown;
          choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        };
        if (j.error) throw new Error("model_stream_error");
        const c = j.choices?.[0];
        if (c?.delta?.reasoning_content || c?.delta?.reasoning) onThinking?.(++thought);
        if (c?.delta?.content) {
          out.text += c.delta.content;
          onText?.(c.delta.content);
        }
        if (c?.finish_reason === "length") out.truncated = true;
        if (j.usage?.prompt_tokens) out.promptTokens = j.usage.prompt_tokens;
        if (j.usage?.completion_tokens) out.outputTokens = j.usage.completion_tokens;
      });
      return out;
    },
    async embed(model, input, signal) {
      const res = await fetch(`${base}/embeddings`, { method: "POST", signal, headers, body: JSON.stringify({ model, input }) });
      const j = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
      if (!res.ok || !j.data) throw new Error(`embed_http_${res.status}`);
      return [...j.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
    async models() {
      const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(3000), cache: "no-store" });
      return ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
    },
    async embedModels() {
      const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(3000), cache: "no-store" });
      return ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).filter((m) => /embed/i.test(m));
    },
    healthy: () => fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false),
  };
}

/**
 * Reports the tokens of every chat call. A stream stopped midway (user cancelled, looping model) never gets the server's
 * figures, so those are estimated: from the text's length, and at least one token per streamed piece (images not included).
 * Cancelled before any output: the model had still read the prompt. A call that failed by itself counts nothing.
 */
export function metered(p: Provider, count: (tokensIn: number, tokensOut: number) => void): Provider {
  return {
    ...p,
    async chat(o) {
      let pieces = 0;
      let chars = 0;
      let thought = 0;
      const outputGuess = () => Math.max(pieces, Math.round(chars / DEFAULT_CHARS_PER_TOKEN)) + thought;
      const promptGuess =() => Math.round(o.messages.reduce((n, m) => n + m.content.length, 0) / DEFAULT_CHARS_PER_TOKEN);
      try {
        const r = await p.chat({
          ...o,
          onText: (t) => {
            pieces++;
            chars += t.length;
            o.onText?.(t);
          },
          onThinking: (n) => {
            thought = n;
            o.onThinking?.(n);
          },
        });
        count(r.promptTokens ?? promptGuess(), r.outputTokens ?? outputGuess());
        return r;
      } catch (e) {
        if (pieces + thought || o.signal.aborted) count(promptGuess(), outputGuess());
        throw e;
      }
    },
  };
}

export function makeProvider(kind: ProviderKind, url: string, opts: { apiKey?: string; numCtx: number }): Provider {
  const base = url.replace(/\/$/, "");
  return kind === "openai" ? openai(base, opts.apiKey) : ollama(base, opts.numCtx);
}
