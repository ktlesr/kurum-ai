// The canonical column dictionary (prompt §1.2): each project table's headers, matched by NAME (never by column letter),
// mapped to one canonical column. Matching ignores extra spaces, line breaks and case. A header not here is kept under
// its own name in `extra` and reported as schema drift; loading goes on.

export type Kind = "text" | "int" | "num" | "date";

/** Canonical columns of destek.projeler, with their type. */
export const CANON = {
  yil: "int", program_kodu: "text", donem: "int", basvuru_sahibi: "text", basari_sira_no: "text", basvuru_sira_no: "text",
  ilce: "text", il: "text", ana_yasal_statu: "text", alt_yasal_statu: "text",
  basvuru_destek: "num", basvuru_es_finansman: "num", basvuru_butce: "num",
  proje_adi: "text", on_inceleme: "text", degerlendirme: "text", toplam_puan: "num", liste: "text", hak_kazandi: "text",
  sozlesme_destek: "num", sozlesme_es_finansman: "num", sozlesme_butce: "num",
  sozlesme_davet: "text", imzaladi: "text", fesih: "text",
  destek_artis: "num", butce_artis: "num", degisiklik_sonrasi_destek: "num", degisiklik_sonrasi_butce: "num", destek_bakiyesi: "num",
  durum: "text", istihdam: "num", belge_sayisi: "num", makine_ekipman: "num", fizibilite_sayisi: "num", yararlanici_sayisi: "num",
  nihai_uygun_destek: "num", nihai_uygun_es_finansman: "num", nihai_uygun_butce: "num",
  nihai_fiili_es_finansman: "num", nihai_fiili_butce: "num", def_destek: "num", def_fiili_butce: "num",
  sektor: "text", proje_konusu: "text", teknik_destek_turu: "text", faaliyet_konusu: "text", yuklenici: "text", ilgili_sop: "text",
} as const satisfies Record<string, Kind>;
export type Canon = keyof typeof CANON;

/** Payment columns: one row each in destek.odemeler (kind, date, amount). */
export const PAYMENTS: Record<string, { tur: string; part: "tarih" | "tutar" }> = {
  "Ön Ödeme Tarihi": { tur: "on", part: "tarih" }, "Ön Ödeme Tutarı": { tur: "on", part: "tutar" },
  "1. Ara Ödeme Tarihi": { tur: "ara1", part: "tarih" }, "1. Ara Ödeme Tutarı": { tur: "ara1", part: "tutar" },
  "2. Ara Ödeme Tarihi": { tur: "ara2", part: "tarih" }, "2. Ara Ödeme Tutarı": { tur: "ara2", part: "tutar" },
  "3. Ara Ödeme Tarihi": { tur: "ara3", part: "tarih" }, "3. Ara Ödeme Tutarı": { tur: "ara3", part: "tutar" },
  "Nihai Ödeme Tarihi": { tur: "nihai", part: "tarih" }, "Nihai Ödeme Tutarı": { tur: "nihai", part: "tutar" },
  "Destek İade Tarihi": { tur: "iade", part: "tarih" }, "Destek İade Tutarı": { tur: "iade", part: "tutar" },
  // TD: one payment, the contractor's realised cost (the TD Def-TL formula deflates this one by its year).
  "Ödeme Tarihi": { tur: "td", part: "tarih" }, "Gerçekleşen Toplam Maliyet (TL)": { tur: "td", part: "tutar" },
};

/** Header → canonical column, for every family. */
const COMMON: Record<string, Canon> = {
  "Yılı": "yil", "Program Kısaltması": "program_kodu", "Dönemi": "donem", "Dönem": "donem",
  "Başvuru Sahibi": "basvuru_sahibi", "Başarı Sıra No": "basari_sira_no", "Başvuru Sıra No": "basvuru_sira_no",
  "İlçe": "ilce", "İl": "il", "Ana Yasal Statü": "ana_yasal_statu", "Alt Yasal Statü": "alt_yasal_statu",
  "Başvuru Ajans Destek Miktarı (TL)": "basvuru_destek", "Başvuru Eş Finansman Miktarı (TL)": "basvuru_es_finansman", "Başvuru Toplam Bütçe (TL)": "basvuru_butce",
  "Proje Adı": "proje_adi", "Faaliyet Adı": "proje_adi",
  "Ön İnceleme Sonucu": "on_inceleme", "Teknik ve Mali Değerlendirme Sonucu": "degerlendirme", "Nihai Değerlendirme Sonucu": "degerlendirme",
  "Toplam Başarı Puanı": "toplam_puan", "Asil/Yedek/U.D. Liste": "liste", "Proje Desteklenmeye Hak Kazandı Mı?": "hak_kazandi",
  "Sözleşme Ajans Destek Miktarı (TL)": "sozlesme_destek", "Sözleşme Eş Finansman Miktarı (TL)": "sozlesme_es_finansman", "Sözleşme Toplam Bütçe (TL)": "sozlesme_butce",
  "Sözleşme İmzalamaya Davet Edildi Mi?": "sozlesme_davet", "Sözleşme İmzaladı Mı?": "imzaladi", "Sözleşme Fesih Edildi Mi?": "fesih",
  "Destek Artış / Azalış Tutarı": "destek_artis", "Toplam Bütçe Artış / Azalış Tutarı": "butce_artis",
  "Değişiklikler Sonrası Ajans Destek Tutarı": "degisiklik_sonrasi_destek", "Değişiklikler Sonrası Toplam Bütçe Tutarı": "degisiklik_sonrasi_butce",
  "(Devam Eden Projeler İçin) Destek Bakiyesi": "destek_bakiyesi", "Proje Tamamlanma Durumu": "durum",
  "İstihdam Edilen Kişi Sayısı": "istihdam", "Kalite ve Markalaşmaya Yönelik Alınan Belge Sayısı": "belge_sayisi", "Alınan Makine ve Ekipman Sayısı": "makine_ekipman",
  "Plan, Araştırma Raporu veya Fizibilite Sayısı": "fizibilite_sayisi", "Yararlanıcı Sayısı": "yararlanici_sayisi",
  "Nihai Uygun Ajans Destek Miktarı (TL)": "nihai_uygun_destek", "Nihai Uygun Eş Finansman Miktarı (TL)": "nihai_uygun_es_finansman", "Nihai Uygun Toplam Bütçe (TL)": "nihai_uygun_butce",
  "Nihai Fiili Eş Finansman Miktarı (TL)": "nihai_fiili_es_finansman", "Nihai Fiili Toplam Bütçe (TL)": "nihai_fiili_butce",
  "Nihai Uygun Ajans Destek Miktarı (Def-TL)": "def_destek", "Nihai Fiili Toplam Bütçe (Def-TL)": "def_fiili_butce",
  "Sektör": "sektor", "Sektör (NACE Kodu)": "sektor", "Proje Konusu": "proje_konusu",
  "Teknik Destek Türü": "teknik_destek_turu", "Faaliyet Konusu": "faaliyet_konusu", "Yüklenici Adı": "yuklenici", "İlgili SOP": "ilgili_sop",
};

