// Run: pnpm test. Firewall refusal / bot challenge pages are recognised, not read as content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { htmlToText, isBlockPage, readPage, webReason } from "./web.ts";

test("isBlockPage: F5, Akamai, Cloudflare, Imperva, captcha walls", () => {
  const blocked = [
    ["Request Rejected", "The requested URL was rejected. Please consult with your administrator. Your support ID is: 7928100468483167273"],
    ["", "Request Rejected. Your support ID is: 123"],
    ["Access Denied", "You don't have permission to access \"http://x/\" on this server. Reference #18.6c2c1002.1730"],
    ["Attention Required! | Cloudflare", "Sorry, you have been blocked"],
    ["Just a moment...", "Checking if the site connection is secure"],
    ["", "Enable JavaScript and cookies to continue"],
    ["", "Request unsuccessful. Incapsula incident ID: 123-456"],
    ["Doğrulama", "Lütfen robot olmadığınızı doğrulayın. CAPTCHA"],
  ];
  for (const [t, x] of blocked) assert.ok(isBlockPage(t, x), `${t} / ${x}`);
});

test("isBlockPage: real pages that mention the words are not refusals", () => {
  assert.ok(!isBlockPage("Tebliğ", "Bu tebliğ ... Erişim reddedildi ifadesi geçen başka bir metin."));
  assert.ok(!isBlockPage("Güvenlik", "Access denied hataları hakkında bir makale. " + "Uzun içerik. ".repeat(400)));
  assert.ok(!isBlockPage("CAPTCHA nedir", "CAPTCHA, kullanıcı doğrulama yöntemidir. " + "Ayrıntı. ".repeat(500)));
});

const srv = createServer((req, res) => {
  if (req.url === "/f5") return void res.end("<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Your support ID is: 42</body></html>");
  if (req.url === "/cf") return void res.writeHead(403, { "content-type": "text/html" }).end("<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>");
  if (req.url === "/txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("The requested URL was rejected. Your support ID is: 42");
  if (req.url === "/gone") return void res.writeHead(404, { "content-type": "text/html" }).end("<title>404</title>yok");
  res.writeHead(200, { "content-type": "text/html" }).end("<title>Tebliğ</title><p>Madde 1 - Amaç</p>");
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => new Promise((r) => srv.close(r)));

test("readPage: a refusal page (200 or 403) is 'blocked', other errors keep their status", async () => {
  const signal = new AbortController().signal;
  for (const p of ["/f5", "/cf", "/txt"]) {
    await assert.rejects(readPage(`${base}${p}`, signal, { allowPrivate: true }), (e: Error) => e.message === "blocked" && /engelliyor/.test(webReason(e)), p);
  }
  await assert.rejects(readPage(`${base}/gone`, signal, { allowPrivate: true }), (e: Error) => e.message === "http_404");
  const ok = await readPage(`${base}/teblig`, signal, { allowPrivate: true });
  assert.match(ok.text, /Madde 1/);
});

test("htmlToText reads a page saved from the browser (upload path)", () => {
  const { title, text } = htmlToText("<html><head><title>Kurul Tebliği</title><script>alert(1)</script></head><body><h1>Madde 1</h1><p>Amaç ve kapsam</p></body></html>");
  assert.equal(title, "Kurul Tebliği");
  assert.match(text, /Madde 1/);
  assert.ok(!text.includes("alert"));
});
