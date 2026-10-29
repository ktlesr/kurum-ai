# TASK-023 — FAZ 4: OCR gereksinimi ve okuma kalitesi işaretleri

**İstek (plan §5.2):** OCR gerekli mi otomatik algılansın. Yanlış karakter, tablo kayması ve benzeri durumlar kalite
işaretleriyle açıklansın.

**Değişiklik:**
- `lib/quality.ts` (saf) `qualityNotes(text)` şu durumları belgenin uyarısına not olarak ekler:
  - **Neredeyse boş sayfalar:** sayfaların ortancası en az 200 görünür karakterken bir sayfa 20 karakterin altındaysa,
    o sayfa görüntü olabilir (taranmış sayfa, grafik, kapak). Sayfa numaraları yazılır.
  - **Simge sayfaları:** harf ve rakamların payı %45'in altındaysa, bozuk yazı tipi kodlaması ya da gürültüye dönmüş
    tablo olabilir. İçindekiler sayfalarındaki nokta dizileri ve çizgiler hesaba katılmaz; rakam tabloları alarm
    vermez.
  - **Bozuk Türkçe harfler:** Windows-1254 metnin 1252 olarak okunması (Ý, þ, ð) ya da UTF-8 metnin Latin-1 olarak
    okunması (Ã§, Ä±).
  - **Okunamayan karakter:** en az 5 tane `�`.
- `lib/parse.ts`:
  - `parseFile`, `parseRaw`'u sarar; Excel dışındaki bütün türlerde notları uyarıya ekler.
  - Kontrol yalnızca görüntülemek içindir: hata verirse yükleme yine başarılı olur.
  - Taranmış PDF mesajı netleştirildi: "bu sunucuda OCR (Docling) kapalı; yöneticinize bildirin".

**Doğrulama:**
- `quality.test.ts`, 6 test: temiz belge, boş sayfalar, simge sayfası, kodlama, `�`, içindekiler ve rakam
  tablosu, 4 milyon nokta ve 25 MiB sayfa.
- Toplam 144 geçti, 3 atlandı (önceden de atlanıyordu). tsc ve eslint temiz.
- Kullanıcının 22 gerçek belgesinde yanlış alarm yok:
  - İlk sürüm rakam tablolarında ve içindekiler sayfalarında alarm veriyordu; ölçüt buna göre düzeltildi.
  - Tek not, bir belgenin gerçekten boş okunan kapak sayfası için.

**Codex:**
- Tur 1 CHANGES REQUIRED: geri başvurulu düzenli ifade çok uzun nokta dizisinde yığın taşması yapıyordu.
- Tur 2 onaylandı. Not kapatıldı: 25 MiB testine ikinci sayfa eklendi.

**Sınır:**
- Tablo kayması (sütunların karışması) yalnızca dolaylı olarak, simge oranı ve iki okuma kontrolüyle yakalanır.
- OCR'ın kendisi Docling'e bağlıdır.
