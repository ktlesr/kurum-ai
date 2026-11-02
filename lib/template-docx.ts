// A Word template: its own file is edited, so letterhead, styles and tables stay. Reads content controls, blank marks
// ({{ad}}, ____, ....), tables, and paragraphs ending in ":" with nothing after them, in the body, headers and footers.
import type JSZip from "jszip";
import { MAX_SLOTS, TemplateError, cleanValue, findTokens, readGrid, tokenLabel, uniqueLabels, type Filled, type GridCell, type Layout, type Slot, type TableSlot, type Values } from "./template.ts";
import { all, kid, kids, openZip, parseXml, saveZip, textOf, writeXml, type El } from "./template-xml.ts";

interface Part { path: string; doc: Document }

type TextSlot = Slot & (
  | { kind: "control"; sdt: El }
  | { kind: "token"; p: El; start: number; end: number }
  | { kind: "after"; p: El }
  | { kind: "cell"; tc: El }
);
type RowTable = TableSlot & { tbl: El; firstRow: number; cols: number[]; headerRow: number };

const paragraphText = (p: El) => {
  // w:t in order, a tab or a line break as what they look like. Inside a control it belongs to the control.
  let out = "";
  const visit = (n: El) => {
    for (const k of kids(n)) {
      if (k.localName === "t") out += textOf(k);
      else if (k.localName === "tab") out += "\t";
      else if (k.localName === "br") out += "\n";
      else if (k.localName === "pPr" || k.localName === "rPr" || k.localName === "del" || k.localName === "instrText") continue;
      else if (k.localName !== "sdt") visit(k);
    }
  };
  visit(p);
  return out;
};
const textNodes = (p: El) => {
  const out: El[] = [];
  const visit = (n: El) => {
    for (const k of kids(n)) {
      if (k.localName === "t") out.push(k);
      else if (["pPr", "rPr", "del", "sdt"].includes(k.localName)) continue;
      else visit(k);
    }
  };
  visit(p);
  return out;
};

async function open(bytes: Uint8Array): Promise<{ zip: JSZip; parts: Part[] }> {
  const zip = await openZip(bytes, "Word şablonu okunamadı. Dosya .docx olmalı.");
  const body = zip.file("word/document.xml");
  if (!body) throw new TemplateError("Word şablonu okunamadı. Dosya .docx olmalı.");
  const names = ["word/document.xml", ...Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f)).sort()];
  const parts: Part[] = [];
  for (const path of names) parts.push({ path, doc: parseXml(await zip.file(path)!.async("string")) });
  return { zip, parts };
}

/** Cells of a row by grid column: a merged cell takes its span, a continued vertical merge is closed to writing. */
function rowCells(tr: El): { tc: El; c: number; cell: GridCell }[] {
  const out: { tc: El; c: number; cell: GridCell }[] = [];
  let c = 0;
  for (const tc of kids(tr, "tc")) {
    const pr = kid(tc, "tcPr");
    const span = Number(kid(pr ?? tc, "gridSpan")?.getAttribute("w:val") ?? 1) || 1;
    const vm = kid(pr ?? tc, "vMerge");
    const continued = !!vm && (vm.getAttribute("w:val") ?? "continue") !== "restart";
    out.push({ tc, c, cell: { text: all(tc, "p").map(paragraphText).join("\n"), locked: continued } });
    c += span;
  }
  return out;
}
const lockedSpan = (cells: ReturnType<typeof rowCells>) => {
  const row: (GridCell | undefined)[] = [];
  for (let i = 0; i < cells.length; i++) {
    const { c, cell } = cells[i];
    row[c] = cell;
    const next = cells[i + 1]?.c ?? c + 1;
    for (let k = c + 1; k < next; k++) row[k] = { text: "", locked: true };
  }
  return row;
};

