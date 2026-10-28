// Renders a page in headless Chromium, for sites whose figures only appear after their scripts run (rates, tables
// loaded by XHR). Chromium never touches the network itself: every browser context it opens for us goes through the
// guard proxy below, which resolves names, refuses internal addresses (the same isPrivate rule as lib/web, checked
// on the address it connects to) and only opens ports 80/443. UDP (QUIC, WebRTC) is off, so nothing goes around it.
// In the deployment the browser runs in its own container ("browser" in deploy/compose.yml) on an internal network
// with no route out and no documents, keys or database next to it; this proxy in the app is its only way out.
// No "server-only": the test drives the proxy.
import { tmpdir } from "node:os";
import http from "node:http";
import net from "node:net";
import { guardedLookup, htmlToText, isPrivate, onSite, readPage, WebError, type Page } from "./web.ts";
import { logError } from "./log.ts";

const RENDER_TIMEOUT_MS = 20_000;
/** After the page loaded: how long its scripts get to fetch their data. */
const SETTLE_MS = 6_000;
const MAX_HTML = 4 * 1024 * 1024;
const MAX_CHARS = 30_000;

export interface Proxy { port: number; close: () => Promise<void> }

/** A tunnel or request through the proxy lives at most this long (a render takes far less), so nothing piles up. */
const CONN_MAX_MS = 60_000;

/**
 * HTTP proxy (CONNECT for https/wss, absolute-URI requests for http) that only reaches public addresses on ports
 * 80/443. No password: Chromium would also answer a website's own 401 challenge with it, handing it out. It is
 * protected by where it listens instead: loopback here, or in the deployment only the address facing the browser
 * container on the internal network (startSession). allowPrivate is for the test only.
 */
export function startProxy(opts: { allowPrivate?: boolean; host?: string; port?: number } = {}): Promise<Proxy> {
  const allowed = (port: number) => opts.allowPrivate || port === 80 || port === 443;
  const literalOk = (host: string) => opts.allowPrivate || !net.isIP(host) || !isPrivate(host);
  const lookup = guardedLookup(!!opts.allowPrivate) as never;

  const server = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      return void res.writeHead(400).end();
    }
    const port = Number(url.port || 80);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "http:" || !allowed(port) || !literalOk(host)) return void res.writeHead(403).end();
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const up = http.request({ host, port, path: url.pathname + url.search, method: req.method, headers, lookup, timeout: CONN_MAX_MS }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    const end = () => up.destroy();
    const cap = setTimeout(() => (up.destroy(), res.destroy()), CONN_MAX_MS);
    // The browser gave up (context closed, page done): drop the upstream side too.
    res.on("close", () => (clearTimeout(cap), end()));
    up.on("timeout", end);
    up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    req.pipe(up);
  });
  server.on("connect", (req, sock: net.Socket, head: Buffer) => {
    sock.on("error", () => {});
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? "");
    const host = m?.[1] ?? "";
    const port = Number(m?.[2]);
    if (!m || !allowed(port) || !literalOk(host)) return void sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    const up = net.connect({ host, port, lookup });
    const cap = setTimeout(() => (up.destroy(), sock.destroy()), CONN_MAX_MS);
    up.on("connect", () => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on("error", () => sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    up.on("close", () => (clearTimeout(cap), sock.destroy()));
    sock.on("close", () => (clearTimeout(cap), up.destroy()));
  });
  // Plain ws:// through a proxy arrives as an upgrade: refused (wss:// goes through CONNECT like https).
  server.on("upgrade", (_req, sock: net.Socket) => sock.destroy());
  // A flood of tunnels from one page can't exhaust the process.
  server.maxConnections = 256;
  return new Promise((resolve, reject) => {
    server.once("error", reject); // EADDRINUSE and the like: the caller falls back to the direct read
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      server.on("error", () => {});
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/**
 * This container's own address on the network it shares with `peer` (the browser container): the proxy listens
 * there and nowhere else, so services on the app's other networks can't use it.
 */
export async function addressFacing(peer: string): Promise<string> {
  const { lookup } = await import("node:dns/promises");
  const { networkInterfaces } = await import("node:os");
  const ip = (await lookup(peer, { family: 4 })).address;
  const n = (a: string) => a.split(".").reduce((v, x) => v * 256 + Number(x), 0);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || !a.cidr) continue;
      const bits = Number(a.cidr.split("/")[1]);
      const size = 2 ** (32 - bits);
      if (Math.floor(n(a.address) / size) === Math.floor(n(ip) / size)) return a.address;
    }
  }
  throw new Error("no_shared_network");
}

