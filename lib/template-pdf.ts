// A PDF template: usually a Word or Excel form saved as PDF, so its "cells" are only lines on the page. The lines are read back
// into cells, which then read like any other form (lib/template readGrid). Values are drawn on the page in place; a PDF has no
// rows to add, so what doesn't fit is said, never cut. A PDF with real form fields has those filled instead.
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFTextField, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { MAX_SLOTS, TemplateError, cleanValue, findTokens, readGrid, tokenLabel, uniqueLabels, type Filled, type GridCell, type Layout, type Slot, type TableSlot, type Values } from "./template.ts";

const MAX_PAGES = 60;
const TOL = 1.5; // points: lines this close are one line
const PAD = 2.5;

export interface Run { x: number; y: number; w: number; size: number; text: string }
export interface Seg { a: number; b: number; at: number }
export interface Box { x: number; y: number; w: number; h: number }

type PdfSlot = Slot & ({ kind: "field"; name: string } | { kind: "box"; page: number; box: Box; size: number; erase?: Box; centerY: boolean });
type PdfTable = TableSlot & { page: number; cells: { box: Box; size: number }[][] };

interface PdfjsDoc {
  numPages: number;
  getPage(n: number): Promise<{
    rotate: number;
    getViewport(o: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }>;
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  }>;
  loadingTask: { destroy(): Promise<void> };
}

type M = [number, number, number, number, number, number];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const times = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Straight lines on a page, in page coordinates: strokes, and the thin filled rectangles Office tools draw borders with. */
async function linesOf(page: Awaited<ReturnType<PdfjsDoc["getPage"]>>): Promise<{ h: Seg[]; v: Seg[] }> {
  const { OPS } = await getResolvedPDFJS();
  const ops = await page.getOperatorList();
  const h: Seg[] = [];
  const v: Seg[] = [];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(y1 - y2) <= 0.5 && Math.abs(x1 - x2) > 1) h.push({ a: Math.min(x1, x2), b: Math.max(x1, x2), at: (y1 + y2) / 2 });
    else if (Math.abs(x1 - x2) <= 0.5 && Math.abs(y1 - y2) > 1) v.push({ a: Math.min(y1, y2), b: Math.max(y1, y2), at: (x1 + x2) / 2 });
  };
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(m);
    else if (fn === OPS.restore) m = stack.pop() ?? m;
    else if (fn === OPS.transform) m = times(m, args as unknown as M);
    else if (fn === OPS.constructPath) {
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      const paint = args[0] as number;
      // A clip draws nothing (LibreOffice clips to the whole page: taken for lines, the page would be one big cell).
      if (!data || paint === OPS.endPath) return;
      // The outline of a filled area is no line either: backgrounds count only when thin enough to be a border.
      const filled = paint === OPS.fill || paint === OPS.eoFill;
      let at: [number, number] | null = null;
      let start: [number, number] | null = null;
      const points: [number, number][] = [];
      let curved = false;
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === 0 || op === 1) {
          const p = apply(m, data[k], data[k + 1]);
          k += 2;
          if (op === 0) start = p;
          else if (at && !filled) add(at[0], at[1], p[0], p[1]);
          at = p;
          points.push(p);
        } else if (op === 2) {
          k += 6;
          curved = true;
        } else if (op === 3) {
          k += 4;
          curved = true;
        } else if (op === 4) {
          if (at && start && !filled) add(at[0], at[1], start[0], start[1]);
          at = start;
        } else break;
      }
      // A thin rectangle is a border, however it was painted; it adds its long side once.
      if (!curved && points.length >= 4) {
        const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        if (y1 - y0 <= 2.5 && x1 - x0 > 3) h.push({ a: x0, b: x1, at: (y0 + y1) / 2 });
        else if (x1 - x0 <= 2.5 && y1 - y0 > 3) v.push({ a: y0, b: y1, at: (x0 + x1) / 2 });
      }
    }
  });
  return { h, v };
}

