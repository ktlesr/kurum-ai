# TASK-009: Paketleme (PR-3b)

**Amaç:** Plan PR-3b — Dokploy (DGX Spark / GB10) için imaj; S12 kapısı; healthcheck; Docling RAM sınırı (PR-2c'den ertelenen).

**Kapsam**
- `next.config.ts` → `output: "standalone"`.
- `Dockerfile` (çok aşamalı, `node:22-bookworm-slim` amd64+arm64): `app` hedefi (PDF unpdf ile) ve `app-docling` hedefi (`/opt/docling` venv, `docling==2.130.0`, modeller veri volume'ünde `HF_HOME=/app/.cache/hf`). Root olmayan `app` kullanıcısı; `/app/.cache` volume; `HEALTHCHECK` → `/api/health`.
- `app/api/health`: süreç + Postgres (`SELECT 1`); kimlik ve ayrıntı yok.
- `scripts/check-trace.mjs`: `.next` altında ve tüm `.nft.json` izlerinde `.cache`, `.venv-docling`, `kurum-ai`, `.env*` yolu varsa build başarısız (imaj build'inde ve CI'da).
- `.dockerignore`: veri, venv, secret, pilot yığın, `.git`.
- İmajda yönetici betiği: `docker compose exec app sh -c 'ADMIN_PASSWORD=… node scripts/create-admin.ts admin'` (postgres paketi ayrıca kopyalanıyor; Turbopack onu sunucu paketine gömüyor).
- `deploy/compose.yml`: `app` + `db` (postgres:17), `mem_limit` (`APP_MEM_LIMIT`, varsayılan 16g; Docling alt süreci dahil cgroup sınırı), zorunlu `POSTGRES_PASSWORD`/`APP_ORIGIN`, diğerleri Dokploy `.env`'inden. Alan adı/HTTPS Dokploy Domains sekmesinden.
- Boş ortam değişkeni ("X=") artık tanımsız sayılıyor (`||`): compose boş değer geçirirse varsayılanlar bozulmuyordu değil, bozuluyordu.
- CI: `check` işinde trace kapısı; yeni `image` işi: imaj build, içinde yasak dosya yok, gerçek Postgres'e karşı `healthy`, izolasyon testleri konteynere karşı.

**Kapsam dışı:** Canlı Dokploy deploy'u (kullanıcı onayı gerekir). `app-docling` imajının GB10'da build/deneme ve vLLM ile uçtan uca test — deploy aşamasında. arm64 build'i CI'da yapılmıyor (QEMU yavaş); taban imajlar çok mimarili.

**Kabul (yerel, Docker Desktop amd64)**

| Kriter | Sonuç |
|---|---|
| `docker build --target app` + trace kapısı | ✅ "temiz" |
| İmajda `.env*`, `.venv-docling`, `kurum-ai` yok; `/app/.cache` boş; uid 999 | ✅ |
| `/api/health` 200, `/login` 200, statik CSS 200, Docker `healthy` | ✅ |
| İzolasyon testleri konteynere karşı | ✅ 3/3 |
| DOCX/XLSX/PDF yükleme konteynerde | ✅ (PDF unpdf yolu) |
| `create-admin.ts` konteynerde | ✅ |
| `deploy/compose.yml` ile tam yığın: db healthy → app healthy, volume yazılabilir, tarayıcıda giriş + /admin, CSP konsol hatası yok | ✅ |

**Rollback:** `output: "standalone"` kaldırılır; Dockerfile/compose yalnızca ek dosya.

**Codex bulguları ve karar**
- Codex tur 1 — CHANGES REQUIRED: **P1** `.env*` yalnızca kökte dışlanıyordu; Dokploy'un `deploy/.env` dosyası `COPY . .` ile build aşamasına girerdi → `.dockerignore` desenleri `**/` ile her derinlikte. **P2** kapı bunu yakalamıyordu → CI'da rastgele işaretli `deploy/.env` ve `.env.local` ile `build` aşaması derlenip içinde işaret aranıyor (yerelde: eski `.dockerignore` ile sızıyor, yenisiyle sızmıyor). **P2** parola URL'ye ham giriyordu → compose `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` veriyor, `lib/db` `DATABASE_URL` yoksa bunları kullanıyor (`#`, `/`, `%`, `@`, `:` içeren parolayla yığın healthy, yönetici betiği çalıştı). arm64/app-docling doğrulaması deploy aşamasında (GB10).
