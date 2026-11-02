// Filling a user's own blank template from their documents. What the formats share: what can be filled (read from the
// template the same way every time, so ids stay valid between reading and filling, and nothing has to be stored), and how a
// table of cells is read. No Next, no server-only: tests drive it directly.

export type TemplateFormat = "xlsx" | "docx" | "pdf" | "json";
export const TEMPLATE_FORMATS: readonly TemplateFormat[] = ["xlsx", "docx", "pdf", "json"];

export interface Slot {
  id: string;
  /** What belongs here, in the template's own words. */
  label: string;
}
export interface TableSlot {
  id: string;
  label: string;
  columns: { id: string; label: string }[];
  /** Rows that fit before anything has to move. */
  rows: number;
}
export interface Layout {
  format: TemplateFormat;
  slots: Slot[];
  tables: TableSlot[];
}
export interface Values {
  slots: Record<string, string>;
  /** Per table: rows, each cell in the order of `columns`. */
  tables: Record<string, string[][]>;
}
export interface Filled {
  bytes: Uint8Array;
  /** What could not be done as asked, in words for the user. */
  notes: string[];
}

/** For the user: a template this code can't work with. */
export class TemplateError extends Error {}

export const MAX_SLOTS = 400;
export const MAX_ROWS = 2000;
export const MAX_VALUE = 4000;

/** What can't stand in a document, whatever the model or a request sent: control characters, and overlong text. */
export const cleanValue = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").trim().slice(0, MAX_VALUE) : "");

// Marks people leave for filling in: {{name}}, <<name>>, [name], at least 3 underscores, at least 4 dots.
// [1] or [12] is a reference, not a blank; a bracket needs a letter.
const TOKEN = /\{\{\s*[^{}]{1,80}?\s*\}\}|<<\s*[^<>]{1,80}?\s*>>|\[[^\[\]\n]{0,80}\p{L}[^\[\]\n]{0,80}\]|_{3,}|\.{4,}|…{2,}/gu;

export interface Token {
  start: number;
  end: number;
  /** The name inside, if the mark has one. */
  name: string;
}
export function findTokens(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    name: m[0].replace(/^[{<[\s]+|[}>\]\s]+$/g, "").replace(/^[_.…]+$/, ""),
  }));
}

/** The words a blank mark stands for: its own name, else what is written just before it on the line (or after it). */
export function tokenLabel(text: string, t: Token): string {
  if (t.name) return t.name;
  const before = text.slice(0, t.start).split(/[\n\t]/).pop()!.replace(TOKEN, " ").trim();
  if (before) return before.slice(-70).replace(/[:\s]+$/, "");
  return text.slice(t.end).split(/[\n\t]/)[0].replace(TOKEN, " ").trim().slice(0, 70);
}

export interface GridCell {
  text: string;
  /** A formula, or a part of a merged cell: not to be written. */
  locked?: boolean;
}
export interface GridPair { r: number; c: number; label: string }
export interface GridTable { headerRow: number; cols: number[]; labels: string[]; firstRow: number; rows: number; atEnd: boolean }

const isBlank = (c: GridCell | undefined) => !c || (!c.locked && !c.text.trim());
const hasText = (c: GridCell | undefined) => !!c && !c.locked && /\p{L}/u.test(c.text);
const isFull = (c: GridCell | undefined) => !!c && !c.locked && !!c.text.trim();
const labelOf = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[:\s]+$/, "").slice(0, 120);

/**
 * Where a grid wants filling. Reads a form the way a person does:
 * - a row of adjacent headings over empty rows: a table to list records in;
 * - headings over rows that start with their own name, the rest empty: each empty cell is "row name, column name";
 * - a heading beside an empty cell: that cell.
 * `free(r, c)` narrows the last kind on grids where any empty cell isn't meant for writing.
 */
export function readGrid(grid: (GridCell | undefined)[][], free: (r: number, c: number) => boolean = () => true): { tables: GridTable[]; pairs: GridPair[] } {
  const tables: GridTable[] = [];
  const pairs: GridPair[] = [];
  const taken = new Set<number>();
  const width = (r: number) => grid[r]?.length ?? 0;
  const nextOpen = (r: number, c: number) => {
    let n = c + 1;
    while (grid[r]?.[n]?.locked && !grid[r][n]!.text) n++; // the rest of a merged label
    return n;
  };
  for (let r = 0; r < grid.length; r++) {
    if (taken.has(r)) continue;
    const texts: number[] = [];
    for (let c = 0; c < width(r); c++) if (isFull(grid[r][c])) texts.push(c);
    // A heading row may hold years, but a row of figures alone is data: it fills nothing.
    if (!texts.some((c) => hasText(grid[r][c]))) continue;
    if (texts.length >= 2) {
      const adjacent = texts.every((c, i) => i === 0 || nextOpen(r, texts[i - 1]) === c);
      const looksLikeForm = texts.every((c) => /:\s*$/.test(grid[r][c]!.text));
      if (adjacent && !looksLikeForm) {
        // Records go under every heading; a formula column works by itself.
        const writable = (row: number) => texts.filter((c) => !grid[row]?.[c]?.locked);
        const empty = (row: number) => writable(row).length > 0 && writable(row).every((c) => isBlank(grid[row]?.[c]));
        let n = 0;
        while (r + 1 + n < grid.length && empty(r + 1 + n)) n++;
        const atEnd = r + 1 + n >= grid.length;
        if (n > 0 || atEnd) {
          const cols = n > 0 ? writable(r + 1) : texts;
          if (cols.length) {
            tables.push({ headerRow: r, cols, labels: cols.map((c) => labelOf(grid[r][c]!.text)), firstRow: r + 1, rows: n, atEnd });
            for (let k = r; k <= r + n; k++) taken.add(k);
            continue;
          }
        }
        // Row names down the first column, the rest empty.
        const [first, ...others] = texts;
        const beside = (row: number) => hasText(grid[row]?.[first]) && others.some((c) => isBlank(grid[row]?.[c]));
        let rows = 0;
        while (r + 1 + rows < grid.length && beside(r + 1 + rows)) rows++;
        if (rows > 0) {
          for (let k = 1; k <= rows; k++) {
            for (const c of others) {
              if (isBlank(grid[r + k]?.[c])) pairs.push({ r: r + k, c, label: `${labelOf(grid[r + k][first]!.text)} / ${labelOf(grid[r][c]!.text)}` });
            }
            taken.add(r + k);
          }
          taken.add(r);
          continue;
        }
        // Not a heading after all: a header row with nothing to fill under it is left alone.
        taken.add(r);
        continue;
      }
    }
    for (const c of texts) {
      if (!hasText(grid[r][c])) continue;
      const n = nextOpen(r, c);
      if (n < width(r) && isBlank(grid[r][n]) && !grid[r][n]?.locked && free(r, n) && grid[r][c]!.text.trim().length <= 120) pairs.push({ r, c: n, label: labelOf(grid[r][c]!.text) });
    }
  }
  return { tables, pairs };
}

/** Numbered, so two fields with the same words stay two fields in the model's and the user's eyes. */
export function uniqueLabels<T extends { label: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = (seen.get(it.label) ?? 0) + 1;
    seen.set(it.label, n);
    return n > 1 ? { ...it, label: `${it.label} (${n})` } : it;
  });
}
