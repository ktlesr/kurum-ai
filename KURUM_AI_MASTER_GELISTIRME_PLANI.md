# KURUM AI — ANA ÜRÜN, MİMARİ VE GELİŞTİRME PLANI

> **Sürüm:** 1.0 — 27 Ekim 2026  
> **Kaynak depo:** https://github.com/ktlesr/kurum-ai  
> **Hedef çalışma düzeni:** VS Code + Claude Code (uygulayıcı) + Codex (bağımsız denetçi)  
> **Durum:** Tasarım kararı / uygulanacak iş paketleri. **Kodun tamamının denetlendiği veya gereksinimlerin uygulandığı anlamına gelmez.**

## 0. BAĞLAYICI ANA TALİMAT

Bu metin, mevcut `kurum-ai` projesini koruyarak üretim kalitesinde bir ürüne dönüştürmek için tekil ürün ve teknik gereksinim belgesidir. Mevcut çalışan fonksiyonlar, model entegrasyonları, testler ve NVIDIA DGX Spark üzerinde kurulmuş servisler **kaybedilmeyecek**. Sıfırdan yazım ancak açık teknik gerekçeyle ve kullanıcı onayıyla değerlendirilebilir.

**Temel ürün ilkesi:** *Arka planda kapsamlı, önde sade.* Kullanıcı belge analizi, sohbet, görsel, ses ve video/reels üretimini sezgisel bir arayüzde yapar; model, OCR, token, iş kuyruğu ve GPU ayrıntıları varsayılan olarak gizli kalır.

**Öncelik sırası:** (1) güvenlik ve veri kaybını önleme, (2) mevcut işlevleri koruma, (3) kullanıcıya ait yerel kalıcılık, (4) doğru kaynaklı belge analizi, (5) iyi arayüz, (6) medya üretimi, (7) performans ve ileri yetenekler.

## 1. İNCELEME KAPSAMI, GERÇEKLER VE DOĞRULAMA YÜKÜMLÜLÜĞÜ

27.10.2026 itibarıyla GitHub üzerindeki depo kökü, README, `package.json`, `AGENTS.md`, `CLAUDE.md` incelenmiştir. **Tüm kaynak dosyaları çalıştırılarak test edilmemiştir.** README'deki davranışlar, uygulamada ayrıca test edilmeden garanti kabul edilmez.

### 1.1 Depoda doğrulanan başlangıç noktaları

- Next.js 16.3.6, React 19.2.8, TypeScript, Tailwind CSS 4, pnpm. `package.json` adı `localdocs`, sürümü 0.1.0.
- `pnpm build`, `pnpm lint`, `pnpm test` scriptleri; `pnpm test` mevcut durumda `lib/checks.test.ts` çalıştırıyor.
- README'ye göre Ollama modelleri `gemma4:12b` ve `embeddinggemma`; opsiyonel Docling; PDF, DOCX, XLS/XLSX, CSV, TXT, MD; kaynak sayfa, görsel tablo ikinci okuması, eşik ve maksimum kontrolleri.
- README'ye göre sunucuda `.cache/` işleme önbelleği ve `.cache/docs/` kalıcı yükleme alanı; yeni çok kullanıcılı yerel saklama hedefine uygun şekilde yeniden ele alınmalı.
- `CLAUDE.md` içeriği `@AGENTS.md`. `AGENTS.md`, Next.js sürüm değişikliklerinde yerel kurulumun `node_modules/next/dist/docs/` rehberlerine uyulmasını istiyor. Bu kural korunmalı.
- Kök dizinde `app`, `lib`, `public`, `scripts`, `kurum-ai` adlı ayrı dizin var. İç içe `kurum-ai` dizininin rolü incelenmeden silinmemeli veya monorepo varsayımı yapılmamalı.
- `package.json` içinde SheetJS harici CDN tarball bağımlılığı vardır; lisans, dağıtım, güvenlik ve build tekrarlanabilirliği kontrol edilmelidir.

### 1.2 Değişiklik öncesi zorunlu repo denetimi

Claude ilk aşamada **kod değiştirmeden** şunları kayda alsın:

1. `git status`, mevcut branch, commit SHA ve temiz/dirty working tree.
2. Gerçek dosya ağacı, tüm API rotaları, istemci bileşenleri ve sunucu servisleri; `kurum-ai/` alt dizininin içeriği.
3. Mevcut veri akışları: yükleme → Docling → vision → cache → RAG → sohbet → dosya silme.
4. Kullanıcı izolasyonu, kimlik doğrulama, CORS/CSRF, upload limitleri, geçici dosya kullanımı, loglar, ortam değişkenleri ve gizli anahtar erişimi.
5. Test/CI kapsamı; Node ve ARM64 bağımlılıklarının kullanılabilirliği; Next.js 16 uyumu.
6. Eski veri biçimi ve geçiş planı: `.cache/docs` içeriği hiçbir şekilde otomatik silinmesin.
7. Gerçek çalışma ve üretim ortamında Ollama/Docling erişim modelleri.
8. Güvenlik açıklarını **bulgu / olası risk / doğrulanmış davranış** biçiminde ayırsın.

**Çıktı:** `docs/audits/BASELINE_AUDIT.md` ve `docs/audits/BASELINE_TESTS.md`; bu belgeler ve Codex incelemesi onaylanmadan büyük mimari refaktör başlamasın.

## 2. ÜRÜN VİZYONU, PERSONALAR, MODÜLLER

Kurum AI, çalışanların metin, doküman, görsel, ses ve videolar üzerinde aynı oturum/çalışma alanında güvenle çalışabildiği, kurumun kendi AI işlem altyapısından yararlanan, **kişisel çalışmaları varsayılan olarak kullanıcı cihazında saklayan** platformdur.

**Personalar:** (1) normal kurum çalışanı, (2) proje/rapor uzmanı, (3) kurumsal iletişim ve sosyal medya çalışanı, (4) sistem yöneticisi.

**Birincil modüller:**

