# Yerel Doküman Asistanı

Dosya yükleyip hakkında soru sorabileceğiniz tek sayfalık arayüz. Tamamen yerel: metin sunucu belleğinde tutulur, modeller Ollama üzerinde çalışır, hiçbir veri dışarı çıkmaz (Ollama'daki `:cloud` modeller listede gösterilmez).

## Gereksinimler

- Node.js 20+ ve pnpm
- Ollama (`ollama serve`) ve şu modeller:
  ```bash
  ollama pull gemma4:12b       # sohbet + tablo doğrulama (görsel)
  ollama pull embeddinggemma   # büyük dosyalarda parça arama (RAG)
  ```
- İsteğe bağlı ama PDF/DOCX için önerilir: Docling (Python 3.10+). Kurulu değilse PDF'lerde yalnızca metin katmanı okunur; görsel olarak gömülü tablolar okunamaz.

## Kurulum ve çalıştırma

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # kontrol fonksiyonlarının testleri
```

Üretim modu: `pnpm build && pnpm start`

### Docling kurulumu (proje içinde ayrı sanal ortam)

```bash
python -m venv .venv-docling
.venv-docling/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128   # NVIDIA GPU; CPU için --index-url'i kaldırın
.venv-docling/Scripts/python -m pip install docling
```

Linux/macOS'ta `Scripts/python` yerine `bin/python`. İlk çalıştırmada Docling ve OCR modelleri bir kez indirilir; sonrasında internet gerekmez. Global Python'daki torch/torchvision sürümleriyle çakışmaması için ayrı ortam kullanılıyor.

## `.env.local` değişkenleri (hepsi isteğe bağlı)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama adresi |
| `DEFAULT_MODEL` | `gemma4:12b` | Açılışta seçili sohbet modeli |
| `NUM_CTX` | `16384` | Bağlam penceresi (token). gemma4 kayan pencereli dikkat kullandığı için bellek neredeyse artmıyor (RTX 5090'da 64k: 9,2 GB, 128k: 9,5 GB, 256k: ~8,3 GB). Bu makinede `131072` kullanılıyor (~380 bin karakter) |
| `EMBED_MODEL` | `embeddinggemma` | Bağlama sığmayan dosyalarda parça arama modeli |
| `VISION_MODEL` | `gemma4:12b` | Görsel tabloların ikinci okuması için görsel model |
| `VISION_VERIFY` | `true` | `false` yapılırsa ikinci okuma atlanır (hızlı ama doğrulamasız) |
| `DOCLING_PYTHON` | `.venv-docling/Scripts/python.exe` | Docling kurulu Python yolu |
| `DOCLING_OFFLINE` | `true` | Docling'i çevrimdışı modda çalıştırır (`HF_HUB_OFFLINE=1`). Modeller önceden indirilmiş olmalı; ilk kurulumda bir kez `false` yapın ya da aşağıdaki kapalı ağ adımlarını izleyin |

## Desteklenen dosyalar

PDF, DOCX (eski `.doc` yok), XLSX / XLS / CSV (her sheet Markdown tablo olarak), TXT / MD. Dosya başına en fazla 25 MB. UTF-8 okunamayan TXT/CSV dosyaları Windows-1254 (Türkçe) olarak okunur.

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

- `POST /api/upload`: NDJSON akışı döner (`progress` olayları, ardından `done` veya `error`).
- `GET /api/upload`: kayıtlı dosyaların listesi. `DELETE /api/upload?id=…`: dosyayı siler.
- `POST /api/chat`: cevap metni akış olarak gelir. Arada `\u001d…\u001d` ilerleme satırları olabilir; sonunda `\u001e` ayıracı ve ardından JSON (mod, kaynaklar, doğrulanamayan sayılar) gelir. `scope: "all"` sorunun bütünü gerektirdiğini bildirir.
- `GET /api/models`: sohbet modelleri; embedding, whisper ve bulut modelleri filtrelenir. Arayüz bunu 15 saniyede bir yoklayarak Ollama'nın açık olup olmadığını izler.

Kısayollar: Enter gönderir, Shift+Enter yeni satır ekler, Esc cevabı durdurur.
