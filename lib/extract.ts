import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkCriteria, checkMaxRows, compactTables, markUncertain } from "./checks";
import { modelConfig, providerOf } from "./model-config";
import type { ModelConfig } from "./models";
import { logError } from "./log";
import { writeFileAtomic } from "./atomic";
import { runJsonLines } from "./proc";
import { withJobDir } from "./workspace";
import { admission, DOCLING_TIMEOUT_MS } from "./admission";
import { Busy } from "./limits";
import { UserError } from "./errors";
import { getSetting } from "./db";

export const DOCLING_PYTHON =
  process.env.DOCLING_PYTHON ||
  path.join(process.cwd(), ".venv-docling", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
// ponytail: fixed cap; a table strip is a few hundred tokens of markdown
const VISION_MAX_TOKENS = 4096;
const VISION_VERIFY = process.env.VISION_VERIFY !== "false";
/** Admin page setting first, env (DOCLING_OFFLINE) when unset; an unreadable DB means offline (the safe side). */
export async function doclingOffline(): Promise<boolean> {
  const v = await getSetting("docling_offline").catch(() => "true");
  return (v ?? process.env.DOCLING_OFFLINE) !== "false";
}
const PIPELINE = "v9"; // bump to invalidate cached extractions
/** Page limit for every PDF path: Docling, the unpdf fallback, and cached results. */
export const MAX_PAGES = Number(process.env.DOCLING_MAX_PAGES) || 500;
export const tooManyPages = () => `Dosya çok fazla sayfa içeriyor (en fazla ${MAX_PAGES}). Dosyayı bölerek yükleyin.`;
const TOO_MANY_PAGES_EXIT = 3; // scripts/extract.py
const PAGE_TOO_LARGE_EXIT = 4;

export interface Progress {
  stage: string;
  done: number;
  total: number;
}

export interface Extracted {
  text: string;
  pages?: number;
  verify?: { tables: number; numbers: number; uncertain: number; skipped?: string };
}

interface PageLine {
  page: number | null;
  total: number;
  markdown: string;
  tables: { markdown: string; strips: string[] }[];
}

const VISION_PROMPT = `Bu görüntü bir teknik rapordaki tablonun bir kesitidir. YALNIZCA görüntüdeki bilgiyi aynen yazıya dök.
- Tabloyu Markdown tablo olarak yaz; her hücreyi görüldüğü gibi yaz. Birleştirilmiş başlıkları alt sütunlara "Başlık / Alt" biçiminde aç.
- Onay işaretini √, çarpıyı x olarak yaz.
- Okuyamadığın hücreye [okunamadı] yaz. Asla tahmin etme, tekrar eden değer uydurma.
- Kesitin kenarında yarım kalmış satırları atla.
- Yorum ekleme.`;


/** Server + model: the same model name on another server is another reading. */
const visionId = (v: ModelConfig["vision"]) => `${v.kind}|${v.url}|${v.model}`;

/** One vision read per image strip; cached (in this doc's own cache dir) so pipeline changes don't redo minutes of work. */
async function readStrip(png: string, signal: AbortSignal, cacheDir: string, vision: ModelConfig["vision"]): Promise<string> {
  const file = path.join(cacheDir, "strips", `${createHash("sha256").update(visionId(vision) + VISION_PROMPT + png).digest("hex")}.txt`);
  const hit = await readFile(file, "utf8").catch(() => null);
  if (hit !== null) return hit;
  // The slot covers the whole call, body included: a provider that sends headers early is still "busy".
  const text = await admission.model.run(async () => {
    const r = await providerOf(vision).chat({ model: vision.model, messages: [{ role: "user", content: VISION_PROMPT, images: [png] }], maxTokens: VISION_MAX_TOKENS, signal });
    // A cut-off reading is a failed reading: never cached, never compared (the caller marks verification skipped).
    if (r.truncated) throw new Error("vision_truncated");
    return r.text.trim();
  }, signal);
  writeFileAtomic(file, text);
  return text;
}

async function runDocling(file: string, signal: AbortSignal, onLine: (l: PageLine) => void): Promise<void> {
  const script = path.join(process.cwd(), "scripts", "extract.py");
  // Offline by default: models must already be on disk (README → kapalı ağ); nothing is fetched at runtime.
  // Set both ways: an inherited HF_HUB_OFFLINE=1 must not override the admin's "off".
  const flag = (await doclingOffline()) ? "1" : "0";
  const offline = { HF_HUB_OFFLINE: flag, TRANSFORMERS_OFFLINE: flag, HF_DATASETS_OFFLINE: flag };
  // Settles only after Docling exited, so the caller's temp-file cleanup never races the running process.
  return runJsonLines<PageLine>(/*turbopackIgnore: true*/ DOCLING_PYTHON, [script, file], { signal, env: { ...process.env, ...offline, PYTHONIOENCODING: "utf-8", DOCLING_MAX_PAGES: String(MAX_PAGES) } }, onLine);
}

/** "## X" lines that open a section rather than title a table (next content line isn't a table). */
function sectionHeadings(md: string): string[] {
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines
    .filter((l, i) => l.startsWith("## ") && !lines[i + 1]?.startsWith("|"))
    .map((l) => l.slice(3).replace(/:\s*$/, ""))
    .filter((h) => !/\S\s:\s\S/.test(h)) // "BİNA PERFORMANSI : GÖÇME DURUMU" is a result, not a section
    .filter((h, i, a) => h !== a[i - 1]);
}

/**
 * Docling reads the file (layout + OCR + table structure). Tables that were screenshots get a second,
 * independent reading from the local vision model; numbers the two readers disagree on are marked "(?)".
 * Returns null when Docling isn't installed, so the caller can fall back to plain text extraction.
 */
export async function extractWithDocling(
  name: string,
  buf: Buffer,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
  /** Per user + source file (lib/workspace extractDir): never shared between users. */
  cacheDir: string,
): Promise<Extracted | null> {
  // turbopackIgnore: runtime paths; otherwise the build traces the whole project (.cache with user text, model files)
  if (!existsSync(/*turbopackIgnore: true*/ DOCLING_PYTHON)) return null;

  // The table-reading model (admin page) is part of the result: another model's reading is another result.
  const { vision } = await modelConfig();
  const cacheFile = path.join(cacheDir, `result-${PIPELINE}-${VISION_VERIFY ? createHash("sha256").update(visionId(vision)).digest("hex").slice(0, 16) : "noverify"}.json`);
  const cached = await readFile(cacheFile, "utf8").catch(() => null);
  if (cached) {
    const hit = JSON.parse(cached) as Extracted;
    if ((hit.pages ?? 0) > MAX_PAGES) throw new UserError(tooManyPages());
    return hit;
  }

  // Private random job dir; removed even if writing the input fails, and swept on start after a crash (audit S9/N3).
  const lines: PageLine[] = [];
  // One Docling run at a time (queue, then 429-style refusal), each with a hard time limit (audit S5/S7).
  if (admission.docling.full) onProgress({ stage: "Sırada bekleniyor", done: 0, total: 1 });
  let timedOut = false;
  try {
    await admission.docling.run(
      () =>
        withJobDir(async (dir) => {
          // The clock starts once we have the slot: waiting in the queue doesn't count.
          const timeout = AbortSignal.timeout(DOCLING_TIMEOUT_MS);
          timeout.addEventListener("abort", () => (timedOut = true), { once: true });
          const input = path.join(dir, `input${path.extname(name).toLowerCase().replace(/[^.\w]/g, "")}`);
          await writeFile(input, buf, { mode: 0o600 });
          await runDocling(input, AbortSignal.any([signal, timeout]), (l) => {
            lines.push(l);
            if (l.page) onProgress({ stage: "Sayfalar okunuyor", done: l.page, total: l.total });
          });
        }),
      signal,
    );
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof Busy) throw new UserError("Sunucu şu an çok yoğun; dosya okunamadı. Biraz sonra tekrar deneyin.");
    if (timedOut) throw new UserError(`Dosyanın okunması ${Math.round(DOCLING_TIMEOUT_MS / 60_000)} dakika sınırını aştı. Dosyayı bölerek yükleyin.`);
    if ((e as Error).message === `proc_exit_${PAGE_TOO_LARGE_EXIT}`) throw new UserError("Dosyada olağandışı büyük bir sayfa var; güvenlik nedeniyle okunmadı.");
    if ((e as Error).message === `proc_exit_${TOO_MANY_PAGES_EXIT}`) throw new UserError(tooManyPages());
    throw e;
  }

  const totalTables = lines.reduce((n, l) => n + l.tables.length, 0);
  const verify = { tables: totalTables, numbers: 0, uncertain: 0, skipped: undefined as string | undefined };
  let done = 0;
  const parts: string[] = [];
  const headings: string[] = [];
  const outline: string[] = [];
  const findings: string[] = [];

  for (const l of lines) {
    let md = compactTables(l.markdown);
    const extra: string[] = [];
    let marked = 0;
    for (const [k, t] of l.tables.entries()) {
      signal.throwIfAborted();
      onProgress({ stage: "Tablolar doğrulanıyor", done: ++done, total: totalTables });
      const primary = compactTables(t.markdown);
      if (!VISION_VERIFY || verify.skipped) continue;
      // allSettled, not all: every strip read (and its cache write) has finished before we go on, so nothing
      // writes into cacheDir after the upload is over and the cache may already have been deleted.
      const reads = await Promise.allSettled(t.strips.map((s) => readStrip(s, signal, cacheDir, vision)));
      const failed = reads.find((r) => r.status === "rejected");
      if (failed) {
        if (signal.aborted) throw signal.reason;
        logError(`vision ${vision.model}`, failed.reason);
        verify.skipped = "Görsel model çalışmadı; tablolar ikinci kez doğrulanamadı.";
        continue;
      }
      const second = reads.map((r) => (r as PromiseFulfilledResult<string>).value).join("\n\n");
      const a = markUncertain(primary, second);
      const b = markUncertain(second, primary);
      verify.numbers += a.total;
      verify.uncertain += a.uncertain;
      // Docling's page export can differ slightly from the table export; then the page stays unmarked.
      if (md.includes(primary)) {
        md = md.replace(primary, a.text);
        marked++;
      }
      extra.push(`[İkinci okuma — görsel model, tablo ${k + 1}; (?) = ilk okumayla uyuşmayan sayı]\n${b.text}`);
    }
    // Max-row checks only where every table on the page is either text-layer or cross-checked.
    const maxNotes = marked === l.tables.length ? checkMaxRows(md) : [];
    // Criteria rows from both readings (one reader often misses a result cell); same verdict once.
    const seen = new Set<string>();
    const criteria = [md, ...extra].flatMap(checkCriteria).filter((n) => {
      const key = n.slice(n.indexOf('": ') + 3).replace(/\s*\(sonuç değeri belirsiz okundu\)/, "");
      return !seen.has(key) && !!seen.add(key);
    });
    const body = [md, ...extra, ...maxNotes, ...criteria].join("\n\n").trim();
    if (!l.page) {
      parts.push(body);
      continue;
    }
    // Pages often continue a section whose heading sat on an earlier page; say which.
    const context = headings.slice(-3).join(" › ");
    parts.push(`--- Sayfa ${l.page} ---\n${context ? `(Önceki sayfalardan süren bölüm: ${context})\n` : ""}${body}`);
    // Outline: section headings plus "KEY : VALUE" headings (e.g. "BİNA PERFORMANSI : GÖÇME DURUMU").
    const sections = sectionHeadings(md);
    const marks = md
      .split("\n")
      .map((line) => line.replace(/^#+\s*|\*\*/g, "").trim())
      .filter((h) => sections.includes(h.replace(/:\s*$/, "")) || /^[^\sa-zçğıöşü|>(][^a-zçğıöşü|]{2,}\s:\s[^a-zçğıöşü|]{2,}$/.test(h));
    if (marks.length) outline.push(`- Sayfa ${l.page}${context ? ` (süren bölüm: ${context})` : ""}: ${marks.join(" → ")}`);
    // Same notes again up front, each with its page and section, so a small model can quote one line.
    for (const n of [...maxNotes, ...criteria]) findings.push(`- Sayfa ${l.page}${context ? ` (${context})` : ""}: ${n.slice(2)}`);
    headings.push(...sections);
  }
  if (findings.length) parts.unshift(`--- Otomatik bulgular (kodla hesaplandı; kaynak sayfada da yer alır) ---\n${findings.join("\n")}`);
  if (outline.length > 1) parts.unshift(`--- Otomatik içindekiler (sayfa başlıkları ve sonuç satırları) ---\n${outline.join("\n")}`);

  const result: Extracted = {
    text: parts.join("\n\n"),
    pages: lines[0]?.page ? lines.length : undefined,
    verify: totalTables ? { ...verify, skipped: verify.skipped } : undefined,
  };
  // Don't cache a run where verification failed midway — retry it next time.
  if (!verify.skipped) {
    writeFileAtomic(cacheFile, JSON.stringify(result));
  }
  return result;
}
