# TASK-020 — FAZ 4: deterministik hesap kontrolleri

**İstek:** Plan §5.2: sayısal kontroller ve hesaplar mümkün olduğunda deterministik kodla yapılsın; yüzde, eşik,
toplama, tarih, para birimi, ondalık ayırıcı, negatif sayı, dipnot ve Excel formülleri için test. Plan §5.3: bütçe
yüzdeleri ve toplamları deterministik olarak yeniden hesaplanır; hatalı hücre ya da çelişkili okuma açıkça gösterilir.

**Değişiklik:**
- `lib/checks.ts`:
  - `cellNumber`: hücredeki sayı yalnızca sayıysa okunur.
    - Türkçe ve İngilizce ayırıcılar (`normNum` kuralı korunur).
    - `(1.234)` ve `−5` negatif sayılır; `-` tek başına 0'dır.
    - TL, ₺, $, €, % işaretleri ve dipnot işaretleri (`*`, `¹`, `(2)`) tanınır.
    - Metin içeren hücre sayı sayılmaz.
  - `checkTotals`: tablolardaki "Toplam", "Ara toplam" ve "Genel toplam" satırları sütun sütun yeniden toplanır.
    - "Genel toplam" (ya da ara toplamlardan sonraki "Toplam"), önceki toplam satırlarıyla bunların arasındaki ek
      satırların (KDV, indirim) toplamıdır. Birden çok "Toplam" grubu da genel toplamda toplanır.
    - Emin olunamayan durumda not yazılmaz. Yanlış "tutarlı" kararı, sessizlikten kötüdür:
      - "Tutarlı" kararı yalnızca düz toplam için verilir.
      - Uyuşmazlık yalnızca hiçbir satır altındaki satırların toplamına eşit değilse bildirilir. Eşitse tablo üst
        kalem ve alt kalem içeriyor olabilir; yapı sayılardan anlaşılamaz.
    - "Toplam" etiketi sınırlıdır: Toplam / Ara toplam / Genel toplam, isteğe bağlı olarak bilinen bir sözcük ve
      parantezli bir ek. "Toplam kalite yönetimi" toplam satırı sayılmaz.
    - Etiket, satırın ilk metin hücresidir (önündeki "No" sütunu atlanır). Etiketsiz, yalnızca yıl içeren satırlar
      başlık sayılır; başka etiketsiz bir satır varsa o toplam denetlenmez.
    - Oran, fiyat, endeks, puan, ortalama ve değişim sütunları toplanmaz.
    - Gösterilen basamaklar kadar yuvarlama farkına izin verilir.
    - Boş, belirsiz (`(?)`) ya da metin hücresi olan sütun tahmin edilmez, atlanır.
    - Pay sütunu yalnızca toplam satırında 100 yazıyorsa pay sayılır ve tutar ÷ toplam olarak denetlenir. Tutarlardan
      biri belirsiz okunmuşsa bu denetim yapılmaz.
    - Sonuç notu: tutarlıysa "tutarlı (n sütun kodla toplandı)"; değilse tablodaki değer ile hesaplanan değer birlikte
      yazılır ve orijinalden kontrol önerilir.
  - `findDates` ve `verifyNumbers`:
    - Tarihler biçimden bağımsız eşleşir (`01.11.2026`, `1/11/2026`, `2026-11-01`, `1 Kasım 2026`, `1 KASIM 2026`).
    - Kaynakta geçen bir tarihin yılı, ayı ve günü bilinen sayı sayılır. Belirsiz okunmuş bir tarih (`(?)`) ve
      parçaları belirsiz kalır.
    - Cevapta olup kaynakta olmayan tarih işaretlenir.
    - Önceden "1 Kasım 2026" ile "01.11.2026" eşleşmiyor, cevaptaki yıl yanlışlıkla "kaynakta yok" diye
      işaretleniyordu.
- `lib/extract.ts`: Docling sayfalarında `checkTotals`, Maksimum satırı kontrolüyle aynı koşulda çalışır: sayfadaki
  her tablo ya metin katmanından okunmuş ya da iki okumayla doğrulanmış olmalı. Notlar "Otomatik bulgular"a da girer.
- `lib/parse.ts` (XLSX/XLS/CSV):
  - Her sayfanın tablosunun altına toplam ve pay notları eklenir.
  - Dosyada hesaplanmış değeri olmayan formül hücreleri sayılır ve uyarılır. Bu hücreler eskiden sessizce boş
    okunuyordu.

**Doğrulama:**
- `checks-calc.test.ts`, 15 test (her Codex bulgusu için bir regresyon testi dahil):
  - sayı biçimleri (27 durum);
  - doğru ve yanlış toplam; yuvarlama, negatif, tire;
  - ara, genel ve alt kalemli toplam; tesadüfen toplama eşit değer içeren düz liste;
  - atlanan sütunlar; pay sütunu;
  - tarihler ve `verifyNumbers`.
- Toplam: 117 geçti, 3 atlandı (önceden de atlanıyordu). tsc ve eslint temiz.
- Gerçek `parseFile` ile oluşturulan bir XLSX denendi:
  - "Butce" sayfasında toplam ve pay "tutarlı" çıktı.
  - Değeri olmayan `SUM` formülünde uyarı çıktı.

**Sınır:**
- Daha önce okunmuş belgeler önbellekten gelir; yeni notlar belge yeniden yüklenince görünür.
- Metin katmanlı PDF'lerde (Docling kapalı) tablo yapısı olmadığı için toplam kontrolü yapılmaz.
- 400 satırdan uzun tablolarda alt kalem araması yapılmaz: toplam tutmazsa uyuşmazlık bildirilir.

**Codex:**
- Tur 1 CHANGES REQUIRED:
  - Alt kalem çıkarımı yanlış toplamı onaylayabiliyordu.
  - Genel toplam KDV'yi atlıyordu.
  - "Toplam" ile başlayan metinler ve yıl başlıkları toplam satırı sanılıyordu.
  - Oran sütunları toplanıyordu.
  - Belirsiz tarih doğrulanmış sayılıyordu.
  - 130 bin satırda yığın taşıyordu.
- Tur 2 CHANGES REQUIRED: birden çok "Toplam" grubu; belirsiz tutarla pay kontrolü; belirsiz tarihin parçaları.
- Tur 3 APPROVED WITH NOTES.
