# TASK-011: Yerel çalışma alanı — sohbet kalıcılığı (FAZ 2, audit R2 P0)

**Amaç:** Plan §4.2 / FAZ 2 çıkışı: yenileme, yeniden başlatma, sekme kapatmada sohbet kaybı yok; yedek/geri yükleme.

**Kapsam**
- `lib/local-store.ts`: kullanıcı başına IndexedDB (`kurum-ai:<kullanıcı>`), `SCHEMA_VERSION` + sıralı `upgrade` adımları, `onversionchange` ile eski sekme yenilenir; tek işlemli `putMany`. Saf yardımcılar: yedek biçimi ve doğrulama (güvenilmeyen girdi; tek bozuk kayıt → hiçbir şey alınmaz), birleştirme (yalnızca yeni ya da daha yeni kopya; hiçbir şey silinmez), Türkçe büyük/küçük harfe duyarsız arama, sıralama (sabitler önce), başlık.
- `app/use-chats.ts`: liste, kaydet/güncelle, 8 sn geri alınabilir silme (sekme kapanırsa sohbet kalır — güvenli yön), BroadcastChannel ile sekmeler arası senkron, `storage.persist()` (ilk kayıtta) ve `estimate()` gösterimi, kota hatası mesajı, JSON yedek al / yükle.
- `app/chat.tsx`: soru gönderilince sohbet hemen kaydedilir (cevap başlamadan), cevap bitince/iptalde/hatada tekrar. Kenar çubuğunda Sohbetler: yeni, ara, aç, sabitle, yeniden adlandır, sil + geri al. Açık sohbet başka sekmede değişirse (bu sekme cevap üretmiyorsa) yeniden yüklenir. Metin: "Sohbetler yalnızca bu tarayıcıda saklanır; cihazlar arası eşitleme yok."
- Yeni bağımlılık yok.

**Kapsam dışı / sonraki:** OPFS'te belge kopyası (belgeler şu an sunucuda kullanıcıya özel ve kalıcı); koleksiyonlar; şifreli yedek; akış sırasında kısmi cevabın ara kayıtları (sekme cevap ortasında kapanırsa soru kalır, kısmi cevap kaybolur). Aynı sohbet iki sekmede aynı anda yazılırsa son yazan kazanır.

**Kabul (Chrome, gerçek IndexedDB; sahte Ollama ile tam akış)**

| Senaryo | Sonuç |
|---|---|
| Soru → akışlı cevap → listede görünür | ✅ |
| Sayfa yenileme → sohbet, tablo ve kaynak notlarıyla geri gelir | ✅ |
| İkinci sekme yeni sohbeti yenilemeden görür | ✅ |
| Yedek al: `kind`, `schema`, 2 sohbet | ✅ |
| Sil → toast → Geri al → geri gelir; sil → 8 sn → IndexedDB'den gerçekten silinir | ✅ |
| Yedekten yükle: silinen 1 sohbet geri gelir, güncel olan ezilmez; ikinci yükleme 0; bozuk dosya reddedilir | ✅ |
| Sabitle → üste çıkar; yeniden adlandır | ✅ |
| `pnpm test` 54/54 (5 yeni), `tsc`, `lint` | ✅ |

**Codex bulguları ve karar**
- Codex tur 1 — CHANGES REQUIRED (düzeltmeler FAZ 3 dalında, FAZ 3 bu dalı içerir): **P1** yedekteki `meta` doğrulanmıyordu (`meta: {}` render'ı çökertiyordu) → bilinen alanlardan yeniden kuruluyor, bozuksa atılıyor. **P1** geri yükleme açık sohbeti yenilemiyordu, eski mesajlar geri yazılabiliyordu; birleştirme ile yazma ayrı işlemdi → `mergeIn` tek işlem; değişen kimlikler hem diğer sekmelere hem bu sekmeye bildiriliyor, açık sohbet yeniden yükleniyor. **P1** depo açılmadan kayıt sessizce atlanıyordu → her yazım depo açılışını bekliyor. **P2** yinelenen kimlikte eski kopya kazanıyordu → en yenisi; **P2** `putMany` her hatada iptal etmiyordu → tüm yazımlar hata halinde `abort` eden tek yardımcıdan; **P2** akış sırasında ad/sabit kayboluyordu → kayıt `upsert` (tek işlemde oku-değiştir-yaz); **P2** yedek boyut sınırı → 50 MB, 5000 sohbet. Tarayıcıda: bozuk meta'lı yedek → çökme yok; geri yükleme açık sohbeti günceller; akışta ad değişikliği korunur. Birim testler 7/7.
