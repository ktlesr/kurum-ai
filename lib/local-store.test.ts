// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBackup, mergeChats, parseBackup, searchChats, sortChats, titleFrom, type StoredChat } from "./local-store.ts";

const chat = (id: string, updatedAt: number, extra: Partial<StoredChat> = {}): StoredChat => ({
  id, title: id, createdAt: 1, updatedAt, docIds: [], messages: [{ role: "user", content: `soru ${id}` }], ...extra,
});

test("backup round-trips; transient fields are dropped", () => {
  const c = chat("a", 5, { pinned: true, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y", status: "Okunuyor" }] });
  const back = parseBackup(JSON.stringify(makeBackup([c])));
  assert.ok(Array.isArray(back));
  assert.deepEqual(back[0].messages, [{ role: "user", content: "x" }, { role: "assistant", content: "y" }]);
  assert.equal(back[0].pinned, true);
});

test("bad backups are refused whole, with a user-facing reason", () => {
  assert.match(parseBackup("{bozuk") as string, /okunamadı/);
  assert.match(parseBackup(JSON.stringify({ kind: "baska", chats: [] })) as string, /yedeği değil/);
  assert.match(parseBackup(JSON.stringify({ ...makeBackup([]), schema: 99 })) as string, /daha yeni/);
  const bad = makeBackup([chat("a", 1), { ...chat("b", 1), messages: [{ role: "system", content: "x" }] } as unknown as StoredChat]);
  assert.match(parseBackup(JSON.stringify(bad)) as string, /bozuk/);
});

test("restore adds new chats and newer copies, never overwrites newer local ones", () => {
  const local = [chat("a", 10), chat("b", 10)];
  const incoming = [chat("a", 5), chat("b", 20), chat("c", 1)];
  assert.deepEqual(mergeChats(local, incoming).map((c) => c.id), ["b", "c"]);
});

test("search covers titles and messages, Turkish case rules", () => {
  const cs = [chat("Bütçe", 1), chat("x", 2, { messages: [{ role: "assistant", content: "İSTANBUL ili" }] })];
  assert.deepEqual(searchChats(cs, "bütÇe").map((c) => c.id), ["Bütçe"]);
  assert.deepEqual(searchChats(cs, "istanbul").map((c) => c.id), ["x"]);
  assert.equal(searchChats(cs, "  ").length, 2);
});

test("pinned first, then most recent; titles are trimmed", () => {
  assert.deepEqual(sortChats([chat("a", 1), chat("b", 3), chat("c", 2, { pinned: true })]).map((c) => c.id), ["c", "b", "a"]);
  assert.equal(titleFrom("  kısa\nsoru "), "kısa soru");
  assert.equal(titleFrom("x".repeat(100)).length, 58);
  assert.equal(titleFrom(""), "Yeni sohbet");
});