1. **AI Asistan:** genel sohbet, kaynağa dayalı soru cevap, konuşma geçmişi.
2. **Belgeler:** yükleme, görüntüleme, OCR, çıkarım, RAG, karşılaştırma, sayısal kontroller.
3. **Görsel Stüdyo:** afiş, sosyal medya görseli, görsel varyasyonları, kaynak görsellerle düzenleme.
4. **Video Stüdyo:** 9:16 Reels/Shorts, 16:9 tanıtım, 1:1 içerik; şablon tabanlı video, ardından üretken kısa klipler.
5. **Ses Stüdyosu:** transkripsiyon, altyazı, yerel Türkçe TTS, sesli anlatım.
6. **Çalışmalarım:** yerel projeler, medya taslakları, dosya koleksiyonları, arama, dışa/içe aktarma.

**Ürün sınırı:** İlk sürümde merkezi ortak dosya havuzu, gerçek zamanlı çok kullanıcılı eşzamanlı düzenleme, kurum içi sosyal ağ, karmaşık video NLE veya sınırsız üretken video sözü verilmeyecek. İlgili modüllerin mimari uzantı noktaları hazırlanacak.

## 3. TASARIM SİSTEMİ VE UX

### 3.1 Tasarım ilkeleri

- Kurumsal, premium, sıcak ama ciddi. Açık tema varsayılan; koyu tema destekli. Lacivert `#14263D`, mavi `#2E5E8C`, açık gri `#EDF3F8`, beyaz, az miktarda yeşil `#1B956F` öneri paleti; kontrast WCAG AA ile doğrulansın.
- Shadcn/ui ve Radix tabanlı erişilebilir kontrol bileşenleri tercih edilebilir; mevcut tasarım sistemi incelenmeden yığın değişimi yapılmasın.
- En fazla üç ana bağlam: **sol navigasyon**, **orta çalışma alanı**, ihtiyaç halinde **sağ kaynak/önizleme paneli**.
- Mobilde sol menü çekmece, sağ panel tam ekran; klavye odağı, ekran okuyucu, reduced motion.
- Türkçe arayüz birinci sınıf; hazırlanacak metinler anlaşılır, resmi ama soğuk olmayan dille yazılsın. İleride i18n için yapı hazırlansın.
- Boş durumlar, hatalar, yükleniyor/iptal/başarılı bildirimleri; gözle görülür geri bildirim; skeleton/loading; klavye kısayolları; sürükle-bırak.
- Teknik ayarlar kullanıcıya dayatılmasın: **Otomatik** varsayılan; isteğe bağlı **Hızlı** ve **Derin analiz**. Bunlar yalnızca etiket değil, gerçek test edilmiş işlem profillerine bağlanmalı.
- Görsel animasyonlar ölçülü; hiçbir gereksiz dashboard, ağır landing animasyonu veya ayar kalabalığı eklenmesin.

### 3.2 Ana ekran

İlk açılış: selamlama + geniş sohbet kutusu, belge ekle, hazır işler için 4-6 kısa öneri: `Özetle`, `Karşılaştır`, `Rakamları kontrol et`, `Şartları çıkar`, `Metni düzenle`, `İçerik oluştur`.

Sol panel: Yeni sohbet, arama, geçmiş, Belgelerim, koleksiyonlar, Görsel/Video/Ses stüdyosu, Çalışmalarım, Ayarlar. Sağ panel: kaynak PDF/Excel sayfası, görsel/video önizlemesi. Alttaki composer desteklenen türlere uygun dosya çipleri göstersin.

### 3.3 Ekran ve durum gereksinimleri

`/` ana sohbet, belgeler, koleksiyon detayı, kaynak görüntüleyici, proje/çalışma listesi, görsel stüdyo, video stüdyo (sihirbaz + storyboard + preview), ses stüdyo, ayarlar/gizlilik, güvenli giriş, yönetici alanı. Gerçek dosya/sayfa dizilimleri ilk kod denetiminden sonra netleştirilsin; rota isimleri öneridir.

Her ekranda: empty/loading/success/error/cancel/retry, offline veya işlem servisi kapalı durumu, mobil görünüm, açıklayıcı hata ve erişilebilirlik testleri olmalı.

## 4. VERİ GİZLİLİĞİ VE YEREL-KALICI MİMARİ

### 4.1 Değişmez ilke ve dürüst ürün beyanı

- **Kalıcı kişisel belge, sohbet geçmişi, koleksiyon ve proje verileri varsayılan olarak kullanıcının cihazındadır.**
- **İşleme DGX Spark üzerinde yapılabilir:** Dosya/veri işlem sırasında HTTPS ile sunucuya aktarılır; bu nedenle "hiçbir veri bilgisayardan çıkmaz" iddiası YANLIŞTIR. Doğru beyan: **"Kalıcı çalışma alanı cihazınızda; AI işlemesi kurum sunucusunda; harici bulut AI servisine belge gönderilmez."** Gerçek ağ davranışıyla doğrulanmalı.
- Sunucu işlem için yalnızca gerekli içeriği, işlem süresince ve mümkün olduğunca kısa süre tutar; geçici dosya ve kullanıcıya ait veriler TTL ile silinir; crash/restart sonrası temizlik işlemi bulunur.
- Kullanıcılar birbirlerinin kayıtlarını, dosyalarını, işlerinin durumunu ya da geçici çıktıları hiçbir API üzerinden göremez.
- Tarayıcıdaki veriler otomatik olarak şifrelenmiş sayılmaz. Şifreleme tehdit modeline göre tasarlansın; salt tarayıcı kaydetmesi kesin güvenlik garantisi değildir.

### 4.2 İstemci verisi

