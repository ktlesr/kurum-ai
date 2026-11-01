"use client";

// A chat answer as a real file, made here in the browser (chats live here; nothing leaves for this). Word and PDF lay out the
// blocks of lib/export-doc: headings, lists, tables, code, page numbers. Their libraries are heavy, so they load when first
// asked for.
import { FILE_FORMATS, dateText, fileNameOf, sheetsOf, toJson, toMarkdown, toText, type Block, type ExportDoc, type FileFormat, type Inline } from "@/lib/export-doc";

const INK = "14263D", ACCENT = "2E5E8C", MUTED = "4E6075", LINE = "D8E2EC", SOFT = "EDF3F8";

async function toDocx(doc: ExportDoc): Promise<Blob> {
  const d = await import("docx");
  const runs = (inlines: Inline[], base: { size?: number; bold?: boolean; color?: string } = {}) =>
    inlines.flatMap((i): (InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink>)[] => {
      const style = { ...base, bold: i.bold || base.bold, italics: i.italic, strike: i.strike, ...(i.code ? { font: "Consolas", shading: { type: d.ShadingType.CLEAR, fill: SOFT } } : {}) };
      const parts = i.text.split("\n").map((text, k) => new d.TextRun({ ...style, text, ...(i.link ? { color: ACCENT, underline: {} } : {}), ...(k ? { break: 1 } : {}) }));
      return i.link ? [new d.ExternalHyperlink({ link: i.link, children: parts })] : parts;
    });
  const LEVEL = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  let numbered = 0;
  const numberRefs: { reference: string; levels: { level: number; format: (typeof d.LevelFormat)[keyof typeof d.LevelFormat]; text: string; start: number; alignment: (typeof d.AlignmentType)[keyof typeof d.AlignmentType]; style: { paragraph: { indent: { left: number; hanging: number } } } }[] }[] = [];
  const border = { style: d.BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const walk = (blocks: Block[], ctx: { list?: { ref?: string; level: number }; quote?: boolean } = {}): (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] =>
    blocks.flatMap((b): (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] => {
      const listing = ctx.list ? (ctx.list.ref ? { numbering: { reference: ctx.list.ref, level: ctx.list.level } } : { bullet: { level: ctx.list.level } }) : {};
      const quoting = ctx.quote ? { indent: { left: 360 }, border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: LINE, space: 8 } } } : {};
      if (b.kind === "heading") return [new d.Paragraph({ heading: LEVEL[b.level - 1], children: runs(b.inlines), keepNext: true })];
      if (b.kind === "paragraph") return [new d.Paragraph({ children: runs(b.inlines, ctx.quote ? { color: MUTED } : {}), spacing: { after: ctx.list ? 60 : 140, line: 288 }, ...listing, ...quoting })];
      if (b.kind === "rule") return [new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: LINE, space: 1 } }, spacing: { after: 160 } })];
      if (b.kind === "code") return b.text.split("\n").map((line) => new d.Paragraph({ children: [new d.TextRun({ text: line, font: "Consolas", size: 18 })], shading: { type: d.ShadingType.CLEAR, fill: SOFT }, spacing: { after: 0 } }));
      if (b.kind === "quote") return walk(b.blocks, { ...ctx, quote: true });
      if (b.kind === "list") {
        const level = ctx.list ? ctx.list.level + 1 : 0;
        let ref: string | undefined;
        if (b.ordered) {
          ref = `liste-${++numbered}`;
          numberRefs.push({ reference: ref, levels: [0, 1, 2, 3, 4].map((l) => ({ level: l, format: d.LevelFormat.DECIMAL, text: `%${l + 1}.`, start: l === level ? b.start : 1, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 360 * (l + 1), hanging: 260 } } } })) });
        }
        return b.items.flatMap((item) => walk(item, { ...ctx, list: { ref, level } }));
      }
      // A table
      const widths = b.header.length;
      const pct = Math.floor(100 / Math.max(1, widths));
      const alignOf = (c: number) => (b.aligns[c] === "right" ? d.AlignmentType.RIGHT : b.aligns[c] === "center" ? d.AlignmentType.CENTER : d.AlignmentType.LEFT);
      const cell = (inlines: Inline[], c: number, head: boolean) => new d.TableCell({
        width: { size: pct, type: d.WidthType.PERCENTAGE }, borders,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        ...(head ? { shading: { type: d.ShadingType.CLEAR, fill: SOFT } } : {}),
        children: [new d.Paragraph({ alignment: alignOf(c), children: runs(inlines, { size: 20, ...(head ? { bold: true, color: INK } : {}) }) })],
      });
      return [
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: [
            new d.TableRow({ tableHeader: true, children: b.header.map((h, c) => cell(h, c, true)) }),
            ...b.rows.map((r) => new d.TableRow({ cantSplit: true, children: b.header.map((_, c) => cell(r[c] ?? [], c, false)) })),
          ],
        }),
        new d.Paragraph({ spacing: { after: 140 } }),
      ];
    });
  const body = doc.turns.flatMap((t, n) => [
    ...(t.question ? [new d.Paragraph({ pageBreakBefore: n > 0, spacing: { before: 120, after: 160 }, shading: { type: d.ShadingType.CLEAR, fill: SOFT }, children: [new d.TextRun({ text: "Soru: ", bold: true, color: ACCENT }), new d.TextRun({ text: t.question })] })] : []),
    ...walk(t.blocks),
    ...(t.sources.length || t.web.length
      ? [
          new d.Paragraph({ spacing: { before: 240, after: 80 }, children: [new d.TextRun({ text: "Kaynaklar", bold: true, color: MUTED, size: 20 })] }),
          ...t.sources.map((s) => new d.Paragraph({ bullet: { level: 0 }, children: [new d.TextRun({ text: s, color: MUTED, size: 20 })] })),
          ...t.web.map((w) => new d.Paragraph({ bullet: { level: 0 }, children: [new d.ExternalHyperlink({ link: w.url, children: [new d.TextRun({ text: w.title, color: ACCENT, underline: {}, size: 20 })] })] })),
        ]
      : []),
  ]);
  const file = new d.Document({
    creator: "Zafer AI",
    title: doc.title,
    description: "Zafer AI cevabı",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: INK } } },
      paragraphStyles: [1, 2, 3, 4, 5, 6].map((l) => ({
        id: `Heading${l}`, name: `Heading ${l}`, basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", bold: true, color: l === 1 ? INK : ACCENT, size: [36, 30, 26, 24, 22, 22][l - 1] },
        paragraph: { spacing: { before: l === 1 ? 240 : 200, after: 100 }, keepNext: true, outlineLevel: l - 1 },
      })),
    },
    numbering: { config: numberRefs },
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1100, left: 1200, right: 1200 } } },
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ text: `Zafer AI · ${dateText(doc.createdAt)}  ·  Sayfa `, color: MUTED, size: 16 }), new d.TextRun({ children: [d.PageNumber.CURRENT], color: MUTED, size: 16 }), new d.TextRun({ text: " / ", color: MUTED, size: 16 }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], color: MUTED, size: 16 })] })] }) },
      children: [
        new d.Paragraph({ spacing: { after: 60 }, children: [new d.TextRun({ text: doc.title, bold: true, size: 40, color: INK })] }),
        new d.Paragraph({ spacing: { after: 240 }, border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } }, children: [new d.TextRun({ text: `Zafer AI · ${dateText(doc.createdAt)}`, color: MUTED, size: 18 })] }),
        ...body,
      ],
    }],
  });
  return d.Packer.toBlob(file);
}

