// The load gate (prompt §7): each family's İcmal first table, row by row (il × ilçe), against the same numbers
// computed from the raw project rows with lib/destek/semantic's metric SQL. The second İcmal table (one program picked
// in a dropdown, §1.4-1) is never read. Region total rows are only checked for consistency, never compared (§1.4-2).
import { METRICS } from "./semantic.ts";
import { normHeader } from "./columns.ts";

/** İcmal header → the metric it is (TD's "Maliyet" columns are its support: lib/destek/columns TD). */
const ICMAL_METRIC: Record<string, string> = {
  "Gelen Proje Sayısı": "gelen_proje",
  "Ön İncelemede Elenen Proje Sayısı": "on_incelemede_elenen",
  "Başarısız Proje Sayısı": "basarisiz_proje",
  "Başarılı Proje Sayısı": "basarili_proje",
  "Asil Proje Sayısı": "asil_proje",
  "Yedek Proje Sayısı": "yedek_proje",
  "Desteklenmeye Hak Kazanan Proje Sayısı": "hak_kazanan",
  "Sözleşme İmzalanan Proje Sayısı": "sozlesme_imzalanan",
  "Sözleşme Ajans Destek Miktarı (TL)": "destek_sozlesme",
  "Sözleşme Eş Finansman Miktarı (TL)": "es_finansman_sozlesme",
  "Sözleşme Toplam Bütçe (TL)": "butce_sozlesme",
  "Sözleşme Toplam Maliyet (TL)": "destek_sozlesme",
  "Sözleşme Fesih Edilen Proje Sayısı": "fesih_edilen",
  "Devam Eden Proje Sayısı": "devam_eden",
  "Tamamlanan Proje Sayısı": "tamamlanan",
  "Nihai Desteklenen Proje Sayısı": "nihai_desteklenen",
  "Nihai Uygun Ajans Destek Miktarı (TL)": "destek_nihai",
  "Nihai Uygun Eş Finansman Miktarı (TL)": "nihai_uygun_es_finansman",
  "Nihai Uygun Toplam Bütçe (TL)": "nihai_uygun_butce",
  "Nihai Fiili Eş Finansman Miktarı (TL)": "es_finansman_nihai",
  "Nihai Fiili Toplam Bütçe (TL)": "butce_nihai",
  "Nihai Fiili Toplam Maliyet (TL)": "destek_nihai",
  "Nihai Uygun Ajans Destek Miktarı (Def-TL)": "destek_def",
  "Nihai Fiili Toplam Bütçe (Def-TL)": "butce_def",
  "Nihai Fiili Toplam Maliyet (Def-TL)": "destek_def",
  "İstihdam Edilen Kişi Sayısı": "istihdam",
  "Kalite ve Markalaşmaya Yönelik Alınan Belge Sayısı": "belge_sayisi",
  "Alınan Makine ve Ekipman Sayısı": "makine_ekipman",
  "Plan, Araştırma Raporu veya Fizibilite Sayısı": "fizibilite_sayisi",
  "Yararlanıcı Sayısı": "yararlanici_sayisi",
};
const BY_NORM = new Map(Object.entries(ICMAL_METRIC).map(([h, m]) => [normHeader(h), m]));
export const icmalMetric = (header: string): string | undefined => BY_NORM.get(normHeader(header));

/** Metrics each family's İcmal must have for its rows to count as checked: the count, the signed count, the support. */
export const REQUIRED = ["gelen_proje", "sozlesme_imzalanan"];
export const SUPPORT_ANY = ["destek_sozlesme", "destek_nihai", "destek_def"];

/**
 * Why a version can't be called checked even with no mismatch: a family with projects whose İcmal table is missing,
 * has no ilçe rows, or lacks the metrics above (a renamed or deleted İcmal must not let its family through unchecked).
 */
export function coverageProblems(families: { aile: string; loaded: number }[], icmal: { aile: string; ilceRows: number; metrics: Set<string> }[]): string[] {
  const out: string[] = [];
  for (const f of families) {
    if (!f.loaded) continue;
    const i = icmal.find((x) => x.aile === f.aile);
    if (!i) out.push(`${f.aile}: İcmal tablosu (${f.aile}_İcmal) bulunamadı; ${f.loaded} proje doğrulanamadı`);
    else if (!i.ilceRows) out.push(`${f.aile}: İcmal tablosunda il/ilçe satırı yok; ${f.loaded} proje doğrulanamadı`);
    else {
      const missing = REQUIRED.filter((m) => !i.metrics.has(m));
      if (!SUPPORT_ANY.some((m) => i.metrics.has(m))) missing.push("bir destek tutarı kolonu");
      if (missing.length) out.push(`${f.aile}: İcmal'de gerekli kolon yok (${missing.join(", ")}); doğrulanamadı`);
    }
  }
  return out;
}

/** Allowed difference: counts exactly, amounts to the kuruş (§7). */
export const TOLERANCE = "0.01";

/** The metrics the İcmal tables use, as one SELECT list (alias = metric name). */
export function reconcileSelect(metrics: string[]): string {
  return metrics.map((m) => `(${METRICS[m].sql})::numeric AS "${m}"`).join(",\n  ");
}

/**
 * SQL: every İcmal ilçe cell next to the computed value, only where they differ. $1 = snapshot id. Both sides are numeric,
 * the difference is taken in SQL. A row of projects no İcmal row names ("il/ilçe" not in the İcmal) is reported apart.
 */
