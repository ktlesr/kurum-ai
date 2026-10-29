# Devir notu — 2026-10-29

Başka bilgisayarda kaldığın yerden devam etmek için. Sır, `.env`, gerçek belge ya da sohbet içermez.

## Başlarken (yeni bilgisayar)

```bash
git pull
pnpm install          # pnpm 10.19; playwright-core 1.64.1 sabit sürüm
pnpm test             # 88/88 geçmeli; ayrıca: npx tsc --noEmit && pnpm lint
```

Claude Code'a ilk mesaj olarak: "docs/HANDOFF.md'yi oku, kaldığımız yerden devam edelim."

## Çalışma kuralları (kullanıcının talimatları)

- Plan: `KURUM_AI_MASTER_GELISTIRME_PLANI.md`. Premium kalite, gece/gündüz teması, **çalışan hiçbir şey bozulmaz**.
- Her değişiklik Codex incelemesinden geçer: `codex exec -s read-only "<inceleme isteği>"`. Kararlar: BLOCKED / CHANGES REQUIRED / APPROVED WITH NOTES / APPROVED. APPROVED (WITH NOTES) olmadan commit yok.
- Kontroller (test, tsc, lint, Codex) geçtikten sonra önemli kilometre taşlarında sormadan commit + push. Deploy'u kullanıcı yapar ve haber verir.
- Yasak (onaysız): canlı Dokploy/Traefik/Ollama/Postgres'e dokunmak ya da yeniden başlatmak, `rm -rf`, `docker system prune`, DB drop, NAT/DNS/firewall değişikliği. Git'e sır, `.env`, gerçek belge girmez.
- Belgeler dışarı çıkmaz; her şey kurum içindeki modellerle çalışır.
- Windows'ta Git Bash heredoc'u Python dizgilerindeki `\n` ve `\\`'ı bozuyor: betikleri Write aracıyla dosyaya yaz ya da Edit kullan.

## Ortam

- Uygulama: Next.js 16.3.6 (standalone), React 19, Postgres. Canlı: `https://ai.ekutlu.com`.
- Sunucu: DGX Spark `spark-e905` (GB10, aarch64), Dokploy ile deploy (`deploy/compose.yml`, Dockerfile varsayılan hedefi `app-docling`).
- Modeller: vLLM (`RedHatAI/gemma-4-26B-A4B-it-NVFP4`, compose profili `vllm`) ve cihazdaki Ollama (`gemma4:12b`, `embeddinggemma`).

## Son yapılanlar (bu oturum)

