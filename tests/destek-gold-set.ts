// The gold questions of the support workbook (prompt §5, §7): each soru tipi at least twice (tip 10, version
// differences, is phase 2). Each has the question, the plan the model should write for it, and how the independent
// computation (tests/destek-independent) selects and groups its rows. No expected value is written here.
// Used by tests/destek-gold.test.ts (values) and scripts/eval-destek.ts (the model's plans, end to end).
import type { ProjectRow } from "../lib/destek/load.ts";
import { lastPayment } from "./destek-independent.ts";

type R = ProjectRow;
const val = (r: R, c: keyof R["values"]) => r.values[c] ?? null;

export interface Agg { id: string; tip: number; soru: string; plan: Record<string, unknown>; keep: (r: R) => boolean; group: string[]; metrics: string[] }
export const AGG: Agg[] = [
  { id: "sogep-2025-il", tip: 1, soru: "SOGEP programı kapsamında 2025 yılında illerin proje sayısı, toplam bütçe, destek tutarı ve oranları (sözleşme)",
    plan: { type: "aggregate", filters: { aile: ["SOGEP"], yil: { in: [2025] } }, group_by: ["il"], metrics: ["gelen_proje", "sozlesme_imzalanan", "butce", "destek", "destek_orani"], amount_basis: "sozlesme" },
    keep: (r) => r.aile === "SOGEP" && val(r, "yil") === "2025", group: ["il"], metrics: ["gelen_proje", "sozlesme_imzalanan", "butce_sozlesme", "destek_sozlesme", "destek_orani_sozlesme"] },
  { id: "ptc-2023-il-def", tip: 1, soru: "PTÇ 2023 il bazında destek ve oran (varsayılan taban)",
    plan: { type: "aggregate", filters: { aile: ["PTÇ"], yil: { in: [2023] } }, group_by: ["il"], metrics: ["sozlesme_imzalanan", "gelen_proje", "destek", "destek_orani"] },
    keep: (r) => r.aile === "PTÇ" && val(r, "yil") === "2023", group: ["il"], metrics: ["sozlesme_imzalanan", "gelen_proje", "destek_def", "destek_orani_def"] },
  { id: "ptc-yil-trend", tip: 2, soru: "PTÇ'de yıllara göre desteklenen proje sayısı",
    plan: { type: "aggregate", filters: { aile: ["PTÇ"] }, group_by: ["yil"], metrics: ["sozlesme_imzalanan", "gelen_proje"] },
    keep: (r) => r.aile === "PTÇ", group: ["yil"], metrics: ["sozlesme_imzalanan", "gelen_proje"] },
  { id: "td-yil-trend", tip: 2, soru: "Teknik destek başvuruları ve imzalananlar yıllara göre",
    plan: { type: "aggregate", filters: { aile: ["teknik destek"] }, group_by: ["yil"], metrics: ["gelen_proje", "sozlesme_imzalanan", "destek"] },
    keep: (r) => r.aile === "TD", group: ["yil"], metrics: ["gelen_proje", "sozlesme_imzalanan", "destek_def"] },
  { id: "usak-aile", tip: 3, soru: "Uşak hangi programdan ne kadar destek aldı",
    plan: { type: "aggregate", filters: { il: ["USAK"] }, group_by: ["aile"], metrics: ["sozlesme_imzalanan", "destek"] },
    keep: (r) => val(r, "il") === "Uşak", group: ["aile"], metrics: ["sozlesme_imzalanan", "destek_def"] },
  { id: "manisa-sogep-kod", tip: 3, soru: "Manisa'da SOGEP programlarına göre sözleşme desteği",
    plan: { type: "aggregate", filters: { il: ["manisa"], aile: ["sosyal gelişme"] }, group_by: ["program_kodu"], metrics: ["destek"], amount_basis: "sozlesme" },
    keep: (r) => val(r, "il") === "Manisa" && r.aile === "SOGEP", group: ["program_kodu"], metrics: ["destek_sozlesme"] },
  { id: "il-oran-asc", tip: 4, soru: "En düşük destek oranlı il (sözleşme)",
    plan: { type: "aggregate", group_by: ["il"], metrics: ["destek_orani"], amount_basis: "sozlesme", order_by: [{ field: "destek_orani", dir: "asc" }] },
    keep: () => true, group: ["il"], metrics: ["destek_orani_sozlesme"] },
  { id: "basari-2024", tip: 5, soru: "2024'te başvuruların yüzde kaçı desteklendi",
    plan: { type: "aggregate", filters: { yil: { in: [2024] } }, metrics: ["gelen_proje", "nihai_desteklenen", "destek_alma_orani", "basari_orani"] },
    keep: (r) => val(r, "yil") === "2024", group: [], metrics: ["gelen_proje", "nihai_desteklenen", "destek_alma_orani", "basari_orani"] },
  { id: "ptc-basari-yil", tip: 5, soru: "PTÇ başarı oranı yıllara göre",
    plan: { type: "aggregate", filters: { aile: ["PTÇ"] }, group_by: ["yil"], metrics: ["basari_orani"] },
    keep: (r) => r.aile === "PTÇ", group: ["yil"], metrics: ["basari_orani"] },
  { id: "sogep-bakiye", tip: 7, soru: "Devam eden SOGEP projelerinde kalan destek bakiyesi",
    plan: { type: "aggregate", filters: { aile: ["SOGEP"], durum: ["Devam Ediyor"] }, group_by: ["il"], metrics: ["devam_eden", "destek_bakiyesi"] },
    keep: (r) => r.aile === "SOGEP" && val(r, "durum") === "Devam Ediyor", group: ["il"], metrics: ["devam_eden", "destek_bakiyesi"] },
  { id: "son-odeme-2025", tip: 7, soru: "Son ödemesi 2025'te yapılan projeler",
    plan: { type: "aggregate", filters: { son_odeme_yili: { in: [2025] } }, group_by: ["aile"], metrics: ["gelen_proje"] },
    keep: (r) => lastPayment(r)?.startsWith("2025") ?? false, group: ["aile"], metrics: ["gelen_proje"] },
  { id: "ptc-istihdam", tip: 8, soru: "PTÇ ile kaç kişi istihdam edildi",
    plan: { type: "aggregate", filters: { aile: ["ptc"] }, metrics: ["istihdam"] },
    keep: (r) => r.aile === "PTÇ", group: [], metrics: ["istihdam"] },
  { id: "dfd-fizibilite-il", tip: 8, soru: "DFD-FZD ile il bazında kaç plan/rapor/fizibilite hazırlandı",
    plan: { type: "aggregate", filters: { aile: ["DFD-FZD"] }, group_by: ["il"], metrics: ["fizibilite_sayisi", "istihdam"] },
    keep: (r) => r.aile === "DFD-FZD", group: ["il"], metrics: ["fizibilite_sayisi", "istihdam"] },
  { id: "belediye-destek", tip: 9, soru: "Belediyelere verilen toplam destek",
    plan: { type: "aggregate", filters: { alt_yasal_statu: ["belediye"] }, group_by: ["aile"], metrics: ["sozlesme_imzalanan", "destek"] },
    keep: (r) => val(r, "alt_yasal_statu") === "Belediye", group: ["aile"], metrics: ["sozlesme_imzalanan", "destek_def"] },
  { id: "statu-kirilim", tip: 9, soru: "Ana yasal statüye göre sözleşme desteği ve oranı",
    plan: { type: "aggregate", group_by: ["ana_yasal_statu"], metrics: ["destek", "destek_orani"], amount_basis: "sozlesme" },
    keep: () => true, group: ["ana_yasal_statu"], metrics: ["destek_sozlesme", "destek_orani_sozlesme"] },
  { id: "ptc-2012-2023-reel", tip: 11, soru: "2012 ve 2023 PTÇ desteklerini bugünkü fiyatlarla karşılaştır",
    plan: { type: "aggregate", filters: { aile: ["PTÇ"], yil: { in: [2012, 2023] } }, group_by: ["yil"], metrics: ["destek_sozlesme", "destek_def"] },
    keep: (r) => r.aile === "PTÇ" && (val(r, "yil") === "2012" || val(r, "yil") === "2023"), group: ["yil"], metrics: ["destek_sozlesme", "destek_def"] },
  { id: "sogep-nihai-def", tip: 11, soru: "SOGEP yıllara göre nihai ve reel destek",
    plan: { type: "aggregate", filters: { aile: ["SOGEP"] }, group_by: ["yil"], metrics: ["destek_nihai", "destek_def", "butce_def", "destek_orani_def"] },
    keep: (r) => r.aile === "SOGEP", group: ["yil"], metrics: ["destek_nihai", "destek_def", "butce_def", "destek_orani_def"] },
  // Asked in the app with the workbook attached as a document (2026-11-06): the model summed rows itself and was wrong.
  { id: "kutahya-sogep-2024-2025-def", tip: 1, soru: "Kütahya ilinin 2024-2025 SOGEP projelerinin toplam nihai deflatörlü bütçesi ile deflatörlü destek tutarı",
    plan: { type: "aggregate", filters: { aile: ["SOGEP"], il: ["kutahya"], yil: { in: [2024, 2025] } }, metrics: ["butce", "destek"], amount_basis: "def" },
    keep: (r) => r.aile === "SOGEP" && val(r, "il") === "Kütahya" && ["2024", "2025"].includes(val(r, "yil") ?? ""), group: [], metrics: ["butce_def", "destek_def"] },
  // Its follow-up (2026-11-06): each year's totals and the ratio, one row a year.
  { id: "kutahya-sogep-yil-yil-def", tip: 2, soru: "2024 ve 2025 toplamlarını ve oranı yıl yıl ayrı göster",
    plan: { type: "aggregate", filters: { aile: ["SOGEP"], il: ["kutahya"], yil: { in: [2024, 2025] } }, group_by: ["yil"], metrics: ["destek", "butce"], amount_basis: "def" },
    keep: (r) => r.aile === "SOGEP" && val(r, "il") === "Kütahya" && ["2024", "2025"].includes(val(r, "yil") ?? ""), group: ["yil"], metrics: ["destek_def", "butce_def", "destek_orani_def"] },
];