/**
 * TD's own headers. The agency's Genel Analiz sheet adds TD's contract cost into its "Sözleşme Ajans Destek Miktarı"
 * total and its final cost into "Nihai Uygun Ajans Destek Miktarı" (FR3, FY3 formulas): for TD the agency pays the
 * contractor, so its cost is the support. Mapped the same way here; TD has no budget or co-financing.
 */
const TD: Record<string, Canon> = {
  "Sözleşme Yüklenici Toplam Maliyet (TL)": "sozlesme_destek",
  "Nihai Toplam Maliyet (TL)": "nihai_uygun_destek",
};

/** Headers kept only in `extra`, knowingly: row ratios (never summed, §0-5), counters, realised interim figures. */
const KNOWN_EXTRA = [
  "#", "Başvuru Destek Oranı (%)", "Sözleşme Destek Oranı (%)", "Gerçekleşen Uygun Destek Oranı (%)", "Gerçekleşen Fiili Destek Oranı (%)",
  "Nihai Uygun Destek Oranı (%)", "Nihai Fiili Destek Oranı (%)", "Nihai Fiili Destek Oranı (Def-%)",
  "Ortak Sayısı", "İştirakçi Sayısı", "Toplam Ortak veya İştirakçi Sayısı",
  "Gerçekleşen Uygun Ajans Destek Miktarı (TL)", "Gerçekleşen Uygun Eş Finansman Miktarı (TL)", "Gerçekleşen Uygun Toplam Bütçe (TL)",
  "Gerçekleşen Fiili Eş Finansman Miktarı (TL)", "Gerçekleşen Fiili Toplam Bütçe (TL)",
];

export const normHeader = (h: unknown) => String(h ?? "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("tr");

const index = (m: Record<string, Canon>) => new Map(Object.entries(m).map(([k, v]) => [normHeader(k), v]));
const COMMON_N = index(COMMON), TD_N = index(TD);
const PAY_N = new Map(Object.entries(PAYMENTS).map(([k, v]) => [normHeader(k), v]));
const EXTRA_N = new Set(KNOWN_EXTRA.map(normHeader));

export type HeaderUse =
  | { to: "canon"; col: Canon }
  | { to: "payment"; tur: string; part: "tarih" | "tutar" }
  | { to: "extra"; known: boolean };

export function headerUse(aile: string, header: string): HeaderUse {
  const h = normHeader(header);
  const col = (aile === "TD" ? TD_N.get(h) : undefined) ?? COMMON_N.get(h);
  if (col) return { to: "canon", col };
  const p = PAY_N.get(h);
  if (p) return { to: "payment", ...p };
  return { to: "extra", known: EXTRA_N.has(h) };
}

/**
 * Values compared the way Excel's COUNTIFS/SUMIFS criteria do (the İcmal formulas): case-insensitive, nothing else.
 * A value equal to one of these in that sense is stored as it; anything else stays as written (so "Asıl" is not "Asil",
 * exactly as the İcmal formula counts it).
 */
export const CRITERIA: Partial<Record<Canon, string[]>> = {
  on_inceleme: ["Başarılı", "Başarısız"], degerlendirme: ["Başarılı", "Başarısız"],
  liste: ["Asil", "Yedek", "U.D.", "Başarısız"], hak_kazandi: ["Evet", "Hayır", "Yedek", "U.D."],
  sozlesme_davet: ["Evet", "Hayır", "U.D."], imzaladi: ["Evet", "Hayır", "U.D."], fesih: ["Evet", "Hayır", "U.D."],
  durum: ["Tamamlandı", "Devam Ediyor", "U.D."],
};

/** Excel's case folding (not Turkish-aware: "I" → "i"); JS toLowerCase() without a locale does the same. */
export const excelEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