export function mismatchSql(metrics: string[]): string {
  const unpivot = metrics.map((m) => `('${m}', c."${m}")`).join(", ");
  return `
WITH calc AS (
  SELECT aile, il, ilce,
  ${reconcileSelect(metrics)}
  FROM destek.v_projeler WHERE snapshot_id = $1 GROUP BY aile, il, ilce
), cells AS (
  SELECT c.aile, c.il, c.ilce, v.metric, v.value FROM calc c CROSS JOIN LATERAL (VALUES ${unpivot}) v(metric, value)
)
SELECT i.aile, i.satir, i.il, i.ilce, i.kolon AS metric, i.deger AS icmal, COALESCE(c.value, 0) AS hesap
FROM destek.icmal i
LEFT JOIN cells c ON c.aile = i.aile AND c.il = i.il AND c.ilce = i.ilce AND c.metric = i.kolon
WHERE i.snapshot_id = $1 AND i.tur = 'ilce'
  AND abs(COALESCE(i.deger, 0) - COALESCE(c.value, 0)) > CASE WHEN i.kolon IN (${countLike(metrics)}) THEN 0 ELSE ${TOLERANCE} END
ORDER BY i.aile, i.satir, i.kolon`;
}

const countLike = (metrics: string[]) => metrics.filter((m) => METRICS[m].kind === "count").map((m) => `'${m}'`).join(", ") || "''";

/** SQL: projects whose (aile, il, ilçe) has no İcmal ilçe row: the İcmal's province totals leave them out. $1 = snapshot. */
export const UNLISTED_SQL = `
SELECT p.aile, p.il, p.ilce, count(*)::int AS n FROM destek.projeler p
WHERE p.snapshot_id = $1
  AND NOT EXISTS (SELECT 1 FROM destek.icmal i WHERE i.snapshot_id = $1 AND i.aile = p.aile AND i.tur = 'ilce' AND i.il = p.il AND i.ilce IS NOT DISTINCT FROM p.ilce)
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;

/**
 * SQL: the İcmal's own total rows that don't add up: a province TOPLAM against its ilçe rows, the region TOPLAM against
 * the province rows (SOGEP İcmal R62:T62 use SUBTOTAL(109) and are stored as 0, §1.4-2). Reported, never compared to data.
 */
export const TOTALS_SQL = `
WITH il_sum AS (
  SELECT aile, il, kolon, sum(COALESCE(deger, 0)) AS s FROM destek.icmal WHERE snapshot_id = $1 AND tur = 'ilce' GROUP BY 1, 2, 3
), bolge_sum AS (
  SELECT aile, kolon, sum(COALESCE(deger, 0)) AS s FROM destek.icmal WHERE snapshot_id = $1 AND tur = 'il' GROUP BY 1, 2
)
SELECT t.aile, t.satir, t.tur, t.il, t.kolon, t.deger AS kayitli, COALESCE(s.s, b.s) AS beklenen
FROM destek.icmal t
LEFT JOIN il_sum s ON t.tur = 'il' AND s.aile = t.aile AND lower(s.il) = lower(t.il) AND s.kolon = t.kolon
LEFT JOIN bolge_sum b ON t.tur = 'bolge' AND b.aile = t.aile AND b.kolon = t.kolon
WHERE t.snapshot_id = $1 AND t.tur IN ('il', 'bolge') AND abs(COALESCE(t.deger, 0) - COALESCE(s.s, b.s, 0)) > ${TOLERANCE}
ORDER BY t.aile, t.satir, t.kolon`;

/**
 * SQL: Def-TL support recomputed for completed, not terminated projects (§1.5 rule: read Excel's value, but check a
 * sample against the formula): each payment over the TOPLAM deflator of its year, rounded to kuruş. Mismatches only.
 */
export const DEF_CHECK_SQL = `
WITH pay AS (
  SELECT o.kaynak_sayfa, o.kaynak_satir, round(sum(o.tutar / d.deger), 2) AS hesap, bool_or(d.deger IS NULL) AS eksik
  FROM destek.odemeler o
  LEFT JOIN destek.deflator d ON d.snapshot_id = o.snapshot_id AND d.sektor = 'TOPLAM' AND d.yil = extract(year FROM o.tarih)::int
  WHERE o.snapshot_id = $1 AND o.tur <> 'iade' AND COALESCE(o.tutar, 0) <> 0
  GROUP BY 1, 2
)
SELECT p.aile, p.kaynak_satir, p.def_destek AS kayitli, pay.hesap, pay.eksik, count(*) OVER () AS kontrol_edilen_fark
FROM destek.projeler p JOIN pay ON pay.kaynak_sayfa = p.kaynak_sayfa AND pay.kaynak_satir = p.kaynak_satir
WHERE p.snapshot_id = $1 AND p.durum = 'Tamamlandı' AND p.fesih IS DISTINCT FROM 'Evet' AND p.def_destek IS NOT NULL
  AND (pay.eksik OR abs(p.def_destek - pay.hesap) > ${TOLERANCE})
ORDER BY p.aile, p.kaynak_satir`;

export const DEF_CHECKED_SQL = `
SELECT count(*)::int AS n FROM destek.projeler p
WHERE p.snapshot_id = $1 AND p.durum = 'Tamamlandı' AND p.fesih IS DISTINCT FROM 'Evet' AND p.def_destek IS NOT NULL
  AND EXISTS (SELECT 1 FROM destek.odemeler o WHERE o.snapshot_id = $1 AND o.kaynak_sayfa = p.kaynak_sayfa AND o.kaynak_satir = p.kaynak_satir AND o.tur <> 'iade' AND COALESCE(o.tutar, 0) <> 0)`;
