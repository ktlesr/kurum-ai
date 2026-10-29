# TASK-019 — Görsel Stüdyo v1

**İstek:** Planın FAZ 5 aşaması: kurumsal sosyal medya görselleri. Model metin yazamaz hale gelmesin, logo bozulmasın,
Türkçe başlıklar doğru çıksın (plan §6). presenton ve HyCanvas incelendi; ikisi de entegre edilmedi (gerekçe: plan
§6.1). Bu iş paketi kendi kodumuzla yazıldı.

**Değişiklik:**
- `lib/studio.ts`: saf modül, tarayıcıda ve testte çalışır.
  - Şablonlar: duyuru, etkinlik, bilgi/rakam, alıntı.
  - Formatlar: kare 1080², dikey 1080×1350, hikâye 1080×1920, yatay 1920×1080.
  - `layout` katmanları üretir. Metinler dikey yığın halinde dizilir: her metin gereken yüksekliği alır, "esnek" metin
    kalanı alır, böylece hiçbir metin üst üste binmez.
  - `fitText`: kelime kaydırma, küçültme, sığmazsa "…".
  - `toSvg`: tek çizim kaynağı. Metinler kaçışlanır, renkler yalnızca `#rrggbb`. Görseller yalnızca `data:image/(png|jpeg|webp|svg+xml);base64`
    biçiminde, `<image>` öğesi olarak eklenir; görsel bağlamında script çalışmaz.
  - Logo `contain` ile ve oranı korunarak çizilir; kırpılmaz, renklendirilmez.
  - Etiketler Türkçe kurala göre büyük harfe çevrilir (`toLocaleUpperCase("tr")`).
  - `parseFill`: model cevabındaki JSON'u alanlara çevirir; alan uzunlukları sınırlanır, kontrol karakterleri atılır.
- `app/api/studio/route.ts`: oturum ve Origin kontrolü, kullanıcı başına hız sınırı, model kuyruğu. Açıklama en fazla
  2000 karakter ve veri olarak gönderilir. Düşünme kapalı, en fazla 400 token. Yalnızca metin gider.
- `app/studio/`: arayüz.
  - Şablon kartlarında canlı küçük önizleme; format seçimi; yapay zekâ ile metin önerisi (iptal edilebilir); alan
    alan düzenleme ve karakter sayacı.
  - Fotoğraf: 20 MB'a kadar, uzun kenarı 2400 px'e indirilir.
  - Logo: 2 MB'a kadar, bayt bayt korunur. Marka kiti (renkler ve logo) kullanıcı başına `localStorage`'da tutulur.
  - Dışa aktarma: PNG, JPEG, WebP (canvas), SVG (doğrudan).
- `public/fonts/Geist-Variable.woff2`, OFL lisanslı (`Geist-OFL.txt`).
  - Ölçüm için FontFace olarak yüklenir, SVG'ye data: URL olarak gömülür.
  - CSP değişmedi: `font-src 'self'`, `img-src 'self' data: blob:`.
- Kenar çubuğuna "Görsel Stüdyo" bağlantısı.

- Fotoğraf boyutu tarayıcı açmadan önce dosya başlığından okunur (en fazla 50 MP). İstek gövdesi bayt sınırıyla okunur (413).

**Gizlilik:** Fotoğraf, logo ve marka kiti tarayıcıdan çıkmaz. Sunucuya yalnızca konu açıklaması gider.

**Doğrulama:**
- Testler: `studio.test` 13 test; toplam 102 geçti, 3 atlandı (önceden de atlanıyordu). Ayrıca tsc ve eslint.
- Kaçış, renk ve görsel doğrulama; logo oranı; her şablon ve formatta en uzun metinlerle çakışma ve taşma yok;
  uzun başlıkta açıklama ve tarihin korunması; `parseFill`; `rasterSize` (PNG/JPEG/WebP başlıkları, bozuk girdi).
- Edge headless (Playwright) ile:
  - Giriş → kenar çubuğu → stüdyo; 4 şablon × 4 format.
  - Fotoğraf ve logo yükleme.
  - Dışa aktarma: PNG (1080×1080, PNG imzası), JPEG, WebP (RIFF/WEBP), SVG.
  - Türkçe harfler (ğüşıöç ĞÜŞİÖÇ, İŞBİRLİĞİ) doğru çizildi.
  - Model yokken anlaşılır hata ("Model sunucusu çalışmıyor…").
  - 390 px genişlikte yatay taşma yok.

**Sınır:**
- Görüntü üreten model yok (FAZ 7). Arka plan kullanıcının fotoğrafı ya da marka renkleri.
- ₺ işareti yazı tipinde yok; "TL" yazılmalı.
- Belgeden görsel üretimi TASK-020'de.

**Codex:**
- Tur 1 CHANGES REQUIRED: sınırsız istek gövdesi; metnin tuvalden taşması; fotoğrafın açılırken bellek
  kullanımı ve şablon kartlarında tam boy kopyalar; bekleyen önerinin yeni düzenlemenin üzerine yazması;
  erişilebilirlik.
- Tur 2 CHANGES REQUIRED: esnek açıklamaya ayrılan yerin korunması; boyutun dosya başlığından okunması.
- Tur 3 APPROVED WITH NOTES. Notlar kapatıldı: VP8 ve bozuk başlık testleri.
