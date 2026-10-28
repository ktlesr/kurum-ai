// Run: pnpm test. The guard proxy every rendered page's traffic goes through (no browser needed here).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { startProxy } from "./browser.ts";

// "/hang" never answers: the proxy must drop it once the browser side is gone.
let hangClosed = false;
const target = createServer((req, res) => {
  if (req.url === "/hang") return void req.socket.on("close", () => (hangClosed = true));
  res.end("iç");
});
await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
const tport = (target.address() as AddressInfo).port;
const strict = await startProxy();
const loose = await startProxy({ allowPrivate: true });
after(() => Promise.all([strict.close(), loose.close(), new Promise((r) => target.close(r))]));

/** First response line for a raw request sent to the proxy. */
const ask = (port: number, raw: string) =>
  new Promise<string>((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(raw));
    let got = "";
    s.on("data", (d) => {
      got += d;
      if (got.includes("\r\n")) {
        resolve(got.split("\r\n")[0]);
        s.destroy();
      }
    });
    s.on("error", () => resolve("error"));
    s.on("close", () => resolve(got.split("\r\n")[0] || "closed"));
  });
const connect = (p: typeof strict, hostPort: string) => ask(p.port, `CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`);
const get = (p: typeof strict, url: string) => ask(p.port, `GET ${url} HTTP/1.1\r\nHost: ${new URL(url).host}\r\nConnection: close\r\n\r\n`);

test("proxy: internal addresses refused, literal or by name, https and http", async () => {
  for (const hp of ["127.0.0.1:443", "[::1]:443", "169.254.169.254:443", "10.0.0.1:443", "[::ffff:127.0.0.1]:443"]) assert.match(await connect(strict, hp), / 403 /, hp);
  assert.match(await connect(strict, "localhost:443"), / 502 /); // the name resolves to loopback: lookup refuses
  for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"]) assert.match(await get(strict, u), / 403 /, u);
  assert.match(await get(strict, "http://localhost/"), / 502 /);
});

test("proxy: only ports 80 and 443", async () => {
  assert.match(await connect(strict, "example.com:22"), / 403 /);
  assert.match(await get(strict, "http://example.com:8080/"), / 403 /);
  assert.match(await get(strict, "ftp://example.com/"), / 403 /);
});

test("proxy: passes traffic through when the target is allowed", async () => {
  assert.match(await get(loose, `http://127.0.0.1:${tport}/`), / 200 /);
  assert.match(await connect(loose, `127.0.0.1:${tport}`), / 200 /);
});

test("proxy: the upstream request is dropped when the browser side goes away", async () => {
  const s = net.connect(loose.port, "127.0.0.1", () => s.write(`GET http://127.0.0.1:${tport}/hang HTTP/1.1\r\nHost: x\r\n\r\n`));
  await new Promise((r) => setTimeout(r, 300));
  s.destroy();
  for (let i = 0; i < 20 && !hangClosed; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(hangClosed, "upstream socket still open");
});

test("proxy: a port already taken is an error the caller can catch", async () => {
  await assert.rejects(startProxy({ port: strict.port }));
});
