# TASK-005: Geçici alan ve kullanıcıya özel önbellek (PR-2b)

**Amaç:** Audit S3 (silinen dokümanın türetilmiş metni kalıyor), S4 (kullanıcılar arası paylaşılan içerik önbelleği), S9 (tahmin edilebilir paylaşılan temp adı), N3 (temp yazımı cleanup dışında, crash sonrası temizlik yok).

**Kapsam içi** — `lib/workspace.ts` (saf fs, testli):
- **İş dizini:** `.cache/jobs/job-XXXXXX` (paylaşılan OS temp dizini değil: sabit adlı kök orada başka bir yerel kullanıcının symlink'ine açık — otomatik güvenlik incelemesi) (`mkdtemp`, rastgele, POSIX'te 0700); Docling girdisi içine `0600` yazılır; yazma dahil her durumda silinir. Aynı dosyanın eşzamanlı iki işi ayrı dizin kullanır.
- **Önbellek:** `.cache/extract/<userId>/<sha256>/` — Docling sonucu (`result-<pipeline>-<model>.json`) ve görsel okuma şeritleri (`strips/`). Anahtar kullanıcı + içerik; **kullanıcılar arası paylaşım yok**. Kimlik/hash biçimi doğrulanır (yol geçişi yok).
- **Silme:** kullanıcının o içerikteki son dokümanı silinince önbellek dizini de silinir; başarısız/iptal edilen yüklemede de. Boş kalan kullanıcı dizinleri kaldırılır.
- **Açılış süpürmesi** (`instrumentation.ts` `register()` → sunucu istek almadan önce): `.cache/jobs` altındaki tüm artıklar (çökme) ve hiçbir dokümana bağlı olmayan önbellek dizinleri silinir. Log yalnızca sayı içerir.
- `Doc.sourceHash` (yalnızca sunucuda; `toMeta` istemciye göndermez).

**Bilinçli olarak dokunulmayan:** Eski paylaşılan önbellek (`.cache/<hash>-v*.json`, `.cache/strips/`) ve `.cache/docs/` karantinası **okunmuyor ve silinmiyor** (plan §4.3: eski veri elle, onayla). Önceki sürümün `tmpdir/localdocs-<hash>.*` artıklarına da dokunulmuyor — başka uygulamaların temp alanında rastgele silme yapılmaz.

**Kabul kriterleri ve gerçek çıktılar**

| Given/When/Then | Sonuç |
|---|---|
| Kullanıcı kimliği/hash'te `../` | reddedilir ✅ (birim) |
| İş dizini: başarı / hata / girdi yazımı hatası | her durumda silinir; eşzamanlı işler ayrı dizin ✅ (birim) |
| Süpürme: yalnızca bizim adlandırmamıza uyanlar, yalnızca bağlanmamış olanlar; başka kullanıcının aynı içeriği ayrı | ✅ (birim) |
| Gerçek Docling DOCX ×2 aynı kullanıcı | tek önbellek dizini; iş dizini artığı 0 ✅ |
| İlk kopya silinir | önbellek durur (ikinci kopya kullanıyor) ✅ |
| Son kopya silinir | önbellek ve kullanıcı dizini silinir ✅ |
| Sunucu açılışı: çökme artığı iş + sahipsiz önbellek | ilk istekten önce silindi; log "1 yarım iş, 1 sahipsiz önbellek silindi" ✅; CI'da `tests/restart.test.ts` ile de |
| Eski `.cache` verisi | önce 13 json / 36 şerit → sonra aynı ✅ |
| `pnpm test` 27/27, `tsc`, `lint`, `build`, izolasyon, restart | ✅ |

**Rollback:** Branch'i geri al. Yeni dizinler (`.cache/extract`, `.cache/jobs`) silinebilir; eski veri değişmedi.

**Codex bulguları ve karar**

- Otomatik güvenlik incelemesi (MEDIUM): iş kökü paylaşılan `tmpdir`'de sabit adla symlink'e açıktı → `.cache/jobs` (973e0bb).
- Codex tur 1 — CHANGES REQUIRED:
  - P1 silinen önbellek yeniden oluşabiliyordu (`Promise.all` erken reddi, bekleyen şerit yazımları) → `Promise.allSettled`: çıkarım dönmeden tüm şerit yazımları bitmiş olur. Ayrıca kullanıcı+içerik başına **aktif yükleme kiralaması** (`holdExtract`): silme, süren yükleme varken önbelleğe dokunmaz; son yükleme bitince (başarısız/iptal/arada silinmiş) temizliği o yapar.
  - P2 ikinci instance aktif işleri silebiliyordu → `.cache/instance.lock` (pid + canlılık); kilidi alamayan instance açılış süpürmesini atlar. Gerçek iki süreçle doğrulandı: A süpürdü, B "başka bir instance çalışıyor; açılış temizliği atlandı", A'nın süren iş dizini durdu. Sınır: tek host/konteyner; paylaşımlı depolamada çok host gerçek kilit ister (kod notu).
  - P2 temizlik hatası upload hata yanıtını bastırıyordu → `dropExtractIfUnused` asla fırlatmaz; içeriksiz loglar, bir sonraki açılış süpürür.
  - P2 testler "ilk istekten önce" iddiasını ayırmıyordu → restart testi artıkları herhangi bir API isteğinden önce kontrol ediyor. **Mutasyon:** `instrumentation.ts` boşaltılınca FAIL ("çökme artığı iş dizini açılışta (ilk istekten önce) silindi"), geri konunca PASS. Kiralama için birim testleri (28/28).
- Codex tur 2 — CHANGES REQUIRED: P2 kilidi alamayan instance yine de istek kabul ediyordu; P2 dosya kilidi ediniminde yarış → dosya kilidi kaldırıldı. `lib/boot.ts` (instrumentation'dan, istek almadan önce): **PostgreSQL oturum advisory lock** (`pg_try_advisory_lock`, ayrılmış bağlantıda süreç boyunca tutulur; atomik, süreç ölünce veritabanı bırakır, eski kilit devralma yok). Alınamazsa `process.exit(1)`: ikinci instance hiç açılmaz. Gerçek süreçlerle doğrulandı: A çalışırken B "başka bir instance çalışıyor; bu instance başlatılmadı" ile çıktı, A 200 vermeye devam etti; A öldürülünce yeni instance kilidi aldı, izolasyon + restart testleri geçti. Sınır: kilit, veritabanı bağlantısı koparsa kaybolur (yeniden bağlanmada yeniden alınmaz) — not.
- Codex tur 4 — **APPROVED.**
- Codex tur 3 — CHANGES REQUIRED, tek P2: kilit oturumu koparsa instance çalışmaya devam ediyordu → kilit, hiç geri dönüştürülmeyen (`max_lifetime: null`, `idle_timeout: 0`) tek bağlantılı ayrı istemcide; bağlantı kapanınca (`onclose`) süreç hemen çıkar; ayrıca 5 sn'de bir `pg_locks` ile kilidin bu oturumda olduğu doğrulanır. Gerçek süreçle doğrulandı: A çalışırken kilit oturumu `pg_terminate_backend` ile koparıldı → A "kilit bağlantısı kapandı" ile çıktı; sonra B kilidi aldı ve 7 sn sonra hâlâ ayaktaydı (yanlış alarm yok). İki instance, izolasyon, restart tekrar geçti.
  - Açık: geciktirilmiş şerit yazımıyla gerçek yarış testi yok (görsel model bu makinede yok); `allSettled` + kiralama mantığı birim/kod düzeyinde.
