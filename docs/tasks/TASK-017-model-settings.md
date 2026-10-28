# TASK-017 — Model sunucuları yönetici Ayarlar'ından; vLLM'e geçiş

**İstek:** Çok kullanıcı için Ollama yerine vLLM; vLLM, Ollama ve modeller yönetici sayfasından yönetilsin.
"Çalışan hiçbir şeyi bozma."

**Değişiklik:**
- `deploy/compose.yml`: `vllm` servisi (NGC GB10 imajı, NVFP4 gemma4 26B-A4B, prefix caching, 128k); sohbet ve
  tablo okuma vLLM, embedding Ollama `/v1`. README'de geçiş adımları. (ayrı commit, 25fdb33)
- `lib/models.ts` (saf): `envConfig` önceki env mantığının aynısı; `validateConfig`.
- `lib/model-config.ts`: kayıtlı seçim (`settings.models`) ya da env; 5 sn önbellek, kayıtta nesil sayacı;
  `providerOf` sunucu başına; API anahtarı yalnızca env `MODEL_API_KEY`.
- Çağıranlar ayarlardan okur: sohbet (izin listesi, sağlayıcı), modeller ucu, arama (embedding; vektörler
  sunucu+model anahtarlı, istek-yerel), belge okuma (tablo okuma modeli; önbellek dosyaları sunucu+model hash'i).
  Bütün-belge notları sunucu+model anahtarlı.
- Yönetici → Ayarlar: "Model sunucuları ve modeller" formu; Bağlantıyı test et / Kaydet / Varsayılana dön.
- **Hata düzeltmesi:** `getSetting`/`setSetting` Next derlemesinde `(await db())\`…\`` → `await db()\`…\`` oluyordu;
  Docling çevrimdışı ayarı canlıda okunamıyor/yazılamıyordu (Node testleri yakalamadı). Artık önce değişkene atanıyor.

**Doğrulama:** tsc, eslint, 70/70. Yerel tarayıcı + gerçek NGC vLLM (RTX 5090): kaydedilmemişken env değerleri;
test (bağlantı, eksik model); kaydet → sohbet; Docling Kapat/Aç; geçersiz URL; tür seçimi test/kaydet/varsayılana dön
sonrasında korunuyor. vLLM: 1. soru 30 sn, aynı belgeye 2. soru 2 sn.

**Codex:** tur 1–4 CHANGES REQUIRED (önbellek anahtarları, eşzamanlı embedding, kayıt yarışı, form sıfırlanması,
select, geri gösterim sınırı), tur 5 onay.

**Not:** tablo okuma sonuç dosyasının adı değiştiği için aynı dosya yeniden yüklenirse bir kez yeniden okunur.
