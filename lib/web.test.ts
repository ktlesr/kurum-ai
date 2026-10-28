// Run: pnpm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { findUrls, htmlToText, isPrivate, readPage, WebError } from "./web.ts";

test("findUrls: http(s) only, trailing punctuation dropped, deduped, at most 3", () => {
  assert.deepEqual(findUrls("Bkz. https://a.gov.tr/x?y=1, ve (http://b.org/p). ftp://c"), ["https://a.gov.tr/x?y=1", "http://b.org/p"]);
  assert.equal(findUrls("https://a.tr https://b.tr https://c.tr https://d.tr https://a.tr").length, 3);
  assert.deepEqual(findUrls("(http://[::1]) ve [https://a.tr/x] ve https://%"), ["http://[::1]", "https://a.tr/x"]);
});

test("isPrivate: internal ranges refused, public allowed", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.ok(isPrivate(ip), ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "151.101.1.1", "2606:4700::1111"]) assert.ok(!isPrivate(ip), ip);
});

test("htmlToText: scripts and styles out, blocks become lines, entities decoded", () => {
  const { title, text } = htmlToText("<html><head><title>Kur &amp; Faiz</title><style>p{}</style></head><body><script>alert(1)</script><h1>Başlık</h1><p>Oran %50&nbsp;arttı</p><table><tr><td>A</td><td>1</td></tr></table></body></html>");
  assert.equal(title, "Kur & Faiz");
  assert.ok(!text.includes("alert") && !text.includes("p{}"));
  assert.match(text, /Başlık\n/);
  assert.match(text, /Oran %50 arttı/);
  assert.match(text, /A \| 1 \|/);
});

const server = createServer((req, res) => {
  if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>T</title><p>merhaba</p>");
  if (req.url === "/go") return res.writeHead(302, { location: "/page" }).end();
  if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
  if (req.url === "/bin") return res.writeHead(200, { "content-type": "application/octet-stream" }).end("x");
  if (req.url === "/big") return res.writeHead(200, { "content-type": "text/plain" }).end("a".repeat(3 * 1024 * 1024));
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());
const signal = new AbortController().signal;
const reason = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof WebError ? e.message : "other"));

test("readPage: internal addresses refused by default (literal and by name)", async () => {
  assert.equal(await reason(readPage(`${base}/page`, signal)), "port"); // non-80/443 port first
  assert.equal(await reason(readPage("http://127.0.0.1/page", signal)), "private");
  assert.equal(await reason(readPage("http://localhost/page", signal)), "private");
  assert.equal(await reason(readPage("file:///etc/passwd", signal)), "scheme");
  assert.equal(await reason(readPage("http://u:p@example.com/", signal)), "credentials");
});

test("readPage: page text, redirects followed and capped, wrong type and size refused", async () => {
  const o = { allowPrivate: true };
  assert.deepEqual(await readPage(`${base}/page`, signal, o), { url: `${base}/page`, title: "T", text: "merhaba" });
  assert.equal((await readPage(`${base}/go`, signal, o)).text, "merhaba");
  assert.equal(await reason(readPage(`${base}/loop`, signal, o)), "redirects");
  assert.equal(await reason(readPage(`${base}/bin`, signal, o)), "type");
  assert.equal(await reason(readPage(`${base}/big`, signal, o)), "too_large");
  assert.equal(await reason(readPage(`${base}/nope`, signal, o)), "http_404");
});

test("isPrivate/readPage: every way of writing an internal address is refused", async () => {
  for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:0:4136:e378::1", "2001:db8::1", "fc00::1", "ff02::1"]) assert.ok(isPrivate(ip), ip);
  for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/", "http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "http://[::1]/"]) {
    assert.equal(await reason(readPage(u, signal)), "private", u);
  }
});

test("htmlToText stays linear on broken HTML (no regex backtracking)", () => {
  for (const evil of ["<".repeat(2_000_000), "<script".repeat(300_000), "<!--".repeat(500_000), "<a ".repeat(600_000) + ">x"]) {
    const t = performance.now();
    htmlToText(evil);
    assert.ok(performance.now() - t < 1500, `${evil.slice(0, 8)}… took ${Math.round(performance.now() - t)} ms`);
  }
});
