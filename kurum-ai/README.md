# Kurum AI — Kurum içi doküman asistanı

Kurum içinden tarayıcıyla erişilen, internete kapalı bir doküman asistanı. Arayüz [Open WebUI](https://docs.openwebui.com), modeller kurumun kendi donanımında çalışır; doküman ve sorular kurum dışına çıkmaz.

```
Kullanıcı tarayıcısı → Caddy (HTTPS) → Open WebUI → model sunucusu → model (yerel disk)
```

| Aşama | Donanım | Model sunucusu | Dosya |
|---|---|---|---|
| 1 — Pilot | Windows + Docker Desktop | Bilgisayarda kurulu Ollama | `compose.pilot.yml` |
| 2 — Üretim | NVIDIA GB10 sınıfı AI cihazı (Linux ARM64) | vLLM | `compose.prod.yml` |

Pilot ve üretim ayrı kurulumlardır; pilottaki kullanıcı ve sohbetler üretime taşınmaz.

---

## Aşama 1 — Pilot kurulumu (Windows)

Pilotta HTTPS ve Caddy yoktur; Open WebUI doğrudan `http://<bilgisayar>:3000` adresinden açılır. Yalnızca kurum iç ağında deneme içindir.

### 1. Önkoşullar

1. **Docker Desktop** kurulu ve çalışıyor olmalı (sistem tepsisinde balina simgesi yeşil).
2. **Ollama** kurulu ve çalışıyor olmalı. Kontrol:
   ```powershell
   ollama list
   ```
3. Gerekli modeller Ollama'da bulunmalı:
   ```powershell
   ollama pull embeddinggemma   # dokümanları aramak için (Türkçe destekli, çok dilli)
   ollama pull gemma4:12b       # sohbet modeli (örnek; kurumda kullanılacak model)
   ```
4. **Bulut modellerini kaldırın.** Adı `:cloud` ile biten Ollama modelleri (ör. `gemini-3-flash-preview:cloud`) soruları ve dokümanları Ollama'nın bulut sunucusuna gönderir. Open WebUI bunları da listeler. Pilottan önce silin:
   ```powershell
   ollama list | Select-String ":cloud"
   ollama rm gemini-3-flash-preview:cloud
   ```
5. **Türkçe OCR modeli** (taranmış PDF'leri okumak için, ~7 MB, bir kez). `kurum-ai` klasöründe:
   ```powershell
   New-Item -ItemType Directory -Force models\tessdata | Out-Null
   Invoke-WebRequest https://github.com/tesseract-ocr/tessdata_best/raw/main/tur.traineddata -OutFile models\tessdata\tur.traineddata
   ```

### 2. Yapılandırma

Proje klasöründe (`kurum-ai`) PowerShell açın:

```powershell
Copy-Item .env.example .env
# Rastgele gizli anahtar üretip .env'e yazın:
$k = -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
(Get-Content .env) -replace '^WEBUI_SECRET_KEY=.*', "WEBUI_SECRET_KEY=$k" | Set-Content .env
```

3000 portu başka bir uygulama tarafından kullanılıyorsa `.env` içindeki `WEBUI_PORT` değerini değiştirin (ör. `3001`).

### 3. Başlatma

```powershell
docker compose -f compose.pilot.yml up -d
```

İlk seferde imaj indirilir (birkaç GB, internet gerekir). Hazır olup olmadığını kontrol edin:

```powershell
docker compose -f compose.pilot.yml ps          # STATUS: Up ... (healthy)
curl.exe http://localhost:3000/health           # {"status":true}
```

Tarayıcıda **http://localhost:3000** adresini açın.

**Diğer bilgisayarlardan erişim:** `http://<bu bilgisayarın IP adresi>:3000`. IP adresini `ipconfig` ile öğrenin. Windows Güvenlik Duvarı engellerse yönetici PowerShell'de:

```powershell
New-NetFirewallRule -DisplayName "Kurum AI pilot" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain,Private
```

### 4. İlk yönetici hesabı

1. http://localhost:3000 adresinde **Kaydol** ile hesap oluşturun. **Sisteme ilk kaydolan kişi otomatik olarak yönetici (admin) olur.** Bu adımı kurulumu yapan kişi hemen yapmalıdır.
2. Open WebUI, ilk yönetici oluşunca güvenlik için **yeni kayıtları kapatır.** Pilot kullanıcıların kaydolabilmesi için bir kez açın:
   **Yönetici Paneli → Ayarlar (Settings) → Genel (General) → "Enable New Sign Ups"** anahtarını açın → **Kaydet**.
   Aynı sayfada **Default User Role** değerinin **pending** olduğunu kontrol edin.

### 5. Pilot kullanıcı ekleme

İki yol var:

**a) Kullanıcı kendisi kaydolur, yönetici onaylar (önerilen)**
1. Kullanıcı http://<sunucu>:3000 adresinde kaydolur. Ekranda "Hesap Aktivasyonu Bekleniyor" mesajı görür; sisteme giremez.
2. Yönetici: **Yönetici Paneli → Kullanıcılar** listesinde rolü `pending` olan kullanıcının rolüne tıklayıp **user** yapar.
3. Kullanıcı sayfayı yenilediğinde sisteme girer.

**b) Yönetici doğrudan ekler**
**Yönetici Paneli → Kullanıcılar → "+" (Kullanıcı Ekle)** ile ad, e-posta, geçici parola ve rol (`user`) girilir. Kullanıcıya parolayı iletin ve ilk girişte değiştirmesini isteyin (**Ayarlar → Hesap**).