// ---- PDF --------------------------------------------------------------------------------------------------------------
const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
// Geist has the Turkish letters but not ₺, ✓ or Greek: those letters come from DejaVu, a wide font, within the same line.
const PDF_FONTS = { "r.ttf": "Geist-Regular.ttf", "b.ttf": "Geist-Bold.ttf", "i.ttf": "Geist-Italic.ttf", "bi.ttf": "Geist-BoldItalic.ttf", "m.ttf": "GeistMono-Regular.ttf", "d.ttf": "DejaVuSans.ttf", "db.ttf": "DejaVuSans-Bold.ttf" };
const NOT_IN_GEIST = /[^ -~¡-¬®-ēĖ-īĮ-ķĹ-ľŁ-ňŊ-ōŐ-ž–—‘-„•…‰€\n]+/g;
/** A text as runs, each in a font that has its letters. */
function lettered(text: string, style: Record<string, unknown> = {}): PdfNode[] {
  const out: PdfNode[] = [];
  let at = 0;
  for (const m of text.matchAll(NOT_IN_GEIST)) {
    if (m.index > at) out.push({ ...style, text: text.slice(at, m.index) });
    out.push({ ...style, text: m[0], font: "DejaVu" });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ ...style, text: text.slice(at) });
  return out;
}
let pdfVfs: Promise<Record<string, string>> | null = null;
const loadPdfFonts = () =>
  (pdfVfs ??= Promise.all(Object.entries(PDF_FONTS).map(async ([k, f]) => {
    const r = await fetch(`/fonts/${f}`);
    if (!r.ok) throw new Error("Yazı tipi yüklenemedi.");
    return [k, toBase64(await r.arrayBuffer())] as const;
  })).then(Object.fromEntries).catch((e) => {
    pdfVfs = null;
    throw e;
  }));

