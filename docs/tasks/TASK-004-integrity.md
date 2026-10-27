# TASK-004: Veri bütünlüğü (PR-2a)

**Amaç:** Audit R3 (atomik olmayan yazma, Map'in diskten önce güncellenmesi), R1'in kalan kısmı, N2 (Docling stdout parse istisnası).

**Kapsam içi**
- `lib/atomic.ts` `writeFileAtomic`: geçici dosya + `rename`; hata olursa geçici dosya silinir, eski içerik kalır. Kullanıldığı yerler: doküman kayıtları (`saveDoc`), çıkarım önbelleği, görsel ikinci okuma önbelleği.
- `saveDoc`: Map yalnızca disk yazımı başarılı olduktan sonra güncellenir; yazım başarısızsa yükleme hata döner ve restart'ta kaybolacak "hayalet" doküman oluşmaz.
- `loadDocs` yalnızca `*.json` okur (`*.tmp` artıkları atlanır); bozuk kayıt atlanır ve yalnızca sayısı loglanır.
- `runDocling`: stdout satırı çözümlenemezse veya `onLine` istisna atarsa Docling süreci sonlandırılır, Promise `docling_bad_output` ile reddedilir (işlenmemiş istisna yok).

**Kapsam dışı:** Docling geçici girdi dosyası (`tmpdir`, tahmin edilebilir ad, crash temizliği) — PR-2b.

**Kabul kriterleri ve gerçek çıktılar**

| Given/When/Then | Sonuç |
|---|---|
| Aynı dosyaya iki atomik yazma | son içerik, dizinde `.tmp` yok ✅ (birim) |
| Rename başarısız | eski içerik korunur, `.tmp` silinir ✅ (birim) |
| Gerçek restart: kullanıcı dizininde bozuk JSON + `.tmp` artığı | asıl doküman listede; log: "1 kayıt okunamadı, atlandı" (içerik yok) ✅ (`tests/restart.test.ts`, yerel + CI) |
| Yükleme sonrası `.tmp` artığı | 0 ✅ |
| İzolasyon (2 test) | ✅ |
| `pnpm test` 23/23, `tsc`, `lint`, `build` | ✅ |
| N2 (Docling bozuk çıktı) | `lib/proc.test.ts`: gerçek alt süreçle; Promise sonuçlandığında süreç kapanmış ✅ |

**Rollback:** Branch'i geri al; disk biçimi değişmedi.

**Codex bulguları ve karar**

- Tur 1 — CHANGES REQUIRED:
  - P0 (koşullu) güç kesintisi: `writeFileAtomic` artık geçici dosyayı `wx` ile açıyor, rename öncesi `fsync`, sonra dizini `fsync` ediyor (POSIX; Windows'ta dizin fsync'i yok — NTFS rename'i journal'lıyor, son rename'in güç kesintisinde kaybı mümkün; kod yorumunda sınırlandırıldı). Gerçek güç kesme testi yapılmadı.
  - P1 readline/stdout `error` dinlenmiyordu, P2 reject süreç kapanmadan geliyordu → `lib/proc.ts` `runJsonLines`: ilk hata saklanır, okuyucu kapatılır, süreç öldürülür; Promise yalnızca `close` sonrası sonuçlanır; sonraki satırlar yok sayılır; stderr tutulmaz. `runDocling` bunu kullanıyor. 5 birim testi gerçek alt süreçlerle: geçerli satırlar, bozuk satır sonrası satırların yok sayılıp sürecin kapanmasının beklenmesi, callback istisnası, çıkış kodu (stderr içeriği hata mesajında yok), olmayan komut.
  - P2 testler dar → atomik yazma testi var olan hedef üzerinde enjekte edilmiş rename hatasıyla; restart testindeki `.tmp` artığı artık *geçerli* bir doküman JSON'u. **Mutasyon kontrolü:** `.json` filtresi kaldırılınca restart testi FAIL, geri konunca PASS.
  - Gerçek Docling (yerel `.venv-docling`) ile üretilmiş Türkçe tablolu DOCX yüklemesi: 24,8 sn, `done`.
- Tur 2 — CHANGES REQUIRED: P1 `writeSync` kısa yazması doğrulanmıyordu → `writeFileSync(fd)` (tümü yazılana kadar döngü); ~12 MB çok baytlı içerik birebir testi. P2 dizin fsync hataları yutuluyordu → yalnızca Windows atlanıyor, POSIX'te hata iletiliyor. Süreç testi artık çocuğun pid'ini alıp Promise sonuçlandığında sürecin ölü olduğunu doğruluyor.
  - Açık not: başarısız `saveDoc` için Map/inflight uçtan uca testi yok (yalnızca kod incelemesi).