Pilot bitince yeni kayıtları tekrar kapatabilirsiniz (aynı "Enable New Sign Ups" anahtarı).

### 6. Test: doküman yükleyip soru sorma

1. Sol üstten **Yeni Sohbet** açın, üstteki model listesinden sohbet modelini seçin (ör. `gemma4:12b`). Ollama'daki modellerin tamamı bu listede görünmelidir.
   Embedding modelleri (`embeddinggemma`, `nomic-embed-text` vb.) sohbet için uygun değildir. Kullanıcılara görünmemesi için: **Yönetici Paneli → Ayarlar → Modeller** listesinde bu modelleri kapatın.
2. Mesaj kutusundaki **+** düğmesiyle (veya dosyayı sürükleyip bırakarak) dosya ekleyin. Desteklenen türler: **PDF, Word (.docx), Excel (.xlsx), CSV, TXT**.
3. Dosya kartındaki yükleniyor göstergesi bitince soru sorun. Örnek: bir destek programı PDF'i yükleyip *"Finansman desteğinde azami vade ve kredi üst limiti nedir?"*
4. Cevapta kaynak numarası (`[1]`) görünmelidir; tıklayınca cevabın dayandığı doküman parçası açılır. Cevaptaki rakamları PDF'ten kontrol edin.

Sık kullanılan dokümanları her sohbette yeniden yüklemek yerine **Çalışma Alanı → Bilgi (Knowledge)** altında bir koleksiyona ekleyip sohbette `#` ile çağırabilirsiniz.

Test sonuçları (kurulum sırasında bu makinede, Open WebUI v0.11.4 + gemma4:12b):
- Türkçe PDF'ten sorulan soru doğru cevaplandı (≈35 sn, kaynak gösterildi).
- PDF, DOCX, XLSX, CSV ve TXT dosyaları hatasız işlendi.
- İkinci kaydolan kullanıcı `pending` rolüyle oluştu ve onay olmadan hiçbir sayfaya erişemedi.

### 7. Günlük işletim

| İş | Komut |
|---|---|
| Durdur | `docker compose -f compose.pilot.yml down` |
| Başlat | `docker compose -f compose.pilot.yml up -d` |
| Kayıtları izle | `docker compose -f compose.pilot.yml logs -f open-webui` |
| Durum | `docker compose -f compose.pilot.yml ps` |

Veriler (kullanıcılar, sohbetler, yüklenen dosyalar, ayarlar) `kurum-ai_open-webui` adlı Docker volume'unda durur; `down` ile silinmez. **`down -v` volume'u ve tüm verileri siler.**

Bilgisayar yeniden başladığında Docker Desktop açılınca container kendiliğinden başlar (`restart: unless-stopped`). Ollama da çalışıyor olmalıdır.

### 8. Ayarlar hakkında önemli not

Open WebUI, `compose.pilot.yml` içindeki ayarların çoğunu **yalnızca ilk açılışta** veritabanına yazar. Sonrasında geçerli olan, Yönetici Paneli'ndeki değerlerdir. Yani compose dosyasında bir ayarı değiştirip yeniden başlatmak, mevcut kurulumda o ayarı **değiştirmez**. Değişiklikleri Yönetici Paneli'nden yapın.

Ayarlar bölümündeki pilot değerleri:

| Ayar | Değer | Ne yapar |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Bilgisayardaki Ollama'ya bağlanır |
| `ENABLE_OPENAI_API`, `ENABLE_DIRECT_CONNECTIONS` | `false` | Harici (OpenAI vb.) API bağlantılarını ve kullanıcıların kendi API bağlantısı eklemesini kapatır |
| `DEFAULT_USER_ROLE` | `pending` | Yeni kullanıcı yönetici onayı olmadan giremez |
| `DEFAULT_LOCALE` | `tr-TR` | Arayüz varsayılan dili Türkçe |
| `RAG_EMBEDDING_ENGINE` / `RAG_EMBEDDING_MODEL` | `ollama` / `embeddinggemma:latest` | Doküman araması Ollama'daki çok dilli modelle yapılır |
| `OFFLINE_MODE` | `true` | Sürüm kontrolünü ve Hugging Face'ten otomatik model indirmeyi kapatır |
| `ENABLE_WEB_SEARCH` | `false` | Web aramasını kapatır |
| `ENABLE_COMMUNITY_SHARING` | `false` | openwebui.com topluluğuyla paylaşımı kapatır |
| `ENABLE_VERSION_UPDATE_CHECK` | `false` | Güncelleme kontrolünü kapatır |
| `SCARF_NO_ANALYTICS`, `DO_NOT_TRACK`, `ANONYMIZED_TELEMETRY` | kapalı | Kullanım istatistiği / telemetri gönderimini kapatır |