type PdfNode = Record<string, unknown> | string;
function pdfInlines(inlines: Inline[]): PdfNode[] {
  return inlines.flatMap((i) => lettered(i.text, { ...(i.bold ? { bold: true } : {}), ...(i.italic ? { italics: true } : {}), ...(i.strike ? { decoration: "lineThrough" } : {}), ...(i.code ? { font: "Mono", background: `#${SOFT}`, fontSize: 9.5 } : {}), ...(i.link ? { link: i.link, color: `#${ACCENT}`, decoration: "underline" } : {}) }));
}
function pdfBlocks(blocks: Block[], width: number): PdfNode[] {
  return blocks.map((b): PdfNode => {
    if (b.kind === "heading") return { text: pdfInlines(b.inlines), style: `h${Math.min(4, b.level)}`, headlineLevel: b.level };
    if (b.kind === "paragraph") return { text: pdfInlines(b.inlines), margin: [0, 0, 0, 7], lineHeight: 1.28 };
    if (b.kind === "rule") return { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.6, lineColor: `#${LINE}` }], margin: [0, 6, 0, 12] };
    if (b.kind === "code") return { table: { widths: ["*"], body: [[{ text: lettered(b.text, { font: "Mono" }), fontSize: 9, preserveLeadingSpaces: true }]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => `#${SOFT}`, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 2, 0, 10] };
    if (b.kind === "quote") return { table: { widths: ["*"], body: [[{ stack: pdfBlocks(b.blocks, width - 12), color: `#${MUTED}` }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => `#${LINE}`, paddingLeft: () => 10, paddingTop: () => 2, paddingBottom: () => 0 }, margin: [0, 2, 0, 8] };
    if (b.kind === "list") {
      const items = b.items.map((item) => ({ stack: pdfBlocks(item, width - 20).map((n) => (typeof n === "object" && "lineHeight" in n ? { ...n, margin: [0, 0, 0, 3] } : n)) }));
      return { [b.ordered ? "ol" : "ul"]: items, ...(b.ordered ? { start: b.start } : {}), margin: [6, 0, 0, 8] };
    }
    const cols = b.header.length;
    const alignOf = (c: number) => b.aligns[c] ?? "left";
    const size = cols > 7 ? 7.5 : cols > 4 ? 8.5 : 9.5;
    return {
      table: {
        headerRows: 1, dontBreakRows: true, widths: Array(cols).fill("*"),
        body: [
          b.header.map((h, c) => ({ text: pdfInlines(h), bold: true, fillColor: `#${SOFT}`, alignment: alignOf(c), fontSize: size })),
          ...b.rows.map((r) => b.header.map((_, c) => ({ text: pdfInlines(r[c] ?? []), alignment: alignOf(c), fontSize: size }))),
        ],
      },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => `#${LINE}`, vLineColor: () => `#${LINE}`, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3.5, paddingBottom: () => 3.5 },
      margin: [0, 2, 0, 12],
    };
  });
}
async function toPdf(doc: ExportDoc): Promise<Blob> {
  const [pdfMake, vfs] = await Promise.all([import("pdfmake/build/pdfmake"), loadPdfFonts()]);
  const engine = (pdfMake as unknown as { default?: unknown }).default ?? pdfMake;
  const maker = engine as { createPdf: (d: unknown, layouts?: unknown, fonts?: unknown, vfs?: unknown) => { getBlob: (cb: (b: Blob) => void) => void } };
  // A wide table reads better across the page.
  const wide = doc.turns.some((t) => t.blocks.some((b) => b.kind === "table" && b.header.length > 5));
  const width = wide ? 741 : 495;
  const content: PdfNode[] = [
    { text: lettered(doc.title), fontSize: 19, bold: true, color: `#${INK}`, margin: [0, 0, 0, 3] },
    { text: `Zafer AI · ${dateText(doc.createdAt)}`, fontSize: 9, color: `#${MUTED}` },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 1.2, lineColor: `#${ACCENT}` }], margin: [0, 7, 0, 14] },
  ];
  doc.turns.forEach((t, n) => {
    if (t.question) content.push({ table: { widths: ["*"], body: [[{ text: [{ text: "Soru: ", bold: true, color: `#${ACCENT}` }, ...lettered(t.question)] }]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => `#${SOFT}`, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 0, 0, 12], ...(n > 0 ? { pageBreak: "before" } : {}) });
    content.push(...pdfBlocks(t.blocks, width));
    if (t.sources.length || t.web.length) {
      content.push({ text: "Kaynaklar", bold: true, fontSize: 9.5, color: `#${MUTED}`, margin: [0, 10, 0, 3] });
      content.push({ ul: [...t.sources.map((s) => ({ text: lettered(s), fontSize: 9, color: `#${MUTED}` })), ...t.web.map((w) => ({ text: lettered(w.title), link: w.url, fontSize: 9, color: `#${ACCENT}`, decoration: "underline" }))] });
    }
  });
  const fonts = { Geist: { normal: "r.ttf", bold: "b.ttf", italics: "i.ttf", bolditalics: "bi.ttf" }, Mono: { normal: "m.ttf", bold: "m.ttf", italics: "m.ttf", bolditalics: "m.ttf" }, DejaVu: { normal: "d.ttf", bold: "db.ttf", italics: "d.ttf", bolditalics: "db.ttf" } };
  const def = {
    info: { title: doc.title, creator: "Zafer AI", producer: "Zafer AI" },
    pageSize: "A4", pageOrientation: wide ? "landscape" : "portrait", pageMargins: [50, 50, 50, 52],
    defaultStyle: { font: "Geist", fontSize: 10.5, color: `#${INK}` },
    styles: {
      h1: { fontSize: 16, bold: true, margin: [0, 10, 0, 5] },
      h2: { fontSize: 13.5, bold: true, color: `#${ACCENT}`, margin: [0, 9, 0, 4] },
      h3: { fontSize: 11.5, bold: true, color: `#${ACCENT}`, margin: [0, 7, 0, 3] },
      h4: { fontSize: 10.5, bold: true, margin: [0, 6, 0, 3] },
    },
    // A heading doesn't stay alone at the foot of a page.
    pageBreakBefore: (node: { headlineLevel?: number; startPosition: { top: number; pageInnerHeight: number } }) => !!node.headlineLevel && node.startPosition.top > node.startPosition.pageInnerHeight - 60,
    footer: (page: number, pages: number) => ({ text: `Zafer AI · Sayfa ${page} / ${pages}`, alignment: "right", fontSize: 8, color: `#${MUTED}`, margin: [50, 18, 50, 0] }),
    content,
  };
  return new Promise<Blob>((ok, fail) => {
    try {
      maker.createPdf(def, undefined, fonts, vfs).getBlob(ok);
    } catch (e) {
      fail(e);
    }
  });
}

