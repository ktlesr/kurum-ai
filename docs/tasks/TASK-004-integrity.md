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
| `pnpm test` 18/18, `tsc`, `lint`, `build` | ✅ |
| N2 (Docling bozuk çıktı) | Yalnızca kod incelemesi; sahte Docling süreciyle çalıştırma testi yok |

**Rollback:** Branch'i geri al; disk biçimi değişmedi.

**Codex bulguları ve karar:** _bekliyor_