- **IndexedDB:** sohbetler, mesajlar, başlıklar, koleksiyonlar, mesaj-belge ilişkileri, belge meta verileri, arama indeksleri ve proje manifestleri.
- **OPFS:** dosyalar, metin çıkarımları, thumbnail, küçük medya ve cache. Büyük medya kullanıcı seçtiği yerel klasöre kaydetme / dışa aktarma yoluyla yönetilsin; File System Access API desteklenmeyen tarayıcılarda indirme alternatifi olsun.
- Uygulama için versiyonlu `localSchemaVersion`, atomik migrasyon, transaction, kota/hata yönetimi, işlerin yarıda kalması, yedek import/export kontrolleri.
- `navigator.storage.persist()` uygunluk kontrolü; depolama alanı gösterimi ve açık yedek hatırlatmaları.
- Sohbet arama, pin, rename, sil/geri al penceresi, yerel projeler, belge tekrar kullanım, cihazlar arası otomatik senkron olmadığına dair açık anlatım.
- Varsayılan **cihazlar arası eşitleme YOK**. Yedek dosyası kullanıcının seçtiği yerde; opsiyonel şifreli yedek (anahtar yönetimiyle). Kullanıcının şifresini saklama ve kurtarma süreci güvenlik tasarımı gerektirir.
- Çoklu sekme kilitleme/senkron; IndexedDB race, OPFS dosya bütünlüğü ve tarayıcı kota sınırı testleri.
- Web geliştirici konsoluna hassas içerik yazılmamalı; XSS tehdidi yerel verileri açığa çıkarabileceğinden güçlü CSP/sanitizasyon gerekir.

### 4.3 Sunucu verisi ve kullanıcı yönetimi

- PostgreSQL yalnızca gerekliyse hesap/oturum/rol/konfigürasyon/iş durumu için; varsayılan sohbet veya belge içeriği için değil.
- Kimlik doğrulama/SSO/OIDC veya self-hosted güvenli oturum. Anonim açık upload/chat endpointi üretimde kapalı.
- Her iş için `userId`, `jobId`, `requestId`, `expiresAt`, `status`; doğrudan object reference tahminiyle veri erişimine izin verilmez.
- Kuyruk ve geçici objeler kullanıcıya özel, rastgele adlandırılmış, kök dışı ve erişim kontrollü. Zaman sınırları, işlem sonrası temizleme ve hata kurtarma.
- `.cache/docs` ve eski önbellek için **veri kaybı olmadan migrasyon**: eski içeriği otomatik silme; elle onaylı ve yedekli dönüşüm. Eski kullanıcıya ait olmayan veriyi otomatik tüm kullanıcılara sunma.
- Günlüklerde prompt, cevap, PDF içeriği, oturum tokenı, kimlik belgesi ve kişisel veri yok.
- Açık kullanıcı rızası olmadan harici telemetri/analitik/AI API'si yok.

### 4.4 Veri yaşam döngüsü

Dosya seçildi → yerel kalıcı kopya doğrulandı → kullanıcı görevi başlattı → kimlik/yetki/kota doğrulandı → TLS ile sunucuya işlendi → izole geçici alan → Docling/model → kaynaklı yapılandırılmış yanıt → istemcide kalıcı saklama → sunucu geçici içerik temizliği; her aşamanın hata halinde davranışı belgelenmeli.

## 5. BELGE MOTORU VE RAG

### 5.1 Mevcut kabiliyetleri KORU

- PDF/DOCX/XLS/XLSX/CSV/TXT/MD okuma; Türkçe kodlama; Docling OCR; çoklu sayfa tablolar; sayfa/sheet referansları; ikinci görsel okuma; `lib/checks.ts` kontrolleri; mevcut progres mesajları.
- Test koruması olmadan parser/refaktör yapma; 25 MB mevcut dosya limiti artışı ancak RAM/kota/DoS riski analizi ile.

### 5.2 İyileştirmeler

- Belgeleri sayfa/bölüm/tablo/hücre ayrımlarıyla tipli, versiyonlu `DocumentArtifact` şemasına dönüştür; belgenin orijinal konumunu koru.
- OCR gerekli mi otomatik algıla; yanlış karakter, tablo kayması, görsel doğrulama uyuşmazlığı durumlarını kalite işaretleriyle açıkla.
- Sayısal kontroller ve hesaplar mümkün olduğunda deterministik kodla; yüzde, eşik, toplama, tarih, para birimi, ondalık ayırıcı, negatif sayı, dipnot ve Excel formülleri için test oluştur.
- Hibrit anahtar kelime + embedding arama; bölüm farkındalıklı chunking; seçmeli reranking; uygun olduğunda tam metin, aksi durumda RAG/çoklu pencere. Her aşama hız/doğruluk ölçümleriyle etkinleştirilmeli.
- Model çağrılarında kaynak izlenebilirliği: cevap cümlesi → kaynak ID → belge → sayfa/sheet → alıntı aralığı/bounding box. Kaynak bulunamayan iddia açık etiketlensin.
- İki belge karşılaştırması: sözleşme/çağrı şartı/bütçe/madde bazında fark tablosu; rakam-kaynak bağlantıları.
- Bilmediğinde söyle, eksik/çelişkili bilgi için açıklama iste; otomatik uydurma testleri.
- Kullanıcı kaynak PDF sayfasına veya Excel sheet/hücreye tıklayarak gidebilsin; kaynak görüntüsü kullanıcıya ait yerel dosyadan açılsın.
- Sunucuda kullanıcılar arası paylaşılan ham içerik cache'i **YOK**. Cross-user dedup ancak kesin izolasyon ve gizlilik denetimi sonrasında.

### 5.3 Kabul testleri

- Taranmış Türkçe PDF, gömülü ve görüntü tabloları, DOCX tabloları, çok sayfalı tablo, çok sheet XLSX, CSV Windows-1254, malformed dosyalar.
- Bütçe yüzdeleri ve toplamları deterministik olarak yeniden hesaplanır; hatalı hücre veya çelişkili okuma açık gösterilir.
- En azından 20 gerçekçi ve izinli Türkçe belge senaryosu ile kaynak doğruluğu test kümesi; sahte sayfa numarası kabul edilmez.
- Aynı veriyle diğer kullanıcı izolasyon testi; işlem iptali ve server restart testi.

