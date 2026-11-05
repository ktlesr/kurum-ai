// A workbook's sheets as tables the code can query (the table index). A big workbook isn't read by the model row by row:
// it sees each sheet's shape (columns, a few values each, schemaOf) and asks for what it needs (runQuery: rows that
// match, or sums by group), worked here exactly. Faster (a few thousand tokens instead of tens of thousands) and the
// totals can't be made up. Parsed from the text lib/parse made ("## Sheet: X" then one Markdown table), so it needs no
// store of its own. No "server-only": the test drives it.

import { cellNumber, sumText, type Exact } from "./calc.ts";

/** lib/parse writes this under a sheet's title when its number cells are in Turkish form ("1.234,5"). */
export const SHEET_TR = "Sayı biçimi: Türkçe (1.234,5)";

/** "1,234.5" → "1.234,5": the separators in each run of digits swapped; signs, currency and % left as they are. */
export const trDigits = (w: string) => w.replace(/\d[\d.,]*\d/gu, (run) => run.replace(/[.,]/gu, (s) => (s === "," ? "." : ",")));

export interface Table {
  sheet: string;
  columns: string[];
  rows: string[][];
  /** The sheet's text that isn't the table: title rows above the header, notes and checks below, a sheet of text. */
  notes: string[];
  /**
   * How the number cells are written. Sheets made before SHEET_TR are SheetJS's English form ("1,234" is a thousand and
   * more); read the Turkish way they'd come out a thousand times too small.
   */
  english: boolean;
  /** Each row's Excel row number (lib/sheet-text "Excel satırları"); absent for a text read before it, or a CSV. */
  excelRows?: number[];
  /** The Excel letter of the table's first column ("A" unless the sheet starts further right). */
  firstCol?: number;
  /**
   * Total rows ("Toplam", "Genel Toplam", "Ara Toplam", "Yekûn", "Total"): out of `rows`, so a sum over the rows
   * doesn't add the sheet's own total to itself and "the last entry" is no total; shown beside every result instead.
   */
  totals: { cells: string[]; excel?: number }[];
  /** Hidden in Excel (lib/sheet-text): a result from it says so. */
  hidden: boolean;
}

/**
 * A total's label, the whole cell: "Toplam", "Genel Toplam", "Ara Toplam", "TOPLAM:", "Genel Toplam (Bin TL)", "Yekûn",
 * "Total". Not a text that starts so ("Toplam kalite yönetimi eğitimi" is an entry).
 */
const TOTAL = /^(?:(?:genel|ara|alt) )?toplam(?:lar[ıi])?\s*(?::|\(.*\))?$|^yek[uû]n:?$|^(?:grand |sub ?)?total:?$/iu;
/** "Genel" alone is a total's label only as a row's first cell (in a later column it is a category: "Bütçe türü: Genel"). */
const GENERAL = /^genel:?$/iu;
/** A row number, a Roman one ("IV." reads "ıv." in Turkish lower case) or a short code with a digit ("B-3") before the label. */
const CODE = /^(?:\d+[.)]?|[ıivxlc]+\.|(?=[^\s]*\d)[\p{L}\d][\p{L}\d./-]{0,5})$/iu;
/** A row the sheet's maker wrote as a total: its first filled cell says so, or its second after a row number or code. */
/** A cell as the labels are matched: Turkish lower case, any run of spaces or line breaks one space ("Genel
Toplam"). */
const label = (c: string) => c.toLocaleLowerCase("tr").replace(/\s+/gu, " ").trim();
export const isTotalRow = (r: string[]) => {
  const [a, b] = r.map(label).filter(Boolean);
  // "Genel" by its place: the row's own first cell, not the first filled one ("| | Genel | 200 |" is a category).
  return !!a && (TOTAL.test(a) || GENERAL.test(label(r[0] ?? "")) || (!!b && CODE.test(a) && TOTAL.test(b)));
};

/** A line of one filled cell that opens as a footnote (FOOTNOTE): a sheet's note, not an entry, when after its entries. */
export const isNoteRow = (r: string[]) => {
  const filled = r.map(label).filter(Boolean);
  return filled.length === 1 && FOOTNOTE.test(filled[0]);
};

/** A footnote's opening: a mark ("*", "¹", "(1)", "1)") or a word that says what follows (Not, Kaynak, Açıklama…). */
const FOOTNOTE = /^(?:\*+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\(\d{1,2}\)|\d{1,2}\)|(?:not(?:lar)?|kaynak(?:lar|ça)?|açıklama(?:lar)?|dipnot(?:lar)?|uyarı|hazırlayan|veri kaynağı)\s*[:.-])/u;

