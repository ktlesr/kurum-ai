// A template by its file type. Everything happens on this server, and nothing here keeps the file.
import { contentProblem } from "./filetype.ts";
import { TEMPLATE_FORMATS, TemplateError, cleanValue, MAX_ROWS, type Filled, type Layout, type TemplateFormat, type Values } from "./template.ts";
import { fillDocxTemplate, readDocxTemplate } from "./template-docx.ts";
import { fillJsonTemplate, readJsonTemplate } from "./template-json.ts";
import { fillPdfTemplate, readPdfTemplate } from "./template-pdf.ts";
import { fillXlsxTemplate, readXlsxTemplate } from "./template-xlsx.ts";

const MAX_JSON = 5 * 1024 * 1024;

export const CONTENT_TYPES: Record<TemplateFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  json: "application/json",
};

export const formatOf = (name: string): TemplateFormat | null => {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (TEMPLATE_FORMATS as readonly string[]).includes(ext) ? (ext as TemplateFormat) : null;
};

/** Same checks as an upload: the bytes must be what the name says, and a zip must not be a bomb. */
export async function templateProblem(format: TemplateFormat, bytes: Uint8Array): Promise<string | null> {
  if (format === "json") return bytes.length > MAX_JSON ? "JSON şablonu en fazla 5 MB olabilir." : bytes.subarray(0, 65536).includes(0) ? "JSON şablonu okunamadı." : null;
  return contentProblem(format, bytes);
}

export function readTemplate(format: TemplateFormat, bytes: Uint8Array): Promise<Layout> | Layout {
  switch (format) {
    case "xlsx": return readXlsxTemplate(bytes);
    case "docx": return readDocxTemplate(bytes);
    case "pdf": return readPdfTemplate(bytes);
    case "json": return readJsonTemplate(bytes);
  }
}

export function fillTemplate(format: TemplateFormat, bytes: Uint8Array, values: Values): Promise<Filled> | Filled {
  switch (format) {
    case "xlsx": return fillXlsxTemplate(bytes, values);
    case "docx": return fillDocxTemplate(bytes, values);
    case "pdf": return fillPdfTemplate(bytes, values);
    case "json": return fillJsonTemplate(bytes, values);
  }
}

/** Values as a request sent them: strings only, no surprise keys, bounded. */
export function parseValues(raw: unknown): Values | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { slots?: unknown; tables?: unknown };
  const out: Values = { slots: Object.create(null) as Record<string, string>, tables: Object.create(null) as Record<string, string[][]> };
  if (typeof r.slots === "object" && r.slots !== null) {
    for (const [k, v] of Object.entries(r.slots)) {
      const text = cleanValue(v);
      if (text) out.slots[k] = text;
    }
  }
  if (typeof r.tables === "object" && r.tables !== null) {
    for (const [k, rows] of Object.entries(r.tables)) {
      if (!Array.isArray(rows)) continue;
      if (rows.length > MAX_ROWS) throw new TemplateError(`Bir tabloya en fazla ${MAX_ROWS} satır yazılabilir.`);
      out.tables[k] = rows.filter(Array.isArray).map((row: unknown[]) => row.slice(0, 200).map(cleanValue));
    }
  }
  return out;
}
