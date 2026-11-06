// The meaning layer (prompt §3): metrics, dimensions, synonyms and defaults. Every metric is the İcmal sheets' own
// formula, written once as SQL over destek.v_projeler (lib/db.ts): the answers and the load-time reconciliation against
// the İcmal use these same expressions, so a definition that drifts from the workbook fails the load, not an answer.
// SQL here is constant text, never built from user input (values go as parameters, lib/destek/compile).

export type Basis = "sozlesme" | "nihai" | "def";
export const BASES: Basis[] = ["sozlesme", "nihai", "def"];
/** User decision (2026-11-06): with no basis asked for, amounts are Def-TL, as the agency's own İstatistik sheet. */
export const DEFAULT_BASIS: Basis = "def";
export const BASIS_LABEL: Record<Basis, string> = {
  sozlesme: "Sözleşme (imzalandığı haliyle, nominal TL)",
  nihai: "Nihai (gerçekleşen uygun destek / fiili bütçe, nominal TL)",
  def: "Def-TL (2026 fiyatlarıyla, kamu yatırım deflatörüyle)",
};

export type MetricKind = "count" | "amount" | "ratio" | "number";
export interface Metric { label: string; kind: MetricKind; sql: string; basis?: Basis; note?: string }

const count = (cond?: string) => (cond ? `count(*) FILTER (WHERE ${cond})` : "count(*)");
const sum = (col: string, cond?: string) => `COALESCE(sum(${col})${cond ? ` FILTER (WHERE ${cond})` : ""}, 0)`;
const ratio = (a: string, b: string) => `(${a})::numeric / NULLIF(${b}, 0)`;
const SIGNED = "imzaladi = 'Evet'";

const C = {
  gelen: count(),
  basarili: count("degerlendirme = 'Başarılı'"),
  nihai: count(`${SIGNED} AND durum IN ('Devam Ediyor', 'Tamamlandı')`),
};

const FIXED: Record<string, Metric> = {
  gelen_proje: { label: "Gelen proje", kind: "count", sql: C.gelen },
  on_incelemede_elenen: { label: "Ön incelemede elenen", kind: "count", sql: count("on_inceleme = 'Başarısız'") },
  basarili_proje: { label: "Başarılı proje", kind: "count", sql: C.basarili },
  basarisiz_proje: { label: "Başarısız proje", kind: "count", sql: `(${C.gelen} - ${C.basarili})` },
  // The İcmal formula counts "Asil" exactly (case aside): "Asıl", "Asıl-4" are not counted there, nor here (a warning says how many).
  asil_proje: { label: "Asil liste", kind: "count", sql: count("liste = 'Asil'") },
  yedek_proje: { label: "Yedek liste", kind: "count", sql: count("liste = 'Yedek'") },
  hak_kazanan: { label: "Desteklenmeye hak kazanan", kind: "count", sql: count("hak_kazandi = 'Evet'"), note: "DFD-FZD ve TD" },
  sozlesme_imzalanan: { label: "Sözleşme imzalanan", kind: "count", sql: count(SIGNED) },
  fesih_edilen: { label: "Fesih edilen", kind: "count", sql: count(`${SIGNED} AND fesih = 'Evet'`) },
  devam_eden: { label: "Devam eden", kind: "count", sql: count(`${SIGNED} AND durum = 'Devam Ediyor'`) },
  tamamlanan: { label: "Tamamlanan", kind: "count", sql: count(`${SIGNED} AND durum = 'Tamamlandı'`) },
  nihai_desteklenen: { label: "Nihai desteklenen", kind: "count", sql: C.nihai },
  istihdam: { label: "İstihdam edilen kişi", kind: "number", sql: sum("istihdam") },
  belge_sayisi: { label: "Kalite/markalaşma belgesi", kind: "number", sql: sum("belge_sayisi") },
  makine_ekipman: { label: "Makine ve ekipman", kind: "number", sql: sum("makine_ekipman") },
  fizibilite_sayisi: { label: "Plan/rapor/fizibilite", kind: "number", sql: sum("fizibilite_sayisi"), note: "DFD-FZD" },
  yararlanici_sayisi: { label: "Yararlanıcı", kind: "number", sql: sum("yararlanici_sayisi"), note: "TD" },
  destek_bakiyesi: { label: "Kalan destek bakiyesi (TL)", kind: "amount", sql: sum("destek_bakiyesi", "durum = 'Devam Ediyor'"), note: "devam eden projeler, nominal" },
  nihai_uygun_butce: { label: "Nihai uygun toplam bütçe (TL)", kind: "amount", sql: sum("nihai_uygun_butce"), basis: "nihai" },
  nihai_uygun_es_finansman: { label: "Nihai uygun eş finansman (TL)", kind: "amount", sql: sum("nihai_uygun_es_finansman"), basis: "nihai" },
  basari_orani: { label: "Başarı oranı", kind: "ratio", sql: ratio(C.basarili, C.gelen) },
  destek_alma_orani: { label: "Destek alma oranı", kind: "ratio", sql: ratio(C.nihai, C.gelen) },
};

