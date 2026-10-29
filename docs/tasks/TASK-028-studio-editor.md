# TASK-028 — Görsel Stüdyo v2: tuval üzerinde düzenlenebilir tasarım

**Kullanıcı geri bildirimi:** v1 çok basitti. Alanlar ve 4 şablon vardı ama logonun yeri ve boyutu, yazı kutusunun
boyutu ve yazı boyutu değiştirilemiyordu. İki repodan (presenton, HyCanvas) bir şey alınmamıştı.

**Repolardan alınanlar:** Kod kopyalanmadı. HyCanvas AGPL lisanslı; presenton'un dışa aktarma motoru kapalı kaynak.
Fikirler kendi kodumuzla yazıldı:
- presenton'dan: şablon = mutlak konumlu öğelerden oluşan bir JSON; model yalnızca metin doldurur.
- HyCanvas'tan:
  - Doğrudan tuval düzenleme: seçme, sürükleme, boyut tutamakları, hizalama kılavuzları, katmanlar listesi, kilit.
  - Marka kilidi: logo yalnızca oranı korunarak büyür ve küçülür, kırpılmaz.
  - Açık JSON proje dosyası; renk temaları.

**Neden editör kitaplığı yok:**
- Fabric.js'in isteğe bağlı `canvas` ve `jsdom` bağımlılıkları arm64 derlemesinde risk taşıyor.
- Konva'nın SVG çıktısı yok ve metni kendi kaydırıyor; önizleme ile dışa aktarma ayrışabilir.
- Kendi SVG'miz: tuval ve dışa aktarma aynı çizim temellerinden (`draw` → `Prim`) üretilir. Ekranda ne görünüyorsa
  dosyada da o çıkar.

**Değişiklik:**
- `lib/studio.ts`:
  - Öğe modeli `El` (yazı, görsel, şekil).
  - `fromTemplate`: şablonun çakışmasız yerleşimi düzenlenebilir öğelere çevrilir. Logo yerleşim sırasında işaretlenir;
    tam sayfa arka plan kilitlidir.
  - `draw` ve `svgOf`: tek çizim yolu.
  - `textLines`: kutuya göre kaydırma, gerekirse küçültme ("Kutuya sığdır") ya da kesme.
  - `hug`: "Kutuya sığdır" kapalıyken kutu yüksekliği metni izler.
  - `cleanEls`: proje dosyasından yalnızca bilinen ve geçerli alanlar alınır.
    - Renkler `#rrggbb`, sayılar sonlu ve sınırlı, en fazla 200 öğe, kimlikler tekil.
    - Görseller `storedPicture` ile denetlenir: gerçek boyut dosya başlığından okunur, en fazla 50 MP. EXIF ile
      döndürülmüş fotoğrafın kayıtlı boyutu korunur.
  - `safePicture`: boyutlar sonlu olmalı.
- `app/studio/editor.tsx`:
  - React SVG tuval; seçme ve sürükleme.
  - Merkeze, kenarlara ve diğer öğelere hizalama kılavuzları; Alt tuşu kılavuzları kapatır.
  - 8 tutamak: görseller oranını korur, Shift ile diğer öğeler de korur.
  - Çift tıklayınca yerinde yazı düzenleme (`foreignObject` içinde `textarea`, `lang="tr"`).
- `app/studio/studio.tsx`: üç bölme.
  - **Sol:** şablon (canlı önizleme), format, yapay zekâ önerisi, metin alanları, marka kiti (6 renk teması, ana ve
    vurgu rengi, logo, şablon fotoğrafı).
  - **Orta:** ekleme araç çubuğu (metin, görsel, şekil, logo), tuval, dışa aktarma (PNG, JPEG, WebP, SVG).
  - **Sağ, özellikler:**
    - Ortak: X, Y, genişlik, yükseklik; tuvale hizalama (6 yön); saydamlık; öne/arkaya alma; çoğaltma; silme.
    - Yazı: metin, boyut (sayı ve kaydırıcı), kalınlık, hizalama, büyük harf, renk (marka renkleri), satır ve harf
      aralığı, kutuya sığdır, arka plan kutusu (renk, köşe).
    - Görsel: kutuyu doldur / tamamı görünsün, köşe yuvarlaklığı, değiştir.
    - Şekil: renk ya da degrade, köşe.
  - **Sağ, katmanlar:** liste, seçme, kilitleme.
  - Geri alma ve yineleme: 100 adım; format da geri gelir.
  - Kısayollar: ok tuşları (Shift ile 10 px), Delete, Ctrl+D, Enter (yazıyı düzenle), Esc.
  - Proje: JSON olarak kaydetme ve açma (düzenlemeye sonra devam etmek için).
  - Şablon ya da format değişince tasarım şablona döner (geri alınabilir). Düzenlenmiş tasarımda:
    - renk teması yalnızca eski marka renklerini yenileriyle değiştirir;
    - logo değişince logonun genişliği korunur, yüksekliği yeni oranından hesaplanır;
    - yapay zekâ önerisi yalnızca metinleri günceller, tasarımın son hâline uygulanır.
- `app/studio/media.ts`: yardımcılar ayrı dosyaya taşındı. Marka kiti yüklenirken logo `storedPicture` ile denetlenir.

**Gizlilik:** Değişmedi. Görseller, marka kiti ve proje tarayıcıda kalır; sunucuya yalnızca konu açıklaması gider.

**Doğrulama:**
- `studio.test` (13) ve `studio-doc.test` (6) geçti; toplam 128 geçti, 3 atlandı (önceden de atlanıyordu). tsc ve
  eslint temiz.
- Edge headless (Playwright) ile:
  - Katmanlardan seçme; başlığı sürükleme (+104, +39).
  - Logoyu köşe tutamağıyla büyütme, oran korundu (3:1 → 3:1).
  - Özelliklerden yazı boyutu.
  - Metin ekleyip çift tıklayarak Türkçe yazma.
  - Shift+Ok ile kaydırma ve Ctrl+Z ile geri alma.
  - PNG ve SVG dışa aktarma; proje kaydedip yeniden açma.
  - Konsolda hata yok; 390 px genişlikte yatay taşma yok.

**Codex:**
- Tur 1 CHANGES REQUIRED: bekleyen öneri yeni düzenlemeleri eziyordu; geri alma formatı geri getirmiyordu; proje
  görsellerinde boyut sınırı yoktu; kimlikler tekrar edebiliyordu.
- Tur 2 CHANGES REQUIRED: EXIF ile döndürülmüş fotoğraflar.
- Tur 3 APPROVED WITH NOTES.

**Sınır:**
- Çoklu seçim, döndürme, gruplama ve yeni yazı tipleri yok. Tek yazı tipi Geist (Türkçe tam, ₺ yok).
- Görüntü üreten model yok (FAZ 7).
- Proje dosyası kullanıcının bilgisayarına kaydedilir; "Çalışmalarım" modülü (plan §2) sonra gelecek.
