# TASK-026 — FAZ 5: şablonlu kısa video (Reels)

**İstek (plan §7.1, FAZ 5):** Deterministik şablonlu video; 9:16 Reels, 16:9 tanıtım ve 1:1 formatları; sahneler;
basit geçişler; müzik; MP4 dışa aktarma.

**Karar:**
- **Remotion kullanılmadı.** Plan onu "lisans doğrulanmadan zorunlu bağımlılık değil" diye aday olarak yazıyordu.
  Lisansı, 3 kişiden büyük kurumların ücretli şirket lisansı almasını gerektiriyor.
- **Sunucuda FFmpeg kullanılmadı.** Docker imajını değiştirmek ve iş kuyruğu kurmak gerekirdi.
- Video tarayıcıda, stüdyonun SVG çiziminden üretiliyor. Tarayıcının kendi MediaRecorder'ı kullanılıyor; yeni
  bağımlılık yok, sunucuya bir şey gitmiyor.

**Değişiklik:**
- `app/studio/video.ts`:
  - Her sahne bir stüdyo tasarımıdır ve iki katman olarak çizilir: arka plan (şekiller, fotoğraflar), ön plan (yazı,
    logo).
  - Canvas üzerinde canlandırılır: arka planda yavaş yakınlaşma (1,00 → 1,08), ön planda 0,7 sn'de belirme ve
    yükselme, sahneler arasında 0,6 sn geçiş (yumuşak geçiş, kaydırma ya da kesme).
  - Gelen sahnenin saati geçişin başından sayılır; yazıları geçiş sırasında belirir, sıçrama olmaz.
  - Kayıt: `captureStream` ve MediaRecorder ile, MP4 (H.264) tercih edilir, yoksa WebM. Hız 8 Mbit/sn.
  - İsteğe bağlı müzik: yerelde çözülür, kısaysa döngüye girer, son saniyede kısılır.
  - Bellekte yalnızca o anki ve bir sonraki sahne tutulur; bir sonraki, o anki oynarken çizilir.
  - Bütün kaynaklar (bitmap'ler, akış izleri, AudioContext, kayıtçı, dinleyiciler, animasyon karesi) tek bir temizleme
    bloğunda bırakılır.
  - Hazırlık dahil her bekleme, tek bir "dur" sinyaliyle yarışır: iptal, sekmenin gizlenmesi ya da çizilemeyen sahne.
  - Gizlenen sekmede tarayıcı animasyonu durdurduğu için kayıt açık bir mesajla durdurulur; donmuş görüntü kaydedilmez.
- `app/studio/studio.tsx`, "Video (Reels)" bölümü:
  - Bu tasarımı sahne olarak ekle (aynı formatta, en fazla 20); küçük önizleme.
  - Süre (2–10 sn); yukarı, aşağı, sil.
  - Geçiş, hareket ve müzik seçimi.
  - İlerleme çubuğu ve iptal; video önizlemesi; indirme.
  - Sayfadan çıkınca kayıt iptal edilir, son video adresi serbest bırakılır.

**Doğrulama (Edge headless):**
- 2 sahne × 2 sn, 1080×1920: 4,4 sn'de 1,8 MB MP4 (`ftyp isom`, 1080×1920 video izi). Sayfa hatası yok.
- Geçersiz müzik dosyası: "Müzik dosyası okunamadı…" mesajı.
- Kayıt sırasında iptal: boşta durumuna döner.
- tsc ve eslint temiz; bütün testler geçiyor.

**Codex:**
- Tur 1 CHANGES REQUIRED: kurulum hatasında temizlik; gizli sekme; sayfadan çıkma; gelen sahnenin yazıları;
  bellek (20 sahne ≈ 316 MB).
- Tur 2 CHANGES REQUIRED: hazırlık sırasında iptal ve gizlenme; sahne çizim hatası.
- Tur 3 CHANGES REQUIRED: animasyon karesinin temizlik sonrası sürmesi.
- Tur 4 APPROVED.

**Sınır:**
- **MP4 parçalı (fragmented) çıkar.** MediaRecorder böyle üretiyor: başlıkta süre 0 görünür. Tarayıcılar, VLC ve
  Windows oynatır; bazı platformlar yeniden işleyebilir. Standart MP4 için WebCodecs ve bir MP4 düzenleyicisiyle
  (kayıttan hızlı) geçiş sonraki adım olabilir.
- Kayıt gerçek sürede yapılır; sekme açık kalmalıdır.
- Seslendirme (TTS) ve altyazı FAZ 6'da.
