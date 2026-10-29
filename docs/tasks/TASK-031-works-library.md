# TASK-031 — "Çalışmalarım": stüdyo tasarımları tarayıcıda

**İstek (plan §2, 6. modül):** Yerel projeler ve medya taslakları. Tasarımlar şimdiye kadar yalnızca JSON dosyası
olarak kaydedilebiliyordu.

**Değişiklik:**
- `app/studio/works.ts`:
  - Kullanıcı başına ayrı bir IndexedDB veritabanı (`kurum-ai-studio:<kullanıcı>`), sohbet veritabanından ayrı; iki
    şema birbirinden bağımsız gelişir.
  - Listeleme: her kayıt proje dosyası gibi doğrulanır (`cleanEls`; format ve şablon izin listesi; küçük resim yalnızca
    `data:image/png|jpeg`).
  - Kaydetmede en fazla 200 çalışma; depolama dolarsa anlaşılır mesaj.
  - Silme. 240 px JPEG küçük resim.
- `app/studio/studio.tsx`, üst çubukta "Çalışmalarım" düğmesi ve iletişim penceresi:
  - Ad; Kaydet / Güncelle; "Yeni çalışma olarak"; küçük resimli ızgara.
  - Açma geri alınabilir; şablon, format ve öğeleri getirir, bekleyen yapay zekâ önerisini iptal eder.
  - Silme iki adımlıdır, tarayıcının onay penceresi kullanılmaz; hata pencerede gösterilir.
  - Pencere açıkken arka plan `inert` olur ve editör kısayolları çalışmaz. Escape ya da arka plana tıklama pencereyi
    kapatır; odak açan düğmeye döner.

**Gizlilik:** Tasarımlar yalnızca bu tarayıcıda durur. Başka bilgisayara taşımak için "Projeyi kaydet" (JSON) kullanılır.

**Doğrulama:**
- Edge e2e: kaydet, sayfayı yenile, liste yerinde; aç, format ("Yatay") ve başlık ("%77 artış") geri geldi; iki
  adımda sil; kapatınca odak düğmeye döndü; sayfa hatası yok.
- tsc ve eslint temiz; testler geçiyor.

**Codex:**
- Tur 1 CHANGES REQUIRED: pencere klavye yalıtımı; açılan çalışmanın üzerine bekleyen öneri yazması; silme hatası.
- Tur 2 CHANGES REQUIRED: odağın geri verilme zamanı.
- Tur 3 onaylandı.
- IndexedDB işlem ömrü güncel tarayıcılarda geçerli bulundu.