| Commit | İçerik |
| --- | --- |
| `7f89ed3` | Ekran görüntüsü yapıştırma ve PNG/JPG/WEBP yükleme (görsel model metne çevirir); bağlantıdan okumada aynı siteden en fazla 2 bağlantı izleme; Türkçe "İ" konum kayması düzeltmesi |
| `6133766` | Evrensel sayfa okuma: sayfalar script'leriyle Chromium'da açılır, siteye özel ayar yok (TCMB'ye özel kur dosyası kaldırıldı) |

`6133766` ayrıntısı:

- `lib/browser.ts`: `readWeb` önce düz okur (`lib/web.ts` `readPage`), sayfa HTML ise Chromium'da açar, olmazsa düz okumaya döner.
- Tarayıcı ayrı `browser` konteynerinde (`scripts/browser-server.mjs`, Dockerfile `browser` aşaması). Konteyner:
  - Dışarı yolu olmayan `browsing` iç ağında (`internal: true`).
  - Dosya sistemi salt okunur, yetkisiz (`cap_drop ALL`, `no-new-privileges`), bellek ve süreç sınırlı.
- Tarayıcının tek çıkışı uygulamadaki vekil sunucu (`startProxy`, port 3101):
  - Yalnızca 80/443 portlarına izin verir, iç ağ adreslerini reddeder, düz ws'yi reddeder.
  - Yalnızca tarayıcıya bakan adreste dinler (`addressFacing`).
  - Parolası yok, çünkü Chromium parolayı sitelerin 401 isteğine de verirdi.
- Yalıtım bozulursa (birden fazla ağ arayüzü ya da dışarı erişim) tarayıcı açılmaz, sayfalar script'siz okunur.
- İzlenen bağlantı siteden çıkamaz: yönlendirme adımları dahil kontrol edilir, DOM okunduktan sonra tekrar kontrol edilir.
- Yerelde ve kopya stack'te doğrulandı: TCMB kurları ve hmb.gov.tr 3–8 saniyede okundu, saldırı sayfasından iç adreslere sıfır erişim. Codex: APPROVED WITH NOTES (4 tur).

## ŞU AN KALDIĞIMIZ YER (güncel)

- **vLLM GPU sorunu çözüldü.** `docker run --gpus all … nvidia-smi` GB10'u gösteriyor. vLLM konteyneri `healthy`, sohbet vLLM'den cevaplıyor; yönetici sayfasında "Varsayılana dön" yapıldı.
- **MTP açık ve çalışıyor (2026-10-29):** 4 tahminde 62,2 token/s, kabul uzunluğu 2,79 (konum başına %74/%49/%32/%23; Türkçe İngilizceden düşük). Kullanıcı 3 tahmine geçti, ölçüm bekleniyor; hızlandırmasız taban hız henüz ölçülmedi. Karşılaştırma komutu: `docker logs $(docker ps -qf name=vllm-1) 2>&1 | grep -v AutoTuner | grep -E "generation throughput|SpecDecoding" | tail -6`.
- **Kesin ölçüm (tek istek, 600 token, temperature 0, vLLM içinden):** hızlandırma açık 59,0 token/s (10,2 sn), kapalı 48,3 token/s (12,4 sn) → **~%22 hızlı**. Forumdaki 2 katın altında (Türkçe, düşük kabul oranı). 3 tahmin 4'ten iyi değildi (kabul 2,5'e karşı 2,79); önerilen ayar 4. Ölçüm komutu README'ye eklenebilir.
- **Açılış önbelleği eklendi:** `vllmcache` volume'ü (`/root/.cache/vllm`), her deploy'daki ~2–3 dk derleme/autotune tekrarını önler. Deploy sırasında vLLM 4–5 dk "ulaşılamıyor" görünür; bu normal.
- (Önceki adım, tamamlandı) **vLLM hızlandırma (MTP) denemesi.** Kod hazır ve Codex onaylı; varsayılanda kapalı olduğu için deploy hiçbir şeyi değiştirmez (`deploy/compose.yml`, README → vLLM → "Hızlandırma").
  1. Kullanıcı Dokploy Environment'a iki satırı ekler (`VLLM_DRAFT_MODEL`, `VLLM_SPECULATIVE_CONFIG`; tam metin README'de) ve deploy eder.
  2. Kontrol: `docker logs --tail 50 $(docker ps -qf name=vllm)`. Logda speculative/MTP satırları ve kabul oranı (acceptance) görünmeli; konteyner `healthy` olmalı.
  3. Hızı önce/sonra karşılaştır: aynı soruyla yazma hızı (token/s, logdaki "Avg generation throughput").
  4. Açılmazsa (`Engine core initialization failed`, `same reduction dim` — vLLM issue #48848): iki satırı silip yeniden deploy et, eski hâline döner. Olası çözümler: `VLLM_USE_V2_MODEL_RUNNER=1` ortam değişkeni (compose'a henüz eklenmedi; boş değer vLLM'i çökertir, ancak koşullu eklenmeli) ya da `nvidia/Gemma-4-26B-A4B-NVFP4` hedef modeli (forumda çalışan çift buydu).
- **Araştırma notları (MTP):**
  - NGC 26.09 = vLLM 0.29.0; Gemma 4 MTP desteği (PR #41745) içinde.
  - Taslak model `google/gemma-4-26B-A4B-it-assistant` (~0,9 GB, Apache-2.0, kapılı değil).
  - Forumda DGX Spark ölçümü: ~1,9–2,3 kat, kabul uzunluğu 3,68/4.
  - Alternatif: `RedHatAI/gemma-4-26B-A4B-it-speculator.eagle3` (`"method":"eagle3"`, 3 token).
- **Değerlendirildi, şimdilik geçildi:** `embeddinggemma-2`. Çok dilli metin puanı neredeyse aynı (61,15 → 61,36), boyutu 1,3 GB. Geçmek güvenli (model değişince vektörler kendiliğinden yeniden hesaplanır, `lib/rag.ts:86`), ama sorgu/belge önekleri (`lib/rag.ts:63`) yeni model için doğrulanmadı.
- **Git:** bu bilgisayarın GitHub girişi süresi dolmuştu (`gh auth status`: token geçersiz), push takılıyordu. Push olmadıysa bu not başka yoldan taşınır.

## Açık işler

### 1. vLLM GPU hatası — ÇÖZÜLDÜ (aşağısı kayıt için)

Belirti: deploy'da vLLM konteyneri başlamıyor. NVIDIA Container Toolkit, sunucuda olmayan `libnvidia-egl-wayland.so.1.1.21` dosyasını arıyor. Model indirme başarılı (`models` servisi, `vllmmodels` volume'ü). Sohbet şu an geçici olarak Ollama'da (yönetici → Ayarlar).

Denenenler: düzeltme komutları çalıştırıldı (aşağıda), **GPU yine görünmedi**. Komutların çıktısı henüz paylaşılmadı. Sıradaki adım, `root@spark-e905` terminalinde çıktıları toplayıp Claude'a vermek:

```bash
nvidia-smi                                      # Docker dışında, doğrudan: sürücü çalışıyor mu?
docker run --rm --gpus all ubuntu:24.04 nvidia-smi   # tam hata metni
ls -l /usr/lib/aarch64-linux-gnu/libnvidia-egl-wayland.so*
nvidia-ctk --version; dpkg -l | grep -Ei 'nvidia-container|libnvidia-egl|nvidia-driver' 
docker info | grep -iA3 runtime
cat /etc/docker/daemon.json
ls -l /etc/cdi/ /var/run/cdi/ 2>/dev/null
sudo dmesg | grep -iE 'nvrm|nvidia' | tail -20
```

Önceden verilen düzeltme sırası (kullanıcı çalıştırır):

1. Kütüphane listesini yenile: `sudo ldconfig` ve `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`.
2. Paketleri yeniden kur: `sudo apt-get install --reinstall nvidia-container-toolkit libnvidia-egl-wayland1` ve `sudo systemctl restart docker`. Docker'ı yeniden başlatmak tüm konteynerleri 1–2 dakika durdurur.
3. Sunucuyu yeniden başlat: `sudo reboot`.

`docker run --gpus all … nvidia-smi` GPU tablosunu gösterince:

1. Dokploy'dan yeniden deploy et.
2. Yönetici → Ayarlar → **Varsayılana dön** ile sohbeti vLLM'e geri al.

Notlar:

- Modeli elle indirme komutları (`/opt/kurum-ai/models/llm`) artık gereksiz; o işi `models` servisi yapıyor. Klasör sunucuda varsa ~17 GB kullanılmıyor demektir. Silip silmemek kullanıcının kararı.
- Dokploy Environment'ta `COMPOSE_PROFILES=vllm` ve `VLLM_API_KEY` olmalı. Ollama döneminden kalan `MODEL_PROVIDER`, `MODEL_URL`, `DEFAULT_MODEL`, `ALLOWED_MODELS`, `VISION_*`, `EMBED_URL` satırları silinmeli.
- Ollama: `ollama pull embeddinggemma`. Konteynerlerden erişim için `OLLAMA_HOST=0.0.0.0` (`sudo systemctl edit ollama`). Güvenlik duvarında 11434 yalnızca Docker ağlarına açık olmalı.

### 2. Deploy sonrası kontrol (`6133766`)

- Dokploy'da **Isolated Deployments kapalı** olmalı, yoksa `browser` konteyneri yalıtım kontrolünden geçmez ve açılmaz. Logunda "tarayıcı hazır" görünmeli.
- Yönetici → **Bağlantıdan okuma → Aç**.
- Test sorusu: "https://www.tcmb.gov.tr/ döviz kurunu okuyabiliyor musun". Dolar ve euro kuru gelmeli.

### 3. Güvenlik incelemesi notu (ORTA, kabul edildi)

`scripts/browser-server.mjs` dosyasında `chromiumSandbox: false`. Docker'ın varsayılan seccomp profili Chromium sandbox'ına izin vermiyor. Sınır konteynerin kendisi: iç ağ, yetkisiz, salt okunur, içinde değerli bir şey yok.

İsteğe bağlı sertleştirme seçenekleri:

- Yalnızca `browser` servisi için Chrome seccomp profili (`security_opt: seccomp=…`). Deploy'u kırma riski var; önce kopya stack'te denenmeli.
- Her sayfa için ayrı tarayıcı süreci.
- `browsing` ağından uygulamanın yalnızca 3101 portuna erişim (3000 zaten herkese açık ve oturum istiyor). Bu güvenlik duvarı değişikliği olduğu için onay gerektirir.

### 4. Diğer bekleyenler

- HTTPS ayarı.
