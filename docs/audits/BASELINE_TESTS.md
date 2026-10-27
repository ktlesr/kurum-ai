# FAZ 0 — Baseline Test Sonuçları

> 2026-10-27 · Windows 11 · Node v22.20.0 · pnpm 10.19.0 · SHA `3a4c093` · Kod değişikliği yok.

## 1. Otomatik kontroller

| Komut | Sonuç | Not |
|---|---|---|
| `pnpm test` | **6/6 geçti** (103 ms) | Yalnızca `lib/checks.test.ts`. parse/extract/rag/API için test yok. |
| `npx tsc --noEmit` | **Hatasız** | |
| `pnpm lint` | **Hatasız** | |
| `pnpm build` | **Başarılı** (1 dk 37 sn) | 2 Turbopack uyarısı: `lib/extract.ts` dinamik `spawn`/`existsSync` → "Dynamic filesystem access causes tracing of the whole project" (bkz. audit S12) |

Rotalar: `○ /` statik; `ƒ /api/chat`, `ƒ /api/models`, `ƒ /api/upload` dinamik.

Ham çıktılar: `docs/audits/raw/test-tsc-lint.txt`, `docs/audits/raw/build-tail.txt`.

Codex yeniden çalıştırmadı (salt-okunur sandbox); bu sonuçlar Claude'un kayıtlarıdır.

## 2. Kapsam boşlukları

- Upload/parse (PDF, DOCX, XLSX, CSV-1254, bozuk dosya): **test yok**.
- RAG chunking/windows: **test yok**.
- API sözleşme/entegrasyon: **test yok**.
- E2E / erişilebilirlik / mobil: **yok**.
- CI (`.github/workflows/kurum-ai.yml`) yalnızca `kurum-ai/**` değişince çalışır; Next uygulamasının test/lint/build'i **CI'da yok**.

## 3. Manuel API sondası (`pnpm start`, port 3999, Ollama kapalı)

| # | İstek | Beklenen (güvenli) | Gözlenen |
|---|---|---|---|
| 1 | `GET /api/upload` (oturumsuz) | 401 | **200**, sunucudaki 3 dokümanın id/ad/boyutu |
| 2 | `POST /api/upload` küçük txt (oturumsuz) | 401 | **200**, doküman kaydedildi |
| 3 | `POST /api/chat` başka id + `model:"x:cloud"` | 401/400 | **503** — Ollama kontrolü sahiplik/model kontrolünden önce çalıştığı için bu sonuç tek başına kabulü kanıtlamaz; eksiklik kaynakta doğrulandı (audit S1/S2) |
| 4 | `POST /api/chat` `{}` | 400 | **500** |
| 5 | `DELETE /api/upload?id=<2'deki id>` (oturumsuz) | 401 | **204** |
| 6 | `HEAD /` güvenlik başlıkları | CSP, XFO, nosniff | Yok; yalnızca `X-Powered-By: Next.js` |
| 7 | 30 MB multipart yükleme | 413, gövde okunmadan | 413 (gövde belleğe alındıktan sonra) |

Test sonrası `.cache/docs` dosya sayısı başlangıçla aynı (3); test dokümanı silindi, mevcut veriye dokunulmadı.

## 3b. Ek doğrulamalar (Codex bulguları için)

- N5: `normNum("1.234,56")` → `"1.234.56"` (node ile çalıştırıldı). `firstNum` kök nedeni yalnızca kaynakta okundu, çalıştırılmadı.
- N4: `compactTables` satır mantığı `| 100 | 100 |` → `| 100 |  |` (aynı ifade node ile çalıştırıldı).

## 4. Çalıştırılamayanlar (bilinmeyen olarak kalır)

- Ollama bu makinede çalışmıyor → sohbet, RAG, görsel ikinci okuma uçtan uca **test edilmedi**.
- Docling (`.venv-docling`) ile gerçek PDF çıkarımı **test edilmedi**.
- Dokploy bu Docker daemon'unda görünmüyor → dağıtım **test edilmedi**.
- ARM64 / GB10 üzerinde hiçbir şey **test edilmedi**.
