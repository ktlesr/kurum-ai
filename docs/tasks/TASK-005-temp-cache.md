# TASK-005: Geçici alan ve kullanıcıya özel önbellek (PR-2b)

**Amaç:** Audit S3 (silinen dokümanın türetilmiş metni kalıyor), S4 (kullanıcılar arası paylaşılan içerik önbelleği), S9 (tahmin edilebilir paylaşılan temp adı), N3 (temp yazımı cleanup dışında, crash sonrası temizlik yok).

**Kapsam içi** — `lib/workspace.ts` (saf fs, testli):
- **İş dizini:** `tmpdir/kurumai-jobs/job-XXXXXX` (`mkdtemp`, rastgele, POSIX'te 0700); Docling girdisi içine `0600` yazılır; yazma dahil her durumda silinir. Aynı dosyanın eşzamanlı iki işi ayrı dizin kullanır.
- **Önbellek:** `.cache/extract/<userId>/<sha256>/` — Docling sonucu (`result-<pipeline>-<model>.json`) ve görsel okuma şeritleri (`strips/`). Anahtar kullanıcı + içerik; **kullanıcılar arası paylaşım yok**. Kimlik/hash biçimi doğrulanır (yol geçişi yok).
- **Silme:** kullanıcının o içerikteki son dokümanı silinince önbellek dizini de silinir; başarısız/iptal edilen yüklemede de. Boş kalan kullanıcı dizinleri kaldırılır.
- **Açılış süpürmesi** (`instrumentation.ts` `register()` → sunucu istek almadan önce): `kurumai-jobs` altındaki tüm artıklar (çökme) ve hiçbir dokümana bağlı olmayan önbellek dizinleri silinir. Log yalnızca sayı içerir.
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

**Rollback:** Branch'i geri al. Yeni dizinler (`.cache/extract`, `tmpdir/kurumai-jobs`) silinebilir; eski veri değişmedi.

**Codex bulguları ve karar:** _bekliyor_