## 6. GÖRSEL STÜDYO

Özellikler: metinle görsel üretme, mevcut görseli düzenleme, boyutlandırma, arka plan ayırma/yenileme, sosyal medya şablonları, kurumsal marka kiti, logoyu bozmadan konumlandırma, Türkçe başlıkları tercihen deterministik render etme, varyasyon/önizleme, PNG/JPEG/WebP/SVG (SVG güvenli sanitizasyon), uygun olduğunda yüksek çözünürlük.

Üretken modelin metin yazma zayıflığını önlemek için posterlerde başlık ve logo **ayrı tasarım katmanları** olarak render edilsin. Kullanıcının yüklediği logo değiştirilmesin; ayrı varlık olarak korunmalı. Lisans ve ticari kullanım kısıtları kayıt altına alınmalı.

### 6.1 Mimari karar (29.10.2026, açık kaynak inceleme sonrası)

İncelenen projeler: [presenton](https://github.com/presenton/presenton) (Apache-2.0, AI sunum üretici) ve [HyCanvas](https://github.com/hyscaler/HyCanvas) (AGPL-3.0, açık kaynak Canva alternatifi). **İkisi de entegre edilmez, kodları kopyalanmaz.**

- **HyCanvas:** kodu AGPL-3.0; herhangi bir parçasını kopyalamak Kurum AI'ı AGPL yapar. Değiştirilmeden ayrı servis olarak çalıştırılabilir. Ancak bu ikinci bir kullanıcı/oturum sistemi ve ikinci bir veritabanı getirir, OIDC sağlayıcımız yok, yazı tipleri dış CDN'den (fonts.bunny.net) yüklenir, yerel `http://vllm` adresi reddedilir, WebP çıktısı yoktur. Proje 1.0 öncesi ve iki kişilik. İleride tam tasarım editörü gerekirse yalnızca değiştirilmemiş ayrı servis olarak yeniden değerlendirilir.
- **presenton:** analitik (Mixpanel) ve topluluk çağrıları varsayılan açık. Webhook ve URL indirmede SSRF yüzeyi var. PPTX/PDF dışa aktarma motoru kapalı kaynak (`@presenton/export-core`). Arayüz yalnızca İngilizce ve sadece 16:9 sunum üretir.
- **Ödünç alınan fikir (kendi kodumuzla):** presenton'un yaklaşımı. Şablon, mutlak konumlu katmanlardan oluşan bir JSON'dur. Model yalnızca şemaya uygun metin içeriğini doldurur. Çizim deterministik koddur ve modele bırakılmaz. HyCanvas'tan da yalnızca fikir alınır: marka kilidi (logo ve renklerin değiştirilmesini engelleme) ve sunucusuz dışa aktarma.

**Görsel Stüdyo v1 tasarımı:**

- Şablon JSON'u → SVG (tek çizim kaynağı) → tarayıcıda canvas üzerinden PNG/JPEG/WebP; SVG doğrudan indirilir.
- Yazı tipi kurum içinden sunulur (Geist, OFL; Türkçe harflerin tamamı mevcut, ₺ yok → "TL") ve SVG'ye gömülür.
- Logo ve fotoğraflar `<image>` olarak gömülür. En-boy oranı korunur, logo kırpılmaz ve renklendirilmez. Görsel bağlamında script çalışmaz.
- Model (vLLM) yalnızca başlık, alt metin ve kısa metinleri JSON olarak önerir. Uzunluklar sunucuda sınırlanır ve kullanıcı her alanı düzenleyebilir.
- Kullanıcının görselleri ve marka kiti tarayıcıda kalır, sunucuya yalnızca metin isteği gider.
- **Görüntü üretim modeli (diffusion) v1'de yoktur.** Gemma 4 görsel okur ama üretemez. Arka plan kullanıcı fotoğrafı ya da marka renkleri/degradesidir. Metinden görsel üretimi (ComfyUI benzeri ayrı servis) FAZ 7 değerlendirmesine bağlıdır.

## 7. VIDEO / REELS STÜDYOSU

### 7.1 Birinci yöntem — deterministik şablonlu video (öncelik)

- Girdiler: metin, yerel belge, fotoğraf, logo, mevcut video, ses, kurum renkleri ve kullanıcı promptu.
- Profiller: 9:16 Reels/Shorts; 16:9 tanıtım; 1:1 sosyal medya. 15/30/60/90 sn şablonları hedef; gerçek çıktı uzunluğu medya/senaryoya göre doğrulanır.
- Süreç: doküman bilgisi çıkar → kaynak doğrula → storyboard taslağı → kullanıcı onayı → sahneleri oluştur → TTS + isteğe bağlı müzik → altyazı → render → önizleme → düzenleme → MP4 dışa aktar.
- Şablonlar: duyuru, etkinlik özeti, proje tanıtımı, sosyal medya bilgilendirmesi, başarı hikâyesi, rapor özeti, fotoğraf montajı.
- Video zaman çizelgesi **basit**: sahne sürükle-bırak, metin değiştir, trim, geçiş, altyazı, logo, müzik ses düzeyi; ileri kurgu aracı yaratma.
- React tabanlı kompozisyon için **Remotion değerlendirme adayıdır**, ancak lisans/ticari şartlar ve aarch64/Chromium uyumu doğrulanmadan zorunlu bağımlılık kabul edilmez. FFmpeg temel pipeline adayıdır.

### 7.2 İkinci yöntem — üretken görüntüden videoya / metinden videoya (aşamalı)

- ComfyUI benzeri ayrı servis / worker değerlendirilir; belirli model seçimi lisans, VRAM/unified memory, GB10 ARM64/PyTorch CUDA 13 uyumu, çıktı süresi, eşzamanlılık ve benchmark sonrasına bırakılır.
- Kısa AI klipler video projesinin bir *sahnesi* olabilir; tüm 90 saniyeyi tek seferde modelin üreteceği varsayılmamalı.
- Render kuyruğu, cancel/retry/progress, geçici dosya temizliği, GPU kaynak planlayıcı, disk alanı ve job timeout.
- Model ve efekt özellikleri desteklenmiyorsa arayüz açıkça belirtir, uyumsuz seçenek göstermez.
- Deepfake/kimlik taklidi, üçüncü kişi hakları, telif, yüz/ses kullanımı için uygun onay ve güvenlik akışları.

### 7.3 Ses stüdyosu

- Yerel TTS (Türkçe kalite değerlendirmesi, lisans ve ARM64 desteği), yerel ASR, zaman damgalı transkript, SRT/VTT, altyazı tasarımı, dil/ton ve telaffuz sözlüğü, ses seviyesi normalizasyonu.
- Ses klonlama ilk sürüm kapsamı DIŞINDA; açık rıza ve kurumsal politika olmadan etkinleştirme.
- Dış ses servislerine veri gönderilmesi varsayılan olarak yasak; açılacaksa ayrı opt-in ve veri işleme bildirimi.

### 7.4 Medyada yerel saklama

Kaynak medya ve nihai çıktı için yerel OPFS/klasör kaydetme; büyük videolarda kullanıcı bilgisayarına açık "kaydet" akışı. Render için kurum sunucusuna geçici dosya yüklenir. Render tamamlanınca otomatik temizleme ve gizliliği doğrulayan entegrasyon testi gerekir. İptal edilmiş veya başarısız işlerde artık dosya bırakma.

### 7.5 Video kabul testleri

- 9:16, 16:9, 1:1; gerçek çözünürlük, FPS, süre, ses, senkron ve Türkçe altyazı doğrulanmalı.
- Belgeden üretilen videoda her iddia senaryoda doğrulanmış kaynakla eşleşmeli; kullanıcı onaylamadan kesin video üretimine başlanmamalı.
- İşlem iptali GPU ve dosya kaynaklarını serbest bırakmalı.
- Sunucu restart'ında job kalıcılığı veya kontrollü fail/retry; kullanıcı verisi sızmamalı.
- 2 eşzamanlı video işi ile belgesel sorgu açıldığında starvation önlenmeli; cihaz limitine uygun test.

## 8. ÜRETİM DAĞITIMI: NVIDIA DGX SPARK + DOKPLOY

Bilinen bağlam: DGX Spark GB10 ARM64 Ubuntu; Ollama ve Docling CUDA kurulumu; Dokploy/Traefik mevcut; `cp.ekutlu.com` ve WAN `95.0.107.17`, NAT hedefi `10.43.1.26`, HTTPS dış erişimi test edildi. **Yapılacak değişiklikler canlı çalışan servisleri ve kurum ağını bozmayacak.**

- `localhost:11434` Docker konteyneri açısından host Ollama değildir. Private bridge ağ, host gateway veya yalnızca iç IP üzerinden erişim seçenekleri saldırı yüzeyi/çalışabilirlik değerlendirmesinden sonra seçilmeli. Ollama `0.0.0.0` üzerinden doğrudan WAN'a yayımlanmamalı.
- Docling mevcut `/opt/yerel-dokuman-asistani/.venv-docling` ortamında GPU çalışabiliyor; bunu Docker içinden doğrudan kullanmak güvenli/taşınabilir varsayılmamalı. Ayrı host worker veya GPU destekli ARM64 konteyner yaklaşımı test edilerek seçilmeli.
- `DOCLING_PYTHON` Linux yolu, model offline cache'i, izinler, volume erişimi, HF_HUB_OFFLINE gereksinimleri açıkça yönetilmeli.
- Ollama, Docling, medya/ComfyUI/FFmpeg aynı GPU ve belleği paylaşır. İş türü başına concurrency/admission control; sıcak model bellek kullanımı, GPU durum ve kernel uyumluluk ölçümleri zorunlu.
- Servislerin startup/healthcheck/restart, secrets, persistent volumes, DB backup, migration, rollback, güvenli SSL ve proxy header ayarları belgelenmeli.
- `cp.ekutlu.com` **Dokploy yönetim paneline** ayrılmış; Kurum AI için farklı hostname kullan (örn. `ai.ekutlu.com`), doğru DNS ve HTTPS ile. Yönetim panelini uygulama rotası olarak kullanma.
- Firewall/NAT/port değişikliği otomatik yapılmaz; canlı Dokploy, Traefik, PostgreSQL ve Ollama için rastgele restart yok.
- Dış internet erişimi, kullanıcı auth ve dosya izolasyonu üretim-gate'i geçmeden genel kullanıma açılmaz.

## 9. GÜVENLİK, UYUM, GÖZLEMLENEBİLİRLİK

Zorunlu tehdit modeli: kötü niyetli dosya, Zip bomb, bozuk PDF, OCR exploit, prompt injection, XSS/HTML Markdown, SSRF, path traversal, IDOR, session fixation, CSRF, brute force, API abuse, medya dönüştürücü zafiyeti, dizin enjeksiyonu, temp veri kalıntısı, veri erişimi ve GPU kaynak tüketimi.

Kontroller:

- Auth + sunucu taraflı her uç noktada authorization; güvenli cookie, session expiration, CSRF, rate limits; yönetici alanı ayrımı.
- Dosya MIME + magic bytes + boyut + içerik limitleri, işlem izolasyonu, CPU/RAM/timeout kotaları, dosya uzantısına kör güvenmeme.
- Harici URL üzerinden içerik çekme varsa allowlist/SSRF engeli; yoksa özellik varsayılan kapalı.
- Prompt injection: belge içerikleri talimat değil **veri**. Modelin terminal, ağ, dosya veya DB yazma yetkisi varsayılan sıfır.
- Gizli bilgileri istemci bundle'a veya Git'e koyma. Ortam değişkenleri, secret scanning, dependency audit ve lisans taraması.
- CSP, HTML sanitizasyonu, CORS, clickjacking/XFO, TLS, security headers; kütüphanelerin sürüm uyumu.
- Sağlık: model erişimi, queue backlog, işlem süreleri, GPU/disk bellek, disk kapasitesi, OCR/retrieval hata oranları, temp temizleme metrikleri; içeriksiz logging.
- KVKK ve kurum bilgi güvenliği açısından veri işleme envanteri, saklama politikası, kullanıcı aydınlatması kurum tarafından gözden geçirilmeli. "KVKK uyumlu" etiketi hukuki denetim olmadan kullanılmaz.

## 10. TEKNİK ORGANİZASYON VE SINIRLAR

**Mevcut Next.js/React/TypeScript temelini koru.** Altta mantıksal ayrım oluştur:

- `workspace`: frontend, auth UI, local persistence, proje/sohbet yönetimi.
- `document-engine`: ingest, Docling adapter, OCR, normalization, citations, checks.
- `intelligence-engine`: model provider, prompt, retrieval, evaluation, orchestration.
- `media-engine`: storyboard, templates, compositing, TTS/ASR, generative adapters, export.
- `jobs`: durum makinesi, queue, retry, cancel, resource scheduler.
- `shared`: tipler, validasyon, hata sözlüğü, feature flags, veri sözleşmeleri.

Bu **mantıksal sınırlar** öneridir. Fiziksel klasör yapısı mevcut repo haritasından sonra düzenlenir. Gereksiz microservice/monorepo dönüşümü yok.

Tüm API'lerde sürümlü istek/yanıt şemaları, idempotency ve user context. İstemciyle sunucu arasında mesaj tipleri JSON-safe; geçici dosya/stream için gerçek upload stratejisi. Üçüncü taraf bağımlılığı eklemeden önce bakım, lisans, üretim dağıtımı, Node/ARM64 uyumu, saldırı yüzeyi, bundle etkisi belgelenmeli.

## 11. TEST VE KALİTE KAPILARI

### 11.1 Zorunlu otomasyon

- Typecheck, lint, unit, API contract/integration, storage migration, Playwright E2E, accessibility smoke, build.
- React state ve IndexedDB gerçek senaryoları; temiz profil, tekrar açılış, quota exceeded, tarayıcı kapanması, eşzamanlı sekmeler.
- Çok kullanıcılı saldırı testleri; bir kullanıcının diğerinin `jobId/documentId` erişimini sistematik olarak reddetme.
- İş kuyruğu timeout/retry/cancel, crash, temp cleanup, idempotency.
- RAG altın örnekleri: Türkçe rakam, kaynak, tespit yok, çelişkili rapor.
- Video formatları, ses/alttazı ve çoklu işlemde kaynak tüketimi.
- Üretim build ve ARM64 container smoke; olmayan/yanlış AI servisi graceful fail.

### 11.2 Performans hedefleri (ölçülmeden taahhüt değildir)

- İlk etkileşimde arayüz bloklamasız; hızlı açılış için Web Vitals izlenmesi.
- Dosya seçimi ve önizleme, ağır OCR bitmeden kullanılabilir.
- Yüklenen aynı belge gereksiz yeniden işlenmez (doğrulanmış içerik hash/cache stratejisi).
- İşlem süresi önceden kesin vaat edilmez; gerçek ilerleme ve iptal sunulur.
- Arkaplanda medya işi sürerken sohbet/değerli görevlerde makul hizmet seviyesi korunur.
- Test sonuçları GPU/CPU/dosya boyutuyla birlikte benchmark belgesine işlenir.

## 12. AŞAMALI YOL HARİTASI VE BAĞIMLILIKLAR

### FAZ 0 — Envanter, tehdit modeli, baseline (BLOCKER)

- Repo/servis incelemesi, eksik güvenlik bulguları, test baseline, veri ve model akışları, rollback/backup.
- **Çıkış kriteri:** Codex onaylı audit; no-code durum raporu; mevcut test ve build sonuçları.

### FAZ 1 — Güvenli çok kullanıcılı çekirdek (BLOCKER)

- Auth, API authorization, iş izolasyonu, geçici dosya lifecycle, güvenli upload, rate limits, log sanitization.
- **Çıkış:** kullanıcı A/B izolasyon testleri; sızıntı yok; geçici silme başarısı; Codex güvenlik onayı.

### FAZ 2 — Yerel çalışma alanı ve veri göçü

- IndexedDB/OPFS, sohbetler, dosyalar, koleksiyonlar, yerel arama, kota, migrasyon, yedek/geri yükleme.
- **Çıkış:** refresh/restart/sekme kapatma sonucu veri kaybı yok; restore testleri; eski `.cache` verisi yedekli.

### FAZ 3 — Premium arayüz ve belge deneyimi

- Yeni UX tasarım sistemi, erişilebilir responsive shell, PDF/Excel kaynak paneli, hızlı işlemler, streaming status.
- **Çıkış:** gerçek kullanıcı yolculuklarının uçtan uca testleri; mobil ve klavye testleri; eski yetenek regresyonu yok.

### FAZ 4 — Belge zekâsı ve kalite

- Hibrit RAG, kaynak doğrulama, sayısal kontrol, çok belge karşılaştırma, benchmarking.
- **Çıkış:** doğrulanmış golden test sonuçları; belgesiz tahmine karşı kontrol; sayfa/sheet işaretleri doğru.

### FAZ 5 — Görsel stüdyo ve şablonlu medya

- Kurumsal şablonlar, görsel üretimi/düzenleme, storyboard, Remotion/FFmpeg aday testi, basit Reels render.
- İş paketleri (§6.1):
  - **TASK-019:** Görsel Stüdyo v1. Şablon katmanları, 1:1 / 4:5 / 9:16 / 16:9 formatları, marka kiti (renk ve logo, tarayıcıda), AI metin önerisi, PNG/JPEG/WebP/SVG dışa aktarma.
  - **TASK-020:** belgeden afiş/görsel (seçili belgeden kaynaklı metin önerisi).
  - **TASK-021:** şablonlu kısa video (aynı katman modelinden sahne; Remotion/FFmpeg aday testi).
- **Çıkış:** 9:16/16:9/1:1 örnekler; ARM64 production smoke; kullanıcı onay akışı.

### FAZ 6 — Ses, altyazı ve basit video editörü

- Yerel ASR/TTS, zaman damgası, SRT/VTT, kısa storyboard düzenleyici, müzik ve ses, render kuyruğu.
- **Çıkış:** Türkçe ses/alttazı testleri, iptal/yeniden deneme ve yerel kaydetme.

### FAZ 7 — Üretken kısa video ve optimizasyon

- ComfyUI/model değerlendirme, kısa klip render, GPU scheduling, önizleme/kalite seçenekleri, lisans incelemesi.
- **Çıkış:** GB10 gerçek benchmark, memory limits, kuyruk güvenliği, ticari kullanım incelemesi.

**Kural:** Her faz küçük, test edilebilir PR'lara ayrılır. P0 güvenlik ve depolama tamamlanmadan internetten geniş kullanıcı erişimi verilmez. Her faz sonrası Codex incelemesi ve kullanıcı kabulü alınır.

## 13. CLAUDE CODE ↔ CODEX ÇALIŞMA PROTOKOLÜ

### 13.1 Roller

**Claude Code = uygulayıcı**

1. Önce bu dosyayı, mevcut `AGENTS.md`, `CLAUDE.md`, ilgili Next.js 16 yerel docs ve ilgili kaynak kodu oku.
2. Yalnızca kullanıcı tarafından seçilen iş paketi üzerinde çalış.
3. Her değişiklikten önce kapsam, mevcut davranış, risk ve test planını kısa yaz.
4. Mevcut işlevi silme; şema değişikliğine migration; log/veri akışında gizlilik denetimi.
5. Kod+test+belge birlikte; `pnpm test`, typecheck, lint, build ve ilgili e2e testlerini çalıştır; başarısızlıkları gizleme.
6. Sonuç olarak changed files, davranış değişimi, risk, geri alma, test komutu/çıktıları ve PR açıklamasını sun.
7. Codex bulgularını sınıflandırıp düzelt; aynı iş paketinde tekrar denetime gönder.

**Codex = bağımsız reviewer**

1. Varsayılan salt-okunur: Kod düzenleme, commit, push, deploy, veri silme yok.
2. Plan ve kullanıcı kriterlerini, `git diff` ve gerçek test sonuçlarını eşleştir.
3. Riskleri **P0 (güvenlik/veri kaybı), P1 (bloklayıcı işlev), P2 (orta), P3 (iyileştirme)** diye sınıflandır.
4. Gerekçeli, yeniden üretilebilir bulgu: `dosya:satır`, test/repro, etki, önerilen düzeltme.
5. İncele: auth/IDOR, secrets, temp cleanup, IndexedDB migration, container/ARM64, race, retry, prompt injection, source grounding, UX/a11y, performance, regression.
6. Kontrol edilmeyen testleri "çalıştı" diye yazma. Bilinmeyeni bilinmeyen olarak belirt.
7. Karar: **BLOCKED / CHANGES REQUIRED / APPROVED WITH NOTES / APPROVED**.
8. P0/P1 açıkken onay yok. P2/P3 kullanıcı kararına göre takip listesi olabilir.

**Ürün sahibi = karar mercii:** Kapsam ve öncelik değişikliği, veri göçü, canlı servis müdahalesi, harici model, lisans değişikliği ve dağıtım onayı kullanıcıdan alınır.

### 13.2 İş paketinin standart şablonu

```md
# TASK-XXX: Kısa ad
Amaç:
Mevcut davranış ve kanıt:
Kapsam içi / kapsam dışı:
Etki alanı ve dosyalar:
Gizlilik/güvenlik etkisi:
Depolama/veri göçü:
Geriye uyumluluk:
Uygulama yaklaşımı:
Kabul kriterleri (Given/When/Then):
Testler ve gerçek çıktılar:
Rollback:
Claude değişiklik özeti:
Codex bulguları ve karar:
Ürün sahibi onayı:
```

### 13.3 PR kabul kontrol listesi

- [ ] Mevcut işlevler korunuyor, farklar belgelenmiş.
- [ ] Yeni güvenlik açığı veya kullanıcılar arası veri sızıntısı yok.
- [ ] Kalıcı kişisel veriler sunucuya plansız yazılmıyor.
- [ ] Gerektiğinde migrasyon + geri alma + yedek stratejisi var.
- [ ] Typecheck, lint, unit, integration/e2e ve production build sonuçları yazılı.
- [ ] ARM64/GPU etkileri incelendi veya açıkça uygulanabilir değil olarak işaretlendi.
- [ ] Erişilebilirlik, mobil, Türkçe hata metinleri test edildi.
- [ ] Bağımlılık, lisans ve gizlilik etkileri kontrol edildi.
- [ ] Codex P0/P1 bulgusu yok.
- [ ] Kullanıcı onayı olmadan üretim deploy'u yapılmadı.

### 13.4 Canlı sunucu ve Git güvenliği

- Ana dala doğrudan geniş kapsamlı değişiklik yok; feature branch + küçük commit/PR.
- İşlem öncesi ilgili dosyalar, DB, `.cache`, secrets hariç konfigürasyon ve üretim imajı geri dönüş planı.
- Kullanıcı onayı olmadan `rm -rf`, `docker system prune`, `docker service rm`, `systemctl restart docker`, Docker Swarm reset, DB drop, NAT/DNS/firewall değişikliği yok.
- Kullanıcının önceden doğruladığı servisler ve modeller korunur; aynı modeli tekrar gereksiz indirme.
- Git içinde `.env`, özel belge, gerçek sohbet, video, yedek ve anahtar commit edilmez.

## 14. İLK İKİ AJAN TALİMATI — KOPYALA/YAPIŞTIR

### Claude Code'a ilk görev

> Bu repoda `KURUM_AI_MASTER_GELISTIRME_PLANI.md`, `AGENTS.md`, `CLAUDE.md` ve README'yi oku. **Henüz ürün kodunu değiştirme.** FAZ 0 envanter ve güvenlik/performans/yerel saklama denetimini gerçek kaynak kod üzerinden gerçekleştir. `app`, `lib`, `scripts`, `kurum-ai` dizinlerini ve API uçlarını haritala. Mevcut işlevlerin otomatik test durumunu göster; bulguları kanıtla. `docs/audits/BASELINE_AUDIT.md` ve `BASELINE_TESTS.md` hazırla. Önerdiğin ilk 3 küçük PR'ı bağımlılık ve risk sırasına koy. Dokploy/Ollama/Docling canlı servislerini değiştirme. Testi çalıştırmadıysan çalıştırdığını söyleme. Sonunda Codex'in gözden geçireceği net bir değerlendirme paketi sun.

### Codex'e ilk görev

> Sen bu depoda bağımsız, **salt-okunur** mimari ve güvenlik denetçisisin. `KURUM_AI_MASTER_GELISTIRME_PLANI.md` ve Claude'un oluşturduğu FAZ 0 denetim belgelerini, gerçek dosyalar, package scripts ve test sonuçlarıyla karşılaştır. Eksikleri, yanlış varsayımları, veri kaybı ve auth/IDOR risklerini, Next.js 16 uyumunu, ARM64/Docling/Ollama dağıtım riskini ve kapsam sapmalarını incele. Kod değiştirme. P0/P1/P2/P3 sınıflı, dosya-satır referanslı bulgular ve `BLOCKED / CHANGES REQUIRED / APPROVED WITH NOTES / APPROVED` kararı üret. Kanıtlanmayan iddiaları açıkça belirt.

## 15. ÜRÜN KABULÜ: ÖRNEK KULLANICI YOLCULUKLARI

1. Çalışan ilk kez giriş yapar; dosyasını seçer, soru sorar, sayfa kaynaklarını görür; kapatıp açtığında aynı cihazda sohbeti bulur.
2. Başka kullanıcı kendi oturumuyla giriş yapar; ilk kullanıcının dosyasını, indeksini, iş ID'sini veya sohbetini hiçbir yöntemle göremez.
3. Kullanıcı 2 çağrı rehberi yükler, kriter/bütçe farklarını tablo olarak alır; her rakam asıl sayfaya bağlanır.
4. Kullanıcı görsel PDF yükler; OCR yapılır; şüpheli tablo değerleri uyarıyla gösterilir ve sayısal kontrol yapılır.
5. Kullanıcı rapordan 45 sn Reels ister; kaynak bilgiler storyboard'da doğrulanır, kullanıcı onaylar, 9:16 MP4 + Türkçe ses/altyazı oluşur, bilgisayarına kaydeder.
6. Kullanıcı video üretimini iptal eder; sunucudaki işlem ve geçici dosyalar güvenli temizlenir; başka işlerin çalışması etkilenmez.
7. Kullanıcı tarayıcı depolama kotasına yaklaşır; uyarı/yedek/temizleme seçenekleri sunulur, sessiz veri kaybı yaşanmaz.
8. Ağ veya Ollama kopar; kullanıcıya anlaşılır hata, yeniden dene, gerekirse kaldığı yerden sürdür seçeneği sunulur.
9. Kullanıcı tarayıcı profilini temizlemeden önce dışa aktarır ve temiz profile geri yükler; bütünlük kontrolü doğrulanır.
10. Yönetici Dokploy durumunu yönetir, ancak uygulamanın sıradan kullanıcı arayüzünde altyapı ayarları veya kullanıcı dosyaları görünmez.

## 16. KAPSAM DIŞI, AÇIK KARARLAR VE TASARIM RİSKLERİ

- Kesin kimlik sistemi, kullanıcı sayısı, medya saklama boyutu, şifreli yedek şifre yönetimi, video modellerinin lisansları ve performansı **repo denetimi ve benchmarktan sonra** kararlaştırılacak.
- Tarayıcı OPFS kalıcılığı sınırsız veya otomatik garantili değil; kota/veri temizleme riski UI ve yedeklemede çözülmeli.
- "Tüm dosyalar kişisel cihazda" ile "web üzerinden sunucuda AI işlemesi" aynı şey değil; veri aktarımı açık anlatılmalı.
- Mevcut `.cache` veri depolama modelinden istemci kalıcılığına dönüşüm için araç, geçiş ve yedek planı gereklidir.
- Gelişmiş medya modelleri tek NVIDIA DGX Spark'ta eşzamanlı sohbet/OCR performansını bozabilir; önce gerçek ölçüm.
- Görsel/video içeriğinde telif, kurum amblemleri, üçüncü taraf ses/yüz kullanımı, ticari model lisansları ayrıca gözden geçirilmeli.

## 17. KAYNAKLAR VE DOĞRULAMA NOKTALARI

- Proje: https://github.com/ktlesr/kurum-ai
- Proje README: https://github.com/ktlesr/kurum-ai/blob/main/README.md
- package.json: https://github.com/ktlesr/kurum-ai/blob/main/package.json
- AGENTS.md: https://github.com/ktlesr/kurum-ai/blob/main/AGENTS.md
- CLAUDE.md: https://github.com/ktlesr/kurum-ai/blob/main/CLAUDE.md
- Web depolama: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- Origin Private File System: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- Persistent Storage: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- OWASP File Upload: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Docling: https://docling-project.github.io/docling/
- Remotion: https://www.remotion.dev/docs/
- NVIDIA DGX Spark: https://build.nvidia.com/spark

---

**Nihai talimat:** Bu belgeyi bir seferde "her şeyi geliştir" isteği olarak yorumlama. Önce FAZ 0; ardından kullanıcı onaylı küçük iş paketleri. Claude uygular, Codex bağımsız denetler, kullanıcı kabul eder. Her işte güvenlik, veri gizliliği, mevcut çalışan yetenekler ve geri dönüş olanağı korunur.
