# FAZ 0 — Baseline Denetimi

> Tarih: 2026-10-27 · Branch: `faz0/baseline-audit` · Başlangıç SHA: `3a4c093` · Working tree: yalnızca `KURUM_AI_MASTER_GELISTIRME_PLANI.md` izlenmiyor (untracked).
> Bu belge **kod değiştirmeden** hazırlandı. Etiketler: **[DOĞRULANDI]** = çalıştırılarak gözlendi · **[KOD]** = kaynak okunarak tespit, çalıştırılmadı · **[RİSK]** = olası, doğrulanmadı.

## 1. Depo haritası

Depoda **iki ayrı ürün** var (plan §1.1 `kurum-ai/` dizinini tanıyor, §10 Next.js temelini koru diyor). Karar §6 K1'de kayıtlı.

| Yol | Ne | Durum |
|---|---|---|
| `app/`, `lib/`, `scripts/extract.py` | **localdocs** — Next.js 16.3.6 / React 19.2.8 tek sayfa doküman asistanı, Ollama'ya doğrudan bağlanır | Çalışıyor, ~1.400 satır |
| `kurum-ai/` | **Open WebUI dağıtımı** — compose (pilot/prod/dev), Caddy, vLLM (GB10 NGC imajı), docling-serve, LDAP, yedek betiği, 162 beceri dosyası | Bu makinede `kurum-ai-dev-*` ve `open-webui`/`docling` konteynerleri ayakta (6 gündür) |

Next.js uygulaması `kurum-ai/` içindeki hiçbir şeyi kullanmıyor; `kurum-ai/` Next.js'i kullanmıyor. Ortak tek şey Docling + Türkçe doküman hedefi.

### 1.1 API uçları (localdocs)

| Uç | Dosya | Ne yapar | Auth |
|---|---|---|---|
| `GET /api/models` | `app/api/models/route.ts:11` | Ollama modelleri; ad (`embed|whisper`), `remote_host` ve yetenek süzgeci (açık `:cloud` kontrolü yok) | Yok |
| `POST /api/upload` | `app/api/upload/route.ts:12` | multipart → parse (Docling/unpdf/mammoth/SheetJS) → NDJSON ilerleme → `.cache/docs/<uuid>.json` | Yok |
| `GET /api/upload` | `app/api/upload/route.ts:44` | **Sunucudaki tüm dokümanların** meta listesi | Yok |
| `DELETE /api/upload?id=` | `app/api/upload/route.ts:48` | Dokümanı siler | Yok |
| `POST /api/chat` | `app/api/chat/route.ts:100` | fileIds + messages → tam metin / RAG / bölüm-bölüm tarama → stream + `ChatMeta` | Yok |

### 1.2 Sunucu modülleri

- `lib/server.ts` — global `Map<string, Doc>` (globalThis), `.cache/docs` kalıcılığı, chars/token ölçümü.
- `lib/parse.ts` — uzantıya göre ayrıştırıcı seçimi; Windows-1254 geri dönüşü.
- `lib/extract.ts` — Docling alt süreci (`spawn`), tablo şeritleri için görsel model ikinci okuması, `.cache/<sha256>-v8-<model>.json` ve `.cache/strips/` önbellekleri.
- `lib/checks.ts` — deterministik sayı/kriter kontrolleri (testli).
- `lib/rag.ts` — sayfa/sheet farkındalıklı chunking, `embeddinggemma`, bellek içi kosinüs araması.
- `lib/context.ts` — istemci/sunucu ortak bağlam bütçesi ve stream ayırıcıları.

### 1.3 İstemci

`app/page.tsx` (490 satır, tek bileşen): dosya kartları, sürükle-bırak, model seçimi, düşünme anahtarı, stream'li sohbet, kaynak/doğrulama rozeti, mobil çekmece. **Gece/gündüz teması zaten var** ve CSS değişkenleri + Tailwind tema eşlemesiyle token tabanlı (`app/globals.css:5,39`): `app/layout.tsx:12` boyama öncesi betik + `localStorage("theme")` + `app/page.tsx:482` anahtar. Markdown `react-markdown` + `remark-gfm`, `rehype-raw` **yok** → ham HTML render edilmiyor [KOD]. Next.js 16 uyumsuzluğu saptanmadı (Route Handler ve ESLint CLI kullanımı yerel rehberle uyumlu).

