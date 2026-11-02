// An Excel template: its own file is edited cell by cell. SheetJS would rewrite the file and drop styles, so the sheet XML is
// changed directly and everything not filled stays byte for byte what it was (colours, widths, formulas, images).
import type JSZip from "jszip";
import { MAX_SLOTS, TemplateError, cleanValue, findTokens, readGrid, tokenLabel, uniqueLabels, type Filled, type GridCell, type Layout, type Slot, type TableSlot, type Values } from "./template.ts";
import { all, kid, kids, openZip, parseXml, saveZip, textOf, writeXml, type El } from "./template-xml.ts";

const MAX_GRID_ROWS = 3000;
const MAX_GRID_COLS = 120;
const MAX_MERGES = 5000;

export const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const parseRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
};
const parseRange = (ref: string) => {
  const [a, b = a] = ref.split(":");
  const s = parseRef(a), e = parseRef(b);
  return s && e ? { s, e } : null;
};

/**
 * A formula after k rows were added at row `at` (1-based): references at or below it move, so a range running through it
 * grows. Text in quotes, and references to other sheets, are left alone; this sheet's own name in front changes nothing.
 */
export function shiftFormula(f: string, at: number, k: number, sheet?: string): string {
  const move = (col: string, dollar: string, row: string) => `${col}${dollar}${Number(row) >= at ? Number(row) + k : Number(row)}`;
  return f.replace(/("(?:[^"]|"")*")|('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(?<![\p{L}\p{N}_.$])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\p{L}\p{N}_(.])/gu, (m, quoted, named, ref, col, dollar, row) => {
    if (quoted) return m;
    if (named) {
      const name = named.startsWith("'") ? named.slice(1, -1).replace(/''/g, "'") : named;
      return name.toLowerCase() === sheet?.toLowerCase() ?`${named}!${ref.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (_: string, c: string, d: string, r: string) => move(c, d, r))}` : m;
    }
    return move(col, dollar, row);
  });
}

interface Sheet {
  name: string;
  path: string;
  doc: Document;
  data: El;
  merged: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  rows: Map<number, El>;
}
interface Book {
  zip: JSZip;
  sheets: Sheet[];
  shared: string[];
  workbook: Document;
  workbookPath: string;
}

async function open(bytes: Uint8Array): Promise<Book> {
  const zip = await openZip(bytes, "Excel şablonu okunamadı. Dosya .xlsx olmalı.");
  const part = async (p: string) => zip.file(p)?.async("string");
  const types = await part("[Content_Types].xml");
  const workbookPath = types && /PartName="\/([^"]*)"[^>]*ContentType="[^"]*(?:spreadsheetml\.sheet\.main|\.template\.main|macroEnabled\.main)/.exec(types)?.[1];
  const wbText = workbookPath && (await part(workbookPath));
  if (!workbookPath || !wbText) throw new TemplateError("Excel şablonu okunamadı. Dosya .xlsx olmalı.");
  const workbook = parseXml(wbText);
  const dir = workbookPath.includes("/") ? workbookPath.slice(0, workbookPath.lastIndexOf("/") + 1) : "";
  const relsPath = `${dir}_rels/${workbookPath.slice(dir.length)}.rels`;
  const relsText = await part(relsPath);
  if (!relsText) throw new TemplateError("Excel şablonu okunamadı.");
  const rels = new Map(kids(parseXml(relsText).documentElement, "Relationship").map((r) => [r.getAttribute("Id")!, r]));
  const resolve = (target: string) => (target.startsWith("/") ? target.slice(1) : `${dir}${target}`);

  const shared: string[] = [];
  const sharedRel = [...rels.values()].find((r) => r.getAttribute("Type")?.endsWith("/sharedStrings"));
  const sharedText = sharedRel && (await part(resolve(sharedRel.getAttribute("Target")!)));
  if (sharedText) {
    for (const si of kids(parseXml(sharedText).documentElement, "si")) {
      // Phonetic runs are guides, not text.
      shared.push(all(si, "t").filter((t) => (t.parentNode as El).localName !== "rPh").map(textOf).join(""));
    }
  }

  const sheets: Sheet[] = [];
  for (const s of kids(kid(workbook.documentElement, "sheets") ?? workbook.documentElement, "sheet")) {
    if ((s.getAttribute("state") || "visible") !== "visible") continue; // hidden sheets aren't the form people see
    const rid = s.getAttribute("r:id") ?? [...Array.from(s.attributes)].find((a) => a.localName === "id")?.value;
    const target = rid && rels.get(rid)?.getAttribute("Target");
    const path = target ? resolve(target) : "";
    const text = path && (await part(path));
    if (!text) continue; // a chart sheet
    const doc = parseXml(text);
    const data = kid(doc.documentElement, "sheetData");
    if (!data) continue;
    const merged = kids(kid(doc.documentElement, "mergeCells") ?? doc.documentElement, "mergeCell").flatMap((m) => parseRange(m.getAttribute("ref") ?? "") ?? []);
    sheets.push({ name: s.getAttribute("name") ?? "Sayfa", path, doc, data, merged, rows: new Map(kids(data, "row").map((r) => [Number(r.getAttribute("r")) - 1, r])) });
  }
  if (!sheets.length) throw new TemplateError("Excel şablonunda sayfa bulunamadı.");
  return { zip, sheets, shared, workbook, workbookPath };
}

