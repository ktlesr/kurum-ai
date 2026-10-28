import { test } from "node:test";
import assert from "node:assert/strict";
import { bm25, ranked, rrf, tokens } from "./search.ts";

// Synthetic report pages (no real documents in git).
const pages = [
  "Proje genel bilgileri. Yürütücü kuruluş: Doğu Anadolu Kalkınma Ajansı. Süre 18 ay.",
  "Bütçe tablosu: Personel giderleri 1.250.000 TL, makine-teçhizat 3.400.000 TL. Toplam bütçenin %27'si personel.",
  "Performans göstergeleri: istihdam edilen kişi sayısı 45, eğitim alan kişi 120.",
  "İzleme ve değerlendirme raporları üç ayda bir İstanbul ofisine gönderilir.",
];

test("tokens: Turkish lowercase, 5-letter stems, whole numbers", () => {
  assert.deepEqual(tokens("BÜTÇENİN İzmir'de 1.250.000 TL ve %4,5"), ["bütçe", "izmir", "de", "1.250.000", "tl", "ve", "4,5"]);
  assert.deepEqual(tokens("IŞIK"), ["ışık"]); // dotless I stays ı
});

test("bm25: inflected word finds the page", () => {
  assert.equal(ranked(bm25(pages, "bütçede personel payı nedir"))[0], 1);
  assert.equal(ranked(bm25(pages, "istihdam hedefi kaç kişi"))[0], 2);
  assert.equal(ranked(bm25(pages, "İSTANBUL"))[0], 3);
});

test("bm25: an exact figure finds its page; no match scores 0", () => {
  assert.deepEqual(ranked(bm25(pages, "3.400.000 neye ait")), [1]);
  assert.deepEqual(ranked(bm25(pages, "uzay")), []);
});

test("rrf: agreement wins; one-sided hits still kept", () => {
  assert.deepEqual(rrf([[2, 0, 1], [0, 3]]).slice(0, 2), [0, 2]);
  assert.deepEqual(new Set(rrf([[1], [3]])), new Set([1, 3]));
});