## 2. Veri akışı (mevcut)

```
Tarayıcı ──multipart──▶ POST /api/upload
   req.formData() (tamamı belleğe) → boyut kontrolü (25 MB)
   → parseFile (uzantı) ─┬─ pdf/docx: Docling varsa → tmpdir/localdocs-<sha>.<ext> → spawn extract.py
                         │      → tablo şeritleri → Ollama vision → .cache/strips/<sha>.txt
                         │      → .cache/<sha>-v8-<model>.json  (KALICI, kullanıcıdan bağımsız)
                         │   yoksa unpdf / mammoth
                         └─ xlsx/xls/csv: SheetJS · txt/md: decodeText
   → Doc{uuid} → globalThis Map + .cache/docs/<uuid>.json  (KALICI, tam metin, düz JSON)
Tarayıcı ──JSON──▶ POST /api/chat {model, fileIds, messages}
   → docs.get(id) → sığarsa tam metin; sığmazsa sınıflandır → RAG (embed, chunks bellekte) veya map/reduce tarama
   → Ollama stream → verifyNumbers → META trailer
Sohbet geçmişi: yalnızca React state'te; sayfa yenilenince kaybolur [KOD].
Dosya silme: .cache/docs/<id>.json siler; .cache/<sha>… ve strips önbelleği KALIR [KOD].
```

## 3. Güvenlik bulguları

