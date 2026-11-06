// The support workbook's gold set asked through the real app (prompt §7): does the model's plan give the right table?
// Each question goes to /api/chat as a user would ask it; the tables in the answer (meta.destek) are compared cell by
// cell with the independent computation from the same workbook (tests/destek-independent), formatted independently.
// Also counted: answers with no table (the model didn't use the tool), held-back comments, end-to-end seconds.
// Nothing is written to disk: the workbook's numbers stay on this machine and the server.
//
//   KAI_URL=https://ai.zafer.gov.tr KAI_USER=… KAI_PASS=… node scripts/eval-destek.ts "<workbook.xlsx>" [--only sogep-]
//
// The workbook given must be the version that is active on the server (the admin page shows which).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "playwright-core";
import { parseWorkbook } from "../lib/destek/load.ts";
import { DIMS, METRICS, type Dim } from "../lib/destek/semantic.ts";
import { dec, expectAggregate, expectTable } from "../tests/destek-independent.ts";
import { AGG } from "../tests/destek-gold-set.ts";

const file = process.argv[2];
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const { KAI_URL, KAI_USER, KAI_PASS } = process.env;
if (!file || !KAI_URL || !KAI_USER || !KAI_PASS) {
  console.error('Kullanım: KAI_URL=… KAI_USER=… KAI_PASS=… node scripts/eval-destek.ts "<dosya.xlsx>" [--only önek]');
  process.exit(1);
}
const base = new URL(KAI_URL).origin;
const parsed = await parseWorkbook(readFileSync(file), basename(file));
const rows = parsed.families.flatMap((f) => f.rows);

