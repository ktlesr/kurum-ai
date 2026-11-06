// The parts of an .xlsx that the cell reader isn't trusted with: the Excel tables (ListObjects) of each sheet, read
// straight from the zip (xl/workbook.xml → its rels → each sheet's rels → xl/tables/tableN.xml), and the formula
// cells that have no stored result. ExcelJS 4.4.0 drops a stored result of 0 (seen on this workbook: "<f>…</f><v>0</v>"
// comes back as { formula } with no result), so "no result" from it is only believed when the XML has no <v> either.
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

export interface XlsxTable { sheet: string; name: string; ref: string }

const xml = (s: string) => new DOMParser().parseFromString(s, "text/xml");
const els = (doc: Document, tag: string) => Array.from(doc.getElementsByTagNameNS("*", tag));
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A rels target against the folder of the part it belongs to ("worksheets/sheet1.xml" from xl/, "../tables/t1.xml"). */
export function resolvePart(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

const relsOf = async (zip: JSZip, part: string): Promise<Map<string, string>> => {
  const at = part.split("/");
  const relsPath = [...at.slice(0, -1), "_rels", `${at.at(-1)}.rels`].join("/");
  const f = zip.file(relsPath);
  const out = new Map<string, string>();
  if (!f) return out;
  for (const r of els(xml(await f.async("string")), "Relationship")) {
    const id = r.getAttribute("Id"), target = r.getAttribute("Target");
    if (id && target && r.getAttribute("TargetMode") !== "External") out.set(id, resolvePart(part, target));
  }
  return out;
};

export interface XlsxParts {
  tables: XlsxTable[];
  /** Per sheet name: addresses of formula cells with no stored value (<f> but no <v>). */
  uncached: Map<string, Set<string>>;
}

export async function readParts(buf: Buffer | Uint8Array): Promise<XlsxParts> {
  const zip = await JSZip.loadAsync(buf);
  const wbFile = zip.file("xl/workbook.xml");
  if (!wbFile) throw new Error("xl/workbook.xml yok: bu bir Excel çalışma kitabı değil.");
  const wbRels = await relsOf(zip, "xl/workbook.xml");
  const tables: XlsxTable[] = [];
  const uncached = new Map<string, Set<string>>();
  for (const s of els(xml(await wbFile.async("string")), "sheet")) {
    const name = s.getAttribute("name") ?? "";
    const part = wbRels.get(s.getAttributeNS(R_NS, "id") ?? s.getAttribute("r:id") ?? "");
    const sheetFile = part && zip.file(part);
    if (!part || !sheetFile) continue;
    const sheetXml = await sheetFile.async("string");
    const sheetRels = await relsOf(zip, part);
    for (const tp of els(xml(sheetXml), "tablePart")) {
      const tPart = sheetRels.get(tp.getAttributeNS(R_NS, "id") ?? tp.getAttribute("r:id") ?? "");
      const tFile = tPart && zip.file(tPart);
      if (!tFile) continue;
      const t = xml(await tFile.async("string")).documentElement;
      const tName = t?.getAttribute("displayName") || t?.getAttribute("name");
      const ref = t?.getAttribute("ref");
      if (tName && ref) tables.push({ sheet: name, name: tName, ref });
    }
    uncached.set(name, uncachedCells(sheetXml));
  }
  return { tables, uncached };
}

/** Formula cells of a sheet's XML with no <v>: "<c r="A1"><f>…</f></c>" or a shared one "<c r="A2"><f t="shared" si="0"/></c>". */
export function uncachedCells(sheetXml: string): Set<string> {
  const out = new Set<string>();
  // One cell at a time, no backtracking across cells: "<c" … ">" then its body up to "</c>" (cells don't nest).
  const CELL = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  for (const m of sheetXml.matchAll(CELL)) {
    const body = m[3];
    if (!body || !/<f\b/.test(body) || /<v\b/.test(body)) continue;
    const r = /\br="([A-Z]{1,3}\d{1,7})"/.exec(m[1]);
    if (r) out.add(r[1]);
  }
  return out;
}

/** "A1:BQ2053" → 1-based bounds. */
export function refBounds(ref: string): { c1: number; r1: number; c2: number; r2: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) throw new Error(`Tablo aralığı okunamadı: ${ref}`);
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

export const colLetter = (n: number): string => (n > 26 ? colLetter(Math.floor((n - 1) / 26)) : "") + String.fromCharCode(65 + ((n - 1) % 26));