Bu ayarlar Open WebUI'nin kendi adına dışarı bağlanmasını engeller; ağ seviyesinde tam kapalılık Aşama 2'de güvenlik duvarıyla sağlanır. Pilot bilgisayarının internet erişimi açık kalır; bu yüzden gizli dokümanlarla pilot yapılmamalı ve bulut modelleri silinmiş olmalıdır (bkz. Önkoşullar 4).

### Taranmış PDF'ler (OCR)

Tarayıcıdan geçmiş PDF'lerde metin yoktur, yalnızca sayfa görüntüsü vardır. Open WebUI'nin varsayılan okuyucusu bunlarda **"The content provided is empty"** hatası verir. Bu yüzden kurulumda ayrı bir **Docling** servisi vardır: PDF, Word, Excel vb. dosyaları metne çevirir, görüntü olan sayfalarda **Tesseract Türkçe** OCR çalıştırır. Docling'in modelleri imajın içindedir, çalışırken internete çıkmaz. Türkçe OCR modeli Önkoşullar 5'te indirilir.

- **Hız:** taranmış 28 sayfalık bir PDF bu bilgisayarda ~100 sn'de işlendi (sayfa başına 3–4 sn). Yükleme sırasında dosya kartı bu süre boyunca "işleniyor" görünür. Metin katmanı olan PDF'ler çok daha hızlıdır.
- **Kalite:** Türkçe karakterler (ş, ğ, ı, İ) ve kelime sırası doğru okunur. EasyOCR de denendi; Türkçe harfleri düşürdüğü (ş→s, ğ→g) ve kelimeleri kaydırdığı için seçilmedi.
- **Bilinen sınır:** Taranmış sayfada **fosforlu kalemle / sarı zeminle vurgulanmış hücreler** atlanabiliyor (denenen örnekte "250.000.000 TL" hücresi). Önemli rakamları kaynak sayfadan kontrol edin.