const browser = await chromium.launch({ channel: process.env.KAI_BROWSER ?? "msedge", headless: true }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
const ctx = await browser.newContext();
// Only the app's own origin: nothing else gets the session.
await ctx.route("**/*", (r) => (new URL(r.request().url()).origin === base ? r.continue() : r.abort()));
const page = await ctx.newPage();
try {
  await page.goto(`${base}/login`);
  await page.$eval('input[name="username"]', (el, v) => ((el as HTMLInputElement).value = v), KAI_USER);
  await page.$eval('input[name="password"]', (el, v) => ((el as HTMLInputElement).value = v), KAI_PASS);
  await Promise.all([page.waitForURL(`${base}/`, { timeout: 30_000 }), page.click('button[type="submit"]')]);
} catch {
  console.error("Giriş yapılamadı (adres, kullanıcı adı ya da parola).");
  await browser.close();
  process.exit(1);
}
const api = ctx.request;
const model = ((await (await api.get(`${base}/api/models`)).json()) as { defaultModel: string }).defaultModel;

type Table = { columns: { label: string }[]; rows: string[][]; total?: string[] };
const kindOf = (m: string) => (METRICS[m].kind === "ratio" ? "ratio" : METRICS[m].kind === "amount" ? "amount" : "count") as "ratio" | "amount" | "count";

/** Every expected cell is in one of the answer's tables, under the metric's label, on the group's row. */
function matches(t: Table, q: (typeof AGG)[number]): string | null {
  const col = (label: string) => t.columns.findIndex((c) => c.label === label);
  const mcols = q.metrics.map((m) => ({ m, at: col(METRICS[m].label) }));
  const missing = mcols.filter((x) => x.at < 0).map((x) => METRICS[x.m].label);
  if (missing.length) return `kolon yok: ${missing.join(", ")}`;
  const metrics = q.metrics.map((name) => ({ name, kind: kindOf(name) }));
  if (!q.group.length) {
    const want = expectTable(rows, q.keep, "aile", metrics).get("__total")!.slice(1);
    const got = mcols.map((x) => t.rows[0]?.[x.at]);
    return want.every((w, i) => w === got[i]) ? null : `beklenen ${want.join(" / ")}, gelen ${got.join(" / ")}`;
  }
  const g = q.group[0];
  const gAt = col(DIMS[g as Dim].label);
  if (gAt < 0) return `gruplama kolonu yok: ${DIMS[g as Dim].label}`;
  const want = expectTable(rows, q.keep, g, metrics);
  for (const [k, cells] of want) {
    const row = k === "__total" ? t.total : t.rows.find((r) => r[gAt] === k);
    if (k === "__total" && !row) continue; // a total row is welcome, not required
    if (!row) return `satır yok: ${k}`;
    for (const [i, x] of mcols.entries()) if (row[x.at] !== cells[i + 1]) return `${k} / ${METRICS[x.m].label}: beklenen ${cells[i + 1]}, gelen ${row[x.at]}`;
  }
  // A question that asks for an order ("en düşük oranlı il") is right only in that order: its first metric, then the group.
  const order = (q.plan.order_by as { field: string; dir?: string }[] | undefined)?.[0];
  if (order) {
    const m = q.metrics.find((x) => x === order.field || x.startsWith(`${order.field}_`)) ?? q.metrics[0];
    const vals = [...expectAggregate(rows, q.keep, q.group, [m])].filter(([k]) => k !== "__total");
    const num = (v: string) => (v === "null" ? null : dec(v));
    const wantOrder = vals.sort(([ka, a], [kb, b]) => {
      const x = num(a[m]), y = num(b[m]);
      if (x === null || y === null) return x === y ? ka.localeCompare(kb) : x === null ? 1 : -1;
      const c = x === y ? 0 : x < y ? -1 : 1;
      return (order.dir === "asc" ? c : -c) || ka.localeCompare(kb);
    }).map(([k]) => k);
    const gotOrder = t.rows.map((r) => r[gAt]);
    if (wantOrder.slice(0, gotOrder.length).join("|") !== gotOrder.join("|")) return `sıra yanlış: beklenen ${wantOrder.join(", ")}, gelen ${gotOrder.join(", ")}`;
  }
  return null;
}

const results: { id: string; ok: boolean; why: string; secs: number; hidden: boolean }[] = [];
for (const q of AGG.filter((x) => !only || x.id.startsWith(only))) {
  const t0 = Date.now();
  const r = await api.post(`${base}/api/chat`, { headers: { Origin: base, "Content-Type": "application/json" }, data: { model, fileIds: [], messages: [{ role: "user", content: q.soru }] }, timeout: 10 * 60_000 });
  const raw = await r.text();
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  let meta: { destek?: Table[]; destekHidden?: boolean } = {};
  try {
    meta = JSON.parse(raw.replace(/\u001d[^\u001d]*\u001d/g, "").split("\u001e").slice(1).join("\u001e").trim() || "{}");
  } catch {
    /* no meta: counted below as no table */
  }
  const tables = r.ok() ? meta.destek ?? [] : [];
  const whys = tables.map((t) => matches(t, q));
  const ok = whys.some((w) => w === null);
  const why = !r.ok() ? `HTTP ${r.status()}` : !tables.length ? "tablo yok (araç kullanılmadı)" : ok ? "" : whys.join(" | ");
  results.push({ id: q.id, ok, why, secs, hidden: !!meta.destekHidden });
  console.log(`${ok ? "DOĞRU " : "YANLIŞ"} ${q.id.padEnd(20)} ${String(secs).padStart(5)} sn${meta.destekHidden ? " (yorum gizlendi)" : ""}${why ? `  ${why}` : ""}`);
}
await browser.close();
const n = results.length;
const s = results.map((x) => x.secs).sort((a, b) => a - b);
const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
console.log(`\nPlan doğruluğu: ${results.filter((x) => x.ok).length}/${n} · tablosuz cevap: ${results.filter((x) => x.why.startsWith("tablo yok")).length} · gizlenen yorum: ${results.filter((x) => x.hidden).length} · uçtan uca p50 ${p(0.5)} sn, p95 ${p(0.95)} sn`);
process.exitCode = results.every((x) => x.ok) ? 0 : 1;
