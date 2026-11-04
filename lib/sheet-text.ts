// A workbook as the text every later step reads ("## Sheet: X", a line or two about it, one Markdown table, the code's
// checks of its totals). Pure (no "server-only"): lib/parse calls it, the test drives it on real SheetJS workbooks.

import * as XLSX from "xlsx";
import { checkTotals } from "./checks.ts";
import { SHEET_TR, trDigits } from "./table.ts";

/**
 * Excel and older .xls: SheetJS writes a number cell's formatted text the English way ("1,234", "2,500.50 ₺"); every
 * later step reads numbers the Turkish way, where "1,234" is one and a bit. So a number cell's text is written in
 * Turkish here, from its number format (read with cellNF): dates and times excepted, they keep SheetJS's text. A CSV's
 * cells are the file's own words, already as its writer meant them: never converted.
 */
export const readXlsx = (buf: Buffer) => XLSX.read(buf, { type: "buffer", cellNF: true });
export const readCsv = (text: string) => XLSX.read(text, { type: "string" });

function turkishNumbers(ws: XLSX.WorkSheet) {
  for (const [k, c] of Object.entries(ws)) {
    const cell = c as XLSX.CellObject;
    if (k.startsWith("!") || cell.t !== "n" || cell.v === undefined) continue;
    const fmt = String(cell.z ?? "General");
    if (XLSX.SSF.is_date(fmt)) continue;
    // A cell SheetJS didn't format (no text of its own) is formatted here first, so none stays English.
    const w = typeof cell.w === "string" ? cell.w : XLSX.utils.format_cell(cell);
    cell.w = trDigits(fullValue(w, Number(cell.v), fmt));
  }
}

/**
 * A display that rounds ("#,##0" shows 100,4 as "100") gets the cell's whole value back, its currency or % kept: the
 * table index sums what the cell holds, as Excel does, not what was shown. A display of one plain number only; a
 * fraction, a time or a scientific form is left as shown (and isn't read as a number later).
 */
function fullValue(w: string, v: number, fmt: string): string {
  if (!Number.isFinite(v) || !/^[^\d]*\d[\d.,]*[^\d]*$/u.test(w) || /[eE][+-]?\d|\/|:/u.test(w)) return w;
  const scale = /%/u.test(fmt.replace(/"[^"]*"/gu, "")) ? 100 : 1;
  const value = Math.abs(v * scale);
  const shown = Number(w.match(/\d[\d.,]*/u)![0].replace(/,/gu, ""));
  if (Math.abs(shown - value) <= Number.EPSILON * Math.max(1, value) * 4) return w;
  const whole = value.toLocaleString("en-US", { maximumFractionDigits: 15, useGrouping: true });
  return w.replace(/\d[\d.,]*/u, whole);
}

export function sheetText(wb: XLSX.WorkBook, o: { csv: boolean }): { text: string; rows: number; sheets: number } {
  let totalRows = 0;
  const parts = wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    // A formula with no stored result (file written by a program, never opened in Excel) reads as an empty cell.
    const noValue = Object.entries(ws).filter(([k, c]) => !k.startsWith("!") && (c as XLSX.CellObject).f && (c as XLSX.CellObject).v === undefined).length;
    if (!o.csv) turkishNumbers(ws);
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
      // Converted (Excel) or as written (a CSV, Turkish files' own form): either way read the Turkish way from here on.
      SHEET_TR,
      `Satır: ${data.length}, Sütun: ${cols}`,
      `Sütun başlıkları: ${header.filter(Boolean).join(", ") || "(yok)"}`,
      ...(noValue ? [`> [Kod kontrolü] ${noValue} formül hücresinin dosyada hesaplanmış değeri yok; bu hücreler boş okundu. Dosyayı Excel'de açıp kaydederek yeniden yükleyin.`] : []),
      "",
      table,
      // Totals and shares recomputed from the cells (plan §5.2); spreadsheet values are exact, nothing to cross-check.
      ...(cols ? checkTotals(`${sheetName}\n${table}`).flatMap((n) => ["", n]) : []),
    ].join("\n");
  });
  return { text: parts.join("\n\n"), rows: totalRows, sheets: wb.SheetNames.length };
}
