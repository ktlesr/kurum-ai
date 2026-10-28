# TASK-018 — Bağlantıdan okuma (güncel bilgi için kullanıcının verdiği URL)

**İstek:** Belgeler içeride kalsın; güncel bilgi gerektiğinde kullanıcı soruya bir URL yazsın, uygulama sayfayı okusun.
Arama motoru planda yok; plan §9: "Harici URL üzerinden içerik çekme varsa allowlist/SSRF engeli; yoksa özellik
varsayılan kapalı."

**Değişiklik:**
- `lib/web.ts`: `findUrls` (son mesajdan en fazla 3), `isPrivate` (IPv4 iç aralıklar; IPv6'da yalnızca 2000::/3 genel
  unicast açık, IPv4 gömen tüm biçimler kapalı), `readPage` (http/https, 80/443, kimlik bilgisi yok, literal IP
  kontrolü, bağlantının kullandığı adresi denetleyen DNS kancası → rebinding'e dayanıklı, yönlendirmeler ≤3 ve
  yeniden denetlenir, 2 MB / 15 sn, HTML/metin, Türkçe karakter kümeleri), `htmlToText` (tek geçiş, doğrusal).
- Sohbet: admin ayarı `web_fetch` (varsayılan kapalı); `admission.web` (4 eşzamanlı, 16 kuyruk); sayfa metni
  kullanıcının son mesajına eklenir (sistem mesajına değil), sistemde "yalnızca veri" kuralı; bağlamın en fazla
  %40'ı; sayı kontrolü kaynaklarına dahil; "Okunan sayfalar" bağlantıları ve okunamayan sayfa notları.
- Yönetici → Ayarlar → Bağlantıdan okuma Aç/Kapat.

**Gizlilik:** dışarı yalnızca kullanıcının yazdığı adrese GET gider (yol ve sorgu dahil); belge ve soru metni gitmez.

**Doğrulama:** 79/79 (web.test: iç ağ biçimleri, şema, kimlik, yönlendirme, tür, boyut, 404, doğrusal HTML), tsc,
eslint. Tarayıcı + gerçek vLLM + internet: kapalıyken not; example.com ve tcmb.gov.tr okunup cevapta kullanıldı;
169.254.169.254 reddedildi.

**Codex:** tur 1 CHANGES REQUIRED (IPv6-mapped SSRF, HTML ReDoS, eşzamanlılık, …), tur 2 CHANGES REQUIRED (başlık
bütçesi, tarama bütçesi), tur 3 APPROVED WITH NOTES (notlar kapatıldı: IPv6 köşeli parantez, geçersiz URL).

**Sınır:** JavaScript ile oluşturulan sayfalarda metin az çıkabilir; PDF bağlantıları okunmaz.
