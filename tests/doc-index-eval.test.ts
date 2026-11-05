// The content index measured (lib/doc-index): a made-up shared folder (no institution's data), 30 questions as the model
// would pass them to belge_ara, the files that answer each. Recall@1/5 and MRR are printed beside the name-only file
// finder's (dosya_ara) on the same questions, and Recall@5 must stay at 95% or more.
// Needs a Postgres it may write to, never the server's: a throwaway one, e.g.
//   docker run -d --name docidx-test-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55499:5432 postgres:17-alpine
//   DOC_INDEX_DB=postgres://postgres:test@127.0.0.1:55499/postgres node --test tests/doc-index-eval.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetGone, indexRows, searchFiles, storeFile } from "../lib/doc-index.ts";
import { FORGET_AFTER_MS } from "../lib/folder-scan.ts";
import { findFiles } from "../lib/file-search.ts";

const DB = process.env.DOC_INDEX_DB;

const table = (sheet: string, head: string[], rows: (string | number)[][]) =>
  [`## Sheet: ${sheet}`, `| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const pages = (...ps: string[]) => ps.map((p, i) => `--- Sayfa ${i + 1} ---\n${p}`).join("\n\n");
const iller = ["Afyonkarahisar", "Kütahya", "Manisa", "Uşak"];

/** path → text as the reader gives it (pages for PDF, "## Sheet:" tables for workbooks). */
const FOLDER: Record<string, string> = {
  "Yazışmalar/Bakanlığa Giden/2026/Giden Yazı Listesi 2026.xlsx": table("Giden-2026", ["Sayı", "Tarih", "Konu", "Muhatap"], [
    ["E-101", "05.01.2026", "2025 yılı faaliyet raporu", "Sanayi ve Teknoloji Bakanlığı"],
    ["E-117", "12.02.2026", "İl bazlı istihdam tablosu", "Sanayi ve Teknoloji Bakanlığı"],
    ["E-140", "20.03.2026", "Güdümlü proje destek talebi", "Kalkınma Ajansları Genel Müdürlüğü"],
  ]),
  "Yazışmalar/Bakanlığa Giden/2025/Giden Yazı Listesi 2025.xlsx": table("Giden-2025", ["Sayı", "Tarih", "Konu", "Muhatap"], [
    ["E-088", "14.11.2025", "Çalışma programı revizyonu", "Sanayi ve Teknoloji Bakanlığı"],
  ]),
  "Yazışmalar/Gönderilecekler/Taslak İstihdam Tablosu 2027.xlsx": table("Taslak", ["İl", "2027 Tahmini İstihdam"], iller.map((il, i) => [il, 10_000 + i * 1500])),
  "Yazışmalar/Gelen/2026/Bakanlık Talimatı Mart 2026.pdf": pages("T.C. SANAYİ VE TEKNOLOJİ BAKANLIĞI\nKalkınma Ajansları Genel Müdürlüğü\nKonu: İl bazlı istihdam verilerinin gönderilmesi\nAjansınız bölgesindeki illere ait 2026 yılı istihdam verilerinin 31.03.2026 tarihine kadar Bakanlığımıza gönderilmesi gerekmektedir."),
  "Raporlar/İstihdam/İl Bazlı İstihdam 2026.xlsx": table("İl Bazlı", ["İl", "İstihdam 2025", "İstihdam 2026"], iller.map((il, i) => [il, 40_000 + i * 900, 41_200 + i * 950])),
  "Raporlar/İstihdam/İl Bazlı İstihdam 2025.xlsx": table("İl Bazlı", ["İl", "İstihdam 2024", "İstihdam 2025"], iller.map((il, i) => [il, 38_000 + i * 900, 40_000 + i * 900])),
  "Raporlar/Faaliyet/2025 Yılı Faaliyet Raporu.pdf": pages(
    "ZAFER KALKINMA AJANSI 2025 YILI FAALİYET RAPORU\nYönetim Kurulu Başkanı Sunuşu",
    "3. MALİ BİLGİLER\n3.1 Bütçe Uygulama Sonuçları\nAjansın 2025 yılı personel giderleri 48.250.000 TL olarak gerçekleşmiştir. Toplam harcama 612.400.000 TL'dir.",
    "4. PROGRAM VE PROJELER\nMali destek programları kapsamında 2025 yılında 87 proje ile sözleşme imzalanmıştır.",
  ),
  "Raporlar/Faaliyet/2024 Yılı Faaliyet Raporu.pdf": pages("ZAFER KALKINMA AJANSI 2024 YILI FAALİYET RAPORU", "3. MALİ BİLGİLER\nAjansın 2024 yılı personel giderleri 41.900.000 TL olarak gerçekleşmiştir."),
  "Bütçe/2026 Bütçe Tablosu.xlsx": table("Gider", ["Kalem", "2025", "2026"], [["Personel giderleri", "48.250.000", "52.000.000"], ["Mal ve hizmet alımları", "21.000.000", "23.500.000"], ["Destek programları", "480.000.000", "510.000.000"], ["Genel Toplam", "549.250.000", "585.500.000"]]),
  "Bütçe/2025 Bütçe Tablosu.xlsx": table("Gider", ["Kalem", "2024", "2025"], [["Personel giderleri", "41.900.000", "48.250.000"], ["Genel Toplam", "500.000.000", "549.250.000"]]),
  "DFT/Toplantılar/DFT 3. Toplantı Tutanağı.docx": "DİJİTAL DÖNÜŞÜM FORUMU (DFT) 3. TOPLANTI TUTANAĞI\nTarih: 18.09.2025\nKatılımcılar: OSB müdürleri, üniversite temsilcileri\nGündem: KOBİ'lerde dijital olgunluk ölçümü, siber güvenlik eğitimleri.",
  "DFT/Toplantılar/DFT 4. Toplantı Tutanağı.docx": "DİJİTAL DÖNÜŞÜM FORUMU (DFT) 4. TOPLANTI TUTANAĞI\nTarih: 22.01.2026\nGündem: Yapay zekâ uygulamaları çalıştayı, dijital olgunluk anket sonuçları.",
  "DFT/Sunumlar/DFT Çalıştay Notları.txt": "Dijital dönüşüm çalıştayında Kütahya ve Uşak'taki seramik firmalarının ERP kullanım oranı tartışıldı.",
  "Etüt/Yeşil Dönüşüm/Hidrojen Ekonomisi Fizibilite Raporu.pdf": pages("HİDROJEN EKONOMİSİNE GEÇİŞ: BÖLGESEL FİZİBİLİTE", "Yeşil hidrojen üretimi için Afyonkarahisar'daki güneş enerjisi potansiyeli değerlendirilmiştir. Elektrolizör kapasitesi 20 MW öngörülmektedir."),
  "Etüt/Yeşil Dönüşüm/Sanayide Karbon Ayak İzi.pdf": pages("SANAYİDE KARBON AYAK İZİ ÖN ÇALIŞMASI", "Sınırda Karbon Düzenleme Mekanizması (SKDM) ihracatçı seramik ve çimento firmalarını etkileyecektir."),
  "Etüt/Turizm/Termal Turizm Analizi.pdf": pages("TERMAL TURİZM ANALİZİ", "Afyonkarahisar ve Kütahya termal tesis yatak kapasitesi 2025 itibarıyla 34.500'e ulaşmıştır."),
  "Destek/Mali Destek/2026 Mali Destek Programı Rehberi.pdf": pages("2026 YILI MALİ DESTEK PROGRAMI BAŞVURU REHBERİ", "Programın toplam bütçesi 120.000.000 TL'dir. Asgari destek tutarı 500.000 TL, azami destek tutarı 5.000.000 TL'dir.", "Son başvuru tarihi 15.05.2026 saat 18:00'dir."),
  "Destek/Mali Destek/Sözleşme İmzalanan Projeler 2025.xlsx": table("Projeler", ["Proje No", "Yararlanıcı", "İl", "Destek Tutarı"], [
    ["TR33/25/MD/001", "Gediz Seramik A.Ş.", "Kütahya", "2.400.000"], ["TR33/25/MD/002", "Usak Tekstil Ltd.", "Uşak", "1.850.000"], ["TR33/25/MD/003", "Manisa Gıda Koop.", "Manisa", "950.000"],
  ]),
  "Destek/Teknik Destek/Teknik Destek Başvuruları.csv": table("Teknik Destek Başvuruları", ["Başvuru", "Kurum", "Konu"], [["TD-14", "Kütahya Ticaret Odası", "İhracat eğitimi"], ["TD-15", "Uşak OSB", "Enerji verimliliği danışmanlığı"]]),
  "İnsan Kaynakları/Personel Listesi.xlsx": table("Personel", ["Ad Soyad", "Birim", "Unvan"], [["Ayşe Yılmaz", "Planlama", "Uzman"], ["Mehmet Demir", "Program Yönetimi", "Birim Başkanı"], ["Işık Çelik", "Destek", "Uzman"]]),
  "İnsan Kaynakları/İzin Yönergesi.docx": "PERSONEL İZİN YÖNERGESİ\nMadde 4 – Yıllık izin süresi hizmet süresi beş yıla kadar olanlar için 20 gündür.",
  "Satın Alma/2026 Satın Alma Planı.xlsx": table("Plan", ["İş", "Tahmini Bedel", "Usul"], [["Bilgisayar alımı", "1.200.000", "Doğrudan temin"], ["Temizlik hizmeti", "3.400.000", "Açık ihale"]]),
  "İzleme/İzleme Ziyaretleri 2026.xlsx": table("Ziyaretler", ["Proje No", "Ziyaret Tarihi", "Sonuç"], [["TR33/25/MD/001", "10.02.2026", "Uygun"], ["TR33/25/MD/003", "03.03.2026", "Eksik belge"]]),
  "Kurumsal/Stratejik Plan 2024-2028.pdf": pages("STRATEJİK PLAN 2024-2028", "Amaç 2: Bölgenin rekabet gücünü artırmak. Hedef 2.3: İhracat yapan firma sayısını %25 artırmak."),
  "Kurumsal/Bölge Planı Özet.pdf": pages("TR33 BÖLGE PLANI 2024-2028 ÖZETİ", "Öncelik alanları: dijital dönüşüm, yeşil dönüşüm, nitelikli işgücü."),
  "Basın/Basın Bültenleri 2026.docx": "BASIN BÜLTENİ – 14.04.2026\nAjansımızın desteklediği Uşak Deri İhtisas OSB arıtma tesisi hizmete açıldı.",
  "Eğitim/Eğitim Takvimi 2026.xlsx": table("Takvim", ["Eğitim", "Tarih", "Yer"], [["Proje döngüsü yönetimi", "12.03.2026", "Kütahya"], ["Dış ticaret", "09.04.2026", "Manisa"]]),
  "Arşiv/Eski Yazışmalar/Bakanlık Yazısı 2019.pdf": pages("2019 yılı çalışma programının Bakanlığa sunulması hakkında."),
  "Toplantı/Yönetim Kurulu/YK Kararları 2026.docx": "YÖNETİM KURULU KARARLARI 2026\nKarar 2026/07: 2026 yılı mali destek programının ilanına karar verilmiştir.\nKarar 2026/08: Hidrojen fizibilite çalışmasının güncellenmesine karar verilmiştir.",
  "Toplantı/Kalkınma Kurulu/Kalkınma Kurulu Toplantısı Sunum Metni.txt": "Kalkınma Kurulu toplantısında bölgenin 2025 yılı ihracatının 5,8 milyar dolar olduğu açıklandı.",
};

// Noise around them: 300 files in the same words (ministry, employment, projects, the provinces, the years), so the
// ranking has to pick, not just find. Made deterministically: the same folder every run.
const NOISE = ["bakanlık", "istihdam", "proje", "destek", "rapor", "toplantı", "tablo", "yazı", "bütçe", "2025", "2026", "Kütahya", "Uşak", "Manisa", "Afyonkarahisar", "dijital", "ihracat", "firma", "eğitim", "program", "karar", "gönderilen", "giden", "sayı", "tarih", "kapasite"];
for (let i = 0; i < 300; i++) {
  const w = (k: number) => NOISE[(i * 7 + k * 13) % NOISE.length];
  const text = Array.from({ length: 6 }, (_, k) => `${w(k)} ${w(k + 1)} ile ilgili ${w(k + 2)} notu; ${w(k + 3)} ve ${w(k + 4)} değerlendirildi.`).join("\n");
  FOLDER[`Arşiv/Genel/${w(0)} ${w(5)} notu ${i}.txt`] = text;
}

/** The question as asked, the query the model passes to belge_ara, the files that answer it (any of them). */
const QUESTIONS: { q: string; query: string; want: string[] }[] = [
  { q: "Bakanlığa giden tablolarda en son ne var?", query: "bakanlık giden gönderilen yazı", want: ["Yazışmalar/Bakanlığa Giden/2026/Giden Yazı Listesi 2026.xlsx"] },
  { q: "İstihdam tablosunu bakanlığa hangi sayıyla gönderdik?", query: "istihdam tablosu sayı bakanlık", want: ["Yazışmalar/Bakanlığa Giden/2026/Giden Yazı Listesi 2026.xlsx"] },
  { q: "2026 Kütahya istihdam verisi nerede?", query: "Kütahya istihdam 2026", want: ["Raporlar/İstihdam/İl Bazlı İstihdam 2026.xlsx"] },
  { q: "bakanlik istihdam talimati", query: "bakanlik istihdam talimati", want: ["Yazışmalar/Gelen/2026/Bakanlık Talimatı Mart 2026.pdf"] },
  { q: "Bakanlık istihdam verilerini ne zamana kadar istedi?", query: "istihdam verileri gönderilmesi tarih bakanlık", want: ["Yazışmalar/Gelen/2026/Bakanlık Talimatı Mart 2026.pdf"] },
  { q: "2025 raporunda personel gideri ne kadar?", query: "2025 personel giderleri faaliyet raporu", want: ["Raporlar/Faaliyet/2025 Yılı Faaliyet Raporu.pdf", "Bütçe/2026 Bütçe Tablosu.xlsx", "Bütçe/2025 Bütçe Tablosu.xlsx"] },
  { q: "2025'te kaç projeyle sözleşme imzalandı?", query: "2025 sözleşme imzalanan proje sayısı", want: ["Raporlar/Faaliyet/2025 Yılı Faaliyet Raporu.pdf", "Destek/Mali Destek/Sözleşme İmzalanan Projeler 2025.xlsx"] },
  { q: "2026 bütçesinde genel toplam kaç?", query: "2026 bütçe genel toplam", want: ["Bütçe/2026 Bütçe Tablosu.xlsx"] },
  { q: "DFT toplantı dosyalarını bul", query: "DFT toplantı tutanağı", want: ["DFT/Toplantılar/DFT 4. Toplantı Tutanağı.docx", "DFT/Toplantılar/DFT 3. Toplantı Tutanağı.docx"] },
  { q: "Dijital olgunluk anketi sonuçları hangi toplantıda konuşuldu?", query: "dijital olgunluk anket sonuçları", want: ["DFT/Toplantılar/DFT 4. Toplantı Tutanağı.docx"] },
  { q: "Hidrojen dönüşümü raporlarını bul", query: "hidrojen dönüşüm rapor", want: ["Etüt/Yeşil Dönüşüm/Hidrojen Ekonomisi Fizibilite Raporu.pdf"] },
  { q: "Elektrolizör kapasitesi ne öngörülmüş?", query: "elektrolizör kapasitesi", want: ["Etüt/Yeşil Dönüşüm/Hidrojen Ekonomisi Fizibilite Raporu.pdf"] },
  { q: "SKDM hangi sektörleri etkiler?", query: "SKDM sınırda karbon düzenleme", want: ["Etüt/Yeşil Dönüşüm/Sanayide Karbon Ayak İzi.pdf"] },
  { q: "Termal tesislerin yatak kapasitesi kaç?", query: "termal yatak kapasitesi", want: ["Etüt/Turizm/Termal Turizm Analizi.pdf"] },
  { q: "Mali destek programında azami destek tutarı ne?", query: "mali destek azami destek tutarı", want: ["Destek/Mali Destek/2026 Mali Destek Programı Rehberi.pdf"] },
  { q: "Son başvuru tarihi ne zaman?", query: "son başvuru tarihi mali destek", want: ["Destek/Mali Destek/2026 Mali Destek Programı Rehberi.pdf"] },
  { q: "Gediz Seramik'e ne kadar destek verildi?", query: "Gediz Seramik destek tutarı", want: ["Destek/Mali Destek/Sözleşme İmzalanan Projeler 2025.xlsx"] },
  { q: "TR33/25/MD/003 projesinin izleme ziyareti sonucu", query: "TR33/25/MD/003 izleme ziyareti", want: ["İzleme/İzleme Ziyaretleri 2026.xlsx"] },
  { q: "Uşak OSB'nin teknik destek başvurusu ne konuda?", query: "Uşak OSB teknik destek başvurusu", want: ["Destek/Teknik Destek/Teknik Destek Başvuruları.csv"] },
  { q: "ISIK CELIK hangi birimde?", query: "IŞIK ÇELİK birim", want: ["İnsan Kaynakları/Personel Listesi.xlsx"] },
  { q: "Yıllık izin kaç gün?", query: "yıllık izin süresi gün", want: ["İnsan Kaynakları/İzin Yönergesi.docx"] },
  { q: "Temizlik hizmeti hangi usulle alınacak?", query: "temizlik hizmeti ihale usul", want: ["Satın Alma/2026 Satın Alma Planı.xlsx"] },
  { q: "İhracat yapan firma sayısı hedefi", query: "ihracat yapan firma sayısı hedef", want: ["Kurumsal/Stratejik Plan 2024-2028.pdf"] },
  { q: "Bölge planının öncelik alanları", query: "bölge planı öncelik alanları", want: ["Kurumsal/Bölge Planı Özet.pdf"] },
  { q: "Arıtma tesisi açılışı basın bülteni", query: "arıtma tesisi basın bülteni", want: ["Basın/Basın Bültenleri 2026.docx"] },
  { q: "Proje döngüsü yönetimi eğitimi nerede?", query: "proje döngüsü yönetimi eğitim", want: ["Eğitim/Eğitim Takvimi 2026.xlsx"] },
  { q: "Hidrojen çalışmasının güncellenmesine dair YK kararı", query: "hidrojen fizibilite güncellenmesi yönetim kurulu kararı", want: ["Toplantı/Yönetim Kurulu/YK Kararları 2026.docx"] },
  { q: "Bölgenin 2025 ihracatı ne kadar?", query: "2025 ihracat milyar dolar", want: ["Toplantı/Kalkınma Kurulu/Kalkınma Kurulu Toplantısı Sunum Metni.txt"] },
  { q: "Seramik firmalarının ERP kullanımı", query: "seramik firmaları ERP kullanım", want: ["DFT/Sunumlar/DFT Çalıştay Notları.txt"] },
  { q: "Kalkınma Ajansları Genel Müdürlüğüne giden güdümlü proje yazısı", query: "güdümlü proje Kalkınma Ajansları Genel Müdürlüğü giden", want: ["Yazışmalar/Bakanlığa Giden/2026/Giden Yazı Listesi 2026.xlsx"] },
];

function score(ranks: (number | null)[]) {
  const n = ranks.length;
  const at = (k: number) => ranks.filter((r) => r !== null && r < k).length / n;
  return { r1: at(1), r5: at(5), mrr: ranks.reduce<number>((s, r) => s + (r === null ? 0 : 1 / (r + 1)), 0) / n };
}
const pct = (x: number) => `%${Math.round(x * 100)}`;

test("content index: Recall@5 ≥ 95% on the made-up folder, against the name-only finder", { skip: !DB && "DOC_INDEX_DB yok (geçici bir Postgres)" }, async () => {
  assert.equal(QUESTIONS.length, 30);
  process.env.DATABASE_URL = DB;
  const { db } = await import("../lib/db.ts");
  const sql = await db();
  try {
    const paths = Object.keys(FOLDER);
    const ids = new Map(paths.map((p, i) => [`t-${i}`, p]));
    for (const [id, p] of ids) await storeFile(sql, id, "eval", indexRows(p, FOLDER[p]));
    const cov = { indexed: paths.length, total: paths.length, failed: 0 };
    const ours: (number | null)[] = [];
    const names: (number | null)[] = [];
    const misses: string[] = [];
    for (const { q, query, want } of QUESTIONS) {
      const got = (await searchFiles(sql, ids, query, cov)).files.map((f) => f.path);
      const r = got.findIndex((p) => want.includes(p));
      ours.push(r < 0 ? null : r);
      if (r < 0 || r >= 5) misses.push(`${q} → ${got.slice(0, 3).join(" ; ") || "hiçbiri"}`);
      const listed = findFiles(paths.map((p) => ({ path: p, size: 1, readable: true })), { sorgu: query }).text;
      const order = [...listed.matchAll(/^\| (.+?) \| /gmu)].map((m) => m[1]).filter((p) => p !== "Yol" && p !== "---");
      const rn = order.findIndex((p) => want.includes(p));
      names.push(rn < 0 ? null : rn);
    }
    // The user's own words passed as they are (a model that adds no synonyms): measured, not held to the bar.
    const raw: (number | null)[] = [];
    for (const { q, want } of QUESTIONS) {
      const got = (await searchFiles(sql, ids, q, cov)).files.map((f) => f.path);
      const r = got.findIndex((p) => want.includes(p));
      raw.push(r < 0 ? null : r);
      if (r < 0 || r >= 5) misses.push(`(ham) ${q} → ${got.slice(0, 3).join(" ; ") || "hiçbiri"}`);
    }
    // The live check: a file changed on the share since it was indexed is left out, the next best shown instead.
    const top = (await searchFiles(sql, ids, "elektrolizör kapasitesi", cov)).files[0];
    const asked: string[][] = [];
    const checked = await searchFiles(sql, ids, "elektrolizör kapasitesi", cov, 8, async (list) => (asked.push(list), new Set(list.filter((id) => id !== top.fileId))));
    assert.ok(asked[0].includes(top.fileId) && !checked.files.some((f) => f.fileId === top.fileId));
    const a = score(ours), b = score(names), c = score(raw);
    console.log(`belge_ara, kullanıcının kendi sözleriyle  Recall@1 ${pct(c.r1)}  Recall@5 ${pct(c.r5)}  MRR ${c.mrr.toFixed(2)}`);
    console.log(`belge_ara  Recall@1 ${pct(a.r1)}  Recall@5 ${pct(a.r5)}  MRR ${a.mrr.toFixed(2)}`);
    console.log(`dosya_ara  Recall@1 ${pct(b.r1)}  Recall@5 ${pct(b.r5)}  MRR ${b.mrr.toFixed(2)}  (yalnızca ad ve klasör)`);
    if (misses.length) console.log(`kaçanlar:\n  ${misses.join("\n  ")}`);
    assert.ok(a.r5 >= 0.95, `Recall@5 ${pct(a.r5)}`);
  } finally {
    await sql`DELETE FROM doc_sections WHERE file_id LIKE 't-%'`;
    await sql`DELETE FROM doc_files WHERE file_id LIKE 't-%'`; // the client is ended by the last test
  }
});

test("forgetGone: a file missing from clean scans keeps its sections for a week, then they go; one back in time keeps them", { skip: !DB && "DOC_INDEX_DB yok" }, async () => {
  process.env.DATABASE_URL = DB;
  const { db } = await import("../lib/db.ts");
  const sql = await db();
  try {
    await storeFile(sql, "g-kept", "v", indexRows("a.txt", "kalan metin"));
    await storeFile(sql, "g-gone", "v", indexRows("b.txt", "silinen metin"));
    await storeFile(sql, "g-back", "v", indexRows("c.txt", "geri gelen metin"));
    const t0 = new Date("2026-01-01T00:00:00Z");
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const others = (await sql<{ file_id: string }[]>`SELECT file_id FROM doc_files WHERE file_id NOT LIKE 'g-%'`).map((r) => r.file_id);
    assert.deepEqual(await forgetGone(sql, [...others, "g-kept"], t0), []);
    assert.deepEqual(await forgetGone(sql, [...others, "g-kept", "g-back"], at(1000)), [], "g-back is in the folder again");
    assert.deepEqual(await forgetGone(sql, [...others, "g-kept"], at(FORGET_AFTER_MS)), ["g-gone"], "missing a week: gone; g-back's clock started again");
    const left = (await sql<{ file_id: string }[]>`SELECT DISTINCT file_id FROM doc_sections WHERE file_id LIKE 'g-%' ORDER BY 1`).map((r) => r.file_id);
    assert.deepEqual(left, ["g-back", "g-kept"]);
  } finally {
    await sql`DELETE FROM doc_sections WHERE file_id LIKE 'g-%'`;
    await sql`DELETE FROM doc_files WHERE file_id LIKE 'g-%'`;
    await sql.end();
  }
});
