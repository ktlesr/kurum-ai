// A chat answer as a document: the Markdown read once into blocks, and each writer works from those. The plain formats (md,
// txt, json) and what goes into a spreadsheet are here, pure; docx and pdf need their libraries (app/export-file). All of it
// runs in the browser: chats live there, and nothing about them goes anywhere to become a file.
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const FILE_FORMATS = {
  docx: { label: "Word", ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { label: "PDF", ext: "pdf", mime: "application/pdf" },
  xlsx: { label: "Excel", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  md: { label: "Markdown", ext: "md", mime: "text/markdown;charset=utf-8" },
  txt: { label: "Metin", ext: "txt", mime: "text/plain;charset=utf-8" },
  json: { label: "JSON", ext: "json", mime: "application/json;charset=utf-8" },
} as const;
export type FileFormat = keyof typeof FILE_FORMATS;
export const isFileFormat = (v: unknown): v is FileFormat => typeof v === "string" && Object.hasOwn(FILE_FORMATS, v);

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; link?: string };
export type TableAlign = "left" | "center" | "right" | null;
export type Block =
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; aligns: TableAlign[]; header: Inline[][]; rows: Inline[][][] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "rule" };

export interface ExportTurn {
  question?: string;
  /** The answer as written, Markdown. */
  answer: string;
  blocks: Block[];
  sources: string[];
  web: { title: string; url: string }[];
  at?: number;
}
export interface ExportDoc { title: string; createdAt: number; turns: ExportTurn[] }

type Node = { type: string; identifier?: string; value?: string; children?: Node[]; depth?: number; ordered?: boolean; start?: number; url?: string; lang?: string; align?: TableAlign[]; alt?: string };

const parser = unified().use(remarkParse).use(remarkGfm);
type Pos = { type: string; value?: string; alt?: string; identifier?: string; children?: Pos[]; position?: { start: { offset: number }; end: { offset: number } } };