**Mevcut bir kurulumda açmak için** (ayar yalnızca ilk açılışta env'den okunur): **Yönetici Paneli → Ayarlar → Belgeler (Documents) → İçerik Çıkarma Motoru (Content Extraction Engine)** = `Docling`, sunucu adresi `http://docling:5001`, parametreler:

```json
{"do_ocr": "true", "ocr_engine": "tesseract", "ocr_lang": ["tur", "eng"]}
```

Kaydedin; daha önce "empty" hatası veren dosyaları yeniden yükleyin.

### Görünüm (yazı boyutu ve kontrast)

`custom.css` tüm kullanıcılar için yazıları %10 büyütür ve açık temadaki silik gri metinleri koyulaştırır. Değiştirdikten sonra `docker restart open-webui` ve tarayıcıda Ctrl+F5. Kişisel ayar: **Ayarlar → Arayüz → UI ölçeği** (bunun üzerine çarpan olarak uygulanır).

### 9. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Model listesi boş | Ollama çalışıyor mu? `ollama list`. Yönetici Paneli → Ayarlar → Bağlantılar'da Ollama adresi `http://host.docker.internal:11434` olmalı. |
| Dosya yüklenirken hata | `ollama list` çıktısında `embeddinggemma` var mı? Yoksa `ollama pull embeddinggemma`. |
| Kaydolan kullanıcı "izin yok" hatası alıyor | Yeni kayıtlar kapalı: 4. adımdaki "Enable New Sign Ups" anahtarını açın. |
| `port is already allocated` | `.env` içinde `WEBUI_PORT` değerini değiştirip yeniden başlatın. |
| Cevap çok geç geliyor | İlk soruda model belleğe yüklenir (≈30 sn). Daha küçük bir model deneyin. |
| Sohbet adı ilk mesajın tamamı oluyor | Düşünen model başlık için ayrılan token'ları düşünmeye harcıyor. **Yönetici Paneli → Ayarlar → Arayüz → Görev Modeli** parametreleri: `{"think": false, "max_tokens": 1000}` (yeni kurulumda hazır gelir). |

### Tamamen sıfırlama (tüm veriler silinir)

```powershell
docker compose -f compose.pilot.yml down -v
docker compose -f compose.pilot.yml up -d
```

---

## Aşama 2 — Üretim (AI cihazı, Linux ARM64)

### Mimari

```
                    kurum ağı
                        │  yalnızca 443 (ve 80 → 443 yönlendirme)
                ┌───────▼────────┐
                │     caddy      │  HTTPS, ai.kurum.local
                └───────┬────────┘
       frontend ağı     │
                ┌───────▼────────┐
                │   open-webui   │  arayüz, kullanıcılar, doküman araması (embedding: models/embedding)
                └───────┬────────┘
       backend ağı      │  internal: dışarıya çıkışı ve dışarıdan girişi yok
                ┌───────▼────────┐
                │      vllm      │  LLM (models/llm), API anahtarlı, port yayınlanmaz
                └────────────────┘
```

| Servis | İmaj | Görev |
|---|---|---|
| `vllm` | `nvcr.io/nvidia/vllm:26.09-py3` | NVIDIA'nın DGX Spark / GB10 için yayınladığı vLLM imajı (arm64). Tek model sunar (varsayılan `openai/gpt-oss-20b`). |
| `open-webui` | `ghcr.io/open-webui/open-webui:v0.11.4` | Arayüz. vLLM'e `http://vllm:8000/v1` üzerinden API anahtarıyla bağlanır; Ollama bağlantısı kapalı. |
| `docling` | `ghcr.io/docling-project/docling-serve-cpu:v1.35.0` | Doküman dönüştürme ve Türkçe OCR (taranmış PDF'ler; bkz. Aşama 1 "Taranmış PDF'ler"). Yalnızca `backend` iç ağında. |
| `caddy` | `caddy:2.10.2-alpine` | Tek giriş noktası; HTTPS. |

Kurum ağına açılan tek şey Caddy'nin 80/443 portlarıdır. vLLM'in portu hiçbir yerde yayınlanmaz ve yalnızca `backend` iç ağındadır.

### 1. Önkoşullar

- **İşletim sistemi:** NVIDIA DGX OS (Ubuntu tabanlı, ARM64). Docker ve NVIDIA Container Toolkit bu işletim sisteminde hazır gelir. Kontrol:
  ```bash
  docker run --rm --gpus all nvcr.io/nvidia/vllm:26.09-py3 nvidia-smi
  ```
  (Bu komut imajı da indirir; internet gerekir.)
- **Disk:** ~60 GB boş alan (imajlar ~25 GB, gpt-oss-20b ~14 GB, bge-m3 ~2.3 GB, yedekler).
- **DNS:** `ai.kurum.local` (veya seçtiğiniz ad) → cihazın IP adresi. Kurum DNS sunucusunda A kaydı açın.
- **Sertifika:** ya Caddy'nin iç CA'sı (kök sertifikayı istemcilere GPO ile dağıtırsınız) ya da kurum CA'sından `ai.kurum.local` için alınmış sertifika.

### 2. Dosyaları kopyalama ve yapılandırma

```bash
sudo mkdir -p /opt/kurum-ai && sudo chown $USER /opt/kurum-ai
# kurum-ai klasörünün içeriğini /opt/kurum-ai altına kopyalayın, sonra:
cd /opt/kurum-ai
cp .env.example .env
chmod 600 .env
chmod +x scripts/*.sh
sed -i "s/^WEBUI_SECRET_KEY=.*/WEBUI_SECRET_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/^VLLM_API_KEY=.*/VLLM_API_KEY=$(openssl rand -hex 32)/" .env
nano .env    # DOMAIN, CADDY_TLS ve gerekiyorsa LDAP ayarlarını düzenleyin
```

| `.env` değeri | Ne yapar |
|---|---|
| `DOMAIN` | Kullanıcıların açacağı adres (ör. `ai.kurum.local`) |
| `CADDY_TLS` | `internal` = Caddy iç CA'sı · `kurum` = `certs/cert.pem` + `certs/key.pem` |
| `LLM_MODEL` | Sunulacak model (Hugging Face adı) |
| `VLLM_GPU_MEMORY_UTILIZATION` | Belleğin vLLM'e ayrılan oranı. GB10'da bellek CPU ile ortaktır; Open WebUI ve sistem için pay bırakın (varsayılan 0.6). |
| `HF_EMBEDDING_MODEL` | Doküman araması için embedding modeli (varsayılan `BAAI/bge-m3`, Türkçe destekli) |
| `ENABLE_LDAP` ve `LDAP_*` | Bkz. "LDAP / Active Directory ile giriş" |

**LDAP kullanılacaksa `.env`'deki LDAP ayarlarını ilk başlatmadan önce doldurun** (Open WebUI bunları yalnızca ilk açılışta okur).

### 3. Modelleri indirme (tek seferlik, internet gerekir)

1. Cihazın internet çıkışını güvenlik duvarında **geçici olarak** açın.
2. İndirin:
   ```bash
   bash scripts/download-models.sh
   ```
   Betik sırasıyla şunları yapar: container imajlarını çeker, LLM'i `models/llm/` altına, embedding modelini `models/embedding/` altına ve gpt-oss'un çevrimdışı çalışması için gereken tokenizer dosyalarını `models/tiktoken/` altına indirir. Ek paket kurmaz, yalnızca Docker kullanır. Süre bağlantı hızına bağlıdır (~40 GB).
3. İnternet çıkışını **tekrar kapatın**.

### 4. Başlatma

```bash
docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml ps
```

vLLM modeli belleğe yüklerken birkaç dakika `health: starting` görünür. Üç servisin de `(healthy)` olmasını bekleyin. İzlemek için:

```bash
docker compose -f compose.prod.yml logs -f vllm      # "Application startup complete" satırı hazır demektir
```

### 5. HTTPS sertifikası

**a) Caddy iç CA'sı (`CADDY_TLS=internal`)**
Caddy ilk açılışta kendi kök sertifikasını üretir. İstemcilerin "güvenli değil" uyarısı almaması için bu kök sertifikayı dağıtın:

```bash
docker compose -f compose.prod.yml cp caddy:/data/caddy/pki/authorities/local/root.crt ./kurum-ai-root.crt
```

`kurum-ai-root.crt` dosyasını Grup İlkesi ile istemcilerin **Güvenilen Kök Sertifika Yetkilileri** deposuna ekleyin (Bilgisayar Yapılandırması → İlkeler → Windows Ayarları → Güvenlik Ayarları → Ortak Anahtar İlkeleri). Bu kök sertifika `caddy-data` volume'unda durur; volume silinirse yenisi üretilir ve yeniden dağıtmak gerekir. Caddy site sertifikasını kendisi yeniler, internet gerekmez.

**b) Kurum sertifikası (`CADDY_TLS=kurum`)**
Kurum CA'sından `ai.kurum.local` için sertifika alın. Ara sertifikalar dahil zinciri `certs/cert.pem`, özel anahtarı `certs/key.pem` olarak koyun, sonra:

```bash
chmod 600 certs/key.pem
docker compose -f compose.prod.yml up -d caddy
```

Sertifika süresi dolmadan yenisini aynı dosyalara koyup `docker compose -f compose.prod.yml restart caddy` çalıştırın.

### 6. İlk yönetici ve kullanıcılar

Pilotla aynıdır (Aşama 1, adım 4–5): `https://ai.kurum.local` adresinde **ilk kaydolan kişi yönetici olur.** Kurulumu yapan kişi bunu hemen yapmalıdır. Sonra **Yönetici Paneli → Ayarlar → Genel → "Enable New Sign Ups"** açılır. Yeni kullanıcılar `pending` rolüyle gelir ve yönetici **user** yapana kadar sisteme giremez.

LDAP açıksa kullanıcılar kurum hesabıyla giriş yapar. İlk girişte hesap `pending` olarak oluşur ve yine yönetici onayı gerekir.

### 7. Test

1. `https://ai.kurum.local` → giriş → model listesinde `openai/gpt-oss-20b` görünmeli.
2. Türkçe bir PDF yükleyip içindeki bir bilgiyi sorun. Cevap kaynak numarasıyla (`[1]`) gelmeli.
3. Kabul kontrolleri:

   ```bash
   # vLLM dışarıya açık değil: bu komutun çıktısı boş olmalı
   docker compose -f compose.prod.yml port vllm 8000
   # Kurumdaki başka bir bilgisayardan (bağlantı kurulamamalı):
   curl -m 5 http://<cihaz-ip>:8000/v1/models
   # vLLM API anahtarsız cevap vermiyor (401 beklenir):
   docker compose -f compose.prod.yml exec open-webui curl -s -o /dev/null -w '%{http_code}\n' http://vllm:8000/v1/models
   ```
4. Çevrimdışı çalışma: internet çıkışı kapalıyken `docker compose -f compose.prod.yml down && docker compose -f compose.prod.yml up -d` yapın. Tüm servisler yine `healthy` olmalı ve 1–2. adımlar çalışmalı.

### 8. Günlük işletim

| İş | Komut (`/opt/kurum-ai` içinde) |
|---|---|
| Durum | `docker compose -f compose.prod.yml ps` |
| Kayıtlar | `docker compose -f compose.prod.yml logs -f --tail 100 <servis>` |
| Yeniden başlat | `docker compose -f compose.prod.yml restart <servis>` |
| Durdur / başlat | `docker compose -f compose.prod.yml down` / `up -d` |
| Bellek/GPU kullanımı | `nvidia-smi` |

Cihaz yeniden başladığında servisler kendiliğinden açılır (`restart: unless-stopped`). **`down -v` kullanmayın:** bu komut kullanıcıları, sohbetleri ve sertifika CA'sını siler.

Ayarlarla ilgili not (Aşama 1, bölüm 8) burada da geçerlidir: Open WebUI ayarları ilk açılıştan sonra Yönetici Paneli'nden değiştirilir.

