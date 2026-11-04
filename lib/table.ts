// A workbook's sheets as tables the code can query (the table index). A big workbook isn't read by the model row by row:
// it sees each sheet's shape (columns, a few values each, schemaOf) and asks for what it needs (runQuery: rows that
// match, or sums by group), worked here exactly. Faster (a few thousand tokens instead of tens of thousands) and the
// totals can't be made up. Parsed from the text lib/parse made ("## Sheet: X" then one Markdown table), so it needs no
// store of its own. No "server-only": the test drives it.

import { cellNumber, sumText, type Exact } from "./calc.ts";

export interface Table { sheet: string; columns: string[]; rows: string[][] }

const cells = (line: string) => line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split(/(?<!\\)\|/u).map((c) => c.replace(/\\\|/gu, "|").trim());
const low = (s: string) => s.toLocaleLowerCase("tr").trim();

/** Each sheet's first table; sheets without one are left out. */
export function tablesOf(text: string): Table[] {
  const out: Table[] = [];
  for (const part of text.split(/(?=^## Sheet: )/mu)) {
    if (!part.startsWith("## Sheet: ")) continue;
    const lines = part.split("\n");
    const sheet = lines[0].slice("## Sheet: ".length).trim();
    const at = lines.findIndex((l) => l.trimStart().startsWith("|"));
    if (at < 0 || !/^\s*\|?\s*:?-{3,}/u.test(lines[at + 1] ?? "")) continue;
    const columns = cells(lines[at]);
    const rows: string[][] = [];
    for (const l of lines.slice(at + 2)) {
      if (!l.trimStart().startsWith("|")) break;
      const r = cells(l);
      rows.push(columns.map((_, k) => r[k] ?? ""));
    }
    out.push({ sheet, columns, rows });
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

export const isWorkbook = (doc: { text: string }) => tablesFor(doc).length > 0;

const MAX_VALUES = 12;

/** What the model sees instead of the rows: per sheet its columns, numbers with their range, words with a few values. */
export function schemaOf(tables: Table[]): string {
  return tables.map((t) => {
    const cols = t.columns.map((c, k) => {
      const vals = t.rows.map((r) => r[k]).filter((v) => v !== "");
      const nums = vals.map(cellNumber);
      if (vals.length && nums.every(Boolean)) {
        const sorted = vals.map((v, i) => [v, nums[i]!] as const).sort((a, b) => (a[1].n * b[1].d < b[1].n * a[1].d ? -1 : 1));
        return `- ${c}: sayı (${sorted[0][0]} … ${sorted.at(-1)![0]})`;
      }
      const distinct = [...new Set(vals)];
      const shown = distinct.slice(0, MAX_VALUES).join(" | ");
      return `- ${c}: metin, ${distinct.length} farklı değer: ${shown}${distinct.length > MAX_VALUES ? " | …" : ""}`;
    });
    return `Sayfa: ${t.sheet} (${t.rows.length} satır)\nSütunlar:\n${cols.join("\n")}`;
  }).join("\n\n");
}

export interface Filter { sutun: string; esit?: string[]; icerir?: string[] }
export interface Query { sayfa: string; filtreler?: Filter[]; topla?: string[]; grupla?: string[]; sutunlar?: string[] }

const MAX_ROWS = 200;

/**
 * Rows of one sheet that pass every filter (a cell equal to one of `esit`, or containing one of `icerir`; case and
 * Turkish letters as people write them). With `topla`: those columns summed exactly, per `grupla` group and in all.
 * Without: the rows themselves (`sutunlar` of them), at most MAX_ROWS. The answer says what was asked and how many rows
 * matched; `numbers` are the sums (figures derived from the document, for the number check).
 */
export interface QueryResult {
  /** What the model reads: the request echoed, then the result. */
  text: string;
  /** The result table alone (the document's cells and column names, the code's sums): no echo of the model's words. */
  table: string;
  /** The sheet as the workbook names it. */
  sheet: string;
  numbers: string[];
}

export function runQuery(tables: Table[], q: Query): QueryResult | { error: string } {
  const t = tables.find((x) => low(x.sheet) === low(q.sayfa ?? ""));
  if (!t) return { error: `"${q.sayfa ?? ""}" adında sayfa yok. Sayfalar: ${tables.map((x) => x.sheet).join(", ")}` };
  const col = (name: string) => t.columns.findIndex((c) => low(c) === low(name));
  const named = [...(q.filtreler ?? []).map((f) => f.sutun), ...(q.topla ?? []), ...(q.grupla ?? []), ...(q.sutunlar ?? [])];
  const unknown = named.filter((n) => col(n) < 0);
  if (unknown.length) return { error: `Bu sütunlar "${t.sheet}" sayfasında yok: ${[...new Set(unknown)].join(", ")}. Sütunlar: ${t.columns.join(", ")}` };
  const passes = (r: string[]) => (q.filtreler ?? []).every((f) => {
    const v = low(r[col(f.sutun)]);
    const eq = (f.esit ?? []).map(low);
    const has = (f.icerir ?? []).map(low).filter(Boolean);
    return (!eq.length && !has.length) || eq.includes(v) || has.some((h) => v.includes(h));
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
    return { text: `${head}\n\n${table}${cut}`, table, sheet: t.sheet, numbers: [] };
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
  const skipped = hits.reduce((n, r) => n + sums.filter((k) => r[k] !== "" && !cellNumber(r[k])).length, 0);
  const numbers: string[] = [];
  const total = (rows: string[][], k: number) => {
    const vals: Exact[] = [];
    for (const r of rows) {
      if (r[k] === "") continue;
      const v = cellNumber(r[k]);
      if (v) vals.push(v);
    }
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
    skipped ? `Sayı olmayan ${skipped} hücre toplama katılmadı.` : "",
  ].filter(Boolean).join(" ");
  const table = md(cols, body);
  return { text: `${head}\n\n${table}${notes ? `\n${notes}` : ""}`, table, sheet: t.sheet, numbers };
}