function cellText(c: El, shared: string[]): string {
  const t = c.getAttribute("t");
  if (t === "inlineStr") return all(c, "t").map(textOf).join("");
  const v = kid(c, "v");
  if (!v) return "";
  return t === "s" ? (shared[Number(textOf(v))] ?? "") : textOf(v);
}

interface GridOf { grid: (GridCell | undefined)[][]; styled: Set<string>; texts: Map<string, string> }

function gridOf(sh: Sheet, shared: string[]): GridOf {
  const grid: (GridCell | undefined)[][] = [];
  const styled = new Set<string>();
  const texts = new Map<string, string>();
  let maxRow = -1, maxCol = -1;
  const covered = new Set<string>();
  if (sh.merged.length > MAX_MERGES) throw new TemplateError("Şablonda çok fazla birleşik hücre var.");
  let walked = 0;
  for (const m of sh.merged) {
    // A 5 KB file can declare a merge of the whole sheet: only what the grid can hold is walked.
    const lastRow = Math.min(m.e.r, MAX_GRID_ROWS - 1), lastCol = Math.min(m.e.c, MAX_GRID_COLS - 1);
    walked += Math.max(0, lastRow - m.s.r + 1) * Math.max(0, lastCol - m.s.c + 1);
    if (walked > MAX_GRID_ROWS * 10) throw new TemplateError("Şablonda çok fazla birleşik hücre var.");
    for (let r = m.s.r; r <= lastRow; r++) for (let c = m.s.c; c <= lastCol; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r},${c}`);
    maxRow = Math.max(maxRow, lastRow);
    maxCol = Math.max(maxCol, lastCol);
  }
  const cells: [number, number, GridCell][] = [];
  for (const [r, row] of sh.rows) {
    for (const c of kids(row, "c")) {
      const at = parseRef(c.getAttribute("r") ?? "");
      if (!at || at.r !== r || at.c >= MAX_GRID_COLS || r >= MAX_GRID_ROWS) continue;
      const text = cellText(c, shared);
      if (Number(c.getAttribute("s") ?? 0) > 0) styled.add(`${r},${at.c}`);
      if (text) texts.set(`${r},${at.c}`, text);
      cells.push([r, at.c, { text, locked: !!kid(c, "f") }]);
      if (text || styled.has(`${r},${at.c}`)) {
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, at.c);
      }
    }
  }
  maxRow = Math.min(maxRow, MAX_GRID_ROWS - 1);
  maxCol = Math.min(maxCol, MAX_GRID_COLS - 1);
  for (let r = 0; r <= maxRow; r++) grid[r] = new Array(maxCol + 1).fill(undefined);
  for (const [r, c, cell] of cells) if (r <= maxRow && c <= maxCol) grid[r][c] = cell;
  for (const k of covered) {
    const [r, c] = k.split(",").map(Number);
    if (r <= maxRow && c <= maxCol) grid[r][c] = { text: "", locked: true };
  }
  return { grid, styled, texts };
}

interface Found {
  slots: (Slot & { sheet: Sheet; r: number; c: number; token?: { start: number; end: number } })[];
  tables: (TableSlot & { sheet: Sheet; headerRow: number; cols: number[]; firstRow: number; capacity: number; atEnd: boolean })[];
}

function find(book: Book): Found {
  const slots: Found["slots"] = [];
  const tables: Found["tables"] = [];
  const many = book.sheets.length > 1;
  for (const sh of book.sheets) {
    const { grid, styled, texts } = gridOf(sh, book.shared);
    const prefix = many ? `${sh.name}: ` : "";
    const id = (r: number, c: number) => `${sh.name}!${colName(c)}${r + 1}`;
    // Blank marks first: what a person marked is surely meant for filling.
    const marked = new Set<number>();
    for (const [k, text] of texts) {
      const [r, c] = k.split(",").map(Number);
      if (grid[r]?.[c]?.locked) continue;
      const tokens = findTokens(text);
      tokens.forEach((t, i) => {
        marked.add(r);
        const left = text.slice(0, t.start).trim() ? "" : (grid[r].slice(0, c).reverse().find((x) => x?.text.trim())?.text.trim() ?? "");
        slots.push({ id: `${id(r, c)}#${i}`, label: prefix + (t.name || tokenLabel(text, t) || left.replace(/[:\s]+$/, "") || id(r, c)), sheet: sh, r, c, token: t });
      });
    }
    const clean = grid.map((row, r) => (marked.has(r) ? row.map((x) => (x && findTokens(x.text).length ? { ...x, locked: true } : x)) : row));
    // In a form an empty cell meant for writing has a border or a colour, or stands after "Ad:". With neither anywhere
    // on the sheet, any cell beside a heading counts.
    const narrowed = readGrid(clean, (r, c) => styled.has(`${r},${c}`) || /:\s*$/.test(clean[r].slice(0, c).reverse().find((x) => x?.text)?.text ?? ""));
    const { tables: ts, pairs } = narrowed.pairs.length || narrowed.tables.length || marked.size ? narrowed : readGrid(clean);
    for (const p of pairs) slots.push({ id: id(p.r, p.c), label: prefix + p.label, sheet: sh, r: p.r, c: p.c });
    for (const t of ts) {
      tables.push({
        id: `${sh.name}!T${t.headerRow + 1}`,
        label: `${prefix}${t.labels.slice(0, 4).join(", ")}${t.labels.length > 4 ? "…" : ""}`,
        columns: t.cols.map((c, i) => ({ id: colName(c), label: t.labels[i] })),
        rows: t.rows,
        sheet: sh,
        headerRow: t.headerRow,
        cols: t.cols,
        firstRow: t.firstRow,
        capacity: t.rows,
        atEnd: t.atEnd,
      });
    }
  }
  if (slots.length + tables.length > MAX_SLOTS) throw new TemplateError(`Şablonda çok fazla alan var (en fazla ${MAX_SLOTS}).`);
  return { slots: uniqueLabels(slots), tables };
}

