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

## Tur 2 (kullanıcı geri bildirimi): sade form, GPU'suz yeşil deploy

- Form yalnızca **vLLM / Ollama** seçtiriyor (canlı "çalışıyor / ulaşılamıyor"); adresler kurulumdan gelir
  (`presets`: VLLM_URL / OLLAMA_URL, yoksa env, yoksa compose varsayılanları). Sohbet modelleri sunucunun
  listesinden işaretlenir (embedding modelleri gizli ve sunucu tarafında reddedilir). Tablo okuma varsayılan
  sohbet modelini izler, embedding Ollama'da kalır; ikisi "Gelişmiş"te. Ollama'da embedding modeli yoksa
  `ollama pull` uyarısı. Kurulum dışı eski adres varsa uyarı.
- Form action yerine doğrudan server action (useTransition): React form sıfırlaması yok.
- `compose.yml`: `models` + `vllm` `vllm` profilinde; `COMPOSE_PROFILES=vllm` ile açılır. GPU araç seti çalışana kadar
  deploy yeşil, sohbet Ollama'da. `VLLM_API_KEY` artık zorunlu değil (profil kapalıyken interpolasyon için).
- Canlı hata: vLLM konteyneri `libnvidia-egl-wayland.so.1.1.21` bağlanamadığı için açılamıyor (NVIDIA Container
  Toolkit / ldcache). Sunucu terminali gerektirir.
- Codex: tur 1 CHANGES REQUIRED (4), tur 2 APPROVED WITH NOTES (not kapatıldı).