type Browser = import("playwright-core").Browser;
type ProxySettings = { server: string; bypass: string };
interface Session { browser: Browser; proxy: ProxySettings }
let session: Promise<Session | null> | undefined;
let containerProxy: Promise<Proxy> | undefined;
/** A browser that didn't start isn't retried on every page: once per RETRY_MS. */
let failedAt = 0;
const RETRY_MS = 5 * 60_000;

// Chromium flags that keep traffic on the proxy (no QUIC, no non-proxied WebRTC, no DNS-over-HTTPS) and quiet.
export const CHROMIUM_ARGS = [
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disable-features=DnsOverHttps,MediaRouter,DialMediaRouteProvider",
  "--disable-background-networking",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
];

/**
 * WEB_BROWSER: a ws:// address of the browser container (deployment), a Chromium path, or "chrome"/"msedge" for an
 * installed browser (development). Unset: /usr/bin/chromium on Linux if present. "off" or nothing found: pages are
 * read without running their scripts.
 */
async function start(): Promise<Session | null> {
  const v = process.env.WEB_BROWSER?.trim() ?? "";
  if (v === "off") return null;
  const { chromium } = await import("playwright-core");
  if (/^wss?:\/\//i.test(v)) {
    // The browser container: it reaches this proxy at WEB_PROXY_URL (the app's name on the internal network).
    const at = process.env.WEB_PROXY_URL;
    if (!at) throw new Error("WEB_PROXY_URL tanımlı değil");
    const u = new URL(at);
    // One listener for the process (a reconnect reuses it; closing and reopening the port could race), on the
    // address facing the browser container only.
    containerProxy ??= addressFacing(new URL(v).hostname)
      .then((host) => startProxy({ host, port: Number(u.port) || 3101 }))
      .catch((e) => {
        containerProxy = undefined;
        throw e;
      });
    await containerProxy;
    const browser = await chromium.connect(v, { timeout: 15_000 });
    return { browser, proxy: { server: u.origin, bypass: "<-loopback>" } };
  }
  const exe = v === "chrome" || v === "msedge" ? { channel: v } : { executablePath: v || "/usr/bin/chromium" };
  if (!v && process.platform !== "linux") return null;
  const { existsSync } = await import("node:fs");
  if (exe.executablePath && !existsSync(exe.executablePath)) return null;
  const proxy = await startProxy();
  try {
    const browser = await launchLocal(exe, chromium);
    browser.on("disconnected", () => void proxy.close());
    return { browser, proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: "<-loopback>" } };
  } catch (e) {
    await proxy.close(); // no browser, no listener left behind for the next attempt to pile onto
    throw e;
  }
}

async function launchLocal(exe: { channel?: string; executablePath?: string }, chromium: typeof import("playwright-core").chromium): Promise<Browser> {
  // Chromium's own sandbox where it can start; a container without user namespaces can't, then it runs without
  // (still behind the proxy) and the log says so once. WEB_BROWSER_SANDBOX=true: sandbox or nothing; false: off.
  const launch = (chromiumSandbox: boolean) =>
    // HOME: Chromium writes its profile dirs there, and the app user's home may be read-only.
    chromium.launch({ ...exe, headless: true, args: CHROMIUM_ARGS, chromiumSandbox, env: { ...process.env, HOME: tmpdir() } });
  let browser: Browser;
  try {
    browser = await launch(process.env.WEB_BROWSER_SANDBOX !== "false");
  } catch (e) {
    if (process.env.WEB_BROWSER_SANDBOX === "true" || process.env.WEB_BROWSER_SANDBOX === "false") throw e;
    logError("render", new Error("chromium_no_sandbox"));
    browser = await launch(false);
  }
  return browser;
}

