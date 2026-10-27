# TASK-003: Güvenlik başlıkları, CSP, sızıntı kanalları (PR-1c)

**Amaç:** Audit S8 (başlık yok), N1 (Markdown dış görseliyle sızıntı), S10 (ham sağlayıcı hata metni istemciye), N9 (yanlış gizlilik beyanı).

**Kapsam içi**
- `proxy.ts`: sayfalara istek başına nonce'lu CSP (Next 16 yerel rehberi `content-security-policy.md` ile birebir). Kurallar: `script-src 'nonce' 'strict-dynamic'`, `img-src 'self' data: blob:` (uzak görsel yok), `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`. `style-src-attr 'unsafe-inline'` React `style={{}}` için. Geliştirmede `unsafe-eval`/`unsafe-inline` (HMR).
- `app/layout.tsx`: tema betiği nonce taşıyor.
- `next.config.ts`: `poweredByHeader: false`; tüm rotalarda nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP; üretimde HSTS.
- Markdown `img` bileşeni görsel yüklemez, `[görsel: alt]` yazar (CSP'ye ek ikinci katman).
- Chat/RAG/vision hataları: ham metin yalnızca sunucu logunda; istemciye sabit Türkçe mesaj.
- Gizlilik metni (arayüz, metadata, README): "Kurum sunucusunda işlenir · harici AI servisine gönderilmez". README, belgelerin şu an sunucuda (yalnızca sahibine görünür) saklandığını açıkça belirtiyor.

**Kabul kriterleri ve gerçek çıktılar** (`pnpm start`, tarayıcı)

| Given/When/Then | Sonuç |
|---|---|
| `/login` yanıt başlıkları | CSP (nonce'lu), nosniff, XFO DENY, Referrer, Permissions, COOP, HSTS; `X-Powered-By` yok ✅ |
| `/api/models` başlıkları | nosniff, XFO ✅ (CSP sayfalara özel) |
| Satır içi script'lerde nonce | `<script nonce="…">` ✅ |
| Sayfada `https://example.com/…` görseli | **ENGELLENDİ** ✅ |
| `theme=dark` + yeniden yükleme | `<html class="dark">` — tema betiği CSP altında çalışıyor ✅ |
| Konsolda CSP ihlali / hydration hatası | yok ✅ |
| `pnpm test` 15/15, `tsc`, `lint`, `build` | ✅ |

**Rollback:** `proxy.ts`'i sil, `next.config.ts` başlıklarını geri al.

**Codex bulguları ve karar**

- Tur 1 — CHANGES REQUIRED (P0/P1 yok). Hepsi düzeltildi:
  - P2 N9 sürüyordu: boş sohbet ekranında "Her şey bu bilgisayarda" → kurum sunucusu metni.
  - P2 S10 eski kayıtlar: önceki sürümün ham vision uyarısı `toMeta`'da güvenli metne çevriliyor.
  - P2 loglarda içerik: kendi hatalarımız sabit kodlarla atılıyor (`ollama_http_500`, `docling_exit_1`, `embed_http_…`, `vision_http_…`); sağlayıcı gövdesi ve Docling stderr hiç tutulmuyor; `lib/log.ts` yalnız bu kodları, diğer hatalarda yalnız tür adını (ör. `SyntaxError`) logluyor (test: `JSON.parse` hatası içeriği loga taşımıyor).
  - P2 dış bağlantıyla kullanıcı tıklamalı sızıntı: Markdown'da yalnızca `#…` ve `/…` bağlantı kalıyor; `https:`, `//host`, `mailto:`, `javascript:` devre dışı ("dış bağlantı devre dışı").
  - P3 prefetch başlığı CSP'yi atlatıyordu: matcher'dan istisna kaldırıldı. Doğrulandı: `purpose: prefetch` ile de CSP geliyor.
  - HSTS yorumu düzeltildi; `style-src-attr` gerekçesi netleştirildi.
- Tur 3 — **APPROVED WITH NOTES.**
- Tur 2 — CHANGES REQUIRED, tek P2: aynı ham metin `verify.skipped`'te de duruyordu → o da yanıt sınırında temizleniyor. Uçtan uca doğrulandı: ham sağlayıcı metinli sahte eski kayıt → `GET /api/upload` çıktısında ham metin 0 kez.
