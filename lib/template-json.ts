// A JSON template: empty values are filled, keys and order stay. An array holding one blank object is a list of records.
import { MAX_SLOTS, TemplateError, cleanValue, findTokens, type Filled, type Layout, type Slot, type TableSlot, type Values } from "./template.ts";

const MAX_DEPTH = 32;

function parse(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
  } catch {
    throw new TemplateError("JSON şablonu okunamadı: dosyanın yazımı hatalı.");
  }
}

/** null, "", 0 or a blank mark ("{{ad}}", "____"): what a person leaves to be filled. */
const isBlank = (v: unknown) => v === null || v === 0 || (typeof v === "string" && (!v.trim() || (findTokens(v).length === 1 && findTokens(v)[0].end - findTokens(v)[0].start === v.trim().length)));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const key = (path: (string | number)[]) => path.map((p) => (typeof p === "number" ? `[${p}]` : p)).join(".").replace(/\.\[/g, "[");

/** A blank record: an object of blanks only. Nested ones count by their full name. */
function recordLeaves(v: Record<string, unknown>, prefix: string[] = []): string[][] | null {
  const out: string[][] = [];
  for (const [k, x] of Object.entries(v)) {
    if (isObject(x)) {
      const inner = recordLeaves(x, [...prefix, k]);
      if (!inner) return null;
      out.push(...inner);
    } else if (isBlank(x)) out.push([...prefix, k]);
    else return null;
  }
  return out;
}

function walk(v: unknown, path: (string | number)[], visit: { blank: (p: (string | number)[]) => void; list: (p: (string | number)[], leaves: string[][]) => void }, depth = 0) {
  if (depth > MAX_DEPTH) throw new TemplateError("JSON şablonu çok derin.");
  if (Array.isArray(v)) {
    const record = v.length === 1 && isObject(v[0]) ? recordLeaves(v[0]) : null;
    if (record?.length) return visit.list(path, record);
    if (!v.length || (v.length === 1 && isBlank(v[0]))) return visit.list(path, []);
    v.forEach((x, i) => walk(x, [...path, i], visit, depth + 1));
  } else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) walk(x, [...path, k], visit, depth + 1);
  } else if (isBlank(v)) visit.blank(path);
}

export function readJsonTemplate(bytes: Uint8Array): Layout {
  const slots: Slot[] = [];
  const tables: TableSlot[] = [];
  walk(parse(bytes), [], {
    blank: (p) => slots.push({ id: key(p), label: key(p) }),
    list: (p, leaves) => tables.push({
      id: key(p),
      label: key(p),
      columns: leaves.length ? leaves.map((l) => ({ id: l.join("."), label: l.join(".") })) : [{ id: "deger", label: "değer" }],
      rows: 0,
    }),
  });
  if (slots.length + tables.length > MAX_SLOTS) throw new TemplateError(`Şablonda çok fazla alan var (en fazla ${MAX_SLOTS}).`);
  return { format: "json", slots, tables };
}

/** "1.234,56" or "12" for a place that held a number; anything else stays as written. */
function typed(text: string, was: unknown): unknown {
  if (was !== 0) return text;
  const n = Number(text.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : text;
}

const setPath = (root: unknown, path: (string | number)[], value: unknown) => {
  let at = root as Record<string | number, unknown>;
  for (const p of path.slice(0, -1)) at = at[p] as Record<string | number, unknown>;
  at[path[path.length - 1]] = value;
};
const getPath = (root: unknown, path: (string | number)[]) => path.reduce<unknown>((at, p) => (at as Record<string | number, unknown>)[p], root);

export function fillJsonTemplate(bytes: Uint8Array, values: Values): Filled {
  const root = parse(bytes);
  // The whole template is the blank: its only value is the answer.
  const wrap = { root };
  const blanks: (string | number)[][] = [];
  const lists: [(string | number)[], string[][]][] = [];
  walk(root, [], { blank: (p) => blanks.push(p), list: (p, l) => lists.push([p, l]) });
  for (const p of blanks) {
    const text = cleanValue(values.slots[key(p)]);
    if (!text) continue;
    if (p.length) setPath(root, p, typed(text, getPath(root, p)));
    else wrap.root = typed(text, root);
  }
  for (const [p, leaves] of lists) {
    const rows = values.tables[key(p)];
    if (!rows?.length) continue;
    const blankRecord = leaves.length ? ((getPath(root, p) as unknown[])[0] as Record<string, unknown>) : null;
    const made = rows.map((row) => {
      if (!blankRecord) return cleanValue(row[0]);
      const rec = structuredClone(blankRecord);
      leaves.forEach((l, i) => {
        const text = cleanValue(row[i]);
        const was = getPath(rec, l);
        // A cell with nothing found is empty, not a leftover "{{ad}}".
        setPath(rec, l, text ? typed(text, was) : was === 0 ? null : typeof was === "string" ? "" : null);
      });
      return rec;
    });
    if (p.length) setPath(root, p, made);
    else wrap.root = made;
  }
  return { bytes: new TextEncoder().encode(`${JSON.stringify(wrap.root, null, 2)}\n`), notes: [] };
}
