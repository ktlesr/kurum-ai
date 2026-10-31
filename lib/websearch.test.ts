// Run: pnpm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSearchQuery, saysNotInDoc, searchWeb } from "./websearch.ts";

let asked = "";
const server = createServer((req, res) => {
  asked = req.url ?? "";
  if (asked.includes("bozuk")) return void res.writeHead(500).end();
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ results: [
    { url: "https://a.gov.tr/x", title: "A", content: "özet" },
    { url: "https://a.gov.tr/x", title: "Aynı", content: "" },
    { url: "javascript:alert(1)", title: "Kötü" },
    { url: "http://b.tr", title: 5 },
    ...["c", "d", "e", "f", "g"].map((h) => ({ url: `https://${h}.tr`, title: h })),
  ] }));
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("searchWeb: http(s) only, no repeats, at most 5, the query goes as asked", async () => {
  const r = await searchWeb(base, "493 üncü madde", AbortSignal.timeout(5000));
  assert.deepEqual(r.map((x) => x.url), ["https://a.gov.tr/x", "http://b.tr", "https://c.tr", "https://d.tr", "https://e.tr"]);
  assert.equal(r[1].title, "");
  assert.equal(new URL(asked, base).searchParams.get("q"), "493 üncü madde");
  assert.equal(new URL(asked, base).searchParams.get("format"), "json");
});

test("searchWeb: a failing search is an error, for the caller to answer without it", async () => {
  await assert.rejects(searchWeb(base, "bozuk", AbortSignal.timeout(5000)));
});

test("parseSearchQuery: one line; YOK or a sentence-long reply is no query", () => {
  assert.equal(parseSearchQuery('"dolar kuru bugün".\nAçıklama'), "dolar kuru bugün");
  assert.equal(parseSearchQuery("YOK"), null);
  assert.equal(parseSearchQuery("yok."), null);
  assert.equal(parseSearchQuery(""), null);
  assert.equal(parseSearchQuery("x".repeat(151)), null);
});

test("saysNotInDoc: the opening says the document doesn't hold it", () => {
  assert.equal(saysNotInDoc("Belgede yok; genel bilgime göre: …"), true);
  assert.equal(saysNotInDoc("Paylaştığınız dokümanın içeriğine göre, 493. madde ile ilgili doğrudan bir kurum ismi belirtilmemiştir."), true);
  assert.equal(saysNotInDoc("Belgenin 4. sayfasına göre tutar 12 milyon TL'dir."), false);
  assert.equal(saysNotInDoc("Tutar 12 milyon TL'dir. " + "x".repeat(300) + " belgede yok"), false);
});
