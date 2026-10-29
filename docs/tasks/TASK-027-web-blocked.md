# TASK-027 — Bağlantıdan okuma: güvenlik duvarı ret sayfaları ve kaydedilmiş sayfa yükleme

**Sorun:** sanayi.gov.tr gibi siteler otomatik isteklere F5 "Request Rejected … support ID" sayfası döndürüyor (HTTP
200). Uygulama bu sayfayı okunmuş içerik sanıp modele verdi ve "Okunan sayfalar: Request Rejected" gösterdi. Model de
kendi altyapısı hakkında açıklama uydurdu.

**Karar:** Bot korumasını kılık değiştirerek aşmıyoruz: tarayıcı kimliği taklidi, gizleme eklentisi ve CAPTCHA çözme
yok. Gerekçe: site sahibinin açık erişim kuralı, kurum adresinin yasaklanma riski, kalıcı olmaması. Bunun yerine:

**Değişiklik:**
- `lib/web.ts`:
  - `isBlockPage`: F5, Akamai, Cloudflare, Imperva ve CAPTCHA duvarlarını tanır. Yalnızca kısa sayfalara bakar;
    CAPTCHA için sayfa 800 karakterden kısa olmalı.
  - `readPage`: HTML, düz metin ve 401/403/405/406/429/503 gövdelerinde ret sayfası `WebError("blocked")` olur.
- `lib/browser.ts`:
  - Ret sayfası işlenmiş sayfada da "blocked" olur.
  - `readWeb`: doğrudan okuma engellenirse sayfa normal Chromium ile bir kez denenir. Kimlik değiştirilmez; aynı vekil
    sunucu ve adres kontrolleri kullanılır.
- `app/api/chat/route.ts`:
  - Okunamayan bağlantılar modele sistem mesajında bildirilir (`failedRule`): nedeni tahmin etmemesi, altyapı
    açıklaması uydurmaması, PDF/HTML olarak kaydedip yükleme ya da Resmî Gazete / mevzuat.gov.tr bağlantısı önermesi.
  - Aynı not arayüzde de gösterilir. İzlenen bağlantıdaki engel de bildirilir.
- HTML yükleme (`.html`, `.htm`): kullanıcının kendi tarayıcısından Ctrl+S ile kaydettiği sayfa `htmlToText` ile okunur.
  Script çalışmaz. Metin dosyasındaki NUL denetimi burada da uygulanır.

**Doğrulama:** `web-block.test.ts` 4 test: imzalar, gerçek sayfalarda yanlış alarm olmaması, 200/403/text ret ve 404
ayrımı, kaydedilmiş sayfa. Toplam 122 geçti, 3 atlandı (önceden de atlanıyordu). tsc ve eslint temiz.

**Codex:**
- Tur 1 CHANGES REQUIRED: düz metin ret sayfası; izlenen bağlantı engeli.
- Tur 2 APPROVED WITH NOTES.

**Sınır:**
- Gerçek sitede deneme yapılmadı. Ortam, siteyi farklı tarayıcı kimlikleriyle denemeyi bot engeli aşma sayıp
  reddetti.
- MHTML (tek dosya web arşivi) desteklenmiyor. HTML ya da PDF kaydedilmeli.
- Kalıcı çözüm, sitenin sahibinden kurum adresi için izin istemek.
