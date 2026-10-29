# TASK-029 — Altın test seti (plan §5.3)

**Amaç:** Belge cevaplarının doğruluğunu ölçmek. Ölçüm, FAZ 4'ün kalan değişikliklerinden (TASK-021…024) önce ve
sonra yapılacak.

**Set:** Kullanıcının verdiği 22 Türkçe belge (`D:\20pdf`): program çağrıları ve özet bilgi formları, ETUYS
kılavuzları, il ekonomik görünüm raporları, KOSGEB uygulama esasları, fizibilite formatı. 2 belge taranmış, metin
katmanı yok. Belgelerle 101 soru hazırlandı:

| Tür | Adet |
| --- | --- |
| rakam | 31 |
| tarih | 18 |
| tanım | 16 |
| liste | 12 |
| yok (belgede olmayan bilgi; doğru davranış "belgede yok" demek) | 10 |
| ocr (taranmış belgeler) | 10 |
| karşılaştırma (iki belge) | 4 |

- Her sorunun kısa doğru cevabı, cevapta mutlaka geçmesi gereken ifadeler (`mustContain`), sayfası ve sayfadaki
  alıntısı var. Alıntılar ve ifadeler, çıkarılan sayfa metninde betikle doğrulandı.
- **Belgeler, metinleri, soru-cevaplar ve raporlar git'e girmez.** Hepsi belge klasöründeki `_text/` ve `_golden/`
  altında durur.

**Betikler (repoda):**
- `scripts/pdf-pages.mjs <klasör>`: PDF'lerin sayfa sayfa metnini çıkarır. Repo içindeki bir klasörü reddeder.
- `scripts/eval-golden.mjs <klasör>`:
  - Uygulamaya giriş yapar, belgeleri bir kez yükler (ad ve boyut eşleşirse yeniden kullanır), her soruyu sohbet uç
    noktasına sorar.
  - Puanlama:
    - Rakamlar biçimden bağımsız karşılaştırılır; "20" ile "120" eşleşmez.
    - İfadeler bütün olarak aranır; "Sayfa N" puanlamaya katılmaz.
    - "Yok" sorularında ret, cevabın ilk iki cümlesinde olmalı.
    - Uydurma sayfa içeren doğru cevap "kısmen" sayılır.
    - Alıntılanan sayfa doğruluğu ve kaynakta bulunmayan sayı ayrı ölçülür.
  - Rapor `_golden/report-<tarih>.md` ve `.json` olarak yazılır.
  - Yalnızca `KAI_URL` kaynağıyla konuşur; başka kaynağa giden istekler kesilir, yönlendirme izlenmez. Parola yalnızca
    ortam değişkeninden okunur ve günlüğe yazılmaz.

**Çalıştırma** (belgeler yalnızca kurum sunucusuna gider):
```
KAI_URL=https://ai.ekutlu.com KAI_USER=degerlendirme KAI_PASS=… node scripts/eval-golden.mjs D:/20pdf
# yalnızca bir grup:   --only eko-     derin analiz profili:   --profile deep
```
Önce yönetici sayfasından ayrı bir "degerlendirme" kullanıcısı açılmalı; belgeler o kullanıcının listesinde kalır.

**Doğrulama:**
- Yerel geliştirme sunucusunda deneme: giriş, yükleme (42 sn), ikinci çalıştırmada yeniden kullanım. Sohbet adımı
  model sunucusu olmadığı için beklenen "hata" ile bitti.
- Puanlama yardımcıları için yanlış eşleşme denemeleri: 120/20, -5/5, 0,5 milyon / 5 milyon, 1,25 m² / 25 m²,
  1.250.000 / 1250000, "BİLGİ YOK".

**Codex:**
- Tur 1 CHANGES REQUIRED: repo içine yazma, kaynak kısıtı, parolanın günlüğe düşmesi, yanlış eşleşmeler, ret
  tanıma, eski yükleme.
- Tur 2 CHANGES REQUIRED: ondalık ve işaretli sayılar içeren ifadeler; meta verisi tür denetimi.
- Tur 3 APPROVED.

**Sınır:** İlk ölçüm (taban çizgisi) sunucuda değerlendirme kullanıcısıyla çalıştırılmayı bekliyor.
