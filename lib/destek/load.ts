// Reads the ZAFER support workbook into plain rows (prompt §1, §4): every "*_Projeler" Excel table by its own range,
// headers matched by name (./columns), values normalised, every data-quality finding recorded. The İcmal sheets' first
// table and the deflator table are read too: the first only to reconcile against (never an answer), the second as data.
// Nothing is summed here; numbers stay as the decimal strings Excel stored, for Postgres numeric.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { CANON, CRITERIA, excelEq, headerUse, normHeader, type Canon } from "./columns.ts";
import { colLetter, readParts, refBounds, type XlsxTable } from "./xlsx-zip.ts";

export type Val = string | null;
export interface Dq { kind: string; aile?: string; sheet: string; row?: number; col?: string; detail: string }
export interface ProjectRow {
  aile: string; sheet: string; row: number;
  values: Partial<Record<Canon, Val>>;
  payments: { tur: string; tarih: Val; tutar: Val }[];
  extra: Record<string, string | number | boolean | null>;
}
export interface Family { aile: string; sheet: string; table: string; ref: string; rows: ProjectRow[]; skipped: number }
export interface IcmalRow { aile: string; sheet: string; row: number; kind: "ilce" | "il" | "bolge"; il: string; ilce: string | null; values: Record<string, Val> }
export interface Parsed {
  file: string; sha256: string; families: Family[]; icmal: IcmalRow[];
  icmalHeaders: { aile: string; headers: string[] }[];
  deflator: { yil: number; sektor: string; deger: string }[];
  dq: Dq[];
}

type Cell = ExcelJS.CellValue;
const isObj = (v: Cell): v is Exclude<Cell, string | number | boolean | Date | null | undefined> => !!v && typeof v === "object" && !(v instanceof Date);

/** A cell's value as stored: a formula's stored result; an error as { error }. */
function stored(v: Cell, uncachedHere: boolean): { v: string | number | boolean | Date | null } | { error: string } | { noResult: true } {
  if (v === null || v === undefined) return { v: null };
  if (!isObj(v)) return { v };
  if ("error" in v) return { error: String(v.error) };
  if ("formula" in v || "sharedFormula" in v) {
    if (!("result" in v) || v.result === undefined) return uncachedHere ? { noResult: true } : { v: 0 }; // ExcelJS drops a stored 0 (./xlsx-zip)
    const r = v.result as Cell;
    if (isObj(r) && "error" in r) return { error: String(r.error) };
    return { v: r instanceof Date || typeof r !== "object" ? (r as string | number | boolean | Date) : null };
  }
  if ("richText" in v) return { v: v.richText.map((t) => t.text).join("") };
  if ("text" in v) return { v: String(v.text) };
  return { v: null };
}

