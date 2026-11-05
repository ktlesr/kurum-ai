// A workbook as the text every later step reads ("## Sheet: X", a line or two about it, one Markdown table, the code's
// checks of its totals). Pure (no "server-only"): lib/parse calls it, the test drives it on real SheetJS workbooks.

import * as XLSX from "xlsx";
import { checkTotals } from "./checks.ts";
import { isNoteRow, isTotalRow, SHEET_TR, trDigits } from "./table.ts";

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
  const run = w.match(/\d[\d.,]*/u)![0].replace(/,/gu, "");
  const shown = Number(run);
  if (Math.abs(shown - value) <= Number.EPSILON * Math.max(1, value) * 4) return w;
  // Only rounding at the shown precision: a format that scales ("#,##0," shows thousands, '0.0,,"M"' millions, under a
  // "Bin TL" header) shows another figure on purpose, and keeps it.
  const decimals = run.includes(".") ? run.length - run.indexOf(".") - 1 : 0;
  if (Math.abs(shown - value) > 0.5 * 10 ** -decimals * (1 + 1e-9)) return w;
  const whole = value.toLocaleString("en-US", { maximumFractionDigits: 15, useGrouping: true });
  return w.replace(/\d[\d.,]*/u, whole);
}

/**
 * A text cell merged down over rows (a group's name beside its entries) says its text on every row it covers, as a
 * reader sees it: each row then carries its group. Only downwards, in its own column: a title merged across the columns
 * stays one cell (else it would read as a row of column names over the real ones). Numbers are left in their first cell
 * (a merged figure is one figure).
 */
function fillMerges(ws: XLSX.WorkSheet) {
  // Rows with a value somewhere, before any filling: a blank row under a merged name stays blank (no made-up entry).
  // A row that isn't an entry under a merged group name keeps its shape: a total ("Ege" over "Kütahya | 100", "Uşak |
  // 200", "| Toplam | 300") or a footnote ("| * Kaynak: TÜİK |"); the group's name written in front would make it read
  // as one more entry. The same rules lib/table reads rows by (isTotalRow, isNoteRow), on the row as it stands before
  // filling: an entry whose category is "Toplam" gets its group.
  const valued = new Map<number, Map<number, string>>();
  let firstCol = Infinity;
  for (const [k, c] of Object.entries(ws)) {
    const v = String((c as XLSX.CellObject).v ?? "");
    if (k.startsWith("!") || v.trim() === "") continue;
    const { r, c: col } = XLSX.utils.decode_cell(k);
    (valued.get(r) ?? valued.set(r, new Map()).get(r)!).set(col, v.trim());
    firstCol = Math.min(firstCol, col);
  }
  // Once per row, and the row as the rules read it without its empty cells (its first column's cell, then the others
  // in order): a wide sheet costs its filled cells, not its width.
  const kinds = new Map<number, { total: boolean; noteLike: boolean; cols: Set<number> }>();
  const kindOf = (r: number) => {
    let k = kinds.get(r);
    if (!k) {
      const cells = valued.get(r)!;
      const cols = [...cells.keys()].sort((a, b) => a - b);
      const row = [cells.get(firstCol) ?? "", ...cols.filter((c) => c !== firstCol).map((c) => cells.get(c)!)];
      k = { total: isTotalRow(row), noteLike: isNoteRow(row), cols: new Set(cols) };
      kinds.set(r, k);
    }
    return k;
  };
  // A note-like line is a footnote only after the sheet's last entry, in a table of two columns or more (lib/table's
  // rule): one among the entries ("| | Not: inceleme |") is an entry, and gets its group.
  const wide = new Set([...valued.values()].flatMap((m) => [...m.keys()])).size >= 2;
  const sorted = [...valued.keys()].sort((a, b) => b - a);
  const lastEntry = sorted.find((r) => !kindOf(r).total && !(wide && kindOf(r).noteLike)) ?? -1;
  const notEntry = (r: number) => kindOf(r).total || (wide && kindOf(r).noteLike && r > lastEntry);
  // The ranges are the file's word (one can claim a billion rows): only the rows that hold a value are walked, found by
  // a binary search in their sorted list, and no more than MAX_FILL row visits in all, however many merges.
  let budget = MAX_FILL;
  const rows = [...valued.keys()].sort((a, b) => a - b);
  const from = (r: number) => {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const m of (ws["!merges"] ?? []).slice(0, MAX_MERGES)) {
    const top = ws[XLSX.utils.encode_cell(m.s)] as XLSX.CellObject | undefined;
    if (!top || top.t !== "s") continue;
    for (let i = from(m.s.r + 1); i < rows.length && rows[i] <= m.e.r; i++) {
      if (--budget < 0) return;
      const r = rows[i];
      const at = XLSX.utils.encode_cell({ r, c: m.s.c });
      const k = kindOf(r);
      const others = k.cols.size > (k.cols.has(m.s.c) ? 1 : 0);
      // A cell there with nothing in it (written as "") is as empty as no cell.
      const here = ws[at] as XLSX.CellObject | undefined;
      if (String(here?.v ?? "").trim() === "" && others && !notEntry(r)) ws[at] = { ...top };
    }
  }
}