const cluster = (vals: number[]) => {
  const out: number[] = [];
  for (const x of [...vals].sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > TOL) out.push(x);
  return out;
};
const covered = (segs: Seg[], at: number, a: number, b: number) => {
  // Pieces of one line count together: a border is often drawn cell by cell.
  const parts = segs.filter((s) => Math.abs(s.at - at) <= TOL && s.b > a - TOL && s.a < b + TOL).sort((x, y) => x.a - y.a);
  let reach = a;
  for (const s of parts) {
    if (s.a > reach + TOL * 2) return false;
    reach = Math.max(reach, s.b);
  }
  return reach >= b - TOL * 2;
};

/** Closed cells from the page's lines. A missing inner line makes one merged cell. */
export function cellsOf(h: Seg[], v: Seg[]): Box[] {
  const ys = cluster(h.map((s) => s.at)).reverse(); // top down
  const xs = cluster(v.map((s) => s.at));
  const out: Box[] = [];
  const used = new Set<string>();
  for (let i = 0; i + 1 < ys.length; i++) {
    for (let j = 0; j + 1 < xs.length; j++) {
      if (used.has(`${i},${j}`)) continue;
      const top = ys[i], left = xs[j];
      if (!covered(v, left, ys[i + 1], top) || !covered(h, top, left, xs[j + 1])) continue;
      let k = j + 1;
      while (k < xs.length && !covered(v, xs[k], ys[i + 1], top)) k++;
      if (k >= xs.length) continue;
      let n = i + 1;
      while (n < ys.length && !covered(h, ys[n], left, xs[k])) n++;
      if (n >= ys.length) continue;
      // All four sides close.
      if (!covered(h, top, left, xs[k]) || !covered(v, left, ys[n], top) || !covered(v, xs[k], ys[n], top)) continue;
      out.push({ x: left, y: ys[n], w: xs[k] - left, h: top - ys[n] });
      for (let a = i; a < n; a++) for (let b = j; b < k; b++) used.add(`${a},${b}`);
    }
  }
  return out.filter((c) => c.w >= 12 && c.h >= 6);
}

/** Cells that touch form one table. */
function tablesOf(cells: Box[]): Box[][] {
  const parent = cells.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const touch = (a: Box, b: Box) => a.x <= b.x + b.w + TOL && b.x <= a.x + a.w + TOL && a.y <= b.y + b.h + TOL && b.y <= a.y + a.h + TOL;
  cells.forEach((a, i) => cells.forEach((b, j) => {
    if (i < j && touch(a, b)) parent[root(i)] = root(j);
  }));
  const groups = new Map<number, Box[]>();
  cells.forEach((c, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), c]));
  return [...groups.values()].sort((a, b) => Math.max(...b.map((c) => c.y + c.h)) - Math.max(...a.map((c) => c.y + c.h)));
}

const inside = (r: Run, b: Box) => {
  const cx = r.x + Math.min(r.w, 6) / 2;
  const cy = r.y + r.size * 0.3;
  return cx >= b.x - 1 && cx <= b.x + b.w + 1 && cy >= b.y - 1 && cy <= b.y + b.h + 1;
};
const textIn = (runs: Run[], b: Box) => {
  const hits = runs.filter((r) => inside(r, b)).sort((p, q) => Math.abs(p.y - q.y) > TOL ? q.y - p.y : p.x - q.x);
  return hits.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
};

/** One line's items as whole runs: a PDF can place every word, or every letter, on its own. */
export function runsOf(items: { str?: string; transform?: number[]; width?: number; height?: number }[]): Run[] {
  const raw = items.flatMap((i): Run[] => {
    const t = i.transform;
    if (!i.str || !t || !i.str.trim()) return [];
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) return []; // turned text: a stamp or side note
    return [{ x: t[4], y: t[5], w: i.width ?? 0, size: Math.abs(t[3]) || i.height || 10, text: i.str }];
  }).sort((a, b) => (Math.abs(a.y - b.y) > TOL ? b.y - a.y : a.x - b.x));
  const out: Run[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    const gap = last ? r.x - (last.x + last.w) : 0;
    if (last && Math.abs(last.y - r.y) <= TOL && gap < Math.max(r.size, last.size) * 0.8 && gap > -2) {
      last.text += gap > r.size * 0.15 && !last.text.endsWith(" ") && !r.text.startsWith(" ") ? ` ${r.text}` : r.text;
      last.w = r.x + r.w - last.x;
      last.size = Math.max(last.size, r.size);
    } else out.push({ ...r });
  }
  return out;
}

