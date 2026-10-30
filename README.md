# Yerel Doküman Asistanı

Dosya yükleyip hakkında soru sorabileceğiniz arayüz. Dosyalar ve sorular kurumun kendi sunucusunda işlenir; harici bir AI servisine gönderilmez. Kullanılabilecek modeller sunucuda `ALLOWED_MODELS` ile sınırlanır. Not: dosyalar şu an işlendikten sonra sunucuda saklanır; yalnızca kendi kullanıcınız görür. Cihazda saklama FAZ 2'de gelecek.

## Gereksinimler

- Node.js 22+ ve pnpm
- PostgreSQL (yalnızca hesap ve oturumlar; sohbet/doküman içeriği yazılmaz)
- Ollama (`ollama serve`) ve şu modeller:
  ```bash
  ollama pull gemma4:12b       # sohbet + tablo doğrulama (görsel)
  ollama pull embeddinggemma   # büyük dosyalarda parça arama (RAG)
  ```
- İsteğe bağlı ama PDF/DOCX için önerilir: Docling (Python 3.10+). Kurulu değilse PDF'lerde yalnızca metin katmanı okunur; görsel olarak gömülü tablolar okunamaz.

## Kurulum ve çalıştırma

```bash
pnpm install
# Geliştirme veritabanı (bir kez):
docker run -d --name kurumai-dev-pg -e POSTGRES_USER=kurumai -e POSTGRES_PASSWORD=kurumai-dev -e POSTGRES_DB=kurumai   -p 127.0.0.1:5491:5432 --restart unless-stopped postgres:17-alpine
echo "DATABASE_URL=postgres://kurumai:kurumai-dev@127.0.0.1:5491/kurumai" >> .env.local
# İlk yönetici (parola ortam değişkeninden okunur, komut satırına yazılmaz):
ADMIN_PASSWORD='en-az-10-karakter' node --env-file=.env.local scripts/create-admin.ts admin
pnpm dev          # http://localhost:3000
pnpm test         # birim testleri
SMOKE_URL=http://localhost:3000 pnpm test:isolation   # çalışan sunucuya karşı kullanıcı A/B izolasyonu
```

Tablolar ilk istekte otomatik oluşturulur (`lib/db.ts` migration listesi). Yeni kullanıcılar giriş sayfasından hesap ister; yönetici `/admin` sayfasından onaylar.

Üretim modu: `pnpm build && pnpm start`

### Docling kurulumu (proje içinde ayrı sanal ortam)

```bash
python -m venv .venv-docling
.venv-docling/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128   # NVIDIA GPU; CPU için --index-url'i kaldırın
.venv-docling/Scripts/python -m pip install docling
```

Linux/macOS'ta `Scripts/python` yerine `bin/python`. İlk çalıştırmada Docling ve OCR modelleri bir kez indirilir; sonrasında internet gerekmez. Global Python'daki torch/torchvision sürümleriyle çakışmaması için ayrı ortam kullanılıyor.