// ---- Excel ------------------------------------------------------------------------------------------------------------
async function toXlsx(doc: ExportDoc): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: doc.title, Author: "Zafer AI" };
  for (const s of sheetsOf(doc)) {
    const ws: Record<string, unknown> = {};
    let cols = 0;
    const widths: number[] = [];
    s.rows.forEach((row, r) => {
      cols = Math.max(cols, row.length);
      row.forEach((v, c) => {
        const at = XLSX.utils.encode_cell({ r, c });
        // Text stays text: what looks like a formula in an answer is never run by Excel.
        if (typeof v === "number") ws[at] = { t: "n", v };
        else if (typeof v === "object") ws[at] = { t: "n", v: v.percent, z: "0.##%" };
        else ws[at] = { t: "s", v };
        const shown = typeof v === "string" ? v.length : 10;
        widths[c] = Math.max(widths[c] ?? 8, Math.min(shown + 2, s.headerRow ? 45 : 110));
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length - 1), c: Math.max(0, cols - 1) } });
    ws["!cols"] = widths.map((wch) => ({ wch }));
    if (s.headerRow && s.rows.length > 1) ws["!autofilter"] = { ref: ws["!ref"] as string };
    XLSX.utils.book_append_sheet(wb, ws as never, s.name);
  }
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true })], { type: FILE_FORMATS.xlsx.mime });
}

export async function fileOf(doc: ExportDoc, format: FileFormat): Promise<Blob> {
  const mime = FILE_FORMATS[format].mime;
  // UTF-8 with its mark: Windows' Notepad and Excel then read Turkish letters right.
  if (format === "txt") return new Blob(["﻿", toText(doc)], { type: mime });
  if (format === "md") return new Blob([toMarkdown(doc)], { type: mime });
  if (format === "json") return new Blob([toJson(doc)], { type: mime });
  if (format === "docx") return toDocx(doc);
  if (format === "xlsx") return toXlsx(doc);
  return toPdf(doc);
}

export async function downloadDoc(doc: ExportDoc, format: FileFormat) {
  const url = URL.createObjectURL(await fileOf(doc, format));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileNameOf(doc, format);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