const numStr = (n: number) => (Number.isFinite(n) ? String(n) : null);
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export async function parseWorkbook(buf: Buffer, file: string): Promise<Parsed> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const parts = await readParts(buf);
  const wb = new ExcelJS.Workbook();
  // ExcelJS's own typings want its Buffer; a Node Buffer is one.
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const dq: Dq[] = [];
  const families: Family[] = [];
  const icmal: IcmalRow[] = [];
  const icmalHeaders: Parsed["icmalHeaders"] = [];
  let deflator: Parsed["deflator"] = [];

  const grid = (t: XlsxTable) => {
    const ws = wb.getWorksheet(t.sheet);
    if (!ws) throw new Error(`Sayfa bulunamadı: ${t.sheet}`);
    const b = refBounds(t.ref);
    const unc = parts.uncached.get(t.sheet) ?? new Set<string>();
    const at = (r: number, c: number) => stored(ws.getCell(r, c).value, unc.has(`${colLetter(c)}${r}`));
    const headers: string[] = [];
    for (let c = b.c1; c <= b.c2; c++) {
      const h = at(b.r1, c);
      headers.push("v" in h && h.v !== null ? String(h.v) : "");
    }
    return { b, at, headers };
  };

  for (const t of parts.tables) {
    if (t.name.endsWith("_Projeler")) families.push(readFamily(t));
    else if (t.name.endsWith("_İcmal")) readIcmal(t);
    else if (normHeader(t.name) === normHeader("Deflatör")) deflator = readDeflator(t);
  }
  if (!families.length) throw new Error("Çalışma kitabında \"*_Projeler\" adlı Excel tablosu yok: bu dosya ZAFER destek verisi değil ya da yapısı değişmiş.");
  if (!deflator.length) dq.push({ kind: "deflator_yok", sheet: "", detail: "Deflatör tablosu bulunamadı; Def-TL örneklem kontrolü yapılamaz." });
  return { file, sha256, families, icmal, icmalHeaders, deflator, dq };

  function readFamily(t: XlsxTable): Family {
    const aile = t.sheet;
    const { b, at, headers } = grid(t);
    const uses = headers.map((h) => headerUse(aile, h));
    uses.forEach((u, i) => {
      if (u.to === "extra" && !u.known && headers[i]) dq.push({ kind: "schema_drift", aile, sheet: t.sheet, col: colLetter(b.c1 + i), detail: `Sözlükte olmayan başlık: "${headers[i]}" (ham adıyla extra alanında tutuldu)` });
    });
    const seen = new Map<Canon, number>();
    uses.forEach((u, i) => {
      if (u.to !== "canon") return;
      if (seen.has(u.col)) dq.push({ kind: "schema_drift", aile, sheet: t.sheet, col: colLetter(b.c1 + i), detail: `"${headers[i]}" ile "${headers[seen.get(u.col)!]}" aynı kolona (${u.col}) eşleşiyor; ilki kullanıldı` });
      else seen.set(u.col, i);
    });
    const rows: ProjectRow[] = [];
    let skipped = 0;
    for (let r = b.r1 + 1; r <= b.r2; r++) {
      const row: ProjectRow = { aile, sheet: t.sheet, row: r, values: {}, payments: [], extra: {} };
      const pay = new Map<string, { tarih: Val; tutar: Val }>();
      const issues: Dq[] = [];
      for (let i = 0; i < headers.length; i++) {
        const u = uses[i];
        const col = colLetter(b.c1 + i);
        const s = at(r, b.c1 + i);
        const where = { aile, sheet: t.sheet, row: r, col };
        if ("noResult" in s) {
          issues.push({ kind: "formul_sonucu_yok", ...where, detail: `"${headers[i]}": formülün kayıtlı sonucu yok` });
          continue;
        }
        if ("error" in s) {
          issues.push({ kind: "hata_degeri", ...where, detail: `"${headers[i]}": ${s.error}` });
          continue;
        }
        if (u.to === "extra") {
          if (headers[i]) row.extra[headers[i]] = s.v instanceof Date ? dateStr(s.v) : s.v;
          continue;
        }
        const kind = u.to === "canon" ? CANON[u.col] : u.part === "tarih" ? "date" : "num";
        const v = typed(s.v, kind, headers[i], where, issues);
        if (u.to === "canon") {
          if (seen.get(u.col) === i) row.values[u.col] = v;
        } else {
          const p = pay.get(u.tur) ?? { tarih: null, tutar: null };
          p[u.part] = v;
          pay.set(u.tur, p);
        }
      }
      // Not a project: a row with no province (FKD's empty template rows, §1.3). Counted, not loaded, its findings dropped.
      if (!row.values.il) {
        skipped++;
        continue;
      }
      normalise(row, issues);
      dq.push(...issues);
      row.payments = [...pay].filter(([, p]) => p.tarih || (p.tutar && Number(p.tutar) !== 0)).map(([tur, p]) => ({ tur, ...p }));
      rows.push(row);
    }
    if (skipped) dq.push({ kind: "bos_il", aile, sheet: t.sheet, detail: `${skipped} satırda İl boş: proje sayılmadı${rows.length ? "" : " (tablo boş şablon)"}` });
    return { aile, sheet: t.sheet, table: t.name, ref: t.ref, rows, skipped };
  }

  function typed(v: string | number | boolean | Date | null, kind: string, header: string, where: Omit<Dq, "kind" | "detail">, issues: Dq[]): Val {
    if (v === null || v === "") return null;
    if (typeof v === "string" && v.trim() === "-") return null; // "-" means none (§1.3)
    if (kind === "text") return v instanceof Date ? dateStr(v) : String(v);
    if (kind === "date") {
      if (v instanceof Date) return dateStr(v);
      issues.push({ kind: "tarih_metin", ...where, detail: `"${header}": tarih değil: ${String(v).slice(0, 40)}` });
      return null;
    }
    if (typeof v === "number") {
      if (kind === "int" && !Number.isInteger(v)) {
        issues.push({ kind: "sayi_metin", ...where, detail: `"${header}": tam sayı değil: ${v}` });
        return null;
      }
      return numStr(v);
    }
    if (typeof v === "string" && kind === "int" && /^\s*\d{1,6}\s*$/u.test(v)) return v.trim();
    issues.push({ kind: "sayi_metin", ...where, detail: `"${header}": sayı değil: ${String(v).slice(0, 40)}` });
    return null;
  }

  function normalise(row: ProjectRow, issues: Dq[]) {
    const where = { aile: row.aile, sheet: row.sheet, row: row.row };
    for (const [col, words] of Object.entries(CRITERIA) as [Canon, string[]][]) {
      const v = row.values[col];
      if (!v) continue;
      const w = words.find((x) => excelEq(x, v));
      if (w && w !== v) {
        if (col === "durum") issues.push({ kind: "yazim", ...where, detail: `Proje Tamamlanma Durumu "${v}" → "${w}"` });
        row.values[col] = w;
      }
    }
    if (row.values.durum === "U.D") {
      row.values.durum = "U.D.";
      issues.push({ kind: "yazim", ...where, detail: `Proje Tamamlanma Durumu "U.D" → "U.D."` });
    }
    for (const col of ["ana_yasal_statu", "alt_yasal_statu", "il", "ilce", "program_kodu"] as Canon[]) {
      const v = row.values[col];
      if (v && v !== v.trim()) {
        issues.push({ kind: "bosluk", ...where, detail: `${col}: "${v}" sonundaki/başındaki boşluk kaldırıldı` });
        row.values[col] = v.trim();
      }
    }
  }

  function readIcmal(t: XlsxTable) {
    const aile = t.sheet.replace(/\s+İcmal$/u, "");
    const { b, at, headers } = grid(t);
    icmalHeaders.push({ aile, headers });
    for (let r = b.r1 + 1; r <= b.r2; r++) {
      const cell = (c: number) => {
        const s = at(r, c);
        return "v" in s ? s.v : null;
      };
      const a = cell(b.c1), bb = cell(b.c1 + 1);
      if (a === null || a === "") continue;
      const il = String(a).trim(), second = bb === null ? "" : String(bb).trim();
      const isTotal = excelEq(second, "TOPLAM");
      const kind: IcmalRow["kind"] = isTotal ? (/bölgesi/iu.test(il) ? "bolge" : "il") : "ilce";
      const values: Record<string, Val> = {};
      for (let i = 2; i < headers.length; i++) {
        const s = at(r, b.c1 + i);
        if ("error" in s) values[headers[i]] = null;
        else if ("noResult" in s) {
          values[headers[i]] = null;
          dq.push({ kind: "formul_sonucu_yok", aile, sheet: t.sheet, row: r, col: colLetter(b.c1 + i), detail: `İcmal "${headers[i]}": kayıtlı sonuç yok` });
        } else values[headers[i]] = typeof s.v === "number" ? numStr(s.v) : s.v === null ? "0" : null;
      }
      icmal.push({ aile, sheet: t.sheet, row: r, kind, il, ilce: isTotal ? null : second, values });
    }
  }

  function readDeflator(t: XlsxTable) {
    const { b, at, headers } = grid(t);
    const yilAt = headers.findIndex((h) => normHeader(h) === normHeader("Yıl"));
    const out: Parsed["deflator"] = [];
    if (yilAt < 0) return out;
    for (let r = b.r1 + 1; r <= b.r2; r++) {
      const y = at(r, b.c1 + yilAt);
      if (!("v" in y) || typeof y.v !== "number") continue;
      headers.forEach((h, i) => {
        if (i === yilAt || !h) return;
        const s = at(r, b.c1 + i);
        if ("v" in s && typeof s.v === "number") out.push({ yil: y.v as number, sektor: h.trim(), deger: numStr(s.v)! });
      });
    }
    return out;
  }
}
