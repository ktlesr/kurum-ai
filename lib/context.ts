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
 * For showing a document's text: its own numbering stays text. Docling marks a line that starts with its own number
 * ("1) Proje…", "a) …", "(2) …", "2. …") as a bullet, and Markdown would make "- 1) Proje…" an empty-looking bullet with
 * a list inside, whose number isn't even copied. The bullet goes wherever a line has its own number; "1)" stays as
 * written instead of becoming "1.". Code blocks are left alone.
 */
export const plainNumbering = (text: string) =>
  text
    .split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/^[ \t]*[-*+] (?="?(?:\p{Ll}\)|\(\d{1,3}\)|\(\p{Ll}\)|\d{1,3}[.)])[ \t])/gmu, "")
            .replace(/^("?\d{1,3})\)(?=[ \t])/gm, "$1\\)"),
    )
    .join("");
