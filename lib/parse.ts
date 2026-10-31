import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { DocKind } from "./server";
import { extractWithDocling, MAX_PAGES, readImage, tooManyPages, type Extracted, type Progress } from "./extract";

export interface Parsed {
  kind: DocKind;
  text: string;
  pages?: number;
  rows?: number;
  sheets?: number;
  warning?: string;
  verify?: Extracted["verify"];
}

import { checkTotals } from "./checks";
import { qualityNotes } from "./quality";
import { htmlToText } from "./web";
import { UserError } from "./errors";
export { UserError };

const NO_DOCLING = "Docling kurulu değil: görsel olarak gömülü tablolar okunamaz (README → Docling kurulumu).";

export async function parseFile(name: string, buf: Buffer, onProgress: (p: Progress) => void, signal: AbortSignal, cacheDir: string): Promise<Parsed> {
  const r = await parseRaw(name, buf, onProgress, signal, cacheDir);
  // Reading-quality notes (lib/quality) on everything but spreadsheets (cells are read exactly).
  // Display-only: a failing check never fails the upload.
  let notes: string[] = [];
  try {
    if (r.kind !== "sheet") notes = qualityNotes(r.text);
  } catch {}
  return notes.length ? { ...r, warning: [r.warning, ...notes].filter(Boolean).join(" ") } : r;
}

async function parseRaw(name: string, buf: Buffer, onProgress: (p: Progress) => void, signal: AbortSignal, cacheDir: string): Promise<Parsed> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
    case "docx": {
      const kind = ext;
      const d = await extractWithDocling(name, buf, onProgress, signal, cacheDir);
      if (d) return { kind, ...d, warning: [d.verify?.skipped, d.warning].filter(Boolean).join(" ") || undefined };
      if (kind === "pdf") {
        const p = await parsePdf(buf);
        return { ...p, warning: p.warning ?? NO_DOCLING };
      }
      // ponytail: mammoth raw text flattens tables; fine as the no-Docling fallback
      return { kind, text: (await mammoth.extractRawText({ buffer: buf })).value.replace(/\n{3,}/g, "\n\n").trim() };
    }
    case "doc":
      throw new UserError("Eski .doc biçimi desteklenmiyor. Dosyayı Word'de açıp .docx olarak kaydedin.");
    case "xlsx":
    case "xls":
      return parseSheet(XLSX.read(buf, { type: "buffer" }));
    case "csv":
      return parseSheet(XLSX.read(decodeText(buf), { type: "string" }));
    case "png":
    case "jpg":
    case "jpeg":
    case "webp": {
      onProgress({ stage: "Görsel okunuyor", done: 0, total: 1 });
      const text = await readImage(buf, signal);
      return { kind: "text", text, rows: text.split("\n").length, ...(text ? {} : { warning: "Görselde okunacak içerik bulunamadı." }) };
    }
    case "html":
    case "htm": {
      // A page the user saved from their own browser (Ctrl+S): read like a fetched one, scripts never run.
      const { title, text } = htmlToText(decodeText(buf));
      const body = title ? `${title}\n\n${text}` : text;
      return { kind: "text", text: body, rows: body.split("\n").length, ...(text.trim() ? {} : { warning: "Sayfada okunacak metin bulunamadı. Sayfayı PDF olarak yazdırıp yükleyin." }) };
    }
    case "txt":
    case "md": {
      const text = decodeText(buf);
      return { kind: "text", text, rows: text.split("\n").length };
    }
    default:
      throw new UserError(`"${ext || name}" türü desteklenmiyor. PDF, DOCX, XLSX, XLS, CSV, TXT, MD, HTML ya da PNG/JPG görsel yükleyin.`);
  }
}

/** `signal` releases the caller at once, while loading too, and tears the parser down as soon as it has one. */
export async function parsePdf(buf: Buffer, signal?: AbortSignal): Promise<Parsed> {
  if (!signal) return readPdf(buf);
  let onAbort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([readPdf(buf, signal), stopped]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function readPdf(buf: Buffer, signal?: AbortSignal): Promise<Parsed> {
  // Count pages before extracting any text, so a 10,000-page file is refused cheaply.
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  let totalPages: number, text: string[];
  const stop = () => void pdf.loadingTask.destroy().catch(() => {});
  try {
    signal?.throwIfAborted();
    signal?.addEventListener("abort", stop, { once: true });
    if (pdf.numPages > MAX_PAGES) throw new UserError(tooManyPages());
    ({ totalPages, text } = await extractText(pdf, { mergePages: false }));
  } finally {
    signal?.removeEventListener("abort", stop);
    await pdf.loadingTask.destroy(); // we opened it, so we close it (unpdf only cleans up documents it opened itself)
  }
  const body = text
    .map((t, i) => `--- Sayfa ${i + 1} ---\n${t.trim()}`)
    .join("\n\n");
  const realChars = text.join("").replace(/\s/g, "").length;
  return {
    kind: "pdf",
    text: body,
    pages: totalPages,
    // ponytail: <20 visible chars/page ≈ image-only; no OCR on purpose
    warning:
      realChars < 20 * totalPages
        ? "Metin çıkarılamadı: taranmış (görüntü) PDF olabilir ve bu sunucuda OCR (Docling) kapalı. Yöneticinize bildirin ya da metin içeren bir PDF yükleyin."
        : undefined,
  };
}

function parseSheet(wb: XLSX.WorkBook): Parsed {
  let totalRows = 0;
  const parts = wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    // A formula with no stored result (file written by a program, never opened in Excel) reads as an empty cell.
    const noValue = Object.entries(ws).filter(([k, c]) => !k.startsWith("!") && (c as XLSX.CellObject).f && (c as XLSX.CellObject).v === undefined).length;
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false, raw: false })
      .map((r) => r.map((c) => String(c).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()));
    const [header = [], ...data] = rows;
    const cols = Math.max(0, ...rows.map((r) => r.length));
    totalRows += data.length;
    const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
    const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
    const table = cols
      ? [line(header), `|${" --- |".repeat(cols)}`, ...data.map(line)].join("\n")
      : "(boş sayfa)";
    return [
      `## Sheet: ${sheetName}`,
      `Satır: ${data.length}, Sütun: ${cols}`,
      `Sütun başlıkları: ${header.filter(Boolean).join(", ") || "(yok)"}`,
      ...(noValue ? [`> [Kod kontrolü] ${noValue} formül hücresinin dosyada hesaplanmış değeri yok; bu hücreler boş okundu. Dosyayı Excel'de açıp kaydederek yeniden yükleyin.`] : []),
      "",
      table,
      // Totals and shares recomputed from the cells (plan §5.2); spreadsheet values are exact, nothing to cross-check.
      ...(cols ? checkTotals(`${sheetName}\n${table}`).flatMap((n) => ["", n]) : []),
    ].join("\n");
  });
  return { kind: "sheet", text: parts.join("\n\n"), rows: totalRows, sheets: wb.SheetNames.length };
}

/** UTF-8, falling back to Windows-1254 (common for older Turkish files). */
function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1254").decode(buf) : utf8;
}