export async function readXlsxTemplate(bytes: Uint8Array): Promise<Layout> {
  const { slots, tables } = find(await open(bytes));
  return {
    format: "xlsx",
    slots: slots.map(({ id, label }) => ({ id, label })),
    tables: tables.map(({ id, label, columns, rows }) => ({ id, label, columns, rows })),
  };
}

// Only numbers that are surely numbers: an id or phone with a leading zero, or too long to survive as one, stays text.
export function excelNumber(text: string): number | null {
  const t = text.trim();
  if (/^0\d/.test(t) || /^[+-]?\d{15,}$/.test(t)) return null;
  let s: string | null = null;
  if (/^[+-]?\d+$/.test(t)) s = t;
  else if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) s = t.replace(/\./g, "").replace(",", ".");
  else if (/^[+-]?\d+,\d+$/.test(t)) s = t.replace(",", ".");
  else if (/^[+-]?\d+\.\d{1,2}$/.test(t)) s = t;
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cellAt(sh: Sheet, r: number, c: number): El {
  const ns = sh.data.namespaceURI;
  let row = sh.rows.get(r);
  if (!row) {
    row = sh.doc.createElementNS(ns, "row");
    row.setAttribute("r", String(r + 1));
    const after = [...sh.rows.keys()].filter((k) => k > r).sort((a, b) => a - b)[0];
    sh.data.insertBefore(row, after === undefined ? null : sh.rows.get(after)!);
    sh.rows.set(r, row);
  }
  let before: El | null = null;
  for (const x of kids(row, "c")) {
    const at = parseRef(x.getAttribute("r") ?? "");
    if (!at) continue;
    if (at.c === c) return x;
    if (at.c > c) {
      before = x;
      break;
    }
  }
  const cell = sh.doc.createElementNS(ns, "c");
  cell.setAttribute("r", `${colName(c)}${r + 1}`);
  row.insertBefore(cell, before);
  return cell;
}

