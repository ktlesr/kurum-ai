import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { checkCriteria, checkMaxRows, markUncertain } from "./checks";
import { NUM_CTX, OLLAMA_URL } from "./server";

export const DOCLING_PYTHON =
  process.env.DOCLING_PYTHON ??
  path.join(process.cwd(), ".venv-docling", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export const VISION_MODEL = process.env.VISION_MODEL ?? "gemma4:12b";
const VISION_VERIFY = process.env.VISION_VERIFY !== "false";
const DOCLING_OFFLINE = process.env.DOCLING_OFFLINE !== "false";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const PIPELINE = "v8"; // bump to invalidate cached extractions

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

/** Collapse Docling's space-padded tables and repeated colspan cells — same content, far fewer tokens. */
export function compactTables(md: string): string {
  return md
    .replace(/\s*<!-- image -->/g, "")
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) return line;
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) return `|${" --- |".repeat(cells.length)}`;
      return `| ${cells.map((c, i) => (i > 0 && c === cells[i - 1] ? "" : c)).join(" | ")} |`;
    })
    .join("\n");
}

/** One vision read per image strip; cached by image hash so pipeline changes don't redo minutes of work. */
async function readStrip(png: string, signal: AbortSignal): Promise<string> {
  const file = path.join(CACHE_DIR, "strips", `${createHash("sha256").update(VISION_MODEL + VISION_PROMPT + png).digest("hex")}.txt`);
  const hit = await readFile(file, "utf8").catch(() => null);
  if (hit !== null) return hit;
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal,
    body: JSON.stringify({
      model: VISION_MODEL,
      stream: false,
      think: false,
      // Same num_ctx as chat: a different value makes Ollama reload the model between calls.
      options: { temperature: 0, num_ctx: NUM_CTX },
      messages: [{ role: "user", content: VISION_PROMPT, images: [png] }],
    }),
  });
  const j = (await res.json()) as { message?: { content: string }; error?: string };
  if (!res.ok || !j.message) throw new Error(j.error ?? `HTTP ${res.status}`);
  const text = j.message.content.trim();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}

function runDocling(file: string, signal: AbortSignal, onLine: (l: PageLine) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scripts", "extract.py");
    // Offline by default: models must already be on disk (README → kapalı ağ); nothing is fetched at runtime.
    const offline = DOCLING_OFFLINE ? { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1" } : {};
    const proc = spawn(DOCLING_PYTHON, [script, file], { signal, env: { ...process.env, ...offline, PYTHONIOENCODING: "utf-8" } });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    createInterface({ input: proc.stdout }).on("line", (l) => l.trim() && onLine(JSON.parse(l) as PageLine));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Docling çıkış kodu ${code}: ${stderr.slice(-500)}`))));
  });
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
): Promise<Extracted | null> {
  if (!existsSync(DOCLING_PYTHON)) return null;

  const hash = createHash("sha256").update(buf).digest("hex");
  const cacheFile = path.join(CACHE_DIR, `${hash}-${PIPELINE}-${VISION_VERIFY ? VISION_MODEL.replace(/[^\w.-]/g, "_") : "noverify"}.json`);
  const cached = await readFile(cacheFile, "utf8").catch(() => null);
  if (cached) return JSON.parse(cached) as Extracted;

  const tmp = path.join(tmpdir(), `localdocs-${hash}${path.extname(name).toLowerCase()}`);
  await writeFile(tmp, buf);
  const lines: PageLine[] = [];
  try {
    await runDocling(tmp, signal, (l) => {
      lines.push(l);
      if (l.page) onProgress({ stage: "Sayfalar okunuyor", done: l.page, total: l.total });
    });
  } finally {
    await rm(tmp, { force: true });
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
      let second: string;
      try {
        second = (await Promise.all(t.strips.map((s) => readStrip(s, signal)))).join("\n\n");
      } catch (e) {
        if (signal.aborted) throw e;
        verify.skipped = `Görsel model (${VISION_MODEL}) çalışmadı: ${(e as Error).message}`;
        continue;
      }
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
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result));
  }
  return result;
}
