# TASK-022 — FAZ 4: bölüm farkındalıklı parçalama

**İstek (plan §5.2):** Bölüm farkındalıklı parçalama ve seçmeli yeniden sıralama (reranking); her aşama hız ve
doğruluk ölçümüyle etkinleştirilsin.

**Önce test koruması (plan §5.1):** `chunkText` ve `windows` sunucuya özel `lib/rag.ts` içindeydi ve testi yoktu.
Değiştirilmeden saf `lib/chunk.ts`'e taşındılar ve mevcut davranış testlerle sabitlendi:
- sayfa ve sheet etiketleri;
- kapsama (hiçbir satır kaybolmuyor);
- boyut sınırı;
- pencere birleştirme.

**Değişiklik:**
- `isHeading`: markdown başlığı, numaralı başlık ("3.2. Destek Oranları"), "MADDE 5", "BÖLÜM 2", kısa büyük harfli
  başlık. Nokta, iki nokta, noktalı virgül, virgül ya da üç noktayla biten satır başlık sayılmaz.
- Kesme noktası: pencerenin ikinci yarısında bir başlık varsa parça onun önünden kesilir, sonraki parça başlıktan
  bindirmesiz başlar. Yoksa eskisi gibi satır sonundan kesilir.
- Bölüm ortasından başlayan parçanın başına bölüm başlığı eklenir (`[3.2. Destek Oranları]`); sayfa geçişlerinde
  taşınır.
  - Ön ek pencerenin en fazla dörtte biridir ve pencere boyutuna dahildir; pencere sınırı aşılmaz.
  - Küçük pencerelerde ön ek yoktur.
- Başlıklar sayfa başına tek ilerleyen işaretçiyle taranır: 25 MB'lık sayfasız metin doğrusal sürede işlenir.
- İlerleme garantisi: her bindirme değerinde bir sonraki başlangıç ileri gider. Eski kodda da sonsuz döngü riski vardı.
- `CHUNKING = "c2"` embedding anahtarına eklendi; eski parçaların vektörleri yeniden kullanılmaz. `retrieve`, anahtar
  tutmuyorsa parçaları yeniden üretir, böylece anahtar kelime ve anlamsal sıralamalardaki indisler hizalı kalır.

**Ölçüm** (`scripts/measure-retrieval.mjs`, altın setteki 81 cevaplanabilir metin sorusu, yalnızca BM25):

| Parçalama | Doğru sayfa ilk 6 parçada | İlk sırada |
| --- | --- | --- |
| Eski | 77 (%95) | 65 (%80) |
| Yeni | 78 (%96) | 64 (%79) |

Anahtar kelime aramasında fark nötr. Başlık ön ekinin beklenen faydası anlamsal arama ve modelin bölüm bağlamını
görmesi; bu, sunucuda altın setle (`scripts/eval-golden.mjs`) ölçülecek. Değişiklik zararsız olduğu için açık bırakıldı.

**Yeniden sıralama:** Yapılmadı. Bir yeniden sıralama (cross-encoder) modeli gerekiyor, sunucuda yok. Altın set
taban çizgisinden sonra değerlendirilecek.

**Doğrulama:** `chunk.test.ts` 9 test. Toplam 152+ geçti, 3 atlandı (önceden de atlanıyordu). tsc ve eslint temiz.

**Codex:**
- Tur 1 CHANGES REQUIRED: kareli tarama (25 MB'de 17,5 sn); ön ekin pencereyi taşırması.
- Tur 2 CHANGES REQUIRED: uzun başlık ön eki; büyük bindirmede sonsuz döngü.
- Tur 3 CHANGES REQUIRED: çok küçük pencereler.
- Tur 4 onaylandı.