/** The addresses of [text][ref] links in the text being read. */
let definitions = new Map<string, string>();
function inlinesOf(nodes: Node[] | undefined, style: Omit<Inline, "text"> = {}): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "text") out.push({ text: n.value ?? "", ...style });
    else if (n.type === "strong") out.push(...inlinesOf(n.children, { ...style, bold: true }));
    else if (n.type === "emphasis") out.push(...inlinesOf(n.children, { ...style, italic: true }));
    else if (n.type === "delete") out.push(...inlinesOf(n.children, { ...style, strike: true }));
    else if (n.type === "inlineCode") out.push({ text: n.value ?? "", ...style, code: true });
    else if (n.type === "break") out.push({ text: "\n", ...style });
    else if (n.type === "link") {
      // Only ordinary web addresses stay links in a file someone may open elsewhere.
      const safe = /^https?:\/\//i.test(n.url ?? "") ? { link: n.url } : {};
      out.push(...inlinesOf(n.children, { ...style, ...safe }));
    } else if (n.type === "linkReference") {
      const url = definitions.get(n.identifier ?? "");
      out.push(...inlinesOf(n.children, { ...style, ...(url && /^https?:\/\//i.test(url) ? { link: url } : {}) }));
    } else if (n.type === "image") out.push({ text: n.alt ? `[görsel: ${n.alt}]` : "[görsel]", ...style });
    else if (n.type === "html") out.push({ text: (n.value ?? "").replace(/<[^>]*>/g, ""), ...style });
    else if (n.children) out.push(...inlinesOf(n.children, style));
    else if (n.value) out.push({ text: n.value, ...style });
  }
  return out.filter((i) => i.text);
}

function blocksOf(nodes: Node[] | undefined): Block[] {
  return (nodes ?? []).flatMap((n): Block[] => {
    if (n.type === "heading") return [{ kind: "heading", level: Math.min(6, n.depth ?? 1), inlines: inlinesOf(n.children) }];
    if (n.type === "paragraph") {
      const inlines = inlinesOf(n.children);
      return inlines.length ? [{ kind: "paragraph", inlines }] : [];
    }
    if (n.type === "list") return [{ kind: "list", ordered: !!n.ordered, start: n.start ?? 1, items: (n.children ?? []).map((it) => blocksOf(it.children)) }];
    if (n.type === "table") {
      const [head, ...rows] = n.children ?? [];
      const cells = (r: Node) => (r.children ?? []).map((c) => inlinesOf(c.children));
      return head ? [{ kind: "table", aligns: n.align ?? [], header: cells(head), rows: rows.map(cells) }] : [];
    }
    if (n.type === "blockquote") return [{ kind: "quote", blocks: blocksOf(n.children) }];
    if (n.type === "code") return [{ kind: "code", lang: n.lang ?? "", text: n.value ?? "" }];
    if (n.type === "thematicBreak") return [{ kind: "rule" }];
    if (n.type === "html") {
      const text = (n.value ?? "").replace(/<[^>]*>/g, "").trim();
      return text ? [{ kind: "paragraph", inlines: [{ text }] }] : [];
    }
    return [];
  });
}

export function parseAnswer(markdown: string): Block[] {
  const tree = parser.parse(markdown) as Node;
  definitions = new Map();
  const find = (n: Node) => {
    if (n.type === "definition" && n.identifier && n.url && !definitions.has(n.identifier)) definitions.set(n.identifier, n.url);
    n.children?.forEach(find);
  };
  find(tree);
  return blocksOf(tree.children);
}
/** Every table, wherever it stands: inside a quotation or a list item too. */
function tablesIn(blocks: Block[]): Extract<Block, { kind: "table" }>[] {
  return blocks.flatMap((b) => (b.kind === "table" ? [b] : b.kind === "quote" ? tablesIn(b.blocks) : b.kind === "list" ? b.items.flatMap(tablesIn) : []));
}
export const textOf = (inlines: Inline[]) => inlines.map((i) => i.text).join("");

/** What goes in a file: the answer and, if there are any, where it came from. */
export function turnOf(input: { question?: string; answer: string; sources?: string[]; web?: { title?: string; url: string }[]; at?: number }): ExportTurn {
  // A model's "i" with a stray dot on it (from upper-case İ) would print as two marks in some fonts.
  const answer = input.answer.replace(/i̇/g, "i");
  return {
    ...(input.question ? { question: input.question } : {}),
    answer,
    blocks: parseAnswer(answer),
    sources: [...new Set(input.sources ?? [])],
    web: (input.web ?? []).map((w) => ({ title: w.title || w.url, url: w.url })),
    ...(input.at ? { at: input.at } : {}),
  };
}
/** The document's name: what the answer calls itself, else what was asked, else what the chat is called. */
export function exportDoc(turns: ExportTurn[], chatTitle?: string, now = Date.now()): ExportDoc {
  const heading = turns.length === 1 ? turns[0].blocks.find((b) => b.kind === "heading") : undefined;
  const named = heading?.kind === "heading" ? textOf(heading.inlines) : "";
  const raw = (turns.length > 1 ? chatTitle : named || turns[0]?.question || chatTitle) || "Zafer AI cevabı";
  const line = raw.replace(/\s+/g, " ").trim();
  const title = line.length > 90 ? `${line.slice(0, 90).replace(/\s+\S*$/, "")}…` : line;
  // The title is printed once: the same heading doesn't follow it straight away.
  const first = turns[0]?.blocks[0];
  const repeats = turns.length === 1 && first?.kind === "heading" && textOf(first.inlines) === line;
  return { title, createdAt: now, turns: repeats ? [{ ...turns[0], blocks: turns[0].blocks.slice(1), answer: turns[0].answer.replace(/^\s*#+[^\n]*\n*/, "") }] : turns };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateText = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A name the file systems accept; Turkish letters stay, what they forbid doesn't. */
export function fileNameOf(doc: ExportDoc, format: FileFormat): string {
  const d = new Date(doc.createdAt);
  const base = doc.title.replace(/…$/, "").replace(/[\u0000-\u001f<>:"/\\|?*\u007f]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 70).trim() || "zafer-ai";
  return `${base} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${FILE_FORMATS[format].ext}`;
}

// ---- plain text ------------------------------------------------------------------------------------------------------
function plainBlocks(blocks: Block[], indent = ""): string[] {
  return blocks.flatMap((b): string[] => {
    if (b.kind === "heading") return [`${indent}${textOf(b.inlines)}`, `${indent}${(b.level <= 2 ? "=" : "-").repeat(Math.min(70, textOf(b.inlines).length))}`, ""];
    if (b.kind === "paragraph") return [...textOf(b.inlines).split("\n").map((l) => indent + l), ""];
    if (b.kind === "rule") return [`${indent}${"-".repeat(40)}`, ""];
    if (b.kind === "code") return [...b.text.split("\n").map((l) => `${indent}    ${l}`), ""];
    if (b.kind === "quote") return plainBlocks(b.blocks, `${indent}> `);
    if (b.kind === "list") {
      return [...b.items.flatMap((item, i) => {
        const mark = b.ordered ? `${b.start + i}. ` : "- ";
        const lines = plainBlocks(item, " ".repeat(mark.length)).filter((l) => l.trim());
        return lines.map((l, k) => indent + (k ? l : mark + l.trimStart()));
      }), ""];
    }
    // Columns lined up, so the table reads as one in any editor.
    const all = [b.header, ...b.rows].map((r) => r.map(textOf));
    const widths = b.header.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
    const row = (r: string[]) => indent + widths.map((w, c) => (r[c] ?? "").padEnd(w)).join("  ").trimEnd();
    return [row(all[0]), indent + widths.map((w) => "-".repeat(w)).join("  "), ...all.slice(1).map(row), ""];
  });
}
const sourceLines = (t: ExportTurn) => [...t.sources, ...t.web.map((w) => (w.title === w.url ? w.url : `${w.title}: ${w.url}`))];

export function toText(doc: ExportDoc): string {
  const out = [doc.title, "=".repeat(Math.min(70, doc.title.length)), `Zafer AI · ${dateText(doc.createdAt)}`, ""];
  for (const t of doc.turns) {
    if (t.question) out.push(`Soru: ${t.question}`, "");
    // One by one: a very long answer would be too many arguments for a call.
    for (const l of plainBlocks(t.blocks)) out.push(l);
    if (sourceLines(t).length) out.push("Kaynaklar:", ...sourceLines(t).map((s) => `- ${s}`), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/**
 * A preview of the file would fetch pictures by itself, sending what is in their address away: they stay as words. Found by
 * the same parser that reads the answer, not by pattern, so every way of writing a picture is one; ordinary links stay as written.
 */
const TAG = /<[a-z/!?][^>\n]*>/i;
const TAG_ALL = /<[a-z/!?][^>\n]*>/gi;
export function withoutPictures(markdown: string): string {
  let text = markdown;
  // Again until nothing is left: taking one away can make what was around it read as another.
  for (let round = 0; round < 8; round++) {
    const cuts: { from: number; to: number; put: string }[] = [];
    const pictures = new Set<string>();
    const definitions: Pos[] = [];
    const walk = (n: Pos) => {
      const at = n.position;
      if (n.type === "definition") definitions.push(n);
      else if (at && (n.type === "image" || n.type === "imageReference")) {
        if (n.identifier) pictures.add(n.identifier);
        cuts.push({ from: at.start.offset, to: at.end.offset, put: `(görsel: ${(n.alt ?? "").replace(/[[\]!<>()]/g, " ").trim() || "adsız"})` });
      } else if (at && n.type === "html") cuts.push({ from: at.start.offset, to: at.end.offset, put: (n.value ?? "").replace(/<[^>]*>?/g, "") }); // its words stay
      else {
        // A tag this parser read as plain words may still be one to another program's preview: fail on the safe side.
        const own = at && (n.type === "paragraph" || n.type === "heading" || n.type === "tableCell") ? text.slice(at.start.offset, at.end.offset) : "";
        if (at && own && !own.includes("`") && TAG.test(own)) cuts.push({ from: at.start.offset, to: at.end.offset, put: own.replace(TAG_ALL, "") });
        else n.children?.forEach(walk);
      }
    };
    walk(parser.parse(text) as Pos);
    for (const d of definitions) if (d.position && pictures.has(d.identifier ?? "")) cuts.push({ from: d.position.start.offset, to: d.position.end.offset, put: "" });
    if (!cuts.length) return text;
    for (const c of cuts.sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.put + text.slice(c.to);
  }
  // Still something after that many: nothing here may read as markup.
  return text.replace(/[!<\[\]]/g, " ");
}

export function toMarkdown(doc: ExportDoc): string {
  const out = [`# ${doc.title}`, "", `*Zafer AI · ${dateText(doc.createdAt)}*`, ""];
  for (const t of doc.turns) {
    if (t.question) out.push(`> **Soru:** ${t.question.replace(/\n/g, "\n> ")}`, "");
    out.push(t.answer.trim(), "");
    if (sourceLines(t).length) out.push("**Kaynaklar**", "", ...t.sources.map((s) => `- ${s}`), ...t.web.map((w) => `- [${w.title.replace(/[[\]]/g, "")}](${w.url.replace(/[()\s<>]/g, encodeURIComponent)})`), "");
  }
  // The whole file: a question or a source's name can hold a picture as well as the answer can.
  return `${withoutPictures(out.join("\n")).trimEnd()}\n`;
}

export function toJson(doc: ExportDoc): string {
  const cells = (rows: Inline[][][]) => rows.map((r) => r.map(textOf));
  return `${JSON.stringify({
    title: doc.title,
    createdAt: new Date(doc.createdAt).toISOString(),
    generator: "Zafer AI",
    turns: doc.turns.map((t) => ({
      ...(t.question ? { question: t.question } : {}),
      ...(t.at ? { askedAt: new Date(t.at).toISOString() } : {}),
      answer: t.answer,
      // The tables as data, not only as text: this is what a program reading the file wants.
      tables: tablesIn(t.blocks).map((b) => ({ columns: b.header.map(textOf), rows: cells(b.rows), records: cells(b.rows).map((r) => Object.fromEntries(b.header.map((h, c) => [textOf(h) || `Sütun ${c + 1}`, r[c] ?? ""]))) })),
      sources: t.sources,
      web: t.web,
    })),
  }, null, 2)}\n`;
}

// ---- spreadsheet ------------------------------------------------------------------------------------------------------
export type SheetCell = string | number | { percent: number };
export interface SheetData { name: string; rows: SheetCell[][]; headerRow?: boolean }

/** A cell as Excel should hold it: Turkish figures (1.250,50 · %42 · 12,5) as numbers; codes with leading zeros and long ids stay text. */
export function cellValue(raw: string): SheetCell {
  const s = raw.trim();
  const percent = /^(?:%\s*(-?[\d.,]+)|(-?[\d.,]+)\s*%)$/.exec(s);
  const num = (t: string): number | null => {
    if (/^-?0\d/.test(t) || t.replace(/\D/g, "").length > 15) return null;
    if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
    if (/^-?\d+(?:,\d+)?$/.test(t)) return Number(t.replace(",", "."));
    return null;
  };
  if (percent) {
    const n = num(percent[1] ?? percent[2]);
    return n === null ? s : { percent: n / 100 };
  }
  return num(s) ?? s;
}

const MAX_CELL = 32_000; // Excel's limit is a little above this
const cellText = (s: string) => (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s);

/** A name Excel allows and no other sheet of this file has. */
function sheetName(wanted: string, taken: Set<string>): string {
  const clean = wanted.replace(/[\u0000-\u001f[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim();
  // Cut between words where it can be.
  const base = (clean.length <= 28 ? clean : clean.slice(0, 28).replace(/\s+\S*$/, "") || clean.slice(0, 28)) || "Sayfa";
  let name = base;
  for (let i = 2; taken.has(name.toLocaleLowerCase("tr")); i++) name = `${base.slice(0, 26)} ${i}`;
  taken.add(name.toLocaleLowerCase("tr"));
  return name;
}

function linesOf(blocks: Block[], out: SheetCell[][], depth = 0) {
  for (const b of blocks) {
    if (b.kind === "heading" || b.kind === "paragraph") {
      for (const part of textOf(b.inlines).split("\n")) out.push([cellText(`${"  ".repeat(depth)}${part}`)]);
    } else if (b.kind === "list") {
      b.items.forEach((item, i) => {
        const at = out.length;
        linesOf(item, out, depth + 1);
        const first = out[at]?.[0];
        if (typeof first === "string") out[at] = [`${"  ".repeat(depth)}${b.ordered ? `${b.start + i}.` : "•"} ${first.trimStart()}`];
      });
    } else if (b.kind === "quote") linesOf(b.blocks, out, depth + 1);
    else if (b.kind === "code") b.text.split("\n").forEach((l) => out.push([cellText(l)]));
    else if (b.kind === "table") out.push([`[${tableLabel}]`]);
  }
}
const tableLabel = "Tablo ayrı sayfada";

/** Each table on its own sheet, in real cells; then the text of the answer; then the sources. */
export function sheetsOf(doc: ExportDoc): SheetData[] {
  const taken = new Set<string>();
  const sheets: SheetData[] = [];
  for (const t of doc.turns) {
    let heading = "";
    // Wherever a table stands: inside a quotation or a list item too.
    const visit = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.kind === "heading") heading = textOf(b.inlines);
        else if (b.kind === "quote") visit(b.blocks);
        else if (b.kind === "list") b.items.forEach(visit);
        else if (b.kind === "table") {
          sheets.push({
            name: sheetName(heading || (doc.turns.length === 1 ? doc.title : `Tablo ${sheets.length + 1}`), taken),
            headerRow: true,
            rows: [b.header.map((c) => cellText(textOf(c))), ...b.rows.map((r) => b.header.map((_, c) => cellValue(cellText(textOf(r[c] ?? [])))))],
          });
        }
      }
    };
    visit(t.blocks);
  }
  const rows: SheetCell[][] = [[doc.title], [`Zafer AI · ${dateText(doc.createdAt)}`], []];
  for (const t of doc.turns) {
    if (t.question) rows.push([cellText(`Soru: ${t.question}`)], []);
    linesOf(t.blocks, rows);
    rows.push([]);
  }
  sheets.push({ name: sheetName("Cevap", taken), rows });
  const sources = doc.turns.flatMap((t) => [...t.sources.map((s): SheetCell[] => [s, ""]), ...t.web.map((w): SheetCell[] => [w.title, w.url])]);
  if (sources.length) sheets.push({ name: sheetName("Kaynaklar", taken), headerRow: true, rows: [["Kaynak", "Adres"], ...sources] });
  return sheets;
}