/**
 * Each basis by the workbook's own column names (lib/db v_projeler), so a table says where its figures come from. On
 * Def-TL: "Nihai Uygun Ajans Destek Miktarı (Def-TL)" and "Nihai Fiili Toplam Bütçe (Def-TL)"; the ratio of their sums is
 * "Nihai Fiili Destek Oranı (Def-%)" weighted (each row's own value is exactly that quotient, checked on the 2026 file).
 */
const LABELS: Record<Basis, { destek: string; butce: string; es?: string; oran: string }> = {
  sozlesme: { destek: "Sözleşme ajans destek miktarı (TL)", butce: "Sözleşme toplam bütçe (TL)", es: "Sözleşme eş finansman miktarı (TL)", oran: "Sözleşme destek oranı" },
  nihai: { destek: "Nihai uygun ajans destek miktarı (TL)", butce: "Nihai fiili toplam bütçe (TL)", es: "Nihai fiili eş finansman miktarı (TL)", oran: "Nihai fiili destek oranı" },
  def: { destek: "Nihai uygun ajans destek miktarı (Def-TL)", butce: "Nihai fiili toplam bütçe (Def-TL)", oran: "Nihai fiili destek oranı (Def-%)" },
};
/** destek / es_finansman / butce / destek_orani on each basis: "destek_sozlesme", …; the bare names take the plan's basis. */
const BY_BASIS: Record<string, Metric> = Object.fromEntries(BASES.flatMap((b) => [
  [`destek_${b}`, { label: LABELS[b].destek, kind: "amount", basis: b, sql: sum(`m_destek_${b}`) }],
  [`butce_${b}`, { label: LABELS[b].butce, kind: "amount", basis: b, sql: sum(`m_butce_${b}`) }],
  ...(LABELS[b].es ? [[`es_finansman_${b}`, { label: LABELS[b].es, kind: "amount", basis: b, sql: sum(`m_es_finansman_${b}`) }]] : []),
  // Weighted (§0-5): Σ support / Σ budget, over the rows that have a budget at all (TD has none on sözleşme/nihai).
  [`destek_orani_${b}`, { label: LABELS[b].oran, kind: "ratio", basis: b, sql: ratio(sum(`m_destek_${b}`, `m_butce_${b} IS NOT NULL`), sum(`m_butce_${b}`)) }],
] as [string, Metric][]));

export const METRICS: Record<string, Metric> = { ...FIXED, ...BY_BASIS };
export const GENERIC = ["destek", "butce", "es_finansman", "destek_orani"] as const;
export const METRIC_NAMES = [...Object.keys(METRICS), ...GENERIC];

