// Reads a web page the user put in their question (admin page → Ayarlar → Bağlantıdan okuma). Only GET to that
// address: no document text ever leaves. No "server-only": the test drives it against a local server.
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export const MAX_URLS = 3;
/** Page text that reaches the model, all pages together (the caller cuts further to fit the context). */
export const MAX_CHARS_TOTAL = 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 30_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/**
 * http(s) addresses in a message, in order, at most MAX_URLS: trailing punctuation isn't part of the address
 * (a "]" only when it doesn't close an IPv6 host), and what URL can't parse is left out.
 */
export function findUrls(text: string): string[] {
  const out: string[] = [];
  for (const [m] of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    let u = m.replace(/[),.;:!?]+$/, "");
    while (u.endsWith("]") && !/^https?:\/\/\[[^\]/]*\]$/i.test(u)) u = u.slice(0, -1).replace(/[),.;:!?]+$/, "");
    try {
      new URL(u);
    } catch {
      continue;
    }
    if (!out.includes(u)) out.push(u);
    if (out.length === MAX_URLS) break;
  }
  return out;
}

/**
 * Internal addresses: IPv4 loopback, private, link-local, CGNAT, benchmark, multicast, reserved. IPv6: only plain
 * global unicast (2000::/3) is public; everything else is refused, including every form that embeds an IPv4
 * address (mapped ::ffff:, compatible ::, NAT64 64:ff9b::, 6to4 2002::, Teredo 2001::), whatever way it's written.
 */
export function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(ip) !== 6) return true;
  const s = ip.toLowerCase();
  if (s.startsWith("::")) return true; // ::, ::1, ::ffff:…, ::a.b.c.d
  const first = parseInt(s.split(":")[0], 16);
  if (first < 0x2000 || first > 0x3fff) return true; // not global unicast (fc00::/7, fe80::/10, ff00::/8, 64:ff9b::…)
  if (first === 0x2002) return true; // 6to4
  const second = parseInt(s.split(":")[1] || "0", 16);
  return first === 0x2001 && (second === 0 || second === 0xdb8); // Teredo, documentation
}

export class WebError extends Error {}

/**
 * The address the connection actually uses is checked (lookup hook), not a separate DNS answer: a name that
 * resolves to a public address first and an internal one later (DNS rebinding) is still refused. allowPrivate is
 * for the test only.
 */
function guardedLookup(allowPrivate: boolean) {
  return (host: string, opts: object, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
    dnsLookup(host, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err, "");
      const list = addrs as { address: string; family: number }[];
      if (!allowPrivate && list.some((a) => isPrivate(a.address))) return cb(new WebError("private"), "");
      // Node asks for all addresses when autoSelectFamily is on, a single one otherwise.
      if ((opts as { all?: boolean }).all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}

function get(url: URL, signal: AbortSignal, allowPrivate: boolean): Promise<{ status: number; location?: string; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(url, {
      lookup: guardedLookup(allowPrivate) as never,
      signal,
      headers: { "user-agent": "KurumAI/1.0 (+page reader)", accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) return req.destroy(new WebError("too_large"));
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const SKIP = new Set(["script", "style", "noscript", "svg", "template", "iframe", "head", "title"]);
const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table", "ul", "ol", "header", "footer", "blockquote", "br"]);

const decode = (t: string) =>
  t.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });

/**
 * Readable text of an HTML page: scripts, styles, head and markup dropped, block ends kept as line breaks.
 * One forward pass with indexOf (no backtracking regex): linear in the page size even for broken HTML such as a
 * run of "<" without ">" (a regex there is quadratic and would stall the server).
 */
export function htmlToText(html: string): { title: string; text: string } {
  const lower = html.toLowerCase();
  const t0 = lower.indexOf("<title");
  const t1 = t0 < 0 ? -1 : lower.indexOf(">", t0);
  const t2 = t1 < 0 ? -1 : lower.indexOf("</title", t1);
  const title = t2 < 0 ? "" : decode(html.slice(t1 + 1, t2)).replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));
    if (lower.startsWith("<!--", lt)) {
      const end = lower.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break; // an unclosed tag runs to the end: nothing readable after it
    const name = /^<\/?\s*([a-z][a-z0-9]*)/.exec(lower.slice(lt, Math.min(gt + 1, lt + 40)))?.[1] ?? "";
    const closing = lower[lt + 1] === "/";
    if (!closing && SKIP.has(name)) {
      const end = lower.indexOf(`</${name}`, gt + 1);
      const endGt = end < 0 ? -1 : lower.indexOf(">", end);
      i = endGt < 0 ? html.length : endGt + 1;
      continue;
    }
    if (name === "td" || name === "th") out.push(closing ? " | " : "");
    else if (BLOCK.has(name) && (closing || name === "br")) out.push("\n");
    i = gt + 1;
  }
  const text = decode(out.join("")).replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { title, text };
}

export interface Page { url: string; title: string; text: string }

/**
 * GET one page: http(s) only, ports 80/443, no credentials in the address, never an internal address (redirects
 * re-checked), at most 2 MB and 15 s, HTML or plain text. Throws WebError with a short reason.
 */
export async function readPage(raw: string, signal: AbortSignal, opts: { allowPrivate?: boolean } = {}): Promise<Page> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebError("invalid");
  }
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebError("scheme");
    if (url.username || url.password) throw new WebError("credentials");
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (!opts.allowPrivate && port !== "80" && port !== "443") throw new WebError("port");
    // A literal address skips DNS (and the lookup hook): check it here.
    // URL normalises any way of writing an address (decimal, octal, hex IPv4; IPv6 forms) before this check.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!opts.allowPrivate && isIP(host) && isPrivate(host)) throw new WebError("private");
    const r = await get(url, timeout, !!opts.allowPrivate);
    if (r.status >= 300 && r.status < 400 && r.location) {
      if (hop >= MAX_REDIRECTS) throw new WebError("redirects");
      url = new URL(r.location, url);
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new WebError(`http_${r.status}`);
    const charset = /charset=([\w-]+)/i.exec(r.type)?.[1]?.toLowerCase();
    let body: string;
    try {
      body = new TextDecoder(charset === "windows-1254" || charset === "iso-8859-9" ? charset : "utf-8").decode(r.body);
    } catch {
      body = r.body.toString("utf8");
    }
    if (/text\/html|application\/xhtml/i.test(r.type) || /^\s*<(!doctype|html)/i.test(body)) {
      const { title, text } = htmlToText(body);
      return { url: url.href, title: title.slice(0, 200), text: text.slice(0, MAX_CHARS) };
    }
    if (/^text\//i.test(r.type) || !r.type) return { url: url.href, title: "", text: body.slice(0, MAX_CHARS) };
    throw new WebError("type");
  }
}

/** Turkish reason for the answer's note. */
export const webReason = (e: unknown) => {
  const m = e instanceof WebError ? e.message : (e as { name?: string })?.name === "TimeoutError" ? "timeout" : "network";
  const t: Record<string, string> = {
    invalid: "adres geçersiz", scheme: "yalnızca http/https", credentials: "adreste kullanıcı adı/parola var", port: "yalnızca 80/443 portları",
    private: "iç ağ adresi", redirects: "çok fazla yönlendirme", too_large: "sayfa çok büyük", type: "HTML ya da metin değil", timeout: "zaman aşımı",
  };
  return t[m] ?? (m.startsWith("http_") ? `sunucu ${m.slice(5)} döndürdü` : "bağlanılamadı");
};
