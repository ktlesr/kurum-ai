import "server-only";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { DocKind } from "./server";
import { extractWithDocling, type Extracted, type Progress } from "./extract";

export interface Parsed {
  kind: DocKind;
  text: string;
  pages?: number;
  rows?: number;
  sheets?: number;
  warning?: string;
  verify?: Extracted["verify"];
}

/** Thrown for problems the user can fix; message is shown as-is. */
export class UserError extends Error {}

const NO_DOCLING = "Docling kurulu değil: görsel olarak gömülü tablolar okunamaz (README → Docling kurulumu).";

export async function parseFile(name: string, buf: Buffer, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Parsed> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
    case "docx": {
      const kind = ext;
      const d = await extractWithDocling(name, buf, onProgress, signal);
      if (d) return { kind, ...d, warning: d.verify?.skipped };
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
    case "txt":
    case "md": {
      const text = decodeText(buf);
      return { kind: "text", text, rows: text.split("\n").length };
    }
    default:
      throw new UserError(`"${ext || name}" türü desteklenmiyor. PDF, DOCX, XLSX, XLS, CSV, TXT veya MD yükleyin.`);
  }
}

async function parsePdf(buf: Buffer): Promise<Parsed> {
  const { totalPages, text } = await extractText(new Uint8Array(buf), { mergePages: false });
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
        ? "Metin çıkarılamadı — taranmış (görüntü) PDF olabilir. OCR desteği yok."
        : undefined,
  };
}

function parseSheet(wb: XLSX.WorkBook): Parsed {
  let totalRows = 0;
  const parts = wb.SheetNames.map((sheetName) => {
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "", blankrows: false, raw: false })
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
      "",
      table,
    ].join("\n");
  });
  return { kind: "sheet", text: parts.join("\n\n"), rows: totalRows, sheets: wb.SheetNames.length };
}

/** UTF-8, falling back to Windows-1254 (common for older Turkish files). */
function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1254").decode(buf) : utf8;
}
