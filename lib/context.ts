// Shared by server (routing) and client (warning). Keep in sync = import from here.
import type { Claim } from "./trace";

// Until a model has been measured (see recordTokens in server.ts): conservative for Turkish.
// Measured: gemma4 ≈ 2.9, gpt-oss ≈ 2.2 chars/token.
export const DEFAULT_CHARS_PER_TOKEN = 2.2;
// Tokens kept free for system prompt, chat history, reasoning and the answer.
export const RESERVED_TOKENS = 8192;

/** How many document characters fit into num_ctx. */
export const contextBudget = (numCtx: number, charsPerToken: number) =>
  Math.max(0, numCtx - RESERVED_TOKENS) * charsPerToken;

/** Fraction (0–1] of the documents that fits into num_ctx. */
export function contextRatio(totalChars: number, numCtx: number, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  const budget = contextBudget(numCtx, charsPerToken);
  return totalChars <= budget ? 1 : budget / totalChars;
}

/** Trailer the chat stream appends after this separator: what the answer was built from and how it checked out. */
export const META_SEP = "\u001e";
/** Progress lines inside the chat stream: STATUS_SEP + text + STATUS_SEP. The client strips them from the answer. */
export const STATUS_SEP = "\u001d";
/** A failure after the stream started: ERROR_SEP + message, then the stream ends. The client shows it as an error turn. */
export const ERROR_SEP = "\u001f";

export interface ChatMeta {
  /** Library documents this answer read because the message asked for them: the chat keeps them for follow-ups. */
  used?: { id: string; name: string; size: number; kind: string }[];
  mode: "full" | "rag" | "scan" | "truncated";
  sources: string[];
  unverified: string[];
  uncertain: string[];
  /** Pages read from links in the question (lib/web). */
  web?: { url: string; title: string }[];
  /** Comparison-table figures under the wrong document's column (lib/checks checkColumns). */
  misplaced?: string[];
  /** The one document of a single-document answer: page links and chips resolve against it, never another doc. */
  doc?: string;
  /** Pages that document has (from its page markers); page links are made only for these. */
  pages?: number[];
  /** Cited pages no selected document has (lib/checks checkPages). Optional: older saved chats lack it. */
  badPages?: string[];
  /** Each factual sentence of the answer with the passage that supports it, or none (lib/trace). */
  claims?: Claim[];
  note?: string;
}

export interface DocSection {
  /** "Sayfa 4", "Sheet: Bütçe", "Başlangıç" (outline before the first page), or "" for unmarked text. */
  label: string;
  text: string;
}