| # | Sınıf | Bulgu | Kanıt |
|---|---|---|---|
| S1 | **P0** | **Hiçbir uçta kimlik doğrulama/yetkilendirme yok.** `GET /api/upload` anonim istemciye sunucudaki **tüm** dokümanların id/ad/boyutunu verir; bu id'lerle `POST /api/chat` herkesin dokümanını okur; `DELETE` herkesin dokümanını siler (IDOR). | [DOĞRULANDI] `pnpm start` + curl: anonim liste → 3 doküman; anonim yükleme 200; anonim silme 204. `BASELINE_TESTS.md` §3 |
| S2 | **P0** | Model adı istemciden geliyor ve doğrulanmıyor (`chat/route.ts:101`). `/api/models` yalnızca `remote_host`/ad/yetenek süzgeci uygular (açık `:cloud` kontrolü ve kesin allowlist yok); `/api/chat` hiç süzmez → doküman Ollama bulutuna gidebilir. | [KOD] `chat/route.ts:53-65`, `models/route.ts:16`; [RİSK] gerçek dış aktarım Ollama yapılandırmasına bağlı, kanıtlanmadı. Sondadaki 503 model kabulünü kanıtlamaz (Ollama kontrolü önce çalışıyor) |
| S3 | **P0** (gizlilik) | Çıkarılan tam metin süresiz, şifresiz, kullanıcı ayrımsız diskte: `.cache/docs/*.json`, `.cache/<sha>-…json`, `.cache/strips/*.txt`. Silme sonrası bile içerik önbellekte kalır. Plan §4.1/§4.3 ile çelişir. | [KOD] `server.ts:33,50-60`, `extract.ts:63,124,212`; [DOĞRULANDI] `.cache` içinde v1–v8 önbellek kopyaları birikmiş |
| S4 | P1 | İçerik hash'ine göre **kullanıcılar arası paylaşılan** çıkarım önbelleği (plan §5.2 açıkça yasaklar). Aynı dosyaya sahip biri için "bu belge sunucuda var mı" varlık/zamanlama yan kanalı **olası** (gözlenmedi). | [KOD] `extract.ts:123-126` |
| S5 | P1 | Yükleme gövdesi boyut kontrolünden **önce** tamamen belleğe alınıyor (`req.formData()`), sonra 25 MB kontrolü. Eşzamanlı büyük istekler bellek tüketir. Tür tespiti yalnızca uzantı; magic-byte yok; DOCX/XLSX (zip) için açılmış boyut/zip-bomb sınırı yok; Docling alt sürecinde zaman/RAM sınırı yok. | [DOĞRULANDI] 30 MB → 413 (ama gövde okunduktan sonra); [KOD] `upload/route.ts:13-18`, `parse.ts:24`, `extract.ts:91` |
| S6 | P1 | Girdi doğrulaması yok: `{}` gövdesi → 500 (`fileIds.map` undefined). `messages` boyutu/sayısı sınırsız; `history` 8 mesaja kesiliyor ama tekil mesaj uzunluğu sınırsız. | [DOĞRULANDI] `{}` → 500; [KOD] `chat/route.ts:101-118` |
| S7 | P1 | Rate limit / admission control yok. Tam bağlam yolu tek çağrı; ama bağlama sığmayan dokümanda sınıflandır + N bölüm tarama + cevap, yüklemede tablo başına vision çağrıları → tek GPU'da kolay kaynak tüketimi. Proxy seviyesindeki limitler kanıtlanmadı. | [KOD] `chat/route.ts:139,145`, `extract.ts:159` |
| S8 | P2 | Güvenlik başlıkları yok (CSP, X-Frame-Options, nosniff, HSTS); `X-Powered-By: Next.js` açık. Satır içi tema betiği CSP'de nonce/hash gerektirecek. | [DOĞRULANDI] `curl -I /` |
| S9 | P2 | Docling geçici dosyası paylaşılan `tmpdir()` içinde tahmin edilebilir adla (`localdocs-<sha>.<ext>`): aynı dosyanın eşzamanlı iki yüklemesi birbirinin dosyasını silebilir; çok kullanıcılı hostta symlink riski. | [KOD] `extract.ts:128-138` |
| S10 | P2 | Chat, ham Ollama hata metnini istemciye iletir (`chat/route.ts:67,189`); vision hatası `warning` üzerinden istemciye ulaşabilir (`extract.ts:162`). Upload'daki Docling hatası genel mesajla gizlenir, sunucuda loglanır (`upload/route.ts:35`). `console.error(e)` içerik taşıyabilir. | [KOD] |
| S11 | P2 | `xlsx` CDN tarball'ı lockfile'da **integrity hash olmadan** (`resolution: {tarball: …}`); doğrulama ve tekrarlanabilirlik açığı (paketin değiştiği anlamına gelmez). CVE düzeltme durumu bağımsız doğrulanmadı. | [KOD] `pnpm-lock.yaml:2436-2437` |
| S12 | **P1** (paketleme öncesi engel) | Dinamik `spawn`/`existsSync` yolları tüm projenin trace edilmesine yol açıyor; mevcut `.next/server/app/api/upload/route.js.nft.json` içinde **48 `.cache/` ve 1 `.venv-docling/` yolu** var (Codex). Standalone/imaja kullanıcı doküman metinleri girebilir. | [DOĞRULANDI] build uyarısı + trace dosyası; [RİSK] imaja gerçekten kopyalandığı kanıtlanmadı |
| S13 | **P1** (koşullu) | Prompt injection: doküman metni sistem mesajına gömülü. Modelin aracı yok, ancak cevaptaki Markdown görseli (`![](https://…?veri=…)`) tarayıcıda otomatik dış istek doğurur → bkz. N1. Doküman adı etiket özniteliğine kaçışsız giriyor. | [KOD] `chat/route.ts:134,148,176`, `page.tsx:433`; başarılı injection gösterilmedi |
| S14 | P3 (olumlu) | `rehype-raw` yok, ham HTML metne dönüşür; `javascript:` URL'leri engellenir. HTTP(S) görselleri ise engellenmez (N1). | [KOD] `page.tsx:433` |

## 4. Güvenilirlik / veri kaybı