function find(parts: Part[]): { slots: TextSlot[]; tables: RowTable[] } {
  let slots: TextSlot[] = [];
  const tables: RowTable[] = [];
  let n = 0;
  let tn = 0;
  for (const { path, doc } of parts) {
    const inPart = path === "word/document.xml" ? "" : path.includes("header") ? "Üst bilgi: " : "Alt bilgi: ";
    for (const sdt of all(doc.documentElement, "sdt")) {
      const pr = kid(sdt, "sdtPr");
      const content = kid(sdt, "sdtContent");
      if (!pr || !content) continue;
      // A date, list, picture or checkbox control has its own value format; plain text and rich text take words.
      if (["picture", "checkbox", "docPartObj", "group"].some((k) => kid(pr, k) || all(pr, k).length)) continue;
      const placeholder = !!kid(pr, "showingPlcHdr") || !textOf(content).trim();
      if (!placeholder) continue;
      const name = kid(pr, "alias")?.getAttribute("w:val") || kid(pr, "tag")?.getAttribute("w:val") || textOf(content).trim().slice(0, 80) || "Alan";
      slots.push({ id: `s${n++}`, label: inPart + name, kind: "control", sdt });
    }
    const consumedCells = new Set<El>();
    for (const tbl of all(doc.documentElement, "tbl")) {
      const trs = kids(tbl, "tr");
      const rows = trs.map(rowCells);
      const { tables: ts, pairs } = readGrid(rows.map(lockedSpan).map((r) => r.map((c) => (c && findTokens(c.text).length ? { ...c, locked: true } : c))));
      for (const t of ts) {
        tables.push({
          id: `t${tn++}`,
          label: inPart + t.labels.slice(0, 4).join(", ") + (t.labels.length > 4 ? "…" : ""),
          columns: t.cols.map((c, i) => ({ id: String(c), label: t.labels[i] })),
          rows: t.rows,
          tbl,
          firstRow: t.firstRow,
          cols: t.cols,
          headerRow: t.headerRow,
        });
        for (let r = t.firstRow; r < t.firstRow + t.rows; r++) for (const x of rows[r]) consumedCells.add(x.tc);
      }
      for (const p of pairs) {
        const hit = rows[p.r].find((x) => x.c === p.c);
        if (!hit || all(hit.tc, "sdt").length) continue;
        slots.push({ id: `s${n++}`, label: inPart + p.label, kind: "cell", tc: hit.tc });
        consumedCells.add(hit.tc);
      }
    }
    for (const p of all(doc.documentElement, "p")) {
      const text = paragraphText(p);
      if (!text.trim()) continue;
      const inControl = (() => {
        for (let up = p.parentNode as El | null; up && up.nodeType === 1; up = up.parentNode as El | null) if (up.localName === "sdt") return true;
        return false;
      })();
      if (inControl) continue;
      const tokens = findTokens(text);
      for (const t of tokens) {
        slots.push({ id: `s${n++}`, label: inPart + (tokenLabel(text, t) || "Alan"), kind: "token", p, start: t.start, end: t.end });
      }
      const inTable = (() => {
        for (let up = p.parentNode as El | null; up && up.nodeType === 1; up = up.parentNode as El | null) if (up.localName === "tc") return true;
        return false;
      })();
      if (!tokens.length && !inTable && /\p{L}[^\n]{0,100}:\s*$/u.test(text) && text.trim().length <= 120) {
        slots.push({ id: `s${n++}`, label: inPart + text.trim().replace(/[:\s]+$/, "").split("\t").pop()!, kind: "after", p });
      }
    }
  }
  slots = uniqueLabels(slots);
  if (slots.length + tables.length > MAX_SLOTS) throw new TemplateError(`Şablonda çok fazla alan var (en fazla ${MAX_SLOTS}).`);
  return { slots, tables };
}

