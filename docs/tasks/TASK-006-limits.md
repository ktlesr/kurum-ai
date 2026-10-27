# TASK-006: Yükleme ve kaynak sınırları (PR-2c)

**Amaç:** Audit S5 (gövde boyut kontrolünden önce belleğe alınıyor, yalnızca uzantı, zip bombası, Docling süre/RAM sınırı yok) ve S7 (rate limit / admission control yok).

**Kapsam içi**
- **Gövde:** `Content-Length` sınırın üstündeyse gövde okunmadan 413; başlık yoksa (chunked) akış sayılarak okunur, 25 MB + 1 MB'ı geçince okuma kesilir, 413 (`lib/filetype.ts` `readLimited`).
- **İçerik ↔ uzantı (415):** PDF `%PDF-` (ilk 1 KB), DOCX/XLSX ZIP imzası, XLS OLE (veya ZIP), CSV/TXT/MD'de ilk 64 KB'ta NUL bayt yok.
- **Zip bombası:** DOCX/XLSX merkezi dizininden, hiçbir şey açılmadan, beyan edilen toplam açılmış boyut ≤ 200 MB ve dosya sayısı ≤ 10.000; ZIP64 / bozuk dizin reddedilir.
- **Docling:** global kuyruk (`DOCLING_CONCURRENCY`=1, `DOCLING_QUEUE`=8; dolu → kullanıcıya "Sunucu yoğun"), süre sınırı `DOCLING_TIMEOUT_MS` (20 dk; saat slot alındıktan sonra başlar, aşımda süreç öldürülür, iş dizini silinir, kullanıcıya açıklayıcı mesaj), `DOCLING_MAX_PAGES` (500; `extract.py` çıkış kodu 3 → mesaj), sayfa alanı × render ölçeği > 60 MP olan sayfalarda tablo kırpması atlanır (bellek bombası).
- **Model çağrıları:** sohbet (sınıflandırma, bölüm tarama, cevap), embedding ve görsel ikinci okuma tek semafordan geçer (`MODEL_CONCURRENCY`=2, `MODEL_QUEUE`=32; FIFO, iptal edilen bekleyen kuyruktan çıkar; dolu → "Sunucu şu an çok yoğun"). Bekleme varsa sohbette "Sırada bekleniyor…" durumu.
- **Kullanıcı başına hız:** `CHAT_PER_MIN`=20, `UPLOAD_PER_MIN`=20 → 429 + `Retry-After`.
- `UserError` döngüsel import olmasın diye `lib/errors.ts`'e taşındı (`lib/parse.ts` yeniden dışa aktarıyor).