**Model değiştirme:** `.env`'de `LLM_MODEL` değerini değiştirin → internet penceresinde `bash scripts/download-models.sh` → `docker compose -f compose.prod.yml up -d vllm`. Model adı değişirse eski modeli kullanan sohbetlerde yeni model seçilmelidir.

### 9. Yedekleme ve geri yükleme

`scripts/backup.sh`, Open WebUI verisini (kullanıcılar, sohbetler, yüklenen dosyalar, ayarlar, doküman arama dizini) `backups/open-webui-YYYYMMDD-HHMMSS.tar.gz` olarak arşivler ve son 14 yedeği tutar. Tutarlı kopya için Open WebUI yedek süresince durdurulur (genelde bir dakikadan kısa). Modeller yedeğe girmez; `download-models.sh` ile yeniden indirilebilirler.

Her gece 02:00'de çalıştırmak için `crontab -e`:

```
0 2 * * * /opt/kurum-ai/scripts/backup.sh >> /var/log/kurum-ai-backup.log 2>&1
```

(`/var/log` yazılamıyorsa log yolunu değiştirin veya root crontab'ı kullanın.) `backups/` klasörünü düzenli olarak cihaz dışındaki bir diske/NAS'a kopyalayın; cihaz arızalanırsa yedek de gider.

**Geri yükleme:**

```bash
cd /opt/kurum-ai
docker compose -f compose.prod.yml stop open-webui
docker compose -f compose.prod.yml run --rm --no-deps -v "$PWD/backups:/backup" --entrypoint sh open-webui \
  -c 'rm -rf /app/backend/data/* && tar xzf /backup/open-webui-YYYYMMDD-HHMMSS.tar.gz -C /app/backend/data'
docker compose -f compose.prod.yml start open-webui
```

### 10. LDAP / Active Directory ile giriş

Varsayılan olarak kapalıdır. Açmak için `.env`'de:

| Değer | Örnek | Açıklama |
|---|---|---|
| `ENABLE_LDAP` | `true` | |
| `LDAP_SERVER_HOST` | `dc01.kurum.local` | Etki alanı denetleyicisi |
| `LDAP_SERVER_PORT` | `636` | LDAPS |
| `LDAP_USE_TLS` / `LDAP_VALIDATE_CERT` | `true` / `true` | |
| `LDAP_CA_CERT_FILE` | `/certs/kurum-ca.pem` | Kurum kök CA'sı (dosyayı `certs/` klasörüne koyun) |
| `LDAP_APP_DN` / `LDAP_APP_PASSWORD` | `CN=svc-ai,OU=...` | Kullanıcı aramak için salt-okunur servis hesabı |
| `LDAP_SEARCH_BASE` | `OU=Kullanicilar,DC=kurum,DC=local` | |
| `LDAP_SEARCH_FILTERS` | `(memberOf=CN=AI-Kullanicilari,OU=Gruplar,DC=kurum,DC=local)` | Opsiyonel: yalnızca bu grup girebilir |
| `LDAP_ATTRIBUTE_FOR_USERNAME` | `sAMAccountName` | Kullanıcının giriş adı |
| `LDAP_ATTRIBUTE_FOR_MAIL` | `mail` | AD'de e-posta alanı dolu olmalı |

- `.env`'deki LDAP ayarları **yalnızca ilk açılışta** okunur. Sistem kurulduktan sonra LDAP'ı açmak veya değiştirmek için: **Yönetici Paneli → Ayarlar → Genel → LDAP**.
- Open WebUI etki alanı denetleyicisine `frontend` ağı üzerinden ulaşır. Güvenlik duvarında cihazdan DC'ye 636/TCP çıkışına izin verin (kontrol listesi, madde 1).
- LDAP açıkken de yerel yönetici hesabı çalışır; LDAP arızasında bu hesapla girilebilir.

---

## Dışarıya kapalılık kontrol listesi

Hedef: çalışma sırasında hiçbir bileşen internete çıkmaz; kurum ağından yalnızca HTTPS ile Caddy'ye erişilir.

### 1. Güvenlik duvarı (asıl koruma)

Uygulama ayarları "kendiliğinden dışarı bağlanma"yı kapatır, ama **garanti ağ seviyesindeki kuraldır.** Kurum güvenlik duvarında AI cihazının IP adresi için:

| Yön | Kaynak → Hedef | Port | Karar |
|---|---|---|---|
| Giriş | Kurum ağı → cihaz | 443/TCP, 80/TCP | İzin (80 yalnızca HTTPS'e yönlendirir) |
| Giriş | Yönetim bilgisayarları → cihaz | 22/TCP | İzin (SSH, yalnızca bilgi işlem) |
| Giriş | Diğer her şey | | **Engelle** |
| Çıkış | Cihaz → kurum DNS / NTP | 53, 123 | İzin |
| Çıkış | Cihaz → etki alanı denetleyicisi | 636/TCP | İzin (yalnızca LDAP açıksa) |
| Çıkış | Cihaz → **internet** | tümü | **Engelle** |

⚠️ **Cihazın kendi `ufw` kuralları container trafiğini durdurmaz.** Docker kendi iptables kurallarını ekler; container'ların çıkış trafiği ufw'nin OUTPUT kurallarından geçmez. Bu yüzden çıkış engeli **kurum güvenlik duvarında** yapılmalıdır. Cihaz üzerinde ek önlem isteniyorsa Docker'ın `DOCKER-USER` zinciri kullanılır.

**Doğrulama** (internet çıkışı kapalıyken hepsi hata vermeli):

```bash
curl -m 5 -sS https://huggingface.co -o /dev/null                                  # cihazın kendisi
docker compose -f compose.prod.yml exec open-webui curl -m 5 -sS https://huggingface.co -o /dev/null
docker compose -f compose.prod.yml exec caddy wget -T 5 -q -O /dev/null https://huggingface.co
docker compose -f compose.prod.yml exec vllm python3 -c "import urllib.request; urllib.request.urlopen('https://huggingface.co', timeout=5)"
```

### 2. Hangi ayar neyi kapatıyor

| Bileşen | Ayar | Ne kapatılır |
|---|---|---|
| Docker ağı | `backend: internal: true` | vLLM'in dışarıyla her türlü bağlantısı (giriş ve çıkış) |
| Docker ağı | vLLM'de `ports` yok | vLLM'e kurum ağından doğrudan erişim |
| vLLM | `VLLM_API_KEY` | API'nin anahtarsız kullanımı |
| vLLM | `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1` | Hugging Face'ten model/tokenizer indirme denemesi |
| vLLM | `TIKTOKEN_ENCODINGS_BASE` | gpt-oss tokenizer dosyalarının internetten indirilmesi |
| vLLM | `VLLM_NO_USAGE_STATS=1`, `DO_NOT_TRACK=1` | stats.vllm.ai'ye kullanım istatistiği gönderimi |
| Open WebUI | `OFFLINE_MODE=true`, `HF_HUB_OFFLINE=1` | Sürüm kontrolü, embedding/reranker/whisper modellerinin otomatik indirilmesi |
| Open WebUI | `RAG_EMBEDDING_MODEL=/models/embedding/...` | Embedding modeli yerel klasörden yüklenir; indirme denenmez |
| Open WebUI | `ENABLE_OLLAMA_API=false`, `OPENAI_API_BASE_URL=http://vllm:8000/v1` | Tek model kaynağı iç ağdaki vLLM |
| Open WebUI | `ENABLE_DIRECT_CONNECTIONS=false` | Kullanıcıların kendi harici API bağlantısını eklemesi |
| Open WebUI | `ENABLE_WEB_SEARCH=false` | Web araması |
| Open WebUI | `ENABLE_COMMUNITY_SHARING=false` | openwebui.com'a paylaşım |
| Open WebUI | `ENABLE_VERSION_UPDATE_CHECK=false` | Güncelleme kontrolü |
| Open WebUI | `SCARF_NO_ANALYTICS`, `DO_NOT_TRACK`, `ANONYMIZED_TELEMETRY=false` | Telemetri |
| Open WebUI | `DEFAULT_USER_ROLE=pending` | Onaysız kullanıcı girişi |
| Caddy | `tls internal` veya dosyadan sertifika | Let's Encrypt/ACME ile dışarıdan sertifika alma |
| Caddy | `ocsp_stapling off` | Sertifikanın OCSP sunucusuna sorgu |
| Caddy | `skip_install_trust` | Container içinde sistem deposuna kök sertifika yükleme denemesi |

**Yönetici Paneli'nde kontrol edin** (bu ayarlar sonradan panelden açılabilir, açılmamalı): Ayarlar → **Bağlantılar**'da yalnızca `http://vllm:8000/v1` olmalı; **Web Araması** kapalı olmalı; **Görseller** (görsel üretimi) kapalı olmalı; **Araçlar / Fonksiyonlar** altında dışarı bağlanan araç olmamalı. Açık olsalar bile güvenlik duvarı bağlantıyı keser, ama kullanıcı hata görür.

### 3. Kontrollü güncelleme prosedürü

Güncellemeler plansız yapılmaz; yılda birkaç kez, bakım penceresinde:

1. **Değerlendirme:** Yeni sürümün sürüm notlarını okuyun ([Open WebUI](https://github.com/open-webui/open-webui/releases), [NGC vLLM](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm), [Caddy](https://github.com/caddyserver/caddy/releases)). Özellikle kaldırılan/adı değişen ortam değişkenlerine bakın.
2. **Yedek:** `bash scripts/backup.sh` ve `cp .env .env.bak`.
3. **Sürüm:** `.env`'de ilgili sürüm değerini değiştirin (`WEBUI_VERSION`, `VLLM_VERSION`, `CADDY_VERSION`). `latest` kullanmayın.
4. **İndirme penceresi:** İnternet çıkışını geçici açın → `docker compose -f compose.prod.yml pull` (model değişiyorsa `bash scripts/download-models.sh`) → çıkışı **kapatın**.
5. **Uygulama:** `docker compose -f compose.prod.yml up -d` → tüm servisler `healthy` olana kadar bekleyin.
6. **Test:** "7. Test" bölümündeki adımlar ve bu listedeki doğrulama komutları.
7. **Geri dönüş (gerekirse):** `.env.bak`'ı geri koyun → `docker compose -f compose.prod.yml up -d` → sorun sürerse yedeği geri yükleyin (bölüm 9). Open WebUI yeni sürümde veritabanını dönüştürebilir; eski sürüme dönüşte **yedeği geri yüklemek gerekir.**

---

## Geliştirme ortamı (cihaz olmadan üretim yığınını deneme)

`compose.dev.yml`, üretim yığınını (`compose.prod.yml`) NVIDIA GPU'lu bir x86 bilgisayarda (ör. Windows + Docker Desktop) çalıştırır. vLLM, gpt-oss, çevrimdışı açılış ve HTTPS zinciri cihaz gelmeden burada denenir. Üretimden farkları:

| | Üretim | Geliştirme |
|---|---|---|
| Proje adı (volume/container önekleri) | `kurum-ai` | `kurum-ai-dev` (pilotla çakışmaz) |
| Caddy portları | 80 / 443 | 8080 / 8443 (`DEV_HTTP_PORT`, `DEV_HTTPS_PORT`) |
| İşlemci mimarisi | ARM64 | x86 (aynı imajların x86 sürümü) |
| vLLM model runner | varsayılan (V2) | V1 (`VLLM_USE_V2_MODEL_RUNNER=0`): Docker Desktop/WSL2'de pinned memory olmadığı için V2 "UVA is not available" hatası verir |
| `VLLM_GPU_MEMORY_UTILIZATION` | 0.6 (128 GB ortak bellek) | 0.9 (24 GB GPU; 0.8'de 128K bağlam için KV cache yetmedi) |

**Kurulum** (`kurum-ai` klasöründe, Git Bash):

```bash
# .env'de Aşama 2 değerleri dolu olmalı; geliştirme için:
#   DOMAIN=localhost   CADDY_TLS=internal   VLLM_GPU_MEMORY_UTILIZATION=0.9 (24 GB GPU)
ollama stop <yüklü-model>                       # GPU belleğini boşaltın
bash scripts/download-models.sh                 # ~40 GB, bir kez
export COMPOSE_FILE="compose.prod.yml;compose.dev.yml"   # Linux'ta ayraç ":" 
docker compose up -d
docker compose ps
```

Arayüz: **https://localhost:8443** (Caddy iç CA'sı; tarayıcı uyarısını geçin ya da kök sertifikayı güvenilenlere ekleyin, bkz. Aşama 2 bölüm 5).

`COMPOSE_FILE` ayarlıyken `docker compose` komutları ve `scripts/backup.sh` geliştirme projesine uygulanır. Temizlemek için: `docker compose down -v` (yalnızca `kurum-ai-dev` verisi silinir).

**Geliştirme ortamında yapılan testler** (RTX 5090 Laptop 24 GB, Windows 11 + Docker Desktop, NGC vLLM 26.09 / vLLM 0.29, Open WebUI v0.11.4):

| Test | Sonuç |
|---|---|
| `download-models.sh` (imajlar + gpt-oss-20b + bge-m3 + tokenizer) | Başarılı; gpt-oss 13 GB (`original/`, `metal/` atlandı), bge-m3 2.2 GB. Bir kopmada otomatik yeniden deneme çalıştı. |
| vLLM açılışı | ~3.5 dk (ağırlık yükleme ~90 sn), 209K token KV cache |
| vLLM'e anahtarsız istek | 401 |
| vLLM'e host'tan erişim | Yok (port yayınlanmıyor) |
| Türkçe PDF sorusu (Caddy HTTPS → Open WebUI → vLLM) | Doğru cevap, kaynak `[1]`, ~7 sn |
| **İnternet tamamen kapalıyken** (tüm ağlar `internal`) sıfırdan açılış | 3 servis de `healthy` (~160 sn); doküman işleme ve soru-cevap çalıştı; hiçbir container dış adres çözemedi |

## Otomatik doğrulama (GitHub Actions)

`kurum-ai/` altında bir değişiklik push edildiğinde `.github/workflows/kurum-ai.yml` şunları kontrol eder:

- `compose.pilot.yml`, `compose.prod.yml` ve `compose.prod.yml + compose.dev.yml` geçerli mi (`docker compose config`)
- `Caddyfile` her iki sertifika modunda (`internal`, `kurum`) geçerli mi (`caddy validate`)
- Betiklerde hata var mı (`shellcheck`)

Kırmızı bir çalıştırma, değişikliğin cihaza uygulanmaması gerektiği anlamına gelir.
