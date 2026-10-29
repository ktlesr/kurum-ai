# TASK-030 — FAZ 6 (1. kısım): altyazı, SRT/VTT, videoya basılmış altyazı

**İstek (plan §7.3, FAZ 6):** Zaman damgalı altyazı, SRT/VTT, altyazı tasarımı, kısa storyboard düzenleyici.
Storyboard TASK-026'da yapıldı (sahneler, süre, sıra).

**Değişiklik:**
- `lib/subtitles.ts` (saf):
  - `cuesOf`: sahne süre ve altyazılarından birer altyazı satırı; kontrol karakterleri atılır, en fazla 240 karakter.
  - `toSrt` / `toVtt`: standart zaman damgaları; satır içinde boş satır kalmaz (altyazıyı erken bitirmesin).
    VTT'de `&` ve `<` kaçışlanır, `-->` ise `→` olur.
  - `captionLines`: en fazla 2 satır; sığmayan satır, tek bir çok uzun kelime de olsa, `…` ile kesilir.
- `app/studio/video.ts`: `Scene.caption`. "Altyazıyı videoya yaz" açıkken o anki sahnenin altyazısı altta koyu,
  yuvarlak kenarlı kutuda, beyaz yazıyla basılır (stüdyo yazı tipi).
- `app/studio/studio.tsx`:
  - Sahne başına altyazı alanı.
  - "Altyazıları sahne metinlerinden doldur" (başlık — açıklama).
  - Videoya basma seçeneği; SRT ve VTT indirme.
- `proxy.ts`, CSP: `media-src 'self' blob:`.
  - Kaydedilen videonun sayfa içi önizlemesi (`<video src=blob:…>`), `default-src 'self'` tarafından engelleniyordu.
    Edge konsolu: "Loading media from blob:… violates … default-src". Bu düzeltmeden önce önizleme oynamıyor,
    yalnızca indirme çalışıyordu.
  - Uzak medya hâlâ yasak.

**Doğrulama:**
- `subtitles.test.ts` 4 test. Toplam testler geçiyor; tsc ve eslint temiz.
- Edge e2e:
  - Altyazılar sahne metinlerinden dolduruldu.
  - SRT içeriği doğru (`00:00:00,000 --> 00:00:02,000` …).
  - WebM kaydından alınan karede altyazı kutusu Türkçe harflerle doğru çizildi.
  - CSP düzeltmesiyle önizleme 1080×1920 olarak yüklendi.

**Codex:**
- Tur 1 CHANGES REQUIRED: VTT'de işaretleme karakterleri; çok uzun kelime.
- Tur 2 APPROVED WITH NOTES.
- CSP değişikliği kabul edilebilir bulundu: model cevabından ya da belgeden medya enjeksiyonu yolu yok.

**FAZ 6'nın kalanı (yerel ASR ve TTS):** Ayrı bir model servisi gerektiriyor; plan, model seçimini lisans ve GB10
ölçümünden sonraya bırakıyor (§7.3, §16). Adaylar:
- **ASR:** faster-whisper / whisper.cpp. Whisper MIT lisanslı, Türkçe destekliyor; arm64 + CUDA derlemesi
  doğrulanmalı.
- **TTS:** Piper (MIT; Türkçe sesler var, ör. `tr_TR-dfki-medium`, `tr_TR-fahrettin-medium`; sesin lisansı ayrıca
  kontrol edilmeli). Coqui XTTS ticari olmayan lisans nedeniyle elenir.
- **Tarayıcı Web Speech API:** sesi dış servise gönderdiği için kullanılmaz.

Kurulum compose'da isteğe bağlı bir profil olarak yapılmalı ve vLLM'in bellek payıyla birlikte ölçülmeli. Kullanıcı ya
da yönetici kararı bekliyor.