**Kapsam dışı / açık:** Docling için işletim sistemi düzeyinde RAM sınırı (Linux `RLIMIT_AS` CUDA/torch sanal bellek ayırmasını bozar; DGX'te cgroup/konteyner bellek sınırıyla çözülmeli — PR-3b). Sınırlar süreç belleğinde; `lib/boot` tek instance garantilediği için yeterli.

**Kabul kriterleri ve gerçek çıktılar**

| Given/When/Then | Sonuç |
|---|---|
| Semafor: slot, FIFO devri, kuyruk dolu → Busy, iptal eden bekleyen slotu sızdırmaz, `run` hata da bırakır | ✅ birim |
| Hız sınırlayıcı: pencere, anahtar ayrımı, sıfırlanma | ✅ birim |
| ZIP toplamları, ZIP64/bozuk red, bomba (boyut/sayı) red, imzalar | ✅ birim |
| `readLimited` sınırda durur (100 parçanın < 10'u okunur) | ✅ birim |
| Gerçek DOCX (17 girdi, 827 KB açılmış) ve XLSX | içerik denetiminden geçti; Docling DOCX 4,6 sn, XLSX `done` ✅ |
| "bu bir pdf değil" → `sahte.pdf` | 415 ✅ (e2e) |
| NUL baytlı `ikili.txt` | 415 ✅ (e2e) |
| 40 MB `Content-Length`, 1 bayt gövde (ham TCP) | 413, gövde beklenmeden ✅ (e2e) |
| 40 MB chunked gövde | 413; Node istemcisi ~31 MB'ta kesildi ✅ (e2e; curl ile de 413) |
| 21. sohbet isteği / dk | ilk 20 → 400 (doğrulama), 21. → 429 ✅ (e2e) |
| `pnpm test` 41/41 (+2 yalnız POSIX), izolasyon 3/3, restart, `tsc`, `lint`, `build` | ✅ |
| Docling süre/sayfa sınırı, model kuyruğu dolması | birim + kod incelemesi; Ollama bu makinede yok, uçtan uca tetiklenmedi |

**Rollback:** Branch'i geri al; veri biçimi değişmedi.

**Codex bulguları ve karar**

- Otomatik güvenlik incelemesi (3 × MEDIUM): `.xls` ZIP yolunda zip denetimi yoktu; zip denetimi beyan edilen boyutlara güveniyordu; büyük sayfa kontrolü Docling sayfayı işledikten sonraydı → düzeltildi (aşağıda).
- Codex tur 1 — CHANGES REQUIRED:
  - P1 ZIP atlatma (EOCD kayıt sayısı 0, `.xls` ZIP, sahte EOCD) → merkezi dizin **katı** okunuyor: EOCD dosyayı tam bitirmeli (yorumdaki sahte kayıt belirsizlik → red), iki kayıt sayısı eşit ve > 0, dizin beyan edilen bayt boyutuyla yürünüp tam o sayıda kayıt bulunmalı, ZIP64 red. Ardından her girdi **gerçekten açılıyor** (`zlib.inflateRaw` + `maxOutputLength`, async), gerçek toplam > 200 MB → red. `.xls` ZIP ise aynı denetim. Testler: 1 KB beyan edip 300 MB açılan bomba yakalanıyor (ağda < 1 MB); sayısı sıfırlanmış, ikisi sıfırlanmış, yorumunda sahte EOCD olan ve yorum uzunluğu tutarsız dizinler reddediliyor; gerçek DOCX/XLSX geçiyor.
  - P1 60 MP kontrolü geç → tüm sayfa boyutları Docling'e hiçbir sayfa verilmeden kontrol, aşan dosya çıkış kodu 4 → "olağandışı büyük bir sayfa". Gerçek 14400×14400 pt PDF ile doğrulandı.
  - P1 timeout'ta kesin sonlandırma yok → `runJsonLines` iptali kendisi yönetiyor: SIGTERM, 5 sn sonra SIGKILL; POSIX'te süreç grubu (`detached` + `kill(-pid)`). Test: SIGTERM'i yok sayan çocuk iptal edilince öldürülüyor ve Promise yalnızca çıktıktan sonra sonuçlanıyor (yükseltme Linux CI'da gerçekten sınanır; Windows'ta SIGTERM zaten zorla sonlandırır).
  - P2 toplam bellek sınırsız → küresel yükleme slotu (`UPLOAD_CONCURRENCY`=4, `UPLOAD_QUEUE`=16; gövde okunmadan alınır, son ilerleme olayına kadar tutulur; erken dönüşlerde bırakılır), `Content-Length` reddi slot almadan.
  - P2 sayfa sınırı tüm yollarda değil → unpdf yedeğinde metin çıkarmadan önce sayfa sayısı (doğrulandı: 501 sayfa 0,1 sn'de red), önbellekten dönen sonuçta da.
  - P2 vision slotu erken bırakılıyordu → yanıt gövdesinin okunması da slotun içinde.
  - P2 Busy sözleşmesi → kuyruk zaten doluysa akıştan önce 429 + `Retry-After` (sohbet; PDF/DOCX yükleme); akış başladıktan sonraki hata `ERROR_SEP` ile işaretleniyor, istemci bunu hata turu olarak gösterip sonraki isteğin geçmişine katmıyor.
- Codex tur 2 — CHANGES REQUIRED:
  - P1 ZIP: merkezi dizin "stored, küçük", yerel başlık "deflate" diyebiliyordu (SheetJS yereli kullanır; 1 MiB açtı) → yerel ve merkezi başlıkta yöntem, veri tanımlayıcı bayrağı ve boyutlar eşit olmalı; yerel başlıkta ZIP64 ek alanı red; yerel girdiler arşivi 0. bayttan merkezi dizine **boşluksuz** kaplamalı (aradaki gizli girdi red). Testler: yöntem/boyut uyuşmazlığı, ZIP64 ek alanı, girdiler arası gizli bayt reddediliyor; veri tanımlayıcılı geçerli arşiv kabul ediliyor; gerçek DOCX/XLSX geçiyor.
  - P2 ana süreç kapanınca grup SIGKILL'i iptal oluyordu → sonlandırma başlatıldıysa ana çocuğun `close`'unda da gruba SIGKILL. Test (yalnız POSIX, CI'da): SIGTERM'i yok sayan ve boru tutmayan yardımcı süreç, iptal sonrası ölü.
  - P2 unpdf belgesi kapatılmıyordu → `try/finally` ile `pdf.loadingTask.destroy()` (unpdf'in kendi yaptığı gibi).
- Codex tur 3 + otomatik inceleme — CHANGES REQUIRED: P1 veri tanımlayıcılı girdide yerel boyut ve merkezi dizindeki ZIP64 ek alanı denetlenmiyordu (126 / 150 baytlık repro, SheetJS 1 MiB ayırdı); grup SIGKILL'i yalnızca hata durumundaydı → yerel boyutlar ya dizinle aynı ya da (tanımlayıcı varsa) 0 olmalı; tanımlayıcıdaki boyutlar da dizinle aynı olmalı; ZIP64 ek alanı (yerel veya merkezi) yalnızca denetlenen 32 bit değerlerin birebir kopyasıysa kabul. Grup, ana çocuk nasıl biterse bitsin SIGKILL alır. İki repro + yalan tanımlayıcı + gereksiz-ama-tutarlı ZIP64 ek alanı testleri; normal çıkışta geride kalan yardımcı süreç testi (POSIX).
  - **Bilinen sınır:** gerçek ZIP64 biçimli arşivler (32 bit alanlar 0xFFFFFFFF; ör. Python `force_zip64`) reddedilir — Word/Excel/LibreOffice bu boyuttaki dosyalarda yazmaz. Mesaj: "iç yapısı desteklenmiyor ya da bozuk… yeniden kaydedin". Denendi: böyle bir XLSX reddedildi (SheetJS okuyabiliyordu).
- CI yan bulgusu: restart'ta eski sürecin veritabanı kilidi port kapandıktan sonra bir an daha tutulabiliyor → `boot` kilidi `INSTANCE_LOCK_WAIT_MS` (30 sn) boyunca yeniden deniyor (rolling deploy için de gerekli); CI restart bekleme 60 sn. Yerelde anında restart ve ikinci instance reddi (bekleme 3 sn ile) doğrulandı.
- Codex tur 4 — CHANGES REQUIRED (ilk deneme içerik filtresine takıldı, savunma odaklı yeniden soruldu): P1 SheetJS ZIP64 alanından uzunluğa bakmadan 16 bayt okuyor → ZIP64 ek alanı en az iki boyutu (16 bayt) içermeli; P2 yerel ad/ek alan uzunluğu merkezi dizini aşarsa `RangeError` yerine temiz red; P2 stdout'u tutan yardımcı süreç `close`'u geciktirebiliyordu → grup SIGKILL'i `exit`'te de. Üçü de testli; her biri mutasyonla doğrulandı (kural kaldırılınca ilgili test düşüyor). CI asılı kalma sorunu (yardımcı `unref` edilmediği için ana süreç çıkmıyordu) düzeltildi; işlere `timeout-minutes` eklendi. POSIX testleri Linux konteynerde 9/9.