/** One browser for the process, started on first use; a crash or lost connection starts a new one on the next page. */
function getSession(): Promise<Session | null> {
  if (!session && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null);
  session ??= start().then(
    (s) => {
      s?.browser.on("disconnected", () => (session = undefined));
      if (!s) failedAt = Date.now();
      return s;
    },
    (e) => {
      session = undefined;
      failedAt = Date.now();
      logError("render", e);
      return null;
    },
  );
  return session;
}

/**
 * The page as a browser shows it after its scripts ran. Images, media and fonts aren't loaded (text only);
 * downloads, service workers and permissions are off; the context is thrown away after one page. With `site`,
 * the page must still be on that site after its redirects.
 */
export async function render(raw: string, signal: AbortSignal, opts: { site?: string } = {}): Promise<Page> {
  const s = await getSession();
  if (!s) throw new WebError("no_browser");
  // Every context gets the proxy: there is no context without it (and in the container no other way out at all).
  const ctx = await s.browser.newContext({
    proxy: s.proxy, acceptDownloads: false, serviceWorkers: "block", locale: "tr-TR", timezoneId: "Europe/Istanbul", javaScriptEnabled: true,
  });
  const stop = () => void ctx.close().catch(() => {});
  signal.addEventListener("abort", stop, { once: true });
  // A page whose scripts never yield would hang every later call into it: the whole render has a hard limit.
  const timer = setTimeout(stop, RENDER_TIMEOUT_MS + SETTLE_MS + 5_000);
  try {
    await ctx.route("**/*", (r) => {
      const q = r.request();
      if (["image", "media", "font"].includes(q.resourceType())) return r.abort();
      // A followed link must stay on its site: a top-level navigation (redirect hops included) elsewhere is
      // stopped before it's sent. Subresources from other hosts (CDNs, APIs) load as the page needs them.
      if (opts.site && q.isNavigationRequest() && q.frame().parentFrame() === null && !onSite(new URL(q.url()).hostname, opts.site)) return r.abort();
      return r.continue();
    });
    const page = await ctx.newPage();
    page.on("dialog", (d) => void d.dismiss().catch(() => {}));
    // Redirect hops skip the route handler: any top-level hop off the site marks the page as unusable. (Sending
    // that request itself gives a page nothing it couldn't do with an <img>; using the content would.)
    let strayed = false;
    if (opts.site) {
      const site = opts.site;
      page.on("request", (q) => {
        if (q.isNavigationRequest() && q.frame() === page.mainFrame() && !onSite(new URL(q.url()).hostname, site)) strayed = true;
      });
    }
    const res = await page.goto(raw, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    if (res && !res.ok()) throw new WebError(`http_${res.status()}`);
    await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {});
    const url = new URL(page.url());
    if (strayed || (opts.site && !onSite(url.hostname, opts.site))) throw new WebError("offsite");
    // Cut inside the browser: a page can build a DOM far bigger than anything worth sending over.
    const html = await page.evaluate((max) => `<title>${document.title.replace(/</g, "")}</title>` + document.documentElement.outerHTML.slice(0, max), MAX_HTML);
    // Again after reading: a navigation can commit while the DOM was being read.
    if (strayed || page.url() !== url.href) throw new WebError(strayed ? "offsite" : "navigated");
    const { title, text, links } = htmlToText(html, url);
    return { url: url.href, title: title.slice(0, 200), text: text.slice(0, MAX_CHARS), links, html: true };
  } catch (e) {
    if (signal.aborted) throw signal.reason ?? e;
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    stop();
  }
}

/**
 * A page for the model: read directly first (type, size and address checks, data files as they are), then, when
 * it's HTML and a browser is available, rendered with its scripts. Rendering failing keeps the direct read.
 */
export async function readWeb(raw: string, signal: AbortSignal, opts: { site?: string } = {}): Promise<Page> {
  const p = await readPage(raw, signal, opts);
  if (!p.html) return p;
  try {
    const r = await render(p.url, signal, opts);
    return r.text ? r : p;
  } catch (e) {
    if (signal.aborted) throw e;
    if (!(e instanceof WebError && e.message === "no_browser")) logError("render", e);
    return p;
  }
}
