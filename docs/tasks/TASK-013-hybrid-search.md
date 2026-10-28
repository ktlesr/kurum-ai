# TASK-013 — FAZ 4: hibrit arama (anahtar kelime + anlamsal)

**Sorun:** Bağlama sığmayan belgelerde parça seçimi yalnızca embedding ile yapılıyordu. Türkçe rakamlar
("3.400.000"), kodlar ve özel adlar embedding'de kaçabiliyordu; embedding çağrısı başarısız olunca belgenin
yalnızca ilk %X'i kullanılıyordu.

**Değişiklik:**
- `lib/search.ts`: Türkçe tokenleştirme (tr küçük harf, 5 harf önek kökü, sayılar bütün), BM25, RRF.
- `lib/rag.ts` `retrieve`: BM25 ve embedding sıralaması RRF ile birleşir. Embedding hatasında yalnızca anahtar
  kelime; o da eşleşmezse ilk parçalar. Arayüzde hangi yolun kullanıldığı not olarak gösterilir.
- `app/globals.css`: tıklanabilir öğelerde `cursor: pointer` (Tailwind 4 varsayılanı ok imleciydi).

**Testler:** `lib/search.test.ts` — sentetik Türkçe sayfalarla çekimli kelime, tam rakam, eşleşmeme, RRF.

**Codex:** APPROVED WITH NOTES (tur 1). Not 1 (eşleşme yokken yanlış not metni) düzeltildi. Not 2 (her sorguda
yeniden tokenleştirme) ölçülmeden optimize edilmedi.

**Açık:** gerçek belgelerle golden soru seti (plan §5.3: 20 izinli Türkçe belge) kullanıcıdan bekleniyor;
reranking ve cümle → kaynak izlenebilirliği sonraki adımlar.