function write(sh: Sheet, r: number, c: number, text: string, keepText = false) {
  const cell = cellAt(sh, r, c);
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  const ns = sh.data.namespaceURI;
  const n = keepText ? null : excelNumber(text);
  if (n !== null) {
    cell.removeAttribute("t");
    const v = sh.doc.createElementNS(ns, "v");
    v.appendChild(sh.doc.createTextNode(String(n)));
    cell.appendChild(v);
    return;
  }
  cell.setAttribute("t", "inlineStr");
  const is = sh.doc.createElementNS(ns, "is");
  const t = sh.doc.createElementNS(ns, "t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(sh.doc.createTextNode(text));
  is.appendChild(t);
  cell.appendChild(is);
}

const sqrefShift = (s: string, at: number, k: number) => s.split(/\s+/).map((part) => part.replace(/([A-Z]+)(\d+)/gi, (_, col, row) => `${col}${Number(row) >= at ? Number(row) + k : Number(row)}`)).join(" ");

/** Why rows can't be added safely: other parts point into this sheet by row, and they'd end up pointing at the wrong cells. */
async function growBlocked(book: Book, sh: Sheet): Promise<string | null> {
  const name = sh.name.replace(/'/g, "''");
  // Excel doesn't mind the case of a sheet's name. \b knows no Turkish letters: the name's own start is checked by hand.
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mention = new RegExp(`(?:'${safe}'|(?<![\\p{L}\\p{N}_.])${safe})!`, "iu");
  const names = all(book.workbook.documentElement, "definedName").filter((d) => !/^_xlnm\.(Print_Area|Print_Titles|_FilterDatabase)$/.test(d.getAttribute("name") ?? ""));
  if (names.some((d) => mention.test(textOf(d)))) return "tanımlı adlar";
  // Every sheet in the file, hidden ones too: only visible ones are in book.sheets.
  for (const path of Object.keys(book.zip.files).filter((p) => /worksheets\/[^/]+\.xml$/.test(p) && p !== sh.path)) {
    const formulas = all(parseXml(await book.zip.file(path)!.async("string")).documentElement, "f");
    if (formulas.some((f) => mention.test(textOf(f)))) return "başka sayfaların formülleri";
  }
  const root = sh.doc.documentElement;
  if (kid(root, "tableParts") && kids(kid(root, "tableParts")!, "tablePart").length) return "Excel tablosu";
  if (all(sh.data, "f").some((f) => f.getAttribute("t") === "shared" || f.getAttribute("t") === "array")) return "paylaşılan formüller";
  if (kid(root, "drawing")) return "sayfadaki çizim ya da görsel";
  return null;
}

/** k rows added at row index `at` (0-based, a blank row of the table), each a copy of it, with its formulas moved along. */
function insertRows(book: Book, sh: Sheet, at: number, k: number) {
  const at1 = at + 1;
  const moving = [...sh.rows.keys()].filter((r) => r >= at).sort((a, b) => b - a);
  const model = sh.rows.get(at);
  // Formulas everywhere on the sheet first: their text is what refers to rows.
  for (const f of all(sh.data, "f")) {
    const text = textOf(f);
    while (f.firstChild) f.removeChild(f.firstChild);
    f.appendChild(sh.doc.createTextNode(shiftFormula(text, at1, k, sh.name)));
  }
  for (const r of moving) {
    const row = sh.rows.get(r)!;
    row.setAttribute("r", String(r + k + 1));
    for (const c of kids(row, "c")) {
      const ref = parseRef(c.getAttribute("r") ?? "");
      if (ref) c.setAttribute("r", `${colName(ref.c)}${r + k + 1}`);
    }
    sh.rows.delete(r);
    sh.rows.set(r + k, row);
  }
  // The next row actually in the file: a blank row may not exist in the XML at all, and rows must stay in order.
  const nextKey = [...sh.rows.keys()].filter((r) => r >= at + k).sort((a, b) => a - b)[0];
  const anchor = nextKey === undefined ? null : sh.rows.get(nextKey)!;
  for (let i = 0; i < k; i++) {
    const r = at + i;
    const row = (model ? model.cloneNode(true) : sh.doc.createElementNS(sh.data.namespaceURI, "row")) as El;
    row.setAttribute("r", String(r + 1));
    for (const c of kids(row, "c")) {
      const ref = parseRef(c.getAttribute("r") ?? "");
      if (ref) c.setAttribute("r", `${colName(ref.c)}${r + 1}`);
      const f = kid(c, "f");
      if (f) {
        // The copy's own row: a formula reading its neighbours on the row reads the new row's.
        const from = at1 + k; // the blank row has already moved here, its formulas with it
        const text = textOf(f).replace(new RegExp(`(?<![\\p{L}\\p{N}_.$])(\\$?[A-Z]{1,3})${from}(?![\\d(])`, "gu"), `$1${r + 1}`);
        while (f.firstChild) f.removeChild(f.firstChild);
        f.appendChild(sh.doc.createTextNode(text));
      } else {
        while (c.firstChild) c.removeChild(c.firstChild);
        c.removeAttribute("t");
      }
      const v = kid(c, "v");
      if (v && f) c.removeChild(v);
    }
    sh.data.insertBefore(row, anchor);
    sh.rows.set(r, row);
  }
  const root = sh.doc.documentElement;
  for (const m of all(kid(root, "mergeCells") ?? sh.doc.createElement("x"), "mergeCell")) m.setAttribute("ref", sqrefShift(m.getAttribute("ref") ?? "", at1, k));
  sh.merged = kids(kid(root, "mergeCells") ?? sh.doc.createElement("x"), "mergeCell").flatMap((m) => parseRange(m.getAttribute("ref") ?? "") ?? []);
  const dim = kid(root, "dimension");
  if (dim) dim.setAttribute("ref", sqrefShift(dim.getAttribute("ref") ?? "", at1, k));
  for (const name of ["conditionalFormatting", "dataValidation", "selection", "autoFilter", "hyperlink", "ignoredError"]) {
    for (const el of all(root, name)) {
      for (const attr of ["sqref", "ref", "activeCell"]) {
        const v = el.getAttribute(attr);
        if (v) el.setAttribute(attr, sqrefShift(v, at1, k));
      }
    }
  }
  for (const b of all(root, "brk")) {
    const id = Number(b.getAttribute("id"));
    if (id >= at) b.setAttribute("id", String(id + k));
  }
  // Print area and print titles of this sheet.
  const name = sh.name.replace(/'/g, "''");
  for (const d of all(book.workbook.documentElement, "definedName")) {
    const text = textOf(d);
    if (!text.includes(`${name}!`) && !text.includes(`${name}'!`)) continue;
    while (d.firstChild) d.removeChild(d.firstChild);
    d.appendChild(book.workbook.createTextNode(text.replace(/\$([A-Z]+)\$(\d+)/g, (_, col, row) => `$${col}$${Number(row) >= at1 ? Number(row) + k : Number(row)}`)));
  }
}

export async function fillXlsxTemplate(bytes: Uint8Array, values: Values): Promise<Filled> {
  const book = await open(bytes);
  const { slots, tables } = find(book);
  const notes: string[] = [];
  const touched = new Set<Sheet>();
  let grew = false;
  // Single cells with several marks are written together, from the last mark back so positions stay right.
  const perCell = new Map<string, Found["slots"]>();
  for (const s of slots) {
    const k = `${s.sheet.path}|${s.r},${s.c}`;
    perCell.set(k, [...(perCell.get(k) ?? []), s]);
  }
  for (const group of perCell.values()) {
    const { sheet, r, c } = group[0];
    if (group[0].token) {
      let text = cellText(cellAt(sheet, r, c), book.shared);
      const whole = group.length === 1 && group[0].token!.start === 0 && group[0].token!.end === text.trim().length;
      let any = false;
      for (const s of [...group].sort((a, b) => b.token!.start - a.token!.start)) {
        const v = cleanValue(values.slots[s.id]);
        if (!v) continue;
        text = text.slice(0, s.token!.start) + v + text.slice(s.token!.end);
        any = true;
      }
      if (any) {
        write(sheet, r, c, text, !whole);
        touched.add(sheet);
      }
    } else {
      const v = cleanValue(values.slots[group[0].id]);
      if (v) {
        write(sheet, r, c, v);
        touched.add(sheet);
      }
    }
  }
  // Bottom up: rows added to a lower table must not move an upper one that is still to be written.
  for (const t of [...tables].sort((a, b) => b.firstRow - a.firstRow)) {
    const rows = (values.tables[t.id] ?? []).filter((row) => row.some((x) => cleanValue(x)));
    if (!rows.length) continue;
    let fit = rows.length;
    const extra = rows.length - t.capacity;
    if (extra > 0 && !t.atEnd) {
      const blocked = t.capacity > 0 ? await growBlocked(book, t.sheet) : "boş satır yok";
      if (blocked) {
        fit = t.capacity;
        notes.push(`${t.label}: ${rows.length} kayıttan ${fit} tanesi şablona sığdı; satır eklemek ${blocked} nedeniyle güvenli değil. Kalan ${rows.length - fit} kayıt yazılmadı.`);
      } else {
        // Inside the block, not after it: a total below reading B3:B12 then grows with it.
        insertRows(book, t.sheet, t.firstRow + t.capacity - 1, extra);
        grew = true;
      }
    }
    rows.slice(0, fit).forEach((row, i) => {
      t.cols.forEach((c, j) => {
        const v = cleanValue(row[j]);
        if (!v) return;
        write(t.sheet, t.firstRow + i, c, v);
        // Past the sheet's last row there's no cell yet: it takes the look of the table's first blank row.
        const cell = cellAt(t.sheet, t.firstRow + i, c);
        const look = t.capacity > 0 ? cellAt(t.sheet, t.firstRow, c).getAttribute("s") : null;
        if (look && !cell.getAttribute("s")) cell.setAttribute("s", look);
      });
    });
    touched.add(t.sheet);
  }
  for (const sh of touched) {
    // Rows written past the sheet's old end: the declared size follows, readers trust it.
    const dim = kid(sh.doc.documentElement, "dimension");
    const range = dim && parseRange(dim.getAttribute("ref") ?? "");
    if (dim && range) {
      for (const [r, row] of sh.rows) {
        range.e.r = Math.max(range.e.r, r);
        for (const c of kids(row, "c")) range.e.c = Math.max(range.e.c, parseRef(c.getAttribute("r") ?? "")?.c ?? 0);
      }
      dim.setAttribute("ref", `${colName(range.s.c)}${range.s.r + 1}:${colName(range.e.c)}${range.e.r + 1}`);
    }
    book.zip.file(sh.path, writeXml(sh.doc));
  }
  const anyOutcome = touched.size > 0;
  if (anyOutcome) {
    // Formulas that read the filled cells are worked out again when the file opens.
    const root = book.workbook.documentElement;
    let calc = kid(root, "calcPr");
    if (!calc) {
      calc = book.workbook.createElementNS(root.namespaceURI, "calcPr");
      const later = kids(root).find((k) => !["fileVersion", "fileSharing", "workbookPr", "workbookProtection", "bookViews", "sheets", "functionGroups", "externalReferences", "definedNames"].includes(k.localName));
      root.insertBefore(calc, later ?? null);
    }
    calc.setAttribute("fullCalcOnLoad", "1");
    book.zip.file(book.workbookPath, writeXml(book.workbook));
  }
  if (grew) await dropCalcChain(book);
  return { bytes: await saveZip(book.zip), notes };
}

/** It lists formula cells by address; after rows move Excel calls a stale one damage. Excel rebuilds it by itself. */
async function dropCalcChain(book: Book) {
  const entry = Object.keys(book.zip.files).find((f) => /(^|\/)calcChain\.xml$/.test(f));
  if (!entry) return;
  book.zip.remove(entry);
  const types = await book.zip.file("[Content_Types].xml")!.async("string");
  book.zip.file("[Content_Types].xml", types.replace(/<Override[^>]*calcChain[^>]*\/>/, ""));
  const dir = book.workbookPath.slice(0, book.workbookPath.lastIndexOf("/") + 1);
  const relsPath = `${dir}_rels/${book.workbookPath.slice(dir.length)}.rels`;
  const rels = await book.zip.file(relsPath)!.async("string");
  book.zip.file(relsPath, rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ""));
}