interface Scan { slots: PdfSlot[]; tables: PdfTable[]; rotated: boolean; anyText: boolean }

async function scan(bytes: Uint8Array): Promise<Scan> {
  // pdf.js takes the buffer over: a copy, because pdf-lib reads the same bytes afterwards.
  const pdf = (await getDocumentProxy(new Uint8Array(bytes)).catch(() => {
    throw new TemplateError("PDF şablonu okunamadı. Bozuk ya da parola korumalı olabilir.");
  })) as unknown as PdfjsDoc;
  const out: Scan = { slots: [], tables: [], rotated: false, anyText: false };
  try {
    if (pdf.numPages > MAX_PAGES) throw new TemplateError(`PDF şablonu en fazla ${MAX_PAGES} sayfa olabilir.`);
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      if (page.rotate % 360 !== 0) {
        out.rotated = true;
        continue;
      }
      const { width } = page.getViewport({ scale: 1 });
      const runs = runsOf((await page.getTextContent()).items);
      if (runs.length) out.anyText = true;
      const { h, v } = await linesOf(page);
      const cells = cellsOf(h, v);
      const inCell = new Set<Run>();
      let n = 0;
      const sizeNear = (b: Box) => runs.filter((r) => inside(r, b))[0]?.size;
      const typical = runs.map((r) => r.size).sort((a, b) => a - b)[Math.floor(runs.length / 2)] ?? 10;
      for (const group of tablesOf(cells)) {
        // Rows and columns of this table from its own cells.
        const tops = cluster(group.map((c) => c.y + c.h)).reverse();
        const lefts = cluster(group.map((c) => c.x));
        const rowOf = (y: number) => tops.findIndex((t) => Math.abs(t - y) <= TOL);
        const colOf = (x: number) => lefts.findIndex((l) => Math.abs(l - x) <= TOL);
        const grid: (GridCell | undefined)[][] = tops.map(() => new Array(lefts.length).fill(undefined));
        const boxAt = new Map<string, Box>();
        for (const c of group) {
          const r = rowOf(c.y + c.h), col = colOf(c.x);
          if (r < 0 || col < 0) continue;
          const text = textIn(runs, c);
          for (const run of runs) if (inside(run, c)) inCell.add(run);
          const marks = findTokens(text).length > 0;
          grid[r][col] = { text: marks ? text : text, locked: marks };
          boxAt.set(`${r},${col}`, c);
          for (let cc = col + 1; cc < lefts.length && lefts[cc] < c.x + c.w - TOL; cc++) grid[r][cc] = { text: "", locked: true };
          for (let rr = r + 1; rr < tops.length && tops[rr] > c.y + TOL; rr++) {
            for (let cc = col; cc < lefts.length && lefts[cc] < c.x + c.w - TOL; cc++) grid[rr][cc] = { text: "", locked: true };
          }
        }
        const { tables, pairs } = readGrid(grid);
        for (const pair of pairs) {
          const box = boxAt.get(`${pair.r},${pair.c}`);
          if (box) out.slots.push({ id: `p${p}-${n++}`, label: pair.label, kind: "box", page: p, box, size: sizeNear(box) ?? typical, centerY: true });
        }
        for (const t of tables) {
          const rows: { box: Box; size: number }[][] = [];
          for (let r = t.firstRow; r < t.firstRow + t.rows; r++) rows.push(t.cols.map((c) => ({ box: boxAt.get(`${r},${c}`)!, size: typical })));
          if (!rows.length || rows.some((row) => row.some((c) => !c.box))) continue;
          out.tables.push({
            id: `p${p}-t${n++}`,
            label: t.labels.slice(0, 4).join(", ") + (t.labels.length > 4 ? "…" : ""),
            columns: t.cols.map((c, i) => ({ id: String(c), label: t.labels[i] })),
            rows: rows.length,
            page: p,
            cells: rows,
          });
        }
      }
      // Blank marks, in or out of a cell. A run's letters are taken as even width: close enough for where a mark begins.
      for (const r of runs) {
        const tokens = findTokens(r.text);
        for (const t of tokens) {
          const unit = r.w / Math.max(1, r.text.length);
          const box: Box = { x: r.x + t.start * unit, y: r.y - r.size * 0.25, w: Math.max((t.end - t.start) * unit, 10), h: r.size * 1.25 };
          // Everything to the right up to the next text on the line is free too.
          const next = runs.filter((o) => o !== r && Math.abs(o.y - r.y) <= TOL && o.x > box.x).map((o) => o.x).sort((a, b) => a - b)[0];
          const endsRun = !r.text.slice(t.end).trim();
          const room = endsRun ? (next ?? width - 30) - box.x - PAD : box.w;
          const dotted = /^[.…]/.test(r.text.slice(t.start));
          out.slots.push({
            id: `p${p}-${n++}`,
            label: tokenLabel(r.text, t) || "Alan",
            kind: "box",
            page: p,
            box: { ...box, w: Math.max(box.w, room) },
            size: r.size,
            centerY: false,
            // Dots go under the value (a line stays: it is what one writes on). Words in brackets go too.
            ...(dotted || t.name ? { erase: { ...box } } : {}),
          });
        }
      }
      // "Ad Soyad:" with room after it; or a label sitting on a line of its own, to write along.
      const free = runs.filter((r) => !inCell.has(r) && !findTokens(r.text).length && /\p{L}/u.test(r.text));
      for (const r of free) {
        const end = r.x + r.w;
        const next = runs.filter((o) => o !== r && Math.abs(o.y - r.y) <= TOL && o.x >= end - 1).map((o) => o.x).sort((a, b) => a - b)[0];
        // A writing line starts after the label; a line running under the label too is a table's top or an underlined title.
        const ruling = h.filter((s) => s.at <= r.y + 1 && s.at >= r.y - r.size * 0.8 && s.b > end + 20 && s.a >= end - 3 && s.a < end + r.size * 2).sort((a, b) => b.b - a.b)[0];
        const limit = Math.min(next ?? Infinity, ruling ? ruling.b : next === undefined ? width - 30 : Infinity);
        const room = limit - end - PAD * 2;
        if (r.text.trim().length > 120 || room < 40) continue;
        if (!/:\s*$/.test(r.text) && !ruling) continue;
        out.slots.push({
          id: `p${p}-${n++}`,
          label: r.text.trim().replace(/[:\s]+$/, ""),
          kind: "box",
          page: p,
          box: { x: end + PAD, y: r.y - r.size * 0.25, w: room, h: r.size * 1.25 },
          size: r.size,
          centerY: false,
        });
      }
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  out.slots = uniqueLabels(out.slots);
  return out;
}

async function loadPdf(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes);
  } catch {
    throw new TemplateError("PDF şablonu okunamadı. Bozuk ya da parola korumalı olabilir.");
  }
}

