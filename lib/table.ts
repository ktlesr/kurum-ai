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
    const about = (l: string) => l === SHEET_TR || /^(Satır: \d+, Sütun: \d+|Sütun başlıkları: )/u.test(l);
    const at = lines.findIndex((l) => l.trimStart().startsWith("|"));
    const isTable = at >= 0 && /^\s*\|?\s*:?-{3,}/u.test(lines[at + 1] ?? "");
    if (!isTable) {
      out.push({ sheet, columns: [], rows: [], notes: lines.slice(1).filter((l) => l.trim() && !about(l)), english });
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
    const rows = grid.slice(h + 1).map((r) => columns.map((_, k) => r[k] ?? ""));
    out.push({ sheet, columns, rows, notes, english });
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
    return `Sayfa: ${t.sheet} (${t.rows.length} satır)\nSütunlar:\n${cols.join("\n")}${text}`;
  }).join("\n\n");
}

export interface Filter { sutun: string; esit?: string[]; icerir?: string[] }
export interface Query { sayfa: string; filtreler?: Filter[]; topla?: string[]; grupla?: string[]; sutunlar?: string[] }

const MAX_ROWS = 200;

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
  const hits = t.rows.filter(passes);
  const asked = [
    `sayfa ${t.sheet}`,
    ...(q.filtreler ?? []).map((f) => `${f.sutun} ${[...(f.esit ?? []).map((v) => `= ${v}`), ...(f.icerir ?? []).map((v) => `içerir ${v}`)].join(" ya da ")}`),
  ].join("; ");
  const head = `Tablo sorgusu (kodla, belgedeki hücrelerden): ${asked}. Eşleşen satır: ${hits.length}.`;
  const md = (cols: string[], rows: string[][]) =>
    [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/gu, "\\|")).join(" | ")} |`)].join("\n");
  if (!q.topla?.length) {
    const show = q.sutunlar?.length ? q.sutunlar.map(col) : t.columns.map((_, k) => k);
    const rows = hits.slice(0, MAX_ROWS).map((r) => show.map((k) => r[k]));
    const cut = hits.length > MAX_ROWS ? `\n…(ilk ${MAX_ROWS} satır; daha dar bir filtre ya da topla kullanın)` : "";
    const table = md(show.map((k) => t.columns[k]), rows);
    return { text: `${head}\n\n${table}${cut}`, table, sheet: t.sheet, numbers: [], counts: [String(hits.length)] };
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
  return { text: `${head}\n\n${table}${notes ? `\n${notes}` : ""}`, table, sheet: t.sheet, numbers, counts };
}
