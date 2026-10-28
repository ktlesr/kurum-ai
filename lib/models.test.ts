// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { envConfig, keyOrigins, validateConfig } from "./models.ts";

test("envConfig: env defaults, one kind for all three, default model must be allowed", () => {
  const c = envConfig({ MODEL_PROVIDER: "vllm", MODEL_URL: "http://vllm:8000/v1", ALLOWED_MODELS: "a, b", DEFAULT_MODEL: "x", EMBED_URL: "http://h:11434/v1" });
  assert.deepEqual(c.chat, { kind: "openai", url: "http://vllm:8000/v1" });
  assert.deepEqual(c.models, ["a", "b"]);
  assert.equal(c.defaultModel, "a");
  assert.deepEqual(c.embed, { kind: "openai", url: "http://h:11434/v1", model: "embeddinggemma" });
  assert.equal(c.vision.url, "http://vllm:8000/v1");
  assert.deepEqual(envConfig({}).chat, { kind: "ollama", url: "http://localhost:11434" });
});

test("validateConfig accepts a full config and rejects bad input with a message", () => {
  const ok = {
    chat: { kind: "openai", url: "http://vllm:8000/v1/" }, models: ["gemma4-26b", "gemma4:12b"], defaultModel: "gemma4-26b",
    embed: { kind: "openai", url: "http://host.docker.internal:11434/v1", model: "embeddinggemma" },
    vision: { kind: "ollama", url: "http://host.docker.internal:11434", model: "gemma4:12b" },
  };
  const v = validateConfig(ok);
  assert.equal(typeof v, "object");
  assert.equal((v as { chat: { url: string } }).chat.url, "http://vllm:8000/v1"); // trailing slash dropped
  const bad = (patch: object) => typeof validateConfig({ ...ok, ...patch }) === "string";
  assert.ok(bad({ chat: { kind: "x", url: "http://a" } }));
  assert.ok(bad({ chat: { kind: "openai", url: "file:///etc/passwd" } }));
  assert.ok(bad({ chat: { kind: "openai", url: "http://user:pw@a/v1" } }));
  assert.ok(bad({ chat: { kind: "openai", url: "http://a/v1?key=1" } }));
  assert.ok(bad({ models: [] }));
  assert.ok(bad({ models: ["ok", "bad name;"] }));
  assert.ok(bad({ defaultModel: "absent" }));
  assert.ok(bad({ embed: { kind: "openai", url: "http://a/v1", model: "" } }));
  assert.ok(typeof validateConfig(null) === "string");
});

test("keyOrigins: only the deployment's own servers and MODEL_KEY_HOSTS get the API key", () => {
  const o = keyOrigins({ MODEL_PROVIDER: "vllm", MODEL_URL: "http://vllm:8000/v1", EMBED_URL: "http://host.docker.internal:11434/v1", MODEL_KEY_HOSTS: "https://ai.example.org, bad url" });
  assert.deepEqual([...o].sort(), ["http://host.docker.internal:11434", "http://vllm:8000", "https://ai.example.org"]);
  assert.ok(!o.has("http://attacker.example"));
});