const textFields = (doc: PDFDocument) => {
  try {
    return doc.getForm().getFields().filter((f): f is PDFTextField => f instanceof PDFTextField && !f.isReadOnly());
  } catch {
    return [];
  }
};

export async function readPdfTemplate(bytes: Uint8Array): Promise<Layout> {
  const fields = textFields(await loadPdf(bytes));
  if (fields.length) {
    if (fields.length > MAX_SLOTS) throw new TemplateError(`Şablonda çok fazla alan var (en fazla ${MAX_SLOTS}).`);
    return { format: "pdf", slots: fields.map((f) => ({ id: `f:${f.getName()}`, label: f.getName().split(".").pop()!.replace(/[_-]+/g, " ") })), tables: [] };
  }
  const s = await scan(bytes);
  if (!s.anyText) throw new TemplateError("Bu PDF taranmış görünüyor: üzerinde metin yok, alanları okunamıyor. Şablonun Word ya da Excel halini kullanın.");
  if (s.slots.length + s.tables.length > MAX_SLOTS) throw new TemplateError(`Şablonda çok fazla alan var (en fazla ${MAX_SLOTS}).`);
  return {
    format: "pdf",
    slots: s.slots.map(({ id, label }) => ({ id, label })),
    tables: s.tables.map(({ id, label, columns, rows }) => ({ id, label, columns, rows })),
  };
}