/** The smallest range holding every cell with a value (formatted or empty-text cells and "!ref" left out); none if none. */
function usedRange(ws: XLSX.WorkSheet): XLSX.Range | undefined {
  let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
  for (const [k, c] of Object.entries(ws)) {
    if (k.startsWith("!")) continue;
    const cell = c as XLSX.CellObject;
    // Nothing in it (no value, or a text of spaces) and no formula: not part of what the sheet holds.
    if ((cell.v === undefined || (typeof cell.v === "string" && !cell.v.trim())) && !cell.f) continue;
    const { r, c: col } = XLSX.utils.decode_cell(k);
    r0 = Math.min(r0, r); c0 = Math.min(c0, col); r1 = Math.max(r1, r); c1 = Math.max(c1, col);
  }
  return r1 < 0 ? undefined : { s: { r: r0, c: c0 }, e: { r: r1, c: c1 } };
}

/** Cells a sheet's range may span to be read (a large real table is a few million). */
const MAX_AREA = 20_000_000;

/** ponytail: merges past this many, or row visits past MAX_FILL, are left unfilled (a layout, not a table); raise if needed. */
const MAX_MERGES = 5_000;
const MAX_FILL = 2_000_000;

/** "2-15, 17, 19-40": Excel row numbers, consecutive ones as a span. */
export function rowSpans(rows: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    out.push(j > i ? `${rows[i]}-${rows[j]}` : String(rows[i]));
    i = j + 1;
  }
  return out.join(", ");
}

const colLetter = (k: number): string => (k < 26 ? String.fromCharCode(65 + k) : colLetter(Math.floor(k / 26) - 1) + colLetter(k % 26));

export function sheetText(wb: XLSX.WorkBook, o: { csv: boolean }): { text: string; rows: number; sheets: number } {
  let totalRows = 0;
  const parts = wb.SheetNames.map((sheetName, sheetIndex) => {
    const ws = wb.Sheets[sheetName];
    // Hidden (1) or very hidden (2) in Excel: still read, and said so; an answer from it says it too.
    const hidden = !o.csv && !!wb.Workbook?.Sheets?.[sheetIndex]?.Hidden;
    if (!o.csv) fillMerges(ws);
    // A formula with no stored result (file written by a program, never opened in Excel) reads as an empty cell.
    const noValue = Object.entries(ws).filter(([k, c]) => !k.startsWith("!") && (c as XLSX.CellObject).f && (c as XLSX.CellObject).v === undefined).length;
    if (!o.csv) turkishNumbers(ws);
    // Blank rows kept here to count them: each row read keeps its Excel row number (the sheet's range may start lower).
    // The range the cells really take: "!ref" may start at A1 above and left of them (and count formatted empty cells).
    const used = usedRange(ws);
    const start = used?.s ?? { r: 0, c: 0 };
    // Reading walks every cell of the range: two cells far apart (A1 and XFD1048576, a file of a few KB) would be
    // billions. Past MAX_AREA the sheet is not read, and said so.
    const height = used ? used.e.r - used.s.r + 1 : 0;
    const width = used ? used.e.c - used.s.c + 1 : 0;
    const tooBig = height * width > MAX_AREA;
    const kept = (used && !tooBig ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true, raw: false, range: used }) : [])
      .map((r, i) => ({ excel: start.r + i + 1, cells: r.map((c) => String(c).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()) }))
      .filter((r) => r.cells.some(Boolean));
    const rows = kept.map((r) => r.cells);
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
      // Where each table line stands in the sheet (lib/table reads it back): its first line, then every next one.
      ...(kept.length && !o.csv ? [`Excel satırları: ${rowSpans(kept.map((r) => r.excel))}`, ...(start.c ? [`İlk sütun: ${colLetter(start.c)}`] : [])] : []),
      ...(hidden ? ["> Bu sayfa Excel'de gizli."] : []),
      ...(tooBig ? [`> [Kod kontrolü] Bu sayfanın dolu alanı çok büyük (${height} satır × ${width} sütun); okunmadı. Gereksiz uzak hücreleri silip yeniden kaydedin.`] : []),
      ...(noValue ? [`> [Kod kontrolü] ${noValue} formül hücresinin dosyada hesaplanmış değeri yok; bu hücreler boş okundu. Dosyayı Excel'de açıp kaydederek yeniden yükleyin.`] : []),
      "",
      table,
      // Totals and shares recomputed from the cells (plan §5.2); spreadsheet values are exact, nothing to cross-check.
      ...(cols ? checkTotals(`${sheetName}\n${table}`).flatMap((n) => ["", n]) : []),
    ].join("\n");
  });
  return { text: parts.join("\n\n"), rows: totalRows, sheets: wb.SheetNames.length };
}