/** The extracted text split on the same page/sheet markers the RAG chunker uses, for the source panel. */
export function docSections(text: string): DocSection[] {
  const parts = text.split(/^(--- Sayfa \d+ ---|## Sheet: .+)$/m);
  const out: DocSection[] = [];
  if (parts[0].trim()) out.push({ label: parts.length > 1 ? "Başlangıç" : "", text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ label: parts[i].startsWith("---") ? parts[i].replace(/-/g, "").trim() : parts[i].slice(3), text: (parts[i + 1] ?? "").trim() });
  }
  return out;
}

/**
 * Which doc and section a source chip points at. Chips look like "Sayfa 4", "Sayfa 3 – 5", "Sheet: X", a doc name
 * (whole document), or "<doc> · <label>" when several docs were in context. With doc (a single-document answer's
 * meta.doc) the chip is resolved against that document only; if it's gone, nothing opens.
 */
export function parseSource(chip: string, docNames: string[], doc?: string): { doc: string; label?: string } | null {
  const first = (l: string) => l.replace(/^(Sayfa \d+)\s*–.*$/, "$1"); // a range points at its first page
  if (doc !== undefined) return docNames.includes(doc) ? { doc, label: chip === doc ? undefined : first(chip) } : null;
  if (docNames.includes(chip)) return { doc: chip, label: undefined };
  // "<doc> · <label>": matched against the real names, longest first (a name may contain " · "), and the rest must
  // be a section label, so a removed "a.pdf · ek.pdf" never resolves to "a.pdf".
  const named = docNames
    .filter((d) => chip.startsWith(`${d} · `) && /^(Sayfa \d+( – \d+)?|Başlangıç|Bölüm \d+)$|^Sheet: /.test(chip.slice(d.length + 3)))
    .sort((x, y) => y.length - x.length)[0];
  if (named) return { doc: named, label: first(chip.slice(named.length + 3)) };
  // A bare label from an older single-document answer (no meta.doc): the first document, as before.
  return chip.includes(" · ") || !docNames[0] ? null : { doc: docNames[0], label: first(chip) };
}

/** Minimal mdast shape (remark's syntax tree); only what linkPages touches. */
export interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

// Never rewritten: text already in a link, and code.
const NO_LINK = new Set(["link", "linkReference", "inlineCode", "code", "definition", "html"]);

/**
 * remark plugin: "Sayfa N" in a finished single-document answer becomes a link that opens the source panel there.
 * Works on text nodes, so code and existing links stay as they are. The href carries a per-render nonce: a link the
 * model wrote itself ("[x](#sayfa-47)") can't pass as one of these. Not for several documents (a bare page number
 * doesn't say which one) and not for pages the document doesn't have.
 */
export function linkPages(meta: ChatMeta | undefined, nonce: string) {
  const pages = new Set(meta?.doc ? meta.pages : []);
  const walk = (node: MdNode) => {
    if (!node.children || NO_LINK.has(node.type)) return;
    node.children = node.children.flatMap((c): MdNode[] => {
      if (c.type !== "text") return walk(c), [c];
      const out: MdNode[] = [];
      let last = 0;
      for (const m of c.value!.matchAll(/\bSayfa (\d+)\b/g)) {
        if (!pages.has(Number(m[1]))) continue;
        if (m.index > last) out.push({ type: "text", value: c.value!.slice(last, m.index) });
        out.push({ type: "link", url: `#sayfa-${nonce}-${Number(m[1])}`, children: [{ type: "text", value: m[0] }] });
        last = m.index + m[0].length;
      }
      if (!out.length) return [c];
      if (last < c.value!.length) out.push({ type: "text", value: c.value!.slice(last) });
      return out;
    });
  };
  return () => (tree: MdNode) => { if (pages.size) walk(tree); };
}

/**
 * A list position Docling put before a line's own number: "17. ç) Uluslararası…" is item "ç)", not item 17.
 * Also for what the model reads: it would quote the 17.
 */
export const dropListPositions = (text: string) => text.replace(/^ {0,3}\d{1,3}\. (?="?(?:[^\s()]{1,3}|&amp;)\) )/gmu, "");

const TR_LETTERS = "abcçdefgğhıijklmnoöprsştuüvyz";
const MARK = /^( {0,3}(?:[-*+] )?"?)(&amp;|[^\s()]{1,3})\)(?= )/;

/**
 * OCR's misread list marks, mended only where the list itself says what they must be: "b) … / e) … / ç) …" (Turkish order)
 * makes the middle one "c)", "g) / 8) / h)" makes it "ğ)" and "Iİ) / 2)" makes it "1)". Nothing is guessed from
 * meaning; a mark with no such neighbours stays as read, even a likely wrong one: "h) / 1)" may be a real sublist.
 */
export function repairListMarks(text: string): string {
  const lines = text.split("\n");
  const near = (i: number, step: number) => {
    for (let j = i + step; lines[j] !== undefined; j += step) if (lines[j].trim()) return MARK.exec(lines[j])?.[2];
    return undefined;
  };
  const num = (m?: string) => (m && /^\d{1,3}$/.test(m) ? Number(m) : NaN);
  const at = (m?: string) => (m && m.length === 1 ? TR_LETTERS.indexOf(m) : -1);
  lines.forEach((line, i) => {
    const m = MARK.exec(line);
    if (!m) return;
    const [p, n] = [near(i, -1), near(i, 1)];
    const unreadable = at(m[2]) < 0 && Number.isNaN(num(m[2])); // not a mark at all, like "Iİ": a valid one may start a sublist
    let want: string | undefined;
    if (num(n) - num(p) === 2) want = String(num(p) + 1);
    else if (at(p) >= 0 && at(n) - at(p) === 2) want = TR_LETTERS[at(p) + 1];
    else if (unreadable && Number.isNaN(num(p)) && n === "2") want = "1"; // a numbered list starting, also under a lettered item
    else if (unreadable && p === undefined && n === "b") want = "a";
    if (want && want !== m[2]) lines[i] = m[1] + want + line.slice(m[0].length - 1);
  });
  return lines.join("\n");
}

// Up to 3 spaces of indent below: four or more is a code block.
/** "- x" with no list around it: a line Docling took for a list, like "- MADDE 9- 4 sayılı…" among paragraphs. */
function dropLoneBullets(text: string): string {
  const lines = text.split("\n");
  const bullet = (i: number, step: number) => {
    for (let j = i + step; lines[j] !== undefined; j += step) if (lines[j].trim()) return /^ {0,3}[-*+] /.test(lines[j]);
    return false;
  };
  return lines.map((l, i) => (/^ {0,3}[-*+] /.test(l) && !bullet(i, -1) && !bullet(i, 1) ? l.replace(/^ {0,3}[-*+] /, "") : l)).join("\n");
}

/**
 * For showing a document's text: its own numbering stays text. Docling marks a line that starts with its own number
 * ("1) Proje…", "a) …", "(2) …", "2. …") as a bullet, and Markdown would make "- 1) Proje…" an empty-looking bullet with
 * a list inside, whose number isn't even copied. The bullet goes wherever a line has its own number; "1)" stays as
 * written instead of becoming "1.". Code blocks are left alone.
 */
export const plainNumbering = (text: string) =>
  text
    .split(/(^ {0,3}(?:```+|~~~+)[^\n]*\n[\s\S]*?^ {0,3}(?:```+|~~~+)[ \t]*$)/m)
    .map((part, i) =>
      i % 2
        ? part
        : dropLoneBullets(dropListPositions(part).replace(/^ {0,3}[-*+] (?="?(?:\p{Ll}\)|\(\d{1,3}\)|\(\p{Ll}\)|\d{1,3}[.)])[ \t])/gmu, ""))
            .replace(/^("?\d{1,3})\)(?=[ \t])/gm, "$1\\)"),
    )
    .join("");
