# TASK-015 — FAZ 4: iki belge karşılaştırması

**Sorun:** "Karşılaştır" hazır işi serbest metin istiyordu; karşılaştırmanın tipik hatası olan "rakamı yanlış belgeye
yazmak" hiçbir kontrolle yakalanmıyordu (bir belgede olan sayı, diğerinin altında yazılsa verifyNumbers onu bilinen
sayar).

**Değişiklik:**
- Hazır iş artık sabit sütunlu tablo istiyor: `| Konu | <dosya adları> | Fark |`, her hücrede değer + "(Sayfa N)".
- `lib/checks.ts` `checkColumns`: tablo sütunu bir belgeye aitse (başlıkta adı geçiyorsa; puanlı eşleşme, eşitlikte
  hiçbiri, "Konu"/"Fark" hiçbir belgenin değil) ve o sütundaki sayı o belgede yok ama başka belgede varsa
  `meta.misplaced`; arayüzde kırmızı uyarı. Kaçışlı `\|`, dış borusuz tablolar ve tek tireli ayırıcılar destekli.

**Testler:** doğru tablo, yer değiştirmiş değerler, sayfa referansı/tek hane, kısa ve benzer adlar, Fark sütunu,
kaçışlı boru, borusuz tablo, iki belgeyi adlandıran başlık; 67/67.

**Codex:** tur 1 CHANGES REQUIRED (4 bulgu), tur 2 APPROVED WITH NOTES; notlar kapatıldı.

**Açık:** gerçek belgelerle deneme; çok belgeli cevaplarda tablo hücresindeki "Sayfa N" henüz kaynak bağlantısı değil.