## `.env.local` değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `DATABASE_URL` | — (**zorunlu**) | PostgreSQL bağlantısı |
| `APP_ORIGIN` | — (**üretimde zorunlu**) | Kullanıcıların açtığı adres (ör. `https://ai.ekutlu.com`). GET dışı isteklerde `Origin` bununla birebir karşılaştırılır; üretimde tanımlı değilse bu istekler reddedilir. Geliştirmede `Host` kullanılır |
| `ALLOWED_MODELS` | `DEFAULT_MODEL` | Kullanıcının seçebileceği sohbet modelleri (virgülle). Listede olmayan model sunucuda reddedilir |
| `MODEL_CONCURRENCY` / `MODEL_QUEUE` | `2` / `32` | Aynı anda model sunucusuna giden çağrı sayısı (sohbet, embedding, görsel) ve bekleyebilecek çağrı sayısı; dolunca 429 |
| `DOCLING_CONCURRENCY` / `DOCLING_QUEUE` | `1` / `8` | Aynı anda çalışan Docling işi ve kuyruk uzunluğu |
| `DOCLING_TIMEOUT_MS` | `1200000` (20 dk) | Tek dosyanın okunma süresi sınırı (kuyrukta bekleme sayılmaz) |
| `DOCLING_MAX_PAGES` | `500` | Sayfa sınırı; aşan PDF reddedilir |
| `UPLOAD_CONCURRENCY` / `UPLOAD_QUEUE` | `4` / `16` | Aynı anda işlenen yükleme (gövde okumadan sonuca kadar) ve kuyruk; bellek tepe değerini sınırlar |
| `INSTANCE_LOCK_WAIT_MS` | `30000` | Açılışta, önceki sürecin veritabanı kilidini bırakmasını bekleme süresi; sonra açılış reddedilir |
| `CHAT_PER_MIN` / `UPLOAD_PER_MIN` | `20` / `20` | Kullanıcı başına dakikalık soru / yükleme sınırı (429) |
| `COOKIE_SECURE` | `true` (üretimde) | Yalnızca HTTPS'siz ağ testinde `false`; üretimde HTTPS arkasında açık kalmalı |
| `MODEL_PROVIDER` | `ollama` | `ollama` (geliştirme) ya da `vllm`/`openai` (GB10'da vLLM, OpenAI uyumlu API) |
| `MODEL_URL` | `http://localhost:11434` (ollama) / `http://localhost:8000/v1` (vllm) | Sohbet modeli sunucusu. Eski `OLLAMA_URL` de okunur. vLLM için `/v1` dahil |
| `EMBED_URL` / `VISION_URL` | `MODEL_URL` | vLLM her süreçte tek model sunar: embedding ve görsel model ayrı süreçteyse adresleri |
| `MODEL_API_KEY` | — | vLLM `--api-key` ile açıldıysa |
| `DEFAULT_MODEL` | `gemma4:12b` | Açılışta seçili sohbet modeli |
| `NUM_CTX` | `16384` | Bağlam penceresi (token). vLLM'de sunucunun `--max-model-len` değeriyle aynı verilmeli (Ollama'da istekle gönderilir). gemma4 kayan pencereli dikkat kullandığı için bellek neredeyse artmıyor (RTX 5090'da 64k: 9,2 GB, 128k: 9,5 GB, 256k: ~8,3 GB). Bu makinede `131072` kullanılıyor (~380 bin karakter) |
| `EMBED_MODEL` | `embeddinggemma` | Bağlama sığmayan dosyalarda parça arama modeli |
| `VISION_MODEL` | `gemma4:12b` | Görsel tabloların ikinci okuması için görsel model |
| `VISION_VERIFY` | `true` | `false` yapılırsa ikinci okuma atlanır (hızlı ama doğrulamasız) |
| `DOCLING_PYTHON` | `.venv-docling/Scripts/python.exe` | Docling kurulu Python yolu |
| `WEB_BROWSER` | compose: `ws://browser:3100/kai`; yoksa Linux'ta `/usr/bin/chromium` | Bağlantıdan okumada sayfaları script'leriyle açan tarayıcı: `browser` konteynerinin adresi, bir Chromium yolu, ya da yüklü tarayıcı için `chrome` / `msedge` (Windows'ta geliştirme). `off`: script çalıştırılmaz, sayfa doğrudan okunur |
| `WEB_PROXY_URL` | compose: `http://app:3101` | `browser` konteynerinin uygulamadaki vekil sunucuya ulaştığı adres (yalnızca `ws://` kipinde) |
| `WEB_BROWSER_SANDBOX` | (otomatik) | Yalnızca uygulamanın kendisi Chromium açtığında: önce Chromium'un sandbox'ı denenir, olmazsa sandbox'sız açılır ve log'a yazılır. `true`: sandbox şart; `false`: denenmez |
| `DOCLING_OFFLINE` | `true` | Docling'i çevrimdışı modda çalıştırır (`HF_HUB_OFFLINE=1`). Modeller önceden indirilmiş olmalı; ilk kurulumda bir kez `false` yapın ya da aşağıdaki kapalı ağ adımlarını izleyin. Yönetici sayfasındaki **Ayarlar** bölümünden de açılıp kapatılır; oradaki seçim bu değerin önüne geçer |

## Belge kütüphanesi

Ortak belgeler sunucuda bir klasördedir (`SOURCES_HOST_DIR`, varsayılan `/srv/kurum-ai/kaynaklar`), uygulama salt okunur bağlar. Alt klasörlere dosya koymak yeterlidir; en geç 30 saniye içinde yan menüde görünür. Dosya ilk kullanıldığında okunur, metni önbelleğe alınır. Sohbet belge okumadan başlar: belgeler yan menüden işaretlenince ya da mesajda istenince ("mevzuat klasöründeki kaynakları kullanarak...") okunur.

## Desteklenen dosyalar

PDF, DOCX (eski `.doc` yok), XLSX / XLS / CSV (her sheet Markdown tablo olarak), TXT / MD, PNG / JPG / WEBP görsel (ekran görüntüsü soru kutusuna yapıştırılabilir; metni ve tabloları kurumun kendi görsel modeli `VISION_MODEL` okur, görsel dışarı çıkmaz). Dosya başına en fazla 25 MB. UTF-8 okunamayan TXT/CSV dosyaları Windows-1254 (Türkçe) olarak okunur.

## Nasıl çalışır

### Okuma (yükleme sırasında, dosya başına bir kez)

1. **Docling** PDF/DOCX'i sayfa sayfa okur: sayfa düzeni, OCR ve tablo yapısı. Resim olarak yapıştırılmış tablolar da tabloya çevrilir.
2. **İkinci okuma:** Resim içeren sayfalardaki her tablo yüksek çözünürlükte kırpılır ve görsel modele (`VISION_MODEL`) ayrıca okutulur.
3. **Karşılaştırma:** İki okumanın sayıları hizalanır; ikisinin uyuşmadığı sayılar `(?)` ile işaretlenir. Görsel modelin okuması da "İkinci okuma" olarak metne eklenir, çünkü Docling bazen hücre atlıyor.
4. **Kod kontrolleri** (`lib/checks.ts`):
   - "en fazla %20" / "%30'u aşmamalı" / "%20'nin altında" gibi kriter satırlarında sonuç eşikle kodla karşılaştırılır ve raporun √/x işaretiyle kıyaslanır.
   - "Maksimum" satırları, yalnızca iki okumayla doğrulanmış sütunlarda satırların en büyüğüyle karşılaştırılır.
5. Metnin başına **otomatik içindekiler** (her sayfanın bölümü ve "BİNA PERFORMANSI : …" gibi sonuç satırları) ve **otomatik bulgular** (kod kontrolleri, sayfa ve bölümüyle) eklenir. Her sayfanın başına da önceki sayfalardan süren bölüm yazılır.

Sonuç `.cache/` altında dosya özetiyle saklanır. Aynı dosya tekrar yüklenince anında açılır; görsel model okumaları da tablo kesiti başına ayrı saklanır. Yüklenen dosyalar `.cache/docs/` altında tutulur; sunucu yeniden başlayınca listede geri gelir. Kaldır butonu dosyayı buradan da siler.

Örnek: 20 sayfalık, 34 görsel tablolu performans raporu RTX 5090'da ilk yüklemede ~4 dakika, önbellekle ~1 dakika (yalnız Docling) sürüyor.

### Sohbet

- **Sığıyorsa tam metin:** Seçili dosyalar bağlama sığıyorsa tamamı gönderilir. Aynı dosyalarla sonraki sorular Ollama'nın önek önbelleği sayesinde hızlıdır: 120 bin token'lık bir istem ilk soruda ~55 sn, sonrakilerde ~1 sn sürdü.
- **Sığmıyorsa soru türüne göre** (model kısa bir sınıflandırma yapar; öneri butonları doğrudan "bütün" sayılır):
  - *Belirli bilgi* (ör. "raporu kim hazırladı?") → **RAG:** metin sayfa/sheet bilgisiyle ~800 token'lık, %15 örtüşmeli parçalara bölünür; `EMBED_MODEL` ile en ilgili 6 parça bulunur.
  - *Bütünü gerektiren* (özet, tüm rakamlar, tutarlılık) → **bölüm bölüm tarama:** doküman bağlama sığan pencerelere bölünür, her pencereden soruyla ilgili notlar çıkarılır, cevap bu notlardan yazılır. Yavaştır: 16k bağlamda 20 sayfalık rapor 7 pencere, ~3 dakika sürdü. Beklerken arayüzde "bölüm 3/7 taranıyor" gibi ilerleme görünür.
  - Kullanılan ya da taranan bölümler cevabın altında "Sayfa 4" gibi etiketlerle gösterilir.
- **Bağlantıdan okuma** (Yönetici → Ayarlar, varsayılan kapalı): soruya yazılan web adresi okunur. HTML sayfalar Chromium'da script'leriyle birlikte açılır (`lib/browser.ts`), böylece verisini sonradan yükleyen sitelerdeki rakamlar da okunur (ör. TCMB ana sayfasındaki kurlar); siteye özel ayar yoktur. Kurulumda Chromium ayrı `browser` konteynerinde çalışır: dışarıya yolu olmayan iç `browsing` ağında, belge/anahtar/veritabanı olmadan, salt okunur dosya sistemi ve sıfır yetkiyle. Chromium ağa kendisi çıkmaz: sayfa, alt kaynaklar ve sayfanın kendi fetch/XHR/WebSocket istekleri dahil her şey uygulamanın denetimli vekil sunucusundan geçer. Orada iç ağ adresleri (loopback, özel ağlar, 169.254.169.254 vb., DNS rebinding dahil) ve 80/443 dışı portlar reddedilir; UDP (QUIC, WebRTC) kapalıdır. Görsel, medya ve yazı tipleri yüklenmez; indirmeler, service worker'lar ve izinler kapalıdır; her sayfa ayrı bir bağlamda açılıp kapatılır. Tarayıcı yoksa ya da açılamazsa sayfa script'siz okunur. Cevap o sayfada yoksa model sayfadaki aynı siteye ait bağlantılardan en ilgili 2 tanesini seçer, onlar da okunur (model yalnızca numara seçer, adres yazamaz; yönlendirmeler siteden çıkamaz). XML/JSON veri dosyaları da okunur.
- **Tutarlı cevaplar:** Sıcaklık 0 kullanılıyor; aynı soru aynı cevabı verir, rastgele örnekleme kaynaklı uydurma azalır.
- **Model başına token ölçümü:** Bağlama sığma hesabı, modelin gerçek token sayımından öğrenilir (Ollama her cevapta bildiriyor). Ölçüm yapılana kadar temkinli 2,2 karakter/token kullanılır. Ölçülen değerler: gemma4 ~2,9, gpt-oss ~2,2.
- Cevap bittikten sonra içindeki her sayı kaynak metinde aranır. Bulunamayanlar ("hesaplanmış ya da uydurulmuş olabilir") ve belirsiz okunanlar (`(?)`) cevabın altında uyarı olarak gösterilir.
- "Düşünerek cevapla" varsayılan olarak açık. gemma4:12b çok adımlı sorularda düşünme kapalıyken mantık hatası yapıyor, açıkken doğru cevaplıyor (bir soru ~25 sn yerine ~40 sn).

### Sınırlar

- **Tek tek sorular güvenilir, açık uçlu analiz kısmen.** "DD1'de göçmenin önlenmesi kriterleri sağlanıyor mu?" gibi sorular doğru cevaplanıyor. "Tutarlılık kontrolü" gibi bütün raporu tarayan istekler (~2 dakika) çoğunlukla doğru; ama yerel 12B model bazen değeri yanlış sayfaya taşıyor ya da önemli bir bulguyu atlıyor. Bu tür cevapları kontrol listesi gibi kullanın, son söz olarak değil.
- Görsel model rakam okuyabilir ama uydurabilir de. Bu yüzden tek başına değil, yalnızca Docling'le karşılaştırma için kullanılıyor.
- Grafiklerdeki eğriler (ör. itme eğrileri) sayıya çevrilmez; yalnızca başlık ve açıklamaları okunur.
- Uygulama itme analizini yeniden hesaplamaz; raporun kendi tutarlılığını ve kriterlerini kontrol eder. Yönetmelik uygunluğu için yönetmelik metnini ikinci dosya olarak yükleyin.

## Kapalı ağda (internetsiz) kurulum

Çalışma sırasında uygulama hiçbir yere bağlanmaz: Ollama yerel, Docling çevrimdışı modda, yazı tipi pakete gömülü. Yalnızca **kurulum** internet ister. İnternetli bir makinede kurup kapalı ağa taşıyın:

1. **Proje:** `pnpm install && pnpm build` sonrası klasörün tamamını (`node_modules` dahil) kopyalayın. Hedefte yalnızca Node.js gerekir (`pnpm start`).
2. **Docling:** Aynı Python sürümünü hedefte de **aynı yola** kurun (sanal ortam Python yolunu içinde saklar). Sonra `.venv-docling` klasörünü (~5 GB; OCR modelleri içinde) ve `%USERPROFILE%\.cache\huggingface\hub` altındaki `models--docling-project--*` klasörlerini (~500 MB) kopyalayın. Farklı Python yolu gerekiyorsa: `pip download docling torch torchvision -d wheels` ile paketleri indirin, hedefte `pip install --no-index --find-links wheels docling` ile kurun.
3. **Ollama modelleri:** `%USERPROFILE%\.ollama\models` klasörünü kopyalayın (gemma4:12b ~7,5 GB, embeddinggemma ~0,6 GB).
4. **Telemetri:** Hedef makinede bir kez `pnpm exec next telemetry disable` çalıştırın (Next.js anonim kullanım verisi). Ollama masaüstü uygulamasında otomatik güncellemeyi kapatın.
5. **Doğrulama:** Ağ kablosu çıkarılmış ya da güvenlik duvarında dış bağlantıları kapatılmış makinede bir PDF yükleyip soru sorun.

Bu makinede doğrulandı: `HF_HUB_OFFLINE=1` ile Docling 20 sayfalık raporu 13 sn'de okudu.

## API

Tüm uçlar oturum ister (yoksa `401`); GET dışı isteklerde farklı `Origin` `403` döner.

- `POST /api/upload`: NDJSON akışı döner (`progress` olayları, ardından `done` veya `error`).
- `GET /api/upload`: kayıtlı dosyaların listesi. `DELETE /api/upload?id=…`: dosyayı siler.
- `POST /api/chat`: cevap metni akış olarak gelir. Arada `\u001d…\u001d` ilerleme satırları olabilir; sonunda `\u001e` ayıracı ve ardından JSON (mod, kaynaklar, doğrulanamayan sayılar) gelir. `scope: "all"` sorunun bütünü gerektirdiğini bildirir.
- `GET /api/models`: sohbet modelleri; embedding, whisper ve bulut modelleri filtrelenir. Arayüz bunu 15 saniyede bir yoklayarak Ollama'nın açık olup olmadığını izler.

Kısayollar: Enter gönderir, Shift+Enter yeni satır ekler, Esc cevabı durdurur.

## Konteyner / Dokploy

```bash
docker build --target app -t kurum-ai-web .          # Docling'siz (PDF metni unpdf ile)
docker build --target app-docling -t kurum-ai-web .  # Docling imajın içinde
```

Dokploy'da **Docker Compose** uygulaması olarak `deploy/compose.yml` kullanılır. Environment sekmesinde en az `POSTGRES_PASSWORD` ve `APP_ORIGIN` (ör. `https://ai.ornek.com`) tanımlanır; model ayarları (`MODEL_PROVIDER`, `MODEL_URL`, `ALLOWED_MODELS` …) yukarıdaki tablodan. Alan adı ve HTTPS Domains sekmesinden `app:3000`'e verilir. Kullanıcı belgeleri `appdata` volume'ünde (`/app/.cache`) durur; yedeklenmelidir. İlk yönetici:

```bash
docker compose exec app sh -c 'ADMIN_PASSWORD=… node scripts/create-admin.ts admin'
```

`app-docling` ilk kurulumda modelleri indirmek için yönetici sayfası → **Ayarlar** → Docling çevrimdışı modu **Kapat**; bir PDF okunduktan sonra yeniden **Aç** (yeniden deploy gerekmez).

### vLLM (GB10)

Sohbet ve tablo okuma aynı stack'teki `vllm` servisinden gelir (NGC `nvcr.io/nvidia/vllm`, varsayılan model `RedHatAI/gemma-4-26B-A4B-it-NVFP4`). Aynı belgelere sorulan sonraki sorular, belgenin hesaplanmış kısmı önbellekte kaldığı için birkaç saniyede başlar (prefix caching); bu birden çok kullanıcı için de geçerlidir. Embedding (parça arama) cihazdaki Ollama'dan, OpenAI uyumlu `/v1` ucuyla alınır (`embeddinggemma`).

1. Model ağırlıkları ilk deploy'da tek seferlik `models` servisiyle `vllmmodels` volume'üne kendiliğinden indirilir (~17 GB, internet gerekir; deploy bu yüzden ilk seferde uzun sürer, arayüz bu sırada açıktır ama sohbet "Model sunucusuna ulaşılamıyor" der). Sonraki deploy'larda model hazırsa atlanır; yarıda kalan indirme sonraki deploy'da devam eder. Ağırlıklar cihazda zaten varsa `VLLM_MODELS_DIR=/o/klasör` verin (içinde `<model>/.complete` dosyası olmalı ya da indirme yeniden denenir). Kapılı (gated) bir model için `HF_TOKEN`.
2. Environment sekmesine `COMPOSE_PROFILES=vllm` ve `VLLM_API_KEY` (rastgele uzun bir değer) ekleyin. `COMPOSE_PROFILES` olmadan vLLM ve indirme servisi hiç başlatılmaz (GPU çalışana kadar deploy yeşil kalır); sohbet için yönetici sayfası → Ayarlar → Model sunucusu → **Ollama** seçin. Ollama döneminden kalan `MODEL_PROVIDER`, `MODEL_URL`, `DEFAULT_MODEL`, `ALLOWED_MODELS`, `VISION_MODEL`, `VISION_URL`, `EMBED_URL` satırları varsa silin: compose varsayılanları vLLM'i (ve embedding için Ollama `/v1`) gösterir; kalan eski bir değer onların önüne geçer (ör. `ALLOWED_MODELS=gemma4:12b` yeni modeli listeden çıkarır).
3. Ollama'da `embeddinggemma` yüklü olmalı (`ollama pull embeddinggemma`) ve Ollama konteynerlerden erişilebilir olmalı (`OLLAMA_HOST=0.0.0.0`; bu Ollama'yı yerel ağa da açar, güvenlik duvarında 11434'ü yalnızca Docker ağlarına izin verin). Cihazda NVIDIA Container Toolkit kurulu olmalı.
4. Deploy. vLLM'in modeli yüklemesi birkaç dakika sürer; bu sırada arayüz "Model sunucusuna ulaşılamıyor" der.

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `VLLM_MODEL` | `RedHatAI/gemma-4-26B-A4B-it-NVFP4` | `VLLM_MODELS_DIR` altındaki model klasörü. Tam hassasiyet: `google/gemma-4-26B-A4B-it` (~52 GB, daha yavaş) |
| `VLLM_MODEL_NAME` | `gemma4-26b` | Arayüzde görünen ad |
| `VLLM_GPU_MEMORY_UTILIZATION` | `0.5` | Birleşik belleğin vLLM'e ayrılan payı (Docling, Ollama ve sistem için yer kalır) |
| `NUM_CTX` | `131072` | Bağlam uzunluğu; vLLM `--max-model-len` ile aynı |
| `VLLM_DRAFT_MODEL` | — | Hızlandırma (speculative decoding) için küçük taslak model; `models` servisi bunu da indirir |
| `VLLM_SPECULATIVE_CONFIG` | — (kapalı) | vLLM `--speculative-config` JSON'u. Boş: hızlandırma yok |

**Hızlandırma (MTP, deneysel).** Küçük bir taslak model birkaç sonraki kelimeyi tahmin eder, ana model hepsini tek adımda doğrular; kalite kaybı hedeflenmez. Bir kullanıcının DGX Spark'ta (NVIDIA forumu, nvidia NVFP4 + bu taslak model, 4 token) ölçtüğü hız artışı ~1,9–2,3 kat; bu kurulumda ölçülmedi ve Google'a göre 26B-A4B'de bazı koşullarda kazanç olmayabilir. Açmak için Environment'a:

```
VLLM_DRAFT_MODEL=google/gemma-4-26B-A4B-it-assistant
VLLM_SPECULATIVE_CONFIG='{"method":"mtp","model":"/models/llm/google/gemma-4-26B-A4B-it-assistant","num_speculative_tokens":4}'
```

Deploy'da taslak model (~0,9 GB) bir kez indirilir. vLLM açılmazsa (logda `Engine core initialization failed` ya da `same reduction dim`), iki satırı silip yeniden deploy edin: önceki hâline döner. Taslak model vLLM'in mevcut bellek payından yer alır (`VLLM_GPU_MEMORY_UTILIZATION` değişmez).

**Açılış önbelleği.** vLLM'in derleme ve ayar (autotune) sonuçları `vllmcache` volume'ünde tutulur; ilk deploy bunları üretir (~2–3 dk), sonraki aynı ayarlı deploy'lar yeniden kullanır. Ayar ya da model değişince vLLM yeni sonuç üretir. vLLM imajı güncellendikten sonra açılışta tuhaf bir hata olursa yalnızca bu volume'ü silin (`docker volume rm <proje>_vllmcache`, vLLM durmuşken); modeller ayrı volume'de kalır.
