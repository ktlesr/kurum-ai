// Golden test set runner (plan §5.3): asks every question of a golden set through the real app and scores the answers.
// Documents go only to the app you point it at (the institution's server); the set, answers and the report stay in
// the golden folder, never in git.
//
//   KAI_URL=https://ai.ornek.com KAI_USER=degerlendirme KAI_PASS=… node scripts/eval-golden.mjs D:/20pdf [--only eko-] [--profile auto|deep]
//
// Folder layout: <dir>/*.pdf, <dir>/_golden/*.json (items: id, files, question, type, answer, mustContain, pages).
// Report: <dir>/_golden/report-<date>.md and .json. Uploaded documents stay in that user's list for the next run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dir = process.argv[2];
const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const { KAI_URL, KAI_USER, KAI_PASS } = process.env;
if (!dir || !KAI_URL || !KAI_USER || !KAI_PASS) {
  console.error("Kullanım: KAI_URL=… KAI_USER=… KAI_PASS=… node scripts/eval-golden.mjs <klasör> [--only önek] [--profile deep]");
  process.exit(1);
}
// Documents and their text must never land in the repo: refuse a folder inside it (symlinks resolved).
const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const real = fs.realpathSync(path.resolve(dir));
if (real === repo || real.startsWith(repo + path.sep)) {
  console.error("Klasör depo içinde olamaz: belgeler ve metinleri git'e girmemeli.");
  process.exit(1);
}
const base = new URL(KAI_URL).origin;
const goldenDir = path.join(dir, "_golden");
const items = fs
  .readdirSync(goldenDir)
  .filter((f) => /^[^_].*\.json$/.test(f) && !f.startsWith("report-"))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(goldenDir, f), "utf8")))
  .filter((q) => !arg("--only") || q.id.startsWith(arg("--only")));
console.log(`${items.length} soru`);

// ---- scoring helpers (same number reading as lib/checks normNum: Turkish first) --------------------------------
const normNum = (s) => {
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) return dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  if (/^-?[1-9]\d{0,2}([.,]\d{3})+$/.test(s) && (dot >= 0 || s.indexOf(",") !== comma)) return s.replace(/[.,]/g, "");
  return s.replace(",", ".");
};
const low = (s) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ");
const NUMBER = /-?\d+(?:[.,]\d+)*/g;
/** Lower case, every number in one notation ("1.250.000" and "1250000" alike), so text and numbers compare fairly. */
const canon = (s) => ` ${low(s).replace(NUMBER, (m) => String(parseFloat(normNum(m))))} `;
/**
 * A required token is in the answer. A bare number must be one of the answer's numbers (20 isn't found in 120, -5
 * isn't 5); a token with words must appear as a whole, numbers normalised ("30 milyon" isn't "30 m²").
 */