/** "2-15, 17": the Excel row numbers back, or none when a span doesn't read (an old text, hand-edited). */
/** The last row an Excel sheet can have. */
const EXCEL_ROWS = 1_048_576;
/**
 * The line is the document's text (an upload can write anything): rows within Excel's own range, rising, and never more
 * of them than the table has lines (`count`): no line can make this loop long or the list big.
 */
function spansOf(line: string | undefined, count: number): number[] | undefined {
  if (!line) return undefined;
  const out: number[] = [];
  for (const part of line.split(",")) {
    const m = /^\s*(\d{1,7})(?:-(\d{1,7}))?\s*$/u.exec(part);
    if (!m) return undefined;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < a || b > EXCEL_ROWS || (out.length && a <= out[out.length - 1]) || out.length + (b - a + 1) > count) return undefined;
    for (let r = a; r <= b; r++) out.push(r);
  }
  return out;
}

/**
 * Where Excel row `row` is in a sheet's own text (its "## Sheet:" section, as the source panel shows it): the 1-based line
 * of its table line, or null when the text doesn't say its rows (a CSV, an old read) or has no such row.
 */
export function rowLineOf(sectionText: string, row: number): number | null {
  const lines = sectionText.split("\n");
  const spansLine = lines.slice(0, 8).find((l) => l.startsWith("Excel satırları: "))?.slice("Excel satırları: ".length);
  const at = lines.findIndex((l) => l.trimStart().startsWith("|"));
  if (!spansLine || at < 0 || !/^\s*\|?\s*:?-{3,}/u.test(lines[at + 1] ?? "")) return null;
  const grid = [at];
  for (let i = at + 2; i < lines.length && lines[i].trimStart().startsWith("|"); i++) grid.push(i);
  const spans = spansOf(spansLine, grid.length);
  if (!spans || spans.length !== grid.length) return null;
  const k = spans.indexOf(row);
  return k < 0 ? null : grid[k] + 1;
}

const cells = (line: string) => line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split(/(?<!\\)\|/u).map((c) => c.replace(/\\\|/gu, "|").trim());
const low = (s: string) => s.toLocaleLowerCase("tr").trim();
const letter = (k: number): string => (k < 26 ? String.fromCharCode(65 + k) : letter(Math.floor(k / 26) - 1) + letter(k % 26));

/**
 * The header: the first of the table's first rows that names most columns (a report's title row, "| Rapor | | |", is
 * passed over and kept as a note). Empty names become the column's letter, repeated ones get "(2)", "(3)": every column
 * can be named in a query.
 */
function header(grid: string[][], width: number): number {
  for (let i = 0; i < Math.min(5, grid.length); i++) {
    if (grid[i].filter(Boolean).length >= Math.max(1, Math.ceil(width * 0.6))) return i;
  }
  return -1;
}
function names(row: string[] | undefined, width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, k) => {
    const base = row?.[k] || `Sütun ${letter(k)}`;
    const n = (seen.get(low(base)) ?? 0) + 1;
    seen.set(low(base), n);
    return n > 1 ? `${base} (${n})` : base;
  });
}

