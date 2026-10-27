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
| `pnpm test` 36/36, izolasyon 3/3, restart, `tsc`, `lint`, `build` | ✅ |
| Docling süre/sayfa sınırı, model kuyruğu dolması | birim + kod incelemesi; Ollama bu makinede yok, uçtan uca tetiklenmedi |

**Rollback:** Branch'i geri al; veri biçimi değişmedi.

**Codex bulguları ve karar:** _bekliyor_
