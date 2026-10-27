# TASK-001: Auth çekirdeği (PR-1a)

**Amaç:** Tüm uçları oturuma bağlamak; audit S1'in "anonim erişim" kısmını kapatmak.

**Mevcut davranış ve kanıt:** Hiçbir uçta auth yok; anonim liste/yükleme/silme çalışıyordu (`BASELINE_TESTS.md` §3).

**Kapsam içi:** PostgreSQL `users`/`sessions` + sıralı migration (`lib/db.ts`); scrypt parola (`lib/password.ts`); DB oturumu — çerezde 32 bayt rastgele token, DB'de yalnızca SHA-256'sı; httpOnly + SameSite=lax + üretimde Secure, 7 gün; giriş/kayıt (admin onaylı, `pending` → `active`); kullanıcı adı başına 5 hatalı deneme / 15 dk kilit; var olmayan kullanıcıda sahte hash doğrulaması (zamanlama); `/admin` onay/devre dışı bırakma (devre dışı → oturumlar silinir; admin kendini kilitleyemez; admin olmayana 404); tüm `/api/*` 401; GET dışında farklı `Origin` 403; ilk admin için `scripts/create-admin.ts` (parola env'den); tema anahtarı giriş/admin sayfalarında da.

**Kapsam dışı (sonraki PR'lar):** doküman sahipliği ve eski `.cache/docs` karantinası (PR-1b — **şu an oturum açan her kullanıcı mevcut tüm dokümanları görür**); girdi şeması, model allowlist'i (1b); CSP/başlıklar (1c); parola sıfırlama, LDAP/OIDC.

**Gizlilik/güvenlik etkisi:** DB yalnızca hesap/oturum tutar (plan §4.3). Parola ve token loglanmaz. Giriş kilidi süreç belleğinde (tek instance varsayımı, kod içinde not).

**Depolama/veri göçü:** Yeni DB şeması; `.cache/docs`'a dokunulmadı.

**Geriye uyumluluk:** `DATABASE_URL` artık zorunlu. Arayüz davranışı aynı, girişten sonra.

**Yeni bağımlılık:** `postgres@3.4.9` (porsager) — sıfır bağımlılık, saf JS (ARM64 sorunsuz), Unlicense. Next/Node stdlib'de Postgres istemcisi yok.

**Kabul kriterleri ve gerçek çıktılar**

| Given/When/Then | Sonuç |
|---|---|
| Oturumsuz → `GET /api/models`, `GET/DELETE /api/upload`, `POST /api/chat` | 401 ×4 ✅ (`pnpm start`, curl) |
| Farklı `Origin` ile POST | 403 ✅ |
| Oturumsuz → `/`, `/admin` | 307 → `/login` ✅ |
| Kayıt → giriş | "Hesabınız yönetici onayı bekliyor." ✅ (tarayıcı) |
| Admin onaylar → kullanıcı girer | Sohbet ekranı ✅ |
| Normal kullanıcı → `/admin` | 404 ✅ |
| Çıkış | `/login`'e döner, oturum silinir ✅ |
| Gece/gündüz anahtarı giriş sayfasında | ✅ (ekran görüntüsü) |
| `pnpm test` | 11/11 ✅ (5 yeni: hash, bozuk hash, token, politika, kilit) |
| `tsc --noEmit`, `lint`, `build` | ✅ |

**Bulunan ve düzeltilen hata:** `await (await db())<T>\`…\`` ifadesinde SWC parantezleri düşürüp `db()`'yi tag olarak çağırıyor (yalnızca Next derlemesinde; Node'da doğru). `const sql = await db()` ile ayrıldı, `lib/auth.ts`'te not var.

**Rollback:** Branch'i geri al; DB tabloları başka hiçbir şeyi etkilemez (`DROP TABLE sessions, users, schema_version`).

**Codex bulguları ve karar:** _bekliyor_
