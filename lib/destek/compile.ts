// Plan → one parameterised SQL statement over destek.v_projeler (prompt §5). Deterministic; the user's words and every
// value go as parameters, the SQL text is only built from the fixed names of lib/destek/semantic. The total row is
// computed by the same aggregate over all rows (GROUPING SETS), so a ratio in it is weighted too (§0-5).
import { BASES, DIMS, METRICS, resolveMetric, type Basis, type Dim } from "./semantic.ts";

/** An order field as the plan wrote it, on the plan's basis: "destek" → "destek_def"; anything else as it is. */
const orderName = (field: string, basis: Basis) => resolveMetric(field, basis) ?? field;
import type { Plan } from "./plan.ts";
import { MAX_ROWS } from "./view.ts";

export type ColKind = "text" | "int" | "date" | "count" | "number" | "amount" | "ratio";
export interface Col { key: string; label: string; kind: ColKind }
export interface Compiled { text: string; params: unknown[]; columns: Col[]; totalKey?: string }

const DIM_KIND: Partial<Record<Dim, ColKind>> = { yil: "int", donem: "int", son_odeme_yili: "int" };

export function whereOf(plan: Plan, snapshotId: number, params: unknown[]): string {
  const p = (v: unknown) => `$${params.push(v)}`;
  const w = [`snapshot_id = ${p(snapshotId)}`];
  const f = plan.filters;
  const anyOf = (col: string, vs?: string[]) => {
    if (vs?.length) w.push(`${col} = ANY(${p(vs)}::text[])`);
  };
  anyOf("aile", f.aile);
  anyOf("program_kodu", f.program_kodu);
  anyOf("il", f.il);
  anyOf("ilce", f.ilce);
  anyOf("durum", f.durum);
  anyOf("ana_yasal_statu", f.ana_yasal_statu);
  anyOf("alt_yasal_statu", f.alt_yasal_statu);
  const range = (col: string, r?: { in?: number[]; gte?: number; lte?: number }) => {
    if (!r) return;
    if (r.in?.length) w.push(`${col} = ANY(${p(r.in)}::int[])`);
    if (r.gte !== undefined) w.push(`${col} >= ${p(r.gte)}`);
    if (r.lte !== undefined) w.push(`${col} <= ${p(r.lte)}`);
  };
  range("yil", f.yil);
  range(DIMS.son_odeme_yili.sql, f.son_odeme_yili);
  if (f.sozlesme_imzalanan) w.push(`imzaladi = 'Evet'`);
  // Each word of the search must be in the folded name text (destek.projeler.ara, lib/destek/store); LIKE's own
  // characters in it are escaped.
  for (const word of searchWords(f.metin)) w.push(`ara LIKE ${p(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);
  return w.join(" AND ");
}

/** A name search with no word left to look for ("A B": one letter each) is refused, never run as no filter at all. */
export function metinProblem(plan: Plan): string | null {
  if (plan.filters.metin !== undefined && !searchWords(plan.filters.metin).length)
    return `HATA: filters.metin ("${plan.filters.metin.slice(0, 60)}") içinde aranacak kelime yok (en az 2 harfli kelime gerekir).`;
  return null;
}

export function searchWords(metin?: string): string[] {
  if (!metin) return [];
  return [...new Set((metin.toLocaleLowerCase("tr").replace(/[ıİ]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .match(/[\p{L}\p{N}]+/gu) ?? []).filter((x) => x.length >= 2))].slice(0, 8);
}

export function compileAggregate(plan: Plan, basis: Basis, snapshotId: number): Compiled | { error: string } {
  const params: unknown[] = [];
  const where = whereOf(plan, snapshotId, params);
  const metrics: string[] = [];
  for (const m of plan.metrics.length ? plan.metrics : ["sozlesme_imzalanan", "gelen_proje"]) {
    const r = resolveMetric(m, basis);
    if (!r) return { error: `HATA: "${m}" metriği ${basis} tabanında yok (Def-TL tabanında eş finansman kolonu yok).` };
    if (!metrics.includes(r)) metrics.push(r);
  }
  // Support and budget on one basis: their ratio beside them, as in the workbook ("Nihai Fiili Destek Oranı (Def-%)").
  for (const b of BASES) if (metrics.includes(`destek_${b}`) && metrics.includes(`butce_${b}`) && !metrics.includes(`destek_orani_${b}`)) {
    metrics.splice(Math.max(metrics.indexOf(`destek_${b}`), metrics.indexOf(`butce_${b}`)) + 1, 0, `destek_orani_${b}`);
  }
  const dims = [...new Set(plan.group_by)] as Dim[];
  const cols: Col[] = [
    ...dims.map((d) => ({ key: d, label: DIMS[d].label, kind: DIM_KIND[d] ?? ("text" as const) })),
    ...metrics.map((m) => ({ key: m, label: METRICS[m].label, kind: METRICS[m].kind as ColKind })),
  ];
  const select = [
    ...dims.map((d) => `${DIMS[d].sql} AS "${d}"`),
    ...metrics.map((m) => `(${METRICS[m].sql})::numeric AS "${m}"`),
    `count(*)::int AS "__n"`,
  ];
  const total = dims.length > 0 && plan.include_total_row;
  if (total) select.push(`GROUPING(${dims.map((d) => DIMS[d].sql).join(", ")}) AS "__total"`);
  else select.push(`0 AS "__total"`);
  const group = dims.length ? `GROUP BY ${total ? `GROUPING SETS ((${dims.map((d) => DIMS[d].sql).join(", ")}), ())` : dims.map((d) => DIMS[d].sql).join(", ")}` : "";
  const order = orderOf(plan, basis, [...dims, ...metrics], dims);
  const inner = `SELECT ${select.join(",\n  ")}\nFROM destek.v_projeler\nWHERE ${where}\n${group}`;
  // The limit counts the data rows (at most MAX_ROWS, a page's table, whatever the plan says); the total row (all rows,
  // not only those shown) always stays, last. __groups: how many data rows there were before the cut.
  const limit = `WHERE "__total" <> 0 OR __rn <= ${Math.min(Number(plan.limit ?? MAX_ROWS), MAX_ROWS)}`;
  const text = `SELECT * FROM (\n  SELECT g.*, row_number() OVER (PARTITION BY "__total" ORDER BY ${order}) AS __rn, count(*) OVER (PARTITION BY "__total") AS __groups FROM (\n${inner}\n  ) g\n) x ${limit}\nORDER BY "__total", __rn`;
  return { text, params, columns: cols, totalKey: "__total" };
}

function orderOf(plan: Plan, basis: Basis, allowed: string[], dims: string[]): string {
  const parts: string[] = [];
  for (const o of plan.order_by) {
    // Exact names only: a generic metric ("destek") is its basis' column, never another name it is a prefix of.
    const f = orderName(o.field, basis);
    if (allowed.includes(f)) parts.push(`"${f}" ${o.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`);
  }
  for (const d of dims) if (!parts.some((x) => x.startsWith(`"${d}"`))) parts.push(`"${d}" ASC NULLS LAST`);
  return parts.length ? parts.join(", ") : "1";
}

/** Project rows (list_projects, lookup_project): fixed columns, the amounts on the plan's basis, the Excel row. */
export function compileProjects(plan: Plan, basis: Basis, snapshotId: number, detail: boolean): Compiled {
  const params: unknown[] = [];
  const where = whereOf(plan, snapshotId, params);
  const unit = basis === "def" ? "Def-TL" : "TL";
  const cols: Col[] = [
    { key: "aile", label: "Aile", kind: "text" },
    { key: "program_kodu", label: "Program", kind: "text" },
    { key: "yil", label: "Yılı", kind: "int" },
    { key: "il", label: "İl", kind: "text" },
    { key: "ilce", label: "İlçe", kind: "text" },
    { key: "basvuru_sahibi", label: "Başvuru sahibi", kind: "text" },
    { key: "proje_adi", label: "Proje adı", kind: "text" },
    { key: "durum", label: "Durum", kind: "text" },
    ...(detail ? [
      { key: "imzaladi", label: "Sözleşme imzaladı", kind: "text" as const },
      { key: "fesih", label: "Fesih", kind: "text" as const },
      { key: "destek_sozlesme", label: "Sözleşme desteği (TL)", kind: "amount" as const },
      { key: "destek_nihai", label: "Nihai uygun destek (TL)", kind: "amount" as const },
      { key: "destek_def", label: "Def-TL destek", kind: "amount" as const },
      { key: "destek_bakiyesi", label: "Kalan bakiye (TL)", kind: "amount" as const },
      { key: "son_odeme_tarihi", label: "Son ödeme", kind: "date" as const },
    ] : [
      { key: "destek", label: `Destek (${unit})`, kind: "amount" as const },
      { key: "butce", label: `Bütçe (${unit})`, kind: "amount" as const },
      { key: "destek_orani", label: "Destek oranı", kind: "ratio" as const },
      ...(plan.filters.son_odeme_yili ? [{ key: "son_odeme_tarihi", label: "Son ödeme", kind: "date" as const }] : []),
      ...(plan.filters.durum?.includes("Devam Ediyor") ? [{ key: "destek_bakiyesi", label: "Kalan bakiye (TL)", kind: "amount" as const }] : []),
    ]),
    { key: "kaynak", label: "Excel satırı", kind: "text" },
  ];
  const select = [
    "aile", "program_kodu", "yil", "il", "ilce", "basvuru_sahibi", "proje_adi", "durum",
    ...(detail
      ? ["imzaladi", "fesih", "sozlesme_destek AS destek_sozlesme", "m_destek_nihai AS destek_nihai", "m_destek_def AS destek_def", "destek_bakiyesi", "son_odeme_tarihi::text AS son_odeme_tarihi"]
      : [`m_destek_${basis} AS destek`, `m_butce_${basis} AS butce`, `m_destek_${basis}::numeric / NULLIF(m_butce_${basis}, 0) AS destek_orani`, "son_odeme_tarihi::text AS son_odeme_tarihi", "destek_bakiyesi"]),
    `kaynak_sayfa || ' › ' || kaynak_satir AS kaynak`, `0 AS "__total"`,
  ];
  const keys = cols.map((c) => c.key);
  const order: string[] = [];
  for (const o of plan.order_by) {
    // A list shows the plan's basis under the bare names ("destek"): "destek_def" on the Def-TL basis is that column.
    const bare = new RegExp(`^(destek|butce|destek_orani)_${basis}$`, "u").exec(o.field)?.[1];
    const f = keys.includes(o.field) ? o.field : bare && keys.includes(bare) ? bare : undefined;
    if (f && f !== "kaynak") order.push(`"${f}" ${o.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`);
  }
  if (!order.length) order.push(detail ? `yil DESC NULLS LAST` : `"destek" DESC NULLS LAST`);
  order.push("aile", "kaynak_satir");
  const limit = Math.min(plan.limit ?? 20, detail ? 20 : 200);
  const text = `SELECT ${select.join(", ")} FROM destek.v_projeler WHERE ${where} ORDER BY ${order.join(", ")} LIMIT ${limit}`;
  return { text, params, columns: cols };
}
