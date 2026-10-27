# TASK-002: Doküman sahipliği, girdi doğrulama, model izin listesi (PR-1b)

**Amaç:** Audit S1 (IDOR), S2 (istemci seçimli model), S6 (doğrulanmayan girdi), K4 (sahipsiz eski veri) bulgularını kapatmak.

**Mevcut davranış:** PR-1a sonrası her oturumlu kullanıcı herkesin dokümanını listeleyip, sohbette kullanıp silebiliyordu; `{}` → 500; herhangi bir model adı Ollama'ya iletiliyordu.

**Kapsam içi**
- `Doc.ownerId`; depolama `.cache/userdocs/<ownerId>/<id>.json`. `getDoc`/`docsOf`/`deleteDoc` sahipliği kontrol eder; başkasının dokümanı yok hükmündedir (sohbette 409, silmede 404, listede görünmez). `ownerId` istemciye gönderilmez.
- **Karantina:** `.cache/docs/` (auth öncesi, sahipsiz 3 kayıt) artık yüklenmez ve **silinmez**. Dönüşüm yalnızca elle ve onayla (plan §4.3).
- `loadDocs` her dosyayı ayrı `try` ile okur: bir bozuk dosya diğerlerini gizlemez (audit R1).
- `lib/validate.ts`: `/api/chat` gövdesi çalışma anında doğrulanır → 400 (Türkçe mesaj). Sınırlar: 20 dosya, 200 mesaj, mesaj başına 100.000 karakter; rol yalnızca user/assistant; mesajdaki fazladan alanlar atılır.
- `ALLOWED_MODELS` (varsayılan: `DEFAULT_MODEL`): sohbet modeli sunucu tarafı izin listesinden; `/api/models` da yalnızca listedekileri gösterir. Vision/embedding modelleri zaten yalnızca env'den gelir (istemci seçemez).

**Kapsam dışı:** CSP/başlıklar, dış görsel engeli, gizlilik metni (PR-1c); atomik yazma, temp alanı, önbellek anahtarı (PR-2a/2b). Paylaşılan çıkarım önbelleği (S4) PR-2b'de.

**Geriye uyumluluk:** Eski yüklemeler arayüzde görünmez (karantina). `ALLOWED_MODELS` tanımlanmazsa yalnızca varsayılan model seçilebilir.

**Kabul kriterleri ve gerçek çıktılar** — `tests/isolation.test.ts`, `pnpm start` + Postgres'e karşı, yerelde ve CI'da:

| Given/When/Then | Sonuç |
|---|---|
| Oturumsuz liste | 401 ✅ |
| A yükler | `done`, `ownerId` yanıtta yok ✅ |
| A listesi / B listesi | yalnızca A'nınki / boş (karantina verisi görünmüyor) ✅ |
| B, A'nın dokümanını siler | 404 ✅ |
| B, A'nın dokümanıyla sohbet | 409 ✅ |
| A kendi dokümanıyla sohbet | 409 değil (Ollama yok → 503) ✅ |
| `{}` / `x:cloud` model | 400 / 400 ✅ |
| A siler | 204, liste boş ✅ |
| `.cache/docs` | 3 dosya duruyor ✅ |
| `pnpm test` | 15/15 ✅ (4 yeni doğrulama testi) |
| `tsc`, `lint`, `build` | ✅ |

**Rollback:** Branch'i geri al. `.cache/userdocs` yeni dizin; eski veri değişmedi.

**Codex bulguları ve karar**

- Tur 1 — CHANGES REQUIRED:
  - **P1 yeniden başlatmada belgeler yüklenmiyordu:** `UUID` sabiti `loadDocs()` çağrısından sonra tanımlıydı (TDZ). `ReferenceError` boş `catch` ile yutuluyor, liste boş geliyordu (dosyalar diskte kalıyordu). İlk testim sunucuyu yeniden başlatmadığı için kaçırdı. Düzeltme: sabit öne alındı. Yeni `tests/restart.test.ts` (CI'da gerçek restart arasında iki faz). **Hatalı sürüme karşı çalıştırıldı ve başarısız oldu**, düzeltilmiş sürümde geçti.
  - P2 kullanıcı dizini hatası izole değildi → dizin okuma da ayrı `try`.
  - P2 logda ownerId → log yalnızca sayı veriyor ("N kayıt okunamadı").
  - P2 test dar → A'nın sohbeti kesin {200, 503}; olmayan id ile başkasınınki aynı yanıt (409); CI'da hazır olma döngüsü zaman aşımında başarısız.
  - P2 200 mesaj sınırı istemciyi kilitliyordu → istemci son 8 mesajı gönderiyor (sunucu zaten 8 kullanıyor). 20 dosya sınırı yüklemede uygulanıyor (409).
  - P2 varsayılan model izin listesi dışında kalabiliyordu → `PREFERRED_MODEL` izinli olandan seçiliyor; istemci listeden düşen seçimi yeniliyor.
  - Otomatik güvenlik incelemesi (MEDIUM): paralel yüklemeler 20 dosya sınırını aşabiliyordu (kontrol ile `saveDoc` arasında await) → kullanıcı başına işlemdeki yükleme sayacı, kontrol+rezerv tek senkron adım, `finally` ile iade. Doğrulandı: 25 paralel yükleme → 20 başarılı, 5 × 409, listede 20.
- Tur 2 — CHANGES REQUIRED: P2 CI restart'ı garanti değildi (`pkill -f "next start"` `next-server` sürecini kaçırabilir; eski süreç bellekten cevap verip testi yanlış geçirebilir) → `setsid` süreç grubu, `kill -- -PID`, portun kapandığı doğrulanmadan yeni süreç başlatılmıyor. P2 paralel dosya sınırı → `923d4c9` ile zaten düzeltilmişti.
- Tur 3 — **APPROVED WITH NOTES.** Not üzerine 25 paralel yükleme deneyi `tests/isolation.test.ts`'e regresyon testi olarak eklendi (5 × 409, liste 20).
  - Açık not: deterministik model sağlayıcıyla gerçek sohbet/RAG uçtan uca testi, sağlayıcı soyutlamasıyla (PR-3a) gelecek.