export async function readDocxTemplate(bytes: Uint8Array): Promise<Layout> {
  const { slots, tables } = find((await open(bytes)).parts);
  return {
    format: "docx",
    slots: slots.map(({ id, label }) => ({ id, label })),
    tables: tables.map(({ id, label, columns, rows }) => ({ id, label, columns, rows })),
  };
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function makeRun(doc: Document, text: string, rPr?: El | null): El {
  const r = doc.createElementNS(W, "w:r");
  if (rPr) r.appendChild(rPr.cloneNode(true));
  text.split("\n").forEach((line, i) => {
    if (i) r.appendChild(doc.createElementNS(W, "w:br"));
    const t = doc.createElementNS(W, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(doc.createTextNode(line));
    r.appendChild(t);
  });
  return r;
}

/** A filled value shouldn't take the label's weight: same font and size, not its bold. */
function plainCopy(rPr: El | undefined | null): El | null {
  if (!rPr) return null;
  const copy = rPr.cloneNode(true) as El;
  for (const k of kids(copy)) if (["b", "bCs", "i", "iCs", "u", "caps", "color", "highlight", "shd"].includes(k.localName)) copy.removeChild(k);
  return copy;
}

function setCell(doc: Document, tc: El, text: string, like?: El | null) {
  const p = kid(tc, "p") ?? (tc.appendChild(doc.createElementNS(W, "w:p")) as El);
  const mark = kid(kid(p, "pPr") ?? p, "rPr");
  // A paragraph mark's size is the cell's own choice; else the row's label sets the look.
  const rPr = plainCopy(mark ?? like);
  p.appendChild(makeRun(doc, text, rPr));
}

function replaceSpan(doc: Document, p: El, start: number, end: number, value: string) {
  // Offsets over the paragraph's w:t text: a mark Word split across runs is put back as one.
  // Tabs and line breaks count one character in paragraphText and don't live in a w:t: map through them.
  const full = paragraphText(p);
  const nodes = textNodes(p);
  let at = 0;
  let scan = 0;
  for (const t of nodes) {
    const text = textOf(t);
    // Move past tabs and breaks that came before this text.
    while (full.slice(scan, scan + text.length) !== text && scan < full.length) scan++;
    const from = Math.max(start, scan), to = Math.min(end, scan + text.length);
    if (from < to) {
      const before = text.slice(0, from - scan), after = text.slice(to - scan);
      const piece = at === 0 ? value : "";
      at++;
      while (t.firstChild) t.removeChild(t.firstChild);
      t.setAttribute("xml:space", "preserve");
      // A line break can't live in w:t: spaces keep the value on the mark's own line.
      t.appendChild(doc.createTextNode(before + piece.replace(/\n/g, " ") + after));
    }
    scan += text.length;
  }
}

function setControl(doc: Document, sdt: El, value: string) {
  const pr = kid(sdt, "sdtPr")!;
  const hdr = kid(pr, "showingPlcHdr");
  if (hdr) pr.removeChild(hdr);
  const content = kid(sdt, "sdtContent")!;
  const ts = all(content, "t");
  if (ts.length) {
    // The placeholder look (grey text style) goes with the placeholder.
    const run = ts[0].parentNode as El;
    const rPr = kid(run, "rPr");
    const style = rPr && kid(rPr, "rStyle");
    if (style && /placeholder/i.test(style.getAttribute("w:val") ?? "")) rPr!.removeChild(style);
    ts.slice(1).forEach((t) => {
      while (t.firstChild) t.removeChild(t.firstChild);
    });
    while (ts[0].firstChild) ts[0].removeChild(ts[0].firstChild);
    ts[0].setAttribute("xml:space", "preserve");
    ts[0].appendChild(doc.createTextNode(value.replace(/\n/g, " ")));
    return;
  }
  const p = all(content, "p")[0];
  if (p) p.appendChild(makeRun(doc, value));
  else content.appendChild(makeRun(doc, value));
}

export async function fillDocxTemplate(bytes: Uint8Array, values: Values): Promise<Filled> {
  const { zip, parts } = await open(bytes);
  const { slots, tables } = find(parts);
  const docOf = (el: El) => el.ownerDocument!;
  // Marks in one paragraph from the last back: offsets before it stay right.
  const tokens = slots.filter((s): s is Extract<TextSlot, { kind: "token" }> => s.kind === "token").sort((a, b) => b.start - a.start);
  for (const s of tokens) {
    const v = cleanValue(values.slots[s.id]);
    if (v) replaceSpan(docOf(s.p), s.p, s.start, s.end, v);
  }
  for (const s of slots) {
    const v = cleanValue(values.slots[s.id]);
    if (!v) continue;
    if (s.kind === "control") setControl(docOf(s.sdt), s.sdt, v);
    else if (s.kind === "after") {
      const last = kids(s.p, "r").pop();
      s.p.appendChild(makeRun(docOf(s.p), ` ${v}`, plainCopy(last && kid(last, "rPr"))));
    } else if (s.kind === "cell") setCell(docOf(s.tc), s.tc, v);
  }
  // Bottom up: rows added to a lower block leave the row numbers of the ones above it right.
  for (const t of [...tables].sort((a, b) => b.firstRow - a.firstRow)) {
    const rows = (values.tables[t.id] ?? []).filter((r) => r.some((x) => cleanValue(x)));
    if (!rows.length) continue;
    const doc = docOf(t.tbl);
    const trs = kids(t.tbl, "tr");
    // Rows past the blank ones: copies of the last blank (or of the heading, emptied, when it has none).
    const model = t.rows > 0 ? trs[t.firstRow + t.rows - 1] : trs[t.headerRow];
    const after = trs[t.firstRow + t.rows] ?? null;
    const need = Math.max(0, rows.length - t.rows);
    for (let i = 0; i < need; i++) {
      const copy = model.cloneNode(true) as El;
      for (const tp of kids(copy, "trPr")) for (const h of kids(tp, "tblHeader")) tp.removeChild(h);
      for (const tc of kids(copy, "tc")) {
        const ps = kids(tc, "p");
        ps.slice(1).forEach((p) => tc.removeChild(p));
        if (ps[0]) for (const r of kids(ps[0]).filter((k) => k.localName !== "pPr")) ps[0].removeChild(r);
        const pr = kid(tc, "tcPr");
        const mark = ps[0] && kid(kid(ps[0], "pPr") ?? ps[0], "rPr");
        if (t.rows === 0 && mark) for (const k of kids(mark)) if (["b", "bCs"].includes(k.localName)) mark.removeChild(k);
        if (t.rows === 0 && pr) for (const s of kids(pr, "shd")) pr.removeChild(s); // the heading's colour
      }
      t.tbl.insertBefore(copy, after);
    }
    const now = kids(t.tbl, "tr");
    rows.forEach((row, i) => {
      const cells = rowCells(now[t.firstRow + i]);
      t.cols.forEach((c, j) => {
        const v = cleanValue(row[j]);
        const hit = cells.find((x) => x.c === c);
        if (v && hit) setCell(doc, hit.tc, v);
      });
    });
  }
  for (const part of parts) zip.file(part.path, writeXml(part.doc));
  return { bytes: await saveZip(zip), notes: [] };
}
