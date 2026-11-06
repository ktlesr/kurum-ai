// The table of a destek_sorgula answer as the page keeps and shows it (ChatMeta.destek): formatted cells only, no
// plan or SQL. Also read back from a chat backup, which is untrusted: every field checked and bounded here.

export interface DestekView {
  title: string;
  columns: { label: string; kind: string }[];
  rows: string[][];
  total?: string[];
  footer: string;
  warnings: string[];
}

/**
 * The most tables one answer keeps: every call the tool loop can make (lib/lookup MAX_STEPS × MAX_CALLS = 3 × 4), so
 * no table the model's comment was checked against is ever dropped (lib/destek/destek.test.ts checks the two agree).
 */
export const MAX_TABLES = 12;
/** The most rows a table has: the engine never returns more (lib/destek/compile), so a backup can't lose any. */
export const MAX_ROWS = 200;
const KINDS = new Set(["text", "int", "date", "count", "number", "amount", "ratio"]);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const row = (r: unknown, width: number) => (Array.isArray(r) ? r.slice(0, width).map((c) => str(c, 300)) : null);

export function cleanDestek(x: unknown): DestekView[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: DestekView[] = [];
  for (const t of x.slice(0, MAX_TABLES)) {
    if (!t || typeof t !== "object") continue;
    const v = t as Record<string, unknown>;
    if (!Array.isArray(v.columns) || !Array.isArray(v.rows)) continue;
    const columns = v.columns.slice(0, 30).map((c) => ({ label: str((c as { label?: unknown })?.label, 120), kind: KINDS.has((c as { kind?: unknown })?.kind as string) ? ((c as { kind: string }).kind) : "text" }));
    const rows = v.rows.slice(0, MAX_ROWS).map((r) => row(r, columns.length)).filter((r): r is string[] => !!r);
    const total = row(v.total, columns.length);
    out.push({
      title: str(v.title, 200), columns, rows, ...(total ? { total } : {}), footer: str(v.footer, 1000),
      warnings: Array.isArray(v.warnings) ? v.warnings.slice(0, 12).map((w) => str(w, 500)).filter(Boolean) : [],
    });
  }
  return out.length ? out : undefined;
}

/** The tables as Markdown (copy, the answer's file): the same cells, then what was counted and the warnings. */
export function destekMarkdown(tables: DestekView[]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return tables.map((t) => [
    `**${cell(t.title)}**`, "",
    `| ${t.columns.map((c) => cell(c.label)).join(" | ")} |`,
    `| ${t.columns.map((c) => (numericKind(c.kind) ? "---:" : "---")).join(" | ")} |`,
    ...t.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
    ...(t.total ? [`| ${t.total.map((c) => (c ? `**${cell(c)}**` : "")).join(" | ")} |`] : []),
    "", `_${cell(t.footer)}_`,
    ...t.warnings.map((w) => `- ${w}`),
  ].join("\n")).join("\n\n");
}

/** What an answer says: its tables and, unless the comment was held back, the model's comment. */
export function answerText(content: string, meta?: { destek?: DestekView[]; destekHidden?: boolean }): string {
  if (!meta?.destek?.length) return content;
  return [destekMarkdown(meta.destek), meta.destekHidden ? "" : content].filter((x) => x.trim()).join("\n\n");
}

/** Most of an answer's tables a later question carries back (the request caps each message at 100.000 characters). */
export const HISTORY_CHARS = 20_000;
/** An assistant turn as the next request's history: its tables too, so a follow-up ("ikinci projenin sahibi?") sees them. */
export function historyText(content: string, meta?: { destek?: DestekView[]; destekHidden?: boolean }): string {
  // Any other answer goes as it is: only the tables are capped, never the model's own text.
  if (!meta?.destek?.length) return meta?.destekHidden ? "" : content;
  const md = destekMarkdown(meta.destek);
  const tables = md.length > HISTORY_CHARS ? `${md.slice(0, HISTORY_CHARS)}\n…(tablo kısaltıldı; ayrıntı için soruyu yeniden sorun)` : md;
  return [tables, meta.destekHidden ? "" : content].filter((x) => x.trim()).join("\n\n");
}

/** Whether a message has something to keep and show: its text, or the support tables / the note that its text was held back. */
export const hasAnswer = (m: { content: string; meta?: { destek?: DestekView[]; destekHidden?: boolean } }) =>
  !!m.content.trim() || !!m.meta?.destek?.length || !!m.meta?.destekHidden;

/** A table that is all right-aligned numbers but its label columns. */
export const numericKind = (kind: string) => kind !== "text" && kind !== "date";