| # | Sınıf | Bulgu | Kanıt |
|---|---|---|---|
| R1 | P1 | `loadDocs` tüm döngüyü tek `try` içinde sarıyor: **tek bir bozuk JSON** sonraki tüm dokümanların yüklenmesini sessizce durdurur (UI'da "kaybolmuş" görünür, diskte durur). | [KOD] `server.ts:37-48` |
| R2 | **P0** (veri kaybı) | Sohbet geçmişi hiç saklanmıyor; yenileme = kayıp. Plan §15 yolculuk 1'i karşılamıyor. Uygulaması FAZ 2'de; o zamana kadar açık kabul maddesi. | [KOD] `page.tsx:46,156` |
| R3 | **P0** (koşullu) | `writeFileSync` atomik değil ve Map, disk yazımı başarılı olmadan güncelleniyor → yarım JSON (R1'i tetikler) ve bellek/disk tutarsızlığı. Gerçek crash testi yapılmadı. | [KOD] `server.ts:51,53` |
| R4 | P2 | Embedding'ler `Doc.chunks` içinde yalnızca bellekte; restart sonrası yeniden hesap; eşzamanlı iki istek aynı dokümanı iki kez embed eder. Bellek sınırsız. | [KOD] `rag.ts:81-90` |
| R5 | P2 | `.cache` için TTL/temizlik yok; pipeline sürümü değiştikçe eski kopyalar birikir. | [DOĞRULANDI] aynı hash için v1…v8 dosyaları |

## 4b. Codex incelemesinde eklenen bulgular

| # | Sınıf | Bulgu | Kanıt |
|---|---|---|---|
| N1 | P1 | Cevaptaki Markdown görselleri tarayıcıda otomatik dış istek yapar → prompt injection ile içerik URL'ye konup sızdırılabilir (model aracı gerekmez). Düzeltme: dış görselleri engelle + `img-src` CSP. | [KOD] `page.tsx:433`; sızıntı kanıtlanmadı |
| N2 | P1 | Docling stdout'unda JSON olmayan satır → `readline` callback'inde `JSON.parse` istisnası Promise'e bağlı değil; süreç seviyesinde hata olası. | [KOD] `extract.ts:94` |
| N3 | P1 | Temp `writeFile` `try/finally` dışında; kısmi yazma veya crash sonrası ham belge `tmpdir`'de kalabilir; restart temizliği yok. | [KOD] `extract.ts:129-137` |
| N4 | P1 | `compactTables` yan yana **gerçekten eşit** hücreleri de siler (birleştirilmiş hücre tekrarıyla ayırt etmez) → modele ve deterministik kontrollere eksik tablo; sonuç önbelleğe yazılır. | [DOĞRULANDI] aynı mantık: `\| 100 \| 100 \|` → `\| 100 \|  \|` (`extract.ts:56`) |
| N5 | P1 | İki kök neden: (a) `normNum` binlik+ondalık birleşimini yanlış çevirir: `normNum("1.234,56")` → `"1.234.56"` → `parseFloat` = 1.234; (b) `firstNum` regex'i (`checks.ts:62`) çoklu/birleşik ayırıcıları normalizasyondan önce keser. Sayısal kontrollerin güvenilirliğini etkiler. | (a) [DOĞRULANDI] `node` ile çalıştırıldı (`checks.ts:6-9`); (b) [KOD] `checks.ts:61-64` |
| N6 | P1 | Docling HTTP (`docling-serve`) geçişinin mevcut akışa eşdeğerliği **kanıtlanmadı**: sayfa bazlı ilerleme, tablo şeritleri, ikinci okuma `scripts/extract.py`'a özgü. Eşdeğerlik ve ARM64 kanıtı olmadan değiştirilmemeli. | [KOD] `extract.py:57-74`, `compose.prod.yml:143` |
| N7 | P2 | `kurum-ai`: Open WebUI `internal` olmayan `frontend` ağında da; "dışarı çıkan her şey kapalı" yalnızca uygulama bayrağı, ağ seviyesinde egress engeli değil. | [KOD] `compose.prod.yml:106,182`; fiilî trafik ölçülmedi |
| N8 | P1 | `kurum-ai`: `download-models.sh` varsayılanı `openai/gpt-oss-20b`, `compose.prod.yml` varsayılanı `google/gemma-4-26B-A4B-it` → `.env`'de `LLM_MODEL` yoksa offline açılışta model bulunamayabilir (koşullu, denenmedi). | [KOD] `download-models.sh:14`, `compose.prod.yml:20` |
| N9 | P1 | Arayüzdeki "veriler cihazdan çıkmaz / her şey bu bilgisayarda" metni sunucudan erişimde yanlış (plan §4.1). | [KOD] `page.tsx:221,350` |
| N10 | P2 | Secret taraması yapılmadı. Yapılandırma secret'ları ortamdan alıyor; yerel `.env` dosyaları `.gitignore`'da. Git geçmişinde/imajda secret olmadığı **kanıtlanmadı**. | [KOD] `.gitignore:34` |

## 5. Dağıtım (Dokploy / DGX Spark)

- Next.js uygulaması için Dockerfile/compose yok; `next.config.ts` boş [KOD]. Next yerel rehberi düz Node sunucusu dağıtımını da destekliyor; standalone bir seçenek. Dokploy için bir imaj tanımı gerekecek, ancak S12 çözülmeden paketlenmemeli.
- `OLLAMA_URL` varsayılanı `http://localhost:11434` — konteyner içinde host Ollama değildir (plan §8 ile aynı tespit) [KOD] `server.ts:7`.
- `DOCLING_PYTHON` varsayılanı proje içi `.venv-docling`; konteynerde yok → unpdf'e düşer; PDF için kullanıcıya uyarı gösterilir (`parse.ts:33,68`) ama taranmış PDF'ler okunmaz [KOD] `extract.ts:12-14,121`. `kurum-ai` tarafındaki `docling-serve` HTTP servisinin eşdeğerliği kanıtlanmadı (N6).
- `kurum-ai/compose.prod.yml` vLLM (OpenAI uyumlu API) kullanıyor; Next uygulaması yalnızca Ollama `/api/chat` biçimini konuşuyor → üretim GB10'da aynı model sunucusunu paylaşmak için sağlayıcı soyutlaması gerekecek.
- Dokploy, kullanıcı beyanına göre **DGX Spark üzerinde** çalışıyor; bu makinenin Docker daemon'unda dokploy/traefik yok. Yerel gözlemler (Docker, Ollama kapalı) yalnızca bu Windows geliştirme makinesi için geçerli; canlı DGX ortamı hakkında hüküm içermez.
- Ollama bu makinede çalışmıyor (`localhost:11434` yanıt yok) → sohbet uçtan uca test edilemedi.

## 6. Kararlar (ürün sahibi, 2026-10-27)

- **K1 — Temel: Next.js `localdocs` uygulaması büyütülecek** (plan §10). Open WebUI (`kurum-ai/`) pilot olarak yanında kalır, kaldırılmaz.
- **K2 — Kimlik: ilk aşamada yerel kullanıcı + parola** (PostgreSQL'de hesap/oturum/rol, admin onaylı kayıt, güvenli cookie oturum). LDAP/OIDC sonraki iş paketi.
- **K3 — Model sunucusu: ikisi de.** Sağlayıcı soyutlaması: geliştirmede Ollama, GB10'da vLLM (OpenAI uyumlu API).
- **K4 — Mevcut `.cache/docs` (3 kayıt): karantina.** Hiçbir kullanıcıya (admin dahil) atanmaz, gösterilmez; yedeklenir; dönüşüm ancak elle onaylı (plan §4.3). *Açık.*
- **K5 — Dokploy: DGX Spark üzerinde.** Canlı servise dokunulmaz; dağıtım dosyaları hazırlanır, deploy kullanıcı onayıyla yapılır. Domain *açık* (plan `ai.ekutlu.com` öneriyor).

## 7. Önerilen ilk PR'lar (Codex geri bildirimiyle küçültüldü)

Her biri ayrı branch, ayrı Codex incelemesi. CI en baştan.

1. **PR-0 · CI:** Next uygulaması için `pnpm test` + `tsc --noEmit` + `lint` + `build` GitHub Actions işi. Kod davranışı değişmez.
2. **PR-1a · Auth çekirdeği:** PostgreSQL kullanıcı/oturum şeması + migration, parola hash (Node `crypto.scrypt`), httpOnly/secure/SameSite cookie, oturum süresi, giriş/çıkış/kayıt (admin onaylı) sayfaları, giriş rate limit'i. Tüm `/api/*` uçlarında oturum zorunlu (401).
3. **PR-1b · Sahiplik ve girdi doğrulama:** `Doc.ownerId`; liste/chat/delete'te sahiplik (başkasınınki 404); istek şema doğrulaması (400); **sunucu tarafı açık model allowlist'i** (chat, vision, embedding — env ile); eski `.cache/docs` karantina (yüklenmez, silinmez). Testler: A/B izolasyon, anonim 401, `{}` → 400, allowlist dışı model → 400.
4. **PR-1c · Başlıklar ve sızıntı kanalları:** `poweredByHeader:false`, CSP (nonce'lu tema betiği, `img-src 'self' data: blob:`), XFO, nosniff; Markdown dış görsellerini engelle (N1); istemciye ham sağlayıcı hata metni gitmesin (S10); arayüz gizlilik metnini düzelt (N9).
5. **PR-2a · Veri bütünlüğü:** atomik yazma (tmp + rename), Map'i yazım sonrası güncelle, bozuk kayıt toleransı (R1/R3); Docling stdout parse hatası → Promise reddi (N2).
6. **PR-2b · Geçici alan ve önbellek:** `mkdtemp` iş dizini, yazmayı kapsayan cleanup, yalnızca uygulamanın kendi temp önekini kapsayan başlangıç temizliği (N3/S9); çıkarım önbelleğini kullanıcıya göre anahtarla (S4); silmede ilişkili önbelleği sil (S3). **Eski `.cache` verisine otomatik temizlik uygulanmaz.**
7. **PR-2c · Upload ve kaynak sınırları (S5/S7):** kabul kriterleri — gövde akış halinde 25 MB'ta kesilir (belleğe tamamı alınmaz); magic-byte uyuşmazlığı 415; zip açılmış boyut ve PDF sayfa/render piksel sınırı; Docling süre ve RAM sınırı (aşımda süreç sonlandırılır, temp silinir); **chat, vision ve embedding çağrıları için global admission control** (eşzamanlı model çağrısı sınırı + kuyruk) ve kullanıcı başına istek hızı sınırı (429). Her limit env ile ayarlanır ve testle doğrulanır.
8. **PR-2d · Belge doğruluğu:** `normNum` **ve** `firstNum` Türkçe biçimleri (N5: `1.234,56`, `1.234.567`, `-12,5`, `%94,7` regresyon örnekleri) ve `compactTables` eşit-hücre kaybı (N4), testlerle. `PIPELINE` sürümü artırılır.
9. **PR-3a · Sağlayıcı soyutlaması (K3):** Ollama ve vLLM (OpenAI API) için tek arayüz; mevcut Ollama davranışı regresyonsuz.
10. **PR-3b · Paketleme:** `outputFileTracingExcludes` (`.cache`, `.venv-docling`) ve kapı: trace dosyalarında ve imaj katmanlarında `.cache`/`.env`/secret yok; `scripts/extract.py` imajda; statik dosyalar servis ediliyor. Docling çalışma ortamı: `.venv-docling` imaja girmez; Python+Docling ARM64 imajda ayrıca kurulur **veya** host worker'a bağlanılır — seçim GB10 üzerinde test edilerek yapılır; o zamana kadar mevcut DGX `.venv-docling` kurulumu korunur (plan §8). ARM64 Dockerfile, healthcheck. Docling HTTP adaptörü **ayrı** iş paketi, eşdeğerlik testinden sonra (N6). Dokploy deploy'u kullanıcı onayıyla.

`kurum-ai/` bulguları (N7, N8) ayrı küçük PR; Next ürününü bloklamaz.

Ardından FAZ 2 (IndexedDB/OPFS yerel çalışma alanı, sohbet kalıcılığı — R2) ve FAZ 3 (yeni kabuk; mevcut token tabanlı gece/gündüz teması korunup genişletilir).

## 8. İnceleme kaydı

- **Codex üçüncü tur:** CHANGES REQUIRED, tek P2 (§5 eşdeğerlik ifadesi) — düzeltildi.
- **Codex ikinci tur:** CHANGES REQUIRED — `:cloud` çelişkisi, kanıt düzeyleri (S4/N6/N8), N5'in `firstNum` kök nedeni, PR-2c kabul kriterleri, PR-3'ün bölünmesi. Bu sürüm hepsini işler.
- **Codex (salt-okunur, 2026-10-27), ilk tur:** CHANGES REQUIRED. Sınıf düzeltmeleri (S12→P1, S13→P1, R2→P0, R3→P0), 10 yeni bulgu (N1–N10), PR'ların küçültülmesi, kanıt düzeyi düzeltmeleri. Bu sürüm hepsini işler. N4/N5 Claude tarafından ayrıca çalıştırılarak doğrulandı.