function has(answer, token) {
  if (/^\s*-?\d+(?:[.,]\d+)*\s*$/.test(token)) return new Set(canon(answer).match(/-?\d+(?:\.\d+)?/g) ?? []).has(canon(token).trim());
  const c = canon(answer);
  const t = canon(token).trim();
  // Not preceded by a sign or a decimal part either: "5 milyon" isn't inside "0.5 milyon" or "-5 milyon".
  return new RegExp(`(^|[^\\p{L}\\p{N}.\\-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(c);
}
/** "Not in the document" said up front (first two sentences), not as an aside after giving figures. */
const REFUSAL = /(bulunmuyor|bulunmamaktadır|yer almıyor|yer almamaktadır|belirtilmemiş|belirtilmiyor|bilgi yok|bilgisi yok|geçmiyor|içermiyor|bulunamadı|yer verilmemiş|rastlanmadı|mevcut değil|bilgi bulunmamaktadır)/;
const refuses = (answer) => REFUSAL.test(low(answer).split(/(?<=[.!?])\s/).slice(0, 2).join(" "));
const citedPages = (answer) => [...answer.matchAll(/\bSayfa\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi)].flatMap((m) => (m[2] ? Array.from({ length: Math.min(50, +m[2] - +m[1] + 1) }, (_, i) => +m[1] + i) : [+m[1]]));

// ---- app session ---------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ channel: process.env.KAI_BROWSER ?? "msedge", headless: true }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
const ctx = await browser.newContext();
// Only the app's own origin: no subrequest or redirect elsewhere carries the session or a document.
await ctx.route("**/*", (r) => (new URL(r.request().url()).origin === base ? r.continue() : r.abort()));
const page = await ctx.newPage();
try {
  await page.goto(`${base}/login`);
  // Set directly: Playwright's fill() keeps the typed value in its action log, and an error would print it.
  await page.$eval('input[name="username"]', (el, v) => (el.value = v), KAI_USER);
  await page.$eval('input[name="password"]', (el, v) => (el.value = v), KAI_PASS);
  await Promise.all([page.waitForURL(`${base}/`, { timeout: 30_000 }), page.click('button[type="submit"]')]);
} catch {
  console.error("Giriş yapılamadı (adres, kullanıcı adı ya da parola).");
  await browser.close();
  process.exit(1);
}
const api = ctx.request;
const headers = { Origin: base };
const get = async (p) => (await api.get(`${base}${p}`, { maxRedirects: 0 })).json();
const models = await get("/api/models");
const model = models.defaultModel;
console.log(`model: ${model}`);

// Documents: reuse what this user already has (same name), upload the rest once.
// Names compared in NFC: some file systems store "ı", "ş" … decomposed.
const nfc = (s) => s.normalize("NFC");
// Reused only when name and size match (an edited PDF with the same name is uploaded again).
const have = new Map(((await get("/api/upload")) ?? []).map((d) => [`${nfc(d.name)}|${d.size}`, d.id]));
const key = (name) => `${nfc(name)}|${fs.statSync(path.join(dir, name)).size}`;
const need = [...new Set(items.flatMap((q) => q.files))];
for (const name of need) {
  if (have.has(key(name))) continue;
  process.stdout.write(`yükleniyor: ${name} … `);
  const t0 = Date.now();
  const r = await api.post(`${base}/api/upload`, { maxRedirects: 0, headers, multipart: { file: { name, mimeType: "application/pdf", buffer: fs.readFileSync(path.join(dir, name)) } }, timeout: 30 * 60_000 });
  const lines = (await r.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const done = lines.find((l) => l.type === "done");
  if (!done) {
    console.log(`HATA ${r.status()} ${lines.find((l) => l.type === "error")?.error ?? (await r.text()).slice(0, 200)}`);
    continue;
  }
  have.set(key(name), done.doc.id);
  console.log(`${Math.round((Date.now() - t0) / 1000)} sn${done.doc.warning ? ` (uyarı: ${done.doc.warning})` : ""}`);
}

// ---- ask ------------------------------------------------------------------------------------------------------------
const results = [];
for (const q of items) {
  const ids = q.files.map((f) => (fs.existsSync(path.join(dir, f)) ? have.get(key(f)) : undefined));
  if (ids.some((id) => !id)) {
    results.push({ ...q, status: "atlandı", why: "belge yüklenemedi" });
    continue;
  }
  const t0 = Date.now();
  const body = { model, fileIds: ids, messages: [{ role: "user", content: q.question }], ...(arg("--profile") === "deep" ? { scope: "all", think: true } : {}) };
  const r = await api.post(`${base}/api/chat`, { maxRedirects: 0, headers: { ...headers, "Content-Type": "application/json" }, data: body, timeout: 30 * 60_000 });
  const raw = await r.text();
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  if (!r.ok()) {
    results.push({ ...q, status: "hata", why: `${r.status()} ${raw.slice(0, 200)}`, secs });
    continue;
  }
  const noStatus = raw.replace(/\u001d[^\u001d]*\u001d/g, "");
  const [textPart, ...metaParts] = noStatus.split("\u001e");
  const error = textPart.includes("\u001f") ? textPart.split("\u001f")[1] : "";
  const answer = textPart.split("\u001f")[0].trim();
  let meta = {};
  let protocol = "";
  try {
    meta = JSON.parse(metaParts.join("\u001e").trim() || "{}");
  } catch {
    protocol = "meta okunamadı";
  }
  // Only the fields used, with their types; anything else is a protocol error, not a score.
  const strings = (v) => (v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null);
  if (!protocol && (meta === null || typeof meta !== "object" || Array.isArray(meta))) protocol = "meta nesne değil";
  if (!protocol) {
    const [badPages, unverified, uncertain] = [meta.badPages, meta.unverified, meta.uncertain].map(strings);
    if (!badPages || !unverified || !uncertain || (meta.mode !== undefined && typeof meta.mode !== "string")) protocol = "meta alanları geçersiz";
    else meta = { mode: meta.mode, badPages, unverified, uncertain };
  }
  if (protocol) meta = {};
  // Page references aren't the figures asked for: scored without them.
  const prose = answer.replace(/\bSayfa\s+\d+(\s*[-–]\s*\d+)?/gi, " ");
  const found = (q.mustContain ?? []).filter((t) => has(prose, t));
  const pages = citedPages(answer);
  let status;
  if (error || protocol) status = "hata";
  else if (q.type === "yok") status = refuses(answer) ? "doğru" : "yanlış";
  else if (!(q.mustContain ?? []).length) status = "geçersiz";
  else status = found.length === q.mustContain.length ? "doğru" : found.length ? "kısmen" : "yanlış";
  // A made-up page number makes a right answer only partly right (plan §5.3).
  if (status === "doğru" && (meta.badPages ?? []).length) status = "kısmen";
  results.push({
    id: q.id, type: q.type, kind: q.kind, files: q.files, question: q.question, expected: q.answer, mustContain: q.mustContain, expectedPages: q.pages,
    status, answer, error: error || protocol, secs, mode: meta.mode, found,
    citedPages: pages, pageOk: !q.pages?.length || !pages.length ? null : pages.some((p) => q.pages.includes(p)),
    fakePages: meta.badPages ?? [], unverified: meta.unverified ?? [], uncertain: meta.uncertain ?? [],
  });
  const last = results.at(-1);
  console.log(`${q.id.padEnd(10)} ${status.padEnd(7)} ${String(secs).padStart(6)} sn  ${last.mode ?? ""}${last.fakePages.length ? `  uydurma sayfa: ${last.fakePages.join(", ")}` : ""}`);
}
await browser.close();

// ---- report ---------------------------------------------------------------------------------------------------------
const by = (k) => Object.entries(results.reduce((m, r) => ((m[r[k] ?? "-"] ??= []).push(r), m), {}));
const pct = (n, d) => (d ? `%${Math.round((100 * n) / d)}` : "-");
const scored = results.filter((r) => r.status !== "atlandı");
const ok = (rs) => rs.filter((r) => r.status === "doğru").length;
const lines = [
  `# Altın test seti raporu — ${new Date().toLocaleString("tr-TR")}`,
  "",
  `Adres: ${base} · model: ${model} · profil: ${arg("--profile") ?? "otomatik"} · ${results.length} soru`,
  "",
  `**Doğru: ${ok(scored)}/${scored.length} (${pct(ok(scored), scored.length)})** · kısmen ${scored.filter((r) => r.status === "kısmen").length} · yanlış ${scored.filter((r) => r.status === "yanlış").length} · hata ${scored.filter((r) => r.status === "hata").length} · atlandı ${results.length - scored.length}`,
  "",
  `Sayfa: alıntılanan sayfa doğru ${scored.filter((r) => r.pageOk === true).length}, yanlış ${scored.filter((r) => r.pageOk === false).length}; uydurma sayfa içeren cevap ${scored.filter((r) => r.fakePages?.length).length}; kaynakta bulunmayan sayı içeren cevap ${scored.filter((r) => r.unverified?.length).length}`,
  "",
  `Ortalama süre: ${Math.round(scored.reduce((s, r) => s + (r.secs ?? 0), 0) / Math.max(1, scored.length))} sn`,
  "",
  "| Tür | Doğru | Soru |",
  "| --- | --- | --- |",
  ...by("type").map(([t, rs]) => `| ${t} | ${ok(rs)} (${pct(ok(rs), rs.length)}) | ${rs.length} |`),
  "",
  "## Doğru olmayanlar",
  "",
  ...scored
    .filter((r) => r.status !== "doğru")
    .flatMap((r) => [
      `### ${r.id} · ${r.status} · ${r.type} · ${r.files.join(" + ")}`,
      `- Soru: ${r.question}`,
      `- Beklenen: ${r.expected} (sayfa ${r.expectedPages?.join(", ") || "-"}; aranan: ${(r.mustContain ?? []).join(" | ") || "ret"})`,
      `- Bulunan: ${(r.found ?? []).join(" | ") || "-"} · alıntılanan sayfa: ${r.citedPages?.join(", ") || "-"} · mod: ${r.mode ?? "-"}${r.unverified?.length ? ` · kaynakta yok: ${r.unverified.join(", ")}` : ""}`,
      `- Cevap: ${(r.error || r.answer || r.why || "").replace(/\s+/g, " ").slice(0, 700)}`,
      "",
    ]),
];
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
fs.writeFileSync(path.join(goldenDir, `report-${stamp}.md`), lines.join("\n"));
fs.writeFileSync(path.join(goldenDir, `report-${stamp}.json`), JSON.stringify(results, null, 1));
console.log(`\n${lines[4]}\nRapor: ${path.join(goldenDir, `report-${stamp}.md`)}`);