/** Each sheet: its table (header found, rows), and the rest of its text as notes; a sheet without a table, notes only. */
export function tablesOf(text: string): Table[] {
  const out: Table[] = [];
  for (const part of text.split(/(?=^## Sheet: )/mu)) {
    if (!part.startsWith("## Sheet: ")) continue;
    const lines = part.split("\n");
    const sheet = lines[0].slice("## Sheet: ".length).trim();
    const english = !lines.slice(1, 4).includes(SHEET_TR);
    // lib/parse's own lines about the sheet (its size, its first row as names): said again by the schema.
    const about = (l: string) => l === SHEET_TR || /^(Satır: \d+, Sütun: \d+|Sütun başlıkları: |Excel satırları: |İlk sütun: [A-Z]{1,3}$|> Bu sayfa Excel'de gizli\.$)/u.test(l);
    const head = lines.slice(1, 8);
    const hidden = head.includes("> Bu sayfa Excel'de gizli.");
    const spansLine = head.find((l) => l.startsWith("Excel satırları: "))?.slice("Excel satırları: ".length);
    const first = head.find((l) => /^İlk sütun: [A-Z]{1,3}$/u.test(l))?.slice("İlk sütun: ".length);
    const firstCol = first ? [...first].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : 0;
    const at = lines.findIndex((l) => l.trimStart().startsWith("|"));
    const isTable = at >= 0 && /^\s*\|?\s*:?-{3,}/u.test(lines[at + 1] ?? "");
    if (!isTable) {
      out.push({ sheet, columns: [], rows: [], notes: lines.slice(1).filter((l) => l.trim() && !about(l)), english, totals: [], hidden });
      continue;
    }
    let end = at + 2;
    while (end < lines.length && lines[end].trimStart().startsWith("|")) end++;
    const grid = [cells(lines[at]), ...lines.slice(at + 2, end).map(cells)];
    const width = Math.max(...grid.map((r) => r.length));
    const h = header(grid, width);
    const notes = [
      ...lines.slice(1, at).filter((l) => l.trim() && !about(l)),
      ...grid.slice(0, Math.max(0, h)).map((r) => r.filter(Boolean).join(" · ")).filter(Boolean),
      ...lines.slice(end).filter((l) => l.trim()),
    ];
    const columns = names(h >= 0 ? grid[h] : undefined, width);
    // The Excel row of every grid line, when the text says them and they match its lines one to one.
    const spans = spansOf(spansLine, grid.length);
    const excelOf = spans && spans.length === grid.length ? spans : undefined;
    const all = grid.slice(h + 1).map((r, i) => ({ cells: columns.map((_, k) => r[k] ?? ""), excel: excelOf?.[h + 1 + i] }));
    // Total rows, wherever they stand, are the sheet's totals. Lines after the last entry (neither a total nor a note)
    // with one filled cell that reads as a footnote ("* Kaynak: TÜİK", "Not: …", "(1) …") are its notes, before or
    // after a total. Marked so, and only in a table of two columns or more: a last entry with an empty cell ("Uşak | ")
    // or a one-column list is an entry.
    const note = (r: (typeof all)[number]) => columns.length >= 2 && !isTotalRow(r.cells) && isNoteRow(r.cells);
    let lastEntry = all.length - 1;
    while (lastEntry >= 0 && (isTotalRow(all[lastEntry].cells) || note(all[lastEntry]))) lastEntry--;
    const isFoot = (r: (typeof all)[number], i: number) => i > lastEntry && note(r);
    const foot = all.filter(isFoot).map((r) => r.cells.filter(Boolean).join(" "));
    const totals = all.filter((r) => isTotalRow(r.cells));
    const data = all.filter((r, i) => !isTotalRow(r.cells) && !isFoot(r, i));
    out.push({
      sheet, columns, rows: data.map((r) => r.cells), notes: [...notes, ...foot], english, hidden, firstCol,
      totals: totals.map((r) => ({ cells: r.cells, excel: r.excel })),
      ...(excelOf ? { excelRows: data.map((r) => r.excel!) } : {}),
    });
  }
  return out;
}

/**
 * The index of one document, kept with it and made once per version: a newer file (the shared folder's copy changed,
 * a new upload) brings new text, and the old index is replaced by one of the new text, never kept beside it.
 */
const index = new WeakMap<object, { text: string; tables: Table[] }>();
export function tablesFor(doc: { text: string }): Table[] {
  const had = index.get(doc);
  if (had && had.text === doc.text) return had.tables;
  const tables = tablesOf(doc.text);
  index.set(doc, { text: doc.text, tables });
  return tables;
}

export const isWorkbook = (doc: { text: string }) => tablesFor(doc).some((t) => t.columns.length > 0);

const MONEY = String.raw`(?:TL|TRY|USD|EUR|₺|\$|€)`;
/** "1.234,50 ₺", "₺ 1.234", "%12,5", "12,5 %", "(5)", "-₺1.234", "−5", "1.234*", "1.234 (2)": the number in it. */
const AMOUNT = new RegExp(String.raw`^(\()?\s*([-−–])?\s*(?:${MONEY}|%)?\s*([-−–])?\s*(\d+(?:[.,]\d+)*)\s*(?:${MONEY}|%)?\s*(\))?\s*(?:[*¹²³⁴⁵⁶⁷⁸⁹⁰]+|\(\d\))?$`, "iu");
/** An accounting format's zero: a dash, maybe with the currency ("-", " -   ₺ "). */
const ZERO = new RegExp(String.raw`^(?:[-–—]\s*${MONEY}?|${MONEY}\s*[-–—])$`, "iu");

/**
 * A cell's number, exactly, in the sheet's own writing (see Table.english): currency, % and footnote marks around it,
 * "(5)" and "−5" negative, an accounting dash zero (the same forms lib/checks cellNumber reads). Null when the cell is
 * something else ("—" alone is text here: a missing value, not a zero someone wrote).
 */
function numberIn(t: Table, raw: string): Exact | null {
  return amountIn(t, raw)?.value ?? null;
}

/** "TL", "TRY", "₺" are one unit; "$" and "USD" another; "%" its own. "" for a plain number. */
const unitOf = (s: string) => {
  const u = s.toUpperCase();
  return /TL|TRY|₺/u.test(u) ? "₺" : /USD|\$/u.test(u) ? "$" : /EUR|€/u.test(u) ? "€" : /%/u.test(u) ? "%" : "";
};

/** numberIn with the cell's unit, so a sum never adds liras to dollars or a share to an amount. */
function amountIn(t: Table, raw: string): { value: Exact; unit: string } | null {
  const c = (t.english ? trDigits(raw) : raw).replace(/\s+/gu, " ").trim();
  if (ZERO.test(c) && c !== "—") return { value: cellNumber("0")!, unit: unitOf(c) };
  const m = AMOUNT.exec(c);
  if (!m || !!m[1] !== !!m[5] || (m[2] && m[3])) return null;
  const v = cellNumber(m[4]);
  if (!v) return null;
  return { value: m[1] || m[2] || m[3] ? { n: -v.n, d: v.d } : v, unit: unitOf(c.replace(m[4], "")) };
}

const MAX_VALUES = 12;
/** One value as the schema shows it: long texts cut, so a wide sheet's shape stays small. */
const MAX_VALUE = 60;
const short = (v: string) => (v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v);
const MAX_NOTES = 1500;

/**
 * What the model sees instead of the rows: per sheet its columns (numbers with their range, words with a few values)
 * and its other text (titles, notes), shortened.
 */
export function schemaOf(tables: Table[]): string {
  return tables.map((t) => {
    const notes = t.notes.join("\n");
    const text = notes ? `\nTablo dışındaki metin:\n${notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}\n…(kısaltıldı)` : notes}` : "";
    if (!t.columns.length) return `Sayfa: ${t.sheet} (tablo yok)${text}`;
    const cols = t.columns.map((c, k) => {
      const vals = t.rows.map((r) => r[k]).filter((v) => v !== "");
      const nums = vals.map((v) => numberIn(t, v));
      if (vals.length && nums.every(Boolean)) {
        const sorted = vals.map((v, i) => [v, nums[i]!] as const).sort((a, b) => (a[1].n * b[1].d < b[1].n * a[1].d ? -1 : 1));
        return `- ${short(c)}: sayı (${short(sorted[0][0])} … ${short(sorted.at(-1)![0])})`;
      }
      const distinct = [...new Set(vals)];
      const shown = distinct.slice(0, MAX_VALUES).map(short).join(" | ");
      return `- ${short(c)}: metin, ${distinct.length} farklı değer: ${shown}${distinct.length > MAX_VALUES ? " | …" : ""}`;
    });
    const where = t.excelRows?.length ? `, Excel satırları ${t.excelRows[0]}–${t.excelRows.at(-1)}` : "";
    const totals = t.totals.length ? `\nToplam satırları (sorgulara katılmaz, sonuçla birlikte verilir): ${t.totals.map((r) => short(r.cells.filter(Boolean).join(" · "))).join(" | ")}` : "";
    return `Sayfa: ${t.sheet} (${t.rows.length} satır${where})${t.hidden ? " — Excel'de gizli sayfa" : ""}\nSütunlar:\n${cols.join("\n")}${totals}${text}`;
  }).join("\n\n");
}

export interface Filter { sutun: string; esit?: string[]; icerir?: string[] }
export interface Query {
  sayfa: string; filtreler?: Filter[]; topla?: string[]; grupla?: string[]; sutunlar?: string[];
  /** Rows ordered by this column: dates as dates, numbers as numbers, else as text (empty cells last). */
  sirala?: string;
  /** Newest, largest or last first. */
  azalan?: boolean;
  /** At most this many rows (1–MAX_ROWS). */
  adet?: number;
  /** Without `sirala`: the sheet's last rows (its latest entries) first. */
  sondan?: boolean;
}

const MAX_ROWS = 200;

const MONTHS = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const DAY_FIRST = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ t]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/u;
const YEAR_FIRST = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/u;
const NAMED = /^(\d{1,2}) (\p{L}+) (\d{4})(?:[ t]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/u;
/**
 * A cell's date as a sortable number (yyyymmddhhmmss), or null: 12.03.2024, 12/03/2024, 12-03-2024 (day first, as
 * Turkish sheets write), 2024-03-12, "12 Mart 2024", the first two maybe with a time ("2024-03-12 14:30").
 */
export function dateKey(raw: string): number | null {
  const s = low(raw.trim());
  const at = (y: string, mo: number, d: string, h = "0", mi = "0", se = "0") => {
    const [Y, D, H, MI, SE] = [y, d, h, mi, se].map(Number);
    // A day the calendar has: 31.02 or 29.02.2025 is no date (it would sort as one).
    const days = new Date(Date.UTC(Y, mo, 0)).getUTCDate();
    if (mo < 1 || mo > 12 || D < 1 || D > days || H > 23 || MI > 59 || SE > 59) return null;
    return ((((Y * 100 + mo) * 100 + D) * 100 + H) * 100 + MI) * 100 + SE;
  };
  let m = DAY_FIRST.exec(s);
  if (m) return at(m[3], +m[2], m[1], m[4], m[5], m[6]);
  m = YEAR_FIRST.exec(s);
  if (m) return at(m[1], +m[2], m[3], m[4], m[5], m[6]);
  m = NAMED.exec(s);
  return m && MONTHS.includes(m[2]) ? at(m[3], MONTHS.indexOf(m[2]) + 1, m[1], m[4], m[5], m[6]) : null;
}

export interface QueryResult {
  /** What the model reads: the request echoed, then the result. */
  text: string;
  /** The result table alone (the document's cells and column names, the code's sums): no echo of the model's words. */
  table: string;
  /** The sheet as the workbook names it. */
  sheet: string;
  numbers: string[];
  /** The rows each line counted ("37 proje"): the code's figures too, for the number check. */
  counts: string[];
}

/**
 * Rows of one sheet that pass every filter (a cell equal to one of `esit`, or containing one of `icerir`; case and
 * Turkish letters as people write them; a number equal as a number, "2025" and "2.025" alike where the sheet writes so).
 * A filter with no value to compare is an error, never "every row". With `topla`: those columns summed exactly, per
 * `grupla` group and in all. Without: the rows themselves (`sutunlar` of them), at most MAX_ROWS. `numbers` are the sums
 * (figures derived from the document, for the number check).
 */
export function runQuery(tables: Table[], q: Query): QueryResult | { error: string } {
  const withTable = tables.filter((x) => x.columns.length);
  const t = withTable.find((x) => low(x.sheet) === low(q.sayfa ?? ""));
  if (!t) return { error: `"${q.sayfa ?? ""}" adında tablolu sayfa yok. Sayfalar: ${withTable.map((x) => x.sheet).join(", ")}` };
  // Read before its numbers were written one way (an upload from before SHEET_TR): "1.234" may be a thousand or one and
  // a bit, as the file had it. No sum is made from such a guess; the document is read as text instead.
  if (t.english) return { error: `"${t.sheet}" sayfası eski biçimde okunmuş; sayıların yazımı belli değil, tablo sorgusu yapılamaz. Dosya yeniden yüklenirse sorgulanabilir.` };
  const col = (name: string) => t.columns.findIndex((c) => low(c) === low(name));
  const named = [...(q.filtreler ?? []).map((f) => f.sutun), ...(q.topla ?? []), ...(q.grupla ?? []), ...(q.sutunlar ?? [])];
  const unknown = named.filter((n) => col(n) < 0);
  if (unknown.length) return { error: `Bu sütunlar "${t.sheet}" sayfasında yok: ${[...new Set(unknown)].join(", ")}. Sütunlar: ${t.columns.join(", ")}` };
  const empty = (q.filtreler ?? []).filter((f) => ![...(f.esit ?? []), ...(f.icerir ?? [])].some((v) => v.trim()));
  if (empty.length) return { error: `Şu sütunların filtresinde karşılaştırılacak değer yok: ${empty.map((f) => f.sutun).join(", ")}. esit ya da icerir içine en az bir değer yazın.` };
  // A column of numbers compares as numbers ("2025" and "2.025" where the sheet writes so); any other column as text,
  // so codes keep their leading zeros ("01" isn't "1").
  const numeric = new Set(t.columns.map((_, k) => k).filter((k) => {
    const vals = t.rows.map((r) => r[k]).filter((v) => v !== "");
    return vals.length > 0 && vals.every((v) => numberIn(t, v));
  }));
  const same = (k: number, cell: string, v: string) => {
    if (low(cell) === low(v)) return true;
    // A leading zero is a code's ("01"), whatever the column: compared as written.
    if (!numeric.has(k) || /^0\d/u.test(cell.trim()) || /^0\d/u.test(v.trim())) return false;
    const a = numberIn(t, cell);
    const b = numberIn({ ...t, english: false }, v.trim());
    return !!a && !!b && a.n * b.d === b.n * a.d;
  };
  const passes = (r: string[]) => (q.filtreler ?? []).every((f) => {
    const k = col(f.sutun);
    const cell = r[k];
    const has = (f.icerir ?? []).map(low).filter(Boolean);
    return (f.esit ?? []).some((v) => v.trim() && same(k, cell, v)) || has.some((h) => low(cell).includes(h));
  });
  let hits = t.rows.filter(passes);
  if (q.sirala !== undefined && col(q.sirala) < 0) return { error: `Bu sütun "${t.sheet}" sayfasında yok: ${q.sirala}. Sütunlar: ${t.columns.join(", ")}` };
  if (q.adet !== undefined && !(Number.isInteger(q.adet) && q.adet >= 1 && q.adet <= MAX_ROWS)) return { error: `adet 1 ile ${MAX_ROWS} arasında bir tam sayı olmalı.` };
  // Ordered by a column the way its cells read: all dates by date, all numbers by number, else Turkish text order.
  // Empty cells last either way.
  let order = "";
  if (q.sirala !== undefined) {
    const k = col(q.sirala);
    const full = hits.map((r) => r[k]).filter((v) => v.trim() !== "");
    const dates = full.length > 0 && full.every((v) => dateKey(v) !== null);
    const nums = !dates && full.length > 0 && full.every((v) => numberIn(t, v));
    const dir = q.azalan ? -1 : 1;
    const cmp = (a: string, b: string) => {
      if (dates) return Math.sign(dateKey(a)! - dateKey(b)!);
      if (nums) {
        const x = numberIn(t, a)!;
        const y = numberIn(t, b)!;
        const d = x.n * y.d - y.n * x.d;
        return d < 0 ? -1 : d > 0 ? 1 : 0;
      }
      return a.localeCompare(b, "tr");
    };
    hits = hits.map((r, i) => ({ r, i })).sort((a, b) => {
      const ea = a.r[k].trim() === "";
      const eb = b.r[k].trim() === "";
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
      // Equal ones by their place in the sheet, the same way round: newest first puts the later entry of a day first.
      return dir * (cmp(a.r[k], b.r[k]) || a.i - b.i);
    }).map((x) => x.r);
    order = `; sıralama: ${t.columns[k]} ${q.azalan ? "azalan" : "artan"} (${dates ? "tarih" : nums ? "sayı" : "metin"} olarak)`;
  } else if (q.sondan) {
    hits = [...hits].reverse();
    order = "; sayfanın son satırından başlayarak";
  }
  const asked = [
    `sayfa ${t.sheet}`,
    ...(q.filtreler ?? []).map((f) => `${f.sutun} ${[...(f.esit ?? []).map((v) => `= ${v}`), ...(f.icerir ?? []).map((v) => `içerir ${v}`)].join(" ya da ")}`),
  ].join("; ");
  const head = `Tablo sorgusu (kodla, belgedeki hücrelerden): ${asked}${order}. Eşleşen satır: ${hits.length}.`;
  // Said with every result: the sheet hidden, and its own total rows (kept out of the rows above, never summed again).
  const letterOf = (k: number) => letter((t.firstCol ?? 0) + k);
  const totalLines = t.totals.map((r) => `- ${r.excel ? `Excel satırı ${r.excel}: ` : ""}${t.columns.map((c, k) => (r.cells[k] ? `${c} = ${r.cells[k]}` : "")).filter(Boolean).join("; ")}`);
  const after = [
    t.hidden ? "Not: bu sayfa Excel'de gizli." : "",
    totalLines.length ? `Sayfanın kendi toplam satırları (yukarıdaki satırlara ve toplamlara katılmadı):\n${totalLines.join("\n")}` : "",
  ].filter(Boolean).join("\n");
  const tail = after ? `\n\n${after}` : "";
  const excelOf = new Map(t.excelRows ? t.rows.map((r, i) => [r, t.excelRows![i]] as const) : []);
  const md = (cols: string[], rows: string[][]) =>
    [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/gu, "\\|")).join(" | ")} |`)].join("\n");
  if (!q.topla?.length) {
    const show = q.sutunlar?.length ? q.sutunlar.map(col) : t.columns.map((_, k) => k);
    const n = Math.min(q.adet ?? MAX_ROWS, MAX_ROWS);
    const picked = hits.slice(0, n);
    // Where each row stands in the workbook: its Excel row first, the columns' letters below the table.
    const at = excelOf.size ? picked.map((r) => String(excelOf.get(r) ?? "")) : [];
    const rows = picked.map((r, i) => [...(at.length ? [at[i]] : []), ...show.map((k) => r[k])]);
    const cut = hits.length > n && q.adet === undefined ? `\n…(ilk ${MAX_ROWS} satır; daha dar bir filtre, sirala ve adet ya da topla kullanın)` : "";
    const table = md([...(at.length ? ["Excel satırı"] : []), ...show.map((k) => t.columns[k])], rows);
    const letters = at.length ? `\nSütunların Excel harfleri: ${show.map((k) => `${t.columns[k]} ${letterOf(k)}`).join(", ")}.` : "";
    return { text: `${head}\n\n${table}${cut}${letters}${tail}`, table, sheet: t.sheet, numbers: at.filter(Boolean), counts: [String(hits.length)] };
  }
  const sums = q.topla.map(col);
  const keys = (q.grupla ?? []).map(col);
  const groups = new Map<string, { key: string[]; rows: string[][] }>();
  for (const r of hits) {
    const key = keys.map((k) => r[k]);
    const id = JSON.stringify(key.map(low));
    const g = groups.get(id) ?? { key, rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  }
  // Counted once, over the matched rows (a group's sum and the grand total read the same cells).
  const skipped = hits.reduce((n, r) => n + sums.filter((k) => r[k] !== "" && !numberIn(t, r[k])).length, 0);
  const numbers: string[] = [];
  // A sum with a cell that isn't a number is no sum: said so in its place, and never a figure the check may accept.
  const total = (rows: string[][], k: number) => {
    const vals: Exact[] = [];
    const units = new Set<string>();
    let bad = 0;
    for (const r of rows) {
      if (r[k] === "") continue;
      const a = amountIn(t, r[k]);
      if (a) {
        vals.push(a.value);
        units.add(a.unit);
      } else bad++;
    }
    if (bad) return `— (${bad} hücre sayı değil)`;
    // One currency, maybe beside plain numbers (an accounting zero, a cell without the sign); never two currencies,
    // never a share (%) with anything else.
    const money = [...units].filter((u) => u && u !== "%");
    if (money.length > 1 || (units.has("%") && units.size > 1)) return `— (farklı birimler: ${[...units].map((u) => u || "birimsiz").join(", ")})`;
    const s = sumText(vals);
    numbers.push(s);
    return s;
  };
  const list = [...groups.values()].slice(0, MAX_ROWS);
  const body = list.map((g) => [...g.key, String(g.rows.length), ...sums.map((k) => total(g.rows, k))]);
  if (keys.length && groups.size > 1) body.push([...keys.map((_, i) => (i ? "" : "Toplam")), String(hits.length), ...sums.map((k) => total(hits, k))]);
  const cols = [...keys.map((k) => t.columns[k]), "Satır sayısı", ...sums.map((k) => `${t.columns[k]} toplamı`)];
  const notes = [
    groups.size > MAX_ROWS ? `…(ilk ${MAX_ROWS} grup)` : "",
    skipped ? `Sayı olmayan ${skipped} hücre var; o hücrelerin bulunduğu toplamlar yazılmadı (—).` : "",
  ].filter(Boolean).join(" ");
  const table = md(cols, body);
  const counts = [String(hits.length), ...(keys.length ? list.map((g) => String(g.rows.length)) : [])];
  return { text: `${head}\n\n${table}${notes ? `\n${notes}` : ""}${tail}`, table, sheet: t.sheet, numbers, counts };
}
