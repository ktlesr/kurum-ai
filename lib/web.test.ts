// Run: pnpm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { findUrls, htmlToText, isPrivate, onSite, parsePick, readPage, WebError } from "./web.ts";

test("findUrls: http(s) only, trailing punctuation dropped, deduped, at most 3", () => {
  assert.deepEqual(findUrls("Bkz. https://a.gov.tr/x?y=1, ve (http://b.org/p). ftp://c"), ["https://a.gov.tr/x?y=1", "http://b.org/p"]);
  assert.equal(findUrls("https://a.tr https://b.tr https://c.tr https://d.tr https://a.tr").length, 3);
  assert.deepEqual(findUrls("(http://[::1]) ve [https://a.tr/x] ve https://%"), ["http://[::1]", "https://a.tr/x"]);
});

test("findUrls: bare addresses with a known ending read as https, file names and e-mails aren't", () => {
  assert.deepEqual(findUrls("tcmb.gov.tr de dolar kurunu alır mısın"), ["https://tcmb.gov.tr"]);
  assert.deepEqual(findUrls("Bkz. www.hmb.gov.tr/duyurular?y=2026, ve (Örnek.com.tr'de)."), ["https://www.hmb.gov.tr/duyurular?y=2026", "https://Örnek.com.tr"]);
  assert.deepEqual(findUrls("rapor.pdf, veri.xlsx, a.b.c, 3.14, ad@kurum.gov.tr, dosya.com.pdf"), []);
  assert.deepEqual(findUrls("https://a.tr/?u=b.com ve c.org"), ["https://a.tr/?u=b.com", "https://c.org"]);
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

test("htmlToText with a base: page links with their text, resolved, no fragments or scripts", () => {
  const { links } = htmlToText(`<a href="/kurlar">Döviz <b>Kurları</b></a> <a href='https://x.tr/a#b'>Dış</a> <a href=javascript:1>J</a> <a href="#top">Üst</a> <a href="mailto:a@b">M</a> <a href="/bos"></a> <a href="/kurlar">Tekrar</a>`, new URL("https://www.tcmb.gov.tr/"));
  assert.deepEqual(links, [{ url: "https://www.tcmb.gov.tr/kurlar", text: "Döviz Kurları" }, { url: "https://x.tr/a", text: "Dış" }]);
  assert.deepEqual(htmlToText("<a href=/x>y</a>").links, []);
  // Stream separators (\x1d–\x1f) never come out of a page, written raw or as entities.
  const ctl = htmlToText(`<a href="/x">&#31;sahte&#29;</a><p>a\u001eb&#30;c</p>`, new URL("https://a.tr/"));
  assert.ok(!/[\u0000-\u0008\u000b-\u001f]/.test(ctl.text + ctl.links[0].text), JSON.stringify(ctl));
  assert.deepEqual(htmlToText(`<A HREF="/Cevap">Cevap</A>`, new URL("https://a.tr/")).links, [{ url: "https://a.tr/Cevap", text: "Cevap" }]);
  // "İ" lowercases to two characters: positions after it must still line up.
  const tr = htmlToText(`<p>${"İSTATİSTİK ".repeat(50)}</p><script>gizli()</script><a href="/k">Kurlar</a>`, new URL("https://a.tr/"));
  assert.deepEqual(tr.links, [{ url: "https://a.tr/k", text: "Kurlar" }]);
  assert.ok(!tr.text.includes("gizli"));
});

test("onSite: the site and its subdomains only, never siblings or parents", () => {
  assert.ok(onSite("www.tcmb.gov.tr", "tcmb.gov.tr"));
  assert.ok(onSite("evds3.tcmb.gov.tr", "tcmb.gov.tr"));
  assert.ok(onSite("a.foo.com", "foo.com"));
  assert.ok(!onSite("hmb.gov.tr", "tcmb.gov.tr"));
  assert.ok(!onSite("eviltcmb.gov.tr", "tcmb.gov.tr"));
  assert.ok(!onSite("bob.github.io", "alice.github.io"));
  assert.ok(!onSite("github.io", "alice.github.io"));
});

test("htmlToText: the named entities Turkish pages use are decoded", () => {
  assert.equal(htmlToText("<title>Saat 11.00&rsquo;de &Ouml;deme &amp; &uuml;&ccedil;</title>").title, "Saat 11.00’de Ödeme & üç");
});

test("parsePick: one or two valid numbers only; anything else follows nothing", () => {
  assert.deepEqual(parsePick("3", 5), [2]);
  assert.deepEqual(parsePick(" 3, 5.", 5), [2, 4]);
  assert.deepEqual(parsePick("2,2", 5), [1]);
  for (const a of ["VAR", "YOK", "YOK — 1", "VAR, kaynak 2", "1,2,3", "9", "0", "1 numaralı bağlantı", ""]) assert.deepEqual(parsePick(a, 5), [], a);
});

const server = createServer((req, res) => {
  if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>T</title><p>merhaba</p>");
  if (req.url === "/go") return res.writeHead(302, { location: "/page" }).end();
  if (req.url === "/away") return res.writeHead(302, { location: "http://localhost:1/x" }).end();
  if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
  if (req.url === "/xml") return res.writeHead(200, { "content-type": "application/xml" }).end("<Kur>\n    <USD>49.69</USD>\n</Kur>");
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
  assert.deepEqual(await readPage(`${base}/page`, signal, o), { url: `${base}/page`, title: "T", text: "merhaba", links: [], html: true });
  assert.equal((await readPage(`${base}/xml`, signal, o)).text, "<Kur>\n<USD>49.69</USD>\n</Kur>");
  assert.equal((await readPage(`${base}/go`, signal, o)).text, "merhaba");
  assert.equal(await reason(readPage(`${base}/loop`, signal, o)), "redirects");
  // A followed link stays on its site, redirects included.
  assert.equal((await readPage(`${base}/go`, signal, { ...o, site: "127.0.0.1" })).text, "merhaba");
  assert.equal(await reason(readPage(`${base}/away`, signal, { ...o, site: "127.0.0.1" })), "offsite");
  assert.equal(await reason(readPage(`${base}/page`, signal, { ...o, site: "a.tr" })), "offsite");
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
  for (const evil of ["<".repeat(2_000_000), "<script".repeat(300_000), "<!--".repeat(500_000), "<a ".repeat(600_000) + ">x", '<a href="/x">y</a>'.repeat(200_000), "<a href=/x>" + "y".repeat(1_000_000) + "</a>".repeat(200_000)]) {
    const t = performance.now();
    htmlToText(evil, new URL("https://a.tr/"));
    assert.ok(performance.now() - t < 1500, `${evil.slice(0, 8)}… took ${Math.round(performance.now() - t)} ms`);
  }
});

test("readPage: a PDF comes back as the file, by type or by its first bytes", async () => {
  const pdf = Buffer.from("%PDF-1.7 belge");
  const srv = createServer((req, res) => {
    res.setHeader("content-type", req.url === "/a" ? "application/pdf" : "application/octet-stream");
    res.end(pdf);
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const at = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    for (const p of ["/a", "/b"]) assert.deepEqual((await readPage(at + p, AbortSignal.timeout(5000), { allowPrivate: true })).pdf, pdf);
  } finally {
    srv.close();
  }
});
