// Run: pnpm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { makeProvider } from "./provider.ts";

/** Fake model server: records each request body, answers from `routes`. */
const seen: { path: string; body: Record<string, unknown>; headers: IncomingHttpHeaders }[] = [];
const routes: Record<string, (res: ServerResponse) => void> = {};
const server = createServer(async (req: IncomingMessage, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  seen.push({ path: req.url!, body: raw ? JSON.parse(raw) : {}, headers: req.headers });
  (routes[req.url!] ?? ((r) => r.writeHead(404).end()))(res);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const signal = new AbortController().signal;
// Split mid-line on purpose: the parser must reassemble.
const send = (chunks: string[]) => (res: ServerResponse) => {
  res.writeHead(200);
  for (const c of chunks) res.write(c);
  res.end();
};

test("ollama: streamed text, thinking count, truncation, prompt tokens, vision images", async () => {
  routes["/api/chat"] = send([
    '{"message":{"thinking":"hmm"}}\n{"message":{"content":"Mer"}}\n{"message":{"con',
    'tent":"haba"}}\n{"done":true,"done_reason":"length","prompt_eval_count":42}',
  ]);
  const p = makeProvider("ollama", base + "/", { numCtx: 8192 });
  const pieces: string[] = [];
  let thinking = 0;
  const r = await p.chat({ model: "gemma4:12b", messages: [{ role: "user", content: "x", images: ["QUJD"] }], maxTokens: 5, signal, onText: (t) => pieces.push(t), onThinking: (n) => (thinking = n) });
  assert.deepEqual(r, { text: "Merhaba", truncated: true, promptTokens: 42 });
  assert.deepEqual(pieces, ["Mer", "haba"]);
  assert.equal(thinking, 1);
  const body = seen.at(-1)!.body as { options: object; messages: { images: string[] }[]; think: unknown };
  assert.deepEqual(body.options, { num_ctx: 8192, temperature: 0, num_predict: 5 });
  assert.deepEqual(body.messages[0].images, ["QUJD"]);
  assert.equal(body.think, false);
});

test("ollama: gpt-oss gets an effort instead of on/off", async () => {
  routes["/api/chat"] = send(['{"done":true}']);
  const p = makeProvider("ollama", base, { numCtx: 1 });
  await p.chat({ model: "gpt-oss:20b", messages: [], think: true, maxTokens: 1, signal });
  assert.equal((seen.at(-1)!.body as { think: unknown }).think, "high");
  await p.chat({ model: "gpt-oss:20b", messages: [], think: false, maxTokens: 1, signal });
  assert.equal((seen.at(-1)!.body as { think: unknown }).think, "low");
});

test("abort reaches the request", async () => {
  routes["/api/chat"] = () => {}; // never answers
  const ac = new AbortController();
  const q = makeProvider("ollama", base, { numCtx: 1 }).chat({ model: "m", messages: [], maxTokens: 1, signal: ac.signal });
  ac.abort(new Error("iptal"));
  await assert.rejects(q, /iptal/);
});

test("ollama: models drops cloud and non-chat models; embed; health", async () => {
  routes["/api/tags"] = send([JSON.stringify({ models: [{ name: "a" }, { name: "b:cloud", remote_host: "x" }, { name: "e", capabilities: ["embedding"] }] })]);
  routes["/api/embed"] = send([JSON.stringify({ embeddings: [[1, 2]] })]);
  routes["/api/version"] = send(["{}"]);
  const p = makeProvider("ollama", base, { numCtx: 1 });
  assert.deepEqual(await p.models(), ["a"]);
  assert.deepEqual(await p.embed("e", ["t"], signal), [[1, 2]]);
  assert.equal(await p.healthy(), true);
});

test("openai (vLLM): SSE deltas, reasoning, finish_reason, usage, images as data URLs, auth header", async () => {
  routes["/v1/chat/completions"] = send([
    ': keep-alive\n\ndata: {"choices":[{"delta":{"reasoning_content":"..."}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Mer"}}]}\n\ndata: {"choices":[{"delta":{"content":"haba"},"finish_reason":"length"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":7}}\n\ndata: [DONE]\n\n',
  ]);
  const p = makeProvider("openai", base + "/v1", { numCtx: 1, apiKey: "k" });
  let thinking = 0;
  const r = await p.chat({ model: "gpt-oss-120b", messages: [{ role: "system", content: "s" }, { role: "user", content: "x", images: ["QUJD"] }], think: true, maxTokens: 9, signal, onThinking: (n) => (thinking = n) });
  assert.deepEqual(r, { text: "Merhaba", truncated: true, promptTokens: 7 });
  assert.equal(thinking, 1);
  const body = seen.at(-1)!.body as Record<string, unknown> & { messages: { content: unknown }[] };
  assert.equal(body.max_tokens, 9);
  assert.equal(body.temperature, 0);
  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
  assert.equal(body.messages[0].content, "s");
  assert.deepEqual(body.messages[1].content, [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }]);
  assert.equal(seen.at(-1)!.headers.authorization, "Bearer k");
});

test("openai (vLLM): embeddings keep input order, models, http errors", async () => {
  routes["/v1/embeddings"] = send([JSON.stringify({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] })]);
  routes["/v1/models"] = send([JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] })]);
  const p = makeProvider("openai", base + "/v1", { numCtx: 1 });
  assert.deepEqual(await p.embed("e", ["a", "b"], signal), [[1], [2]]);
  assert.deepEqual(await p.models(), ["m1", "m2"]);
  assert.equal(await p.healthy(), true);
  routes["/v1/chat/completions"] = (res) => res.writeHead(500).end();
  await assert.rejects(p.chat({ model: "m1", messages: [], maxTokens: 1, signal }), /model_http_500/);
  routes["/v1/chat/completions"] = send(['data: {"error":{"message":"boom"}}\n\n']);
  await assert.rejects(p.chat({ model: "m1", messages: [], maxTokens: 1, signal }), /model_stream_error/);
});
