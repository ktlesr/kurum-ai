# TASK-016 — Asistan davranışı: belgeleri inceleyen, yorum yapan asistan

**Şikâyet (canlı, 2 PDF: 28 + 10 sayfa):** "Sunum ile fizibilite raporu uyumlu mu?" sorusuna her seferinde
"Dokümanda bu bilgi yok"; her soruda tüm belgeler baştan bölüm bölüm taranıyor. Kullanıcı ChatGPT/Claude/Gemini
gibi analiz eden bir asistan istiyor.

**Kök nedenler:**
1. `NUM_CTX` varsayılanı 16384: 38 sayfa bağlama sığmadı → her bütün-belge sorusu bölüm taraması.
2. İstem "yalnızca dokümana dayan, yoksa bilgi yok de" idi; tarama da soruya özel olduğu için hiçbir bölümde
   "uyum" kelimesi geçmeyince notlar boş, cevap "bilgi yok".

**Değişiklik:**
- `deploy/compose.yml`: `NUM_CTX` varsayılanı 131072 (gemma4 kayan pencere; README'deki ölçümler). vLLM'de sunucu
  `--max-model-len` değeriyle eşleşmeli.
- İstem: analiz, karşılaştırma, değerlendirme ve genel bilgi kullanımı açıkça isteniyor; belgeye ait olgular uydurulmaz.
- Bütün-belge modu: soruya özel tarama yerine sorudan bağımsız bölüm notları belge başına bir kez çıkarılıp
  `Doc.digests[model]` içinde (bellekte) tutulur; eşzamanlı istekler tek koşuyu paylaşır, kesik/boş notlu set
  saklanmaz, belge içeriği talimat değil veri olarak verilir.
- Arayüz metinleri ve "belgelerde geçmeyen sayılar" uyarısı yeni davranışa göre.

**Doğrulama:** 67/67, tsc, eslint. Yerel uçtan uca (sahte Ollama, NUM_CTX=12000, 2 belge): 1. soru 5 not + 1 cevap
çağrısı, 2. soru yalnızca 1 cevap çağrısı. Gerçek modelle cevap kalitesi henüz denenmedi.

**Codex:** tur 1 CHANGES REQUIRED (4), tur 2 CHANGES REQUIRED (1), tur 3 APPROVED WITH NOTES; not kapatıldı.

**Sınır:** notlar sunucu yeniden başlayınca kaybolur (bir kez yeniden çıkarılır). Otomatik profilde sınıflandırma
çağrısı (5 token) her soruda var.