const FONT_FILE = path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"); // has every Turkish letter, and ₺

/** The words on lines that fit `w`. A word wider than a line alone: null, the size is too large. */
export function wrapText(text: string, w: number, width: (s: string) => number): string[] | null {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (width(word) > w) return null;
      const next = line ? `${line} ${word}` : word;
      if (width(next) <= w) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** False: it can't be written at a readable size in this box. Nothing is cut: a partial number is worse than a blank. */
function draw(page: PDFPage, font: PDFFont, text: string, box: Box, wanted: number, centerY: boolean): boolean {
  const w = box.w - PAD * 2;
  for (let size = Math.min(wanted, 11); size >= 5.5; size -= 0.5) {
    const lines = wrapText(text, w, (s) => font.widthOfTextAtSize(s, size));
    if (!lines) continue;
    const lh = size * 1.18;
    const need = lines.length * lh;
    if (need > box.h + (lines.length === 1 ? size * 0.5 : 0)) continue;
    // From the top line's baseline down. One line in a box sits in its middle; on a ruled line it sits on the line.
    const top = centerY ? box.y + (box.h + need) / 2 - size : box.y + box.h - size * 0.95;
    lines.forEach((line, i) => page.drawText(line, { x: box.x + PAD, y: top - i * lh, size, font, color: rgb(0.05, 0.05, 0.1) }));
    return true;
  }
  return false;
}

export async function fillPdfTemplate(bytes: Uint8Array, values: Values): Promise<Filled> {
  const doc = await loadPdf(bytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile(FONT_FILE), { subset: true });
  const notes: string[] = [];
  const fields = textFields(doc);
  if (fields.length) {
    for (const f of fields) {
      const v = cleanValue(values.slots[`f:${f.getName()}`]);
      if (!v) continue;
      const max = f.getMaxLength();
      if (max !== undefined && v.length > max) {
        notes.push(`${f.getName()}: değer alanın sınırından (${max} karakter) uzun, yazılmadı.`);
        continue;
      }
      if (v.includes("\n") && !f.isMultiline()) f.setText(v.replace(/\n/g, " "));
      else f.setText(v);
    }
    doc.getForm().updateFieldAppearances(font);
    return { bytes: await doc.save(), notes };
  }
  const s = await scan(bytes);
  if (s.rotated) notes.push("Döndürülmüş sayfalar doldurulmadı.");
  const pages = doc.getPages();
  for (const slot of s.slots) {
    const v = cleanValue(values.slots[slot.id]);
    if (!v || slot.kind !== "box") continue;
    const page = pages[slot.page - 1];
    if (slot.erase) page.drawRectangle({ ...{ x: slot.erase.x, y: slot.erase.y, width: slot.erase.w, height: slot.erase.h }, color: rgb(1, 1, 1) });
    if (!draw(page, font, v, slot.box, slot.size, slot.centerY)) notes.push(`${slot.label}: değer alana sığmadı, yazılmadı.`);
  }
  for (const t of s.tables) {
    const rows = (values.tables[t.id] ?? []).filter((r) => r.some((x) => cleanValue(x)));
    if (!rows.length) continue;
    const page = pages[t.page - 1];
    rows.slice(0, t.rows).forEach((row, i) => {
      t.cells[i].forEach((cell, j) => {
        const v = cleanValue(row[j]);
        if (v && !draw(page, font, v, cell.box, cell.size, true)) notes.push(`${t.columns[j].label} (${i + 1}. satır): değer alana sığmadı, yazılmadı.`);
      });
    });
    if (rows.length > t.rows) notes.push(`${t.label}: ${rows.length} kayıttan ${t.rows} tanesi sığdı; PDF'e satır eklenemez. Bütün kayıtlar için şablonun Word ya da Excel halini kullanın.`);
  }
  return { bytes: await doc.save(), notes };
}
