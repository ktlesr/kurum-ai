# TASK-007: Belge doğruluğu — Türkçe sayılar ve eşit hücreler (PR-2d)

**Amaç:** Audit N4 ve N5.

**Kapsam**
- **N5a `normNum`:** iki ayırıcı varsa sonuncusu ondalık (`1.234,56` → 1234.56, `1,234.56` → 1234.56); yalnız noktalı 3'lü gruplar binlik (`1.234`, `1.234.567`); birden çok virgüllü 3'lü gruplar binlik (`1,234,567`); tek virgül ondalık (`94,7`, `12,345`).
- **N5b `firstNum`:** hücredeki ilk sayı tüm ayırıcılarıyla alınır (`1.234,56` artık `1.234` diye kesilmiyor); `%94,7` → 94.7.
- **N4 `compactTables`:** yan yana eşit hücreler artık silinmiyor. Markdown birleşik hücre tekrarını gerçek eşit değerden ayıramıyor; veri kaybı tekrar etmekten kötü. Bilinen yan etki: birleşik sayısal başlık hücresi görsel ikinci okumada yanlışlıkla "(?)" alabilir (güvenli yön). Fonksiyon test edilebilsin diye `lib/checks.ts`'e taşındı.
- `PIPELINE` v8 → v9 (eski önbellekli çıkarımlar yeniden üretilir).

**Kabul**

| Kriter | Sonuç |
|---|---|
| `1.234,56`, `1.234.567`, `-12,5`, `%94,7` regresyon örnekleri | ✅ birim |
| Maksimum kontrolü `1.234,56`'yı 1234.56 okur, yanlış maksimumu bildirir | ✅ birim |
| `\| 100 \| 100 \|` korunur | ✅ birim |
| `pnpm test` 43/43, `tsc`, `lint` | ✅ |

**Rollback:** branch'i geri al; önbellek sürümü v8'e döner.

**Codex bulguları ve karar**