/** A plan's metric name on its basis: "destek" → "destek_def"; "es_finansman" has no Def-TL column → null. */
export function resolveMetric(name: string, basis: Basis): string | null {
  if ((GENERIC as readonly string[]).includes(name)) return METRICS[`${name}_${basis}`] ? `${name}_${basis}` : null;
  return METRICS[name] ? name : null;
}

/** Dimensions a plan may group or filter by: name → SQL over v_projeler, and its label. */
export const DIMS = {
  aile: { sql: "aile", label: "Program ailesi" },
  program_kodu: { sql: "program_kodu", label: "Program" },
  yil: { sql: "yil", label: "Yılı" },
  donem: { sql: "donem", label: "Dönem" },
  il: { sql: "il", label: "İl" },
  ilce: { sql: "ilce", label: "İlçe" },
  ana_yasal_statu: { sql: "ana_yasal_statu", label: "Ana yasal statü" },
  alt_yasal_statu: { sql: "alt_yasal_statu", label: "Alt yasal statü" },
  sektor: { sql: "sektor", label: "Sektör" },
  durum: { sql: "durum", label: "Durum" },
  liste: { sql: "liste_grubu", label: "Liste" },
  son_odeme_yili: { sql: "extract(year FROM son_odeme_tarihi)::int", label: "Son ödeme yılı" },
} as const;
export type Dim = keyof typeof DIMS;
export const DIM_NAMES = Object.keys(DIMS) as Dim[];

/** Families by sheet name (§1.1); a new sheet is still loaded, under its own name. */
export const FAMILIES = ["PTÇ", "GPD", "FND", "FKD", "DFD-FZD", "TD", "SOGEP", "Diğer"];
/** Words for a family (§3). FKD, ÇÜGP, KDSP, ÜŞP, MUSTD: expansions not given yet (§11-4), so none are guessed. */
export const FAMILY_WORDS: Record<string, string[]> = {
  SOGEP: ["sogep", "sosyal gelişme", "sosyal gelisme"],
  "PTÇ": ["ptç", "ptc", "proje teklif çağrısı", "proje teklif cagrisi", "mali destek programı", "mali destek programi"],
  TD: ["td", "teknik destek"],
  "DFD-FZD": ["dfd", "doğrudan faaliyet", "dogrudan faaliyet", "fzd", "fizibilite", "fd", "dfd-fzd"],
  GPD: ["gpd", "güdümlü", "gudumlu", "güdümlü proje"],
  FND: ["fnd", "finansman", "faiz destekli", "kobifin", "kobistfin"],
  FKD: ["fkd"],
  "Diğer": ["diğer", "diger"],
};
/** Province spellings (§3): "afyon" → Afyonkarahisar; case and Turkish letters are ignored anyway (lib/destek/match). */
export const PLACE_WORDS: Record<string, string> = { afyon: "Afyonkarahisar" };

/** Concept words the tool description lists for the model (§3). */
export const CONCEPTS = `Kavramlar: "destek tutarı / hibe / ajans katkısı" → destek; "bütçe / proje bütçesi / toplam maliyet" → butce; "oran / destek oranı / hibe oranı" → destek_orani; "desteklenen proje / sözleşme imzalanan / proje sayısı" → sozlesme_imzalanan (yanına gelen_proje de koy); "biten" → tamamlanan; "feshedilen / iptal" → fesih_edilen; "reel / bugünkü fiyatlarla / 2026 fiyatlarıyla / deflatörlü" → amount_basis "def" (Def-TL kolonları da nihai tutarlardır: "nihai deflatörlü" → "def"); "sözleşme tutarı" → "sozlesme"; deflatörsüz "gerçekleşen / nihai" → "nihai". Tutarları tabanla birlikte değil, düz adıyla (destek, butce, destek_orani) iste; taban amount_basis'tedir. "Yıl yıl / her yıl / yıllara göre / ayrı ayrı" → tek çağrıda group_by ["yil"] (il, ilçe, program için de aynı): her değer için ayrı çağrı yapma; toplam satırı kendiliğinden gelir.`;
