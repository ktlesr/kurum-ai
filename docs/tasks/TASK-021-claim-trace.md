# TASK-021 — FAZ 4: cümle → kaynak → sayfa → alıntı izlenebilirliği

**İstek (plan §5.2):** Model çağrılarında kaynak izlenebilirliği: cevap cümlesi → belge → sayfa/sheet → alıntı.
Kaynak bulunamayan iddia açıkça etiketlensin.

**Değişiklik:**
- `lib/trace.ts`: kodla yapılır, model çağrısı yok.
  - `claimsOf`: cevaptaki olgu cümleleri, yani bir sayı içeren ya da en az 6 sözcüklü cümleler.
    - Tablolar (sayıları zaten ayrıca denetleniyor), başlıklar, alıntı blokları ve kod blokları atlanır.
    - Markdown işaretleri temizlenir. "Dr.", "vb." gibi kısaltmalar cümleyi bölmez.
  - `traceClaims`: seçili belgeler sayfa/sheet işaretlerinden bölünür, sonra ~420 karakterlik bindirmeli pencerelere
    ayrılır.
    - Pencere bütçesi belgelere paylaştırılır: uzun belge daha uzun pencere alır, her belge baştan sona taranır.
    - Sayfa işaretindeki numara kanıt sayılmaz.
    - Her cümle için en iyi pencere seçilir. Puan = sözcük kökü eşleşmesi + 3 × sayı eşleşmesi.
    - Sayılar biçimden bağımsız karşılaştırılır; işaret, tek basamak ve tarih tam olarak eşleşmeli.
    - Durum:
      - "ok": cümledeki bütün sayılar pencerede geçiyor ve sözcüklerin en az %50'si eşleşiyor.
      - "weak": sözcüklerin en az %30'u ve sayıların en az yarısı eşleşiyor.
      - "none": ikisi de değil.
    - Kaynak çipi mevcut biçimdedir (`Sayfa N` ya da `<belge> · Sayfa N`) ve kaynak panelini açar. Alıntı en fazla
      220 karakterdir.
- `app/api/chat/route.ts`: belgeli cevaplarda sayı ve sayfa kontrollerinden sonra `meta.claims` eklenir.
- `app/chat.tsx` "Cümle kaynakları" bölümü:
  - Özet satırı: eşleşti / kısmen / eşleşmedi sayıları.
  - Her cümle için durum simgesi, kaynak çipi ve alıntı.
  - Eşleşmeyen cümle kırmızı gösterilir; yanında genel bilgiden, hesaplamadan ya da yanlış okumadan gelmiş
    olabileceği notu durur.
  - Eşleşmeyen cümle varsa bölüm açık başlar.
  - Altta not: "eşleştirme kelime ve sayı benzerliğine göre kodla yapılır; anlamı doğrulamaz".
- `lib/local-store.ts`: yedekten geri yüklemede `claims` doğrulanır (durum listesi, uzunluk sınırları). Tek belgeli
  cevapta çipin doğru belgeyi açması için `meta.doc` korunur.

**Doğrulama:**
- `trace.test.ts`, 10 test:
  - cümle bölme;
  - sayfa ve alıntı;
  - belgede olmayan rakam;
  - çok belge ve sheet etiketi;
  - 3 ay / 9 ay, -50 / 50, 2026 / 2027;
  - büyük ilk belgeden sonra küçük belge;
  - kod bloğu, vurgu, "Dr.";
  - sayfa işareti numarası;
  - hız: 20 belge, 6,5 milyon karakter, ~0,6 sn.
- Toplam 138 geçti, 3 atlandı (önceden de atlanıyordu). tsc ve eslint temiz.
- Arayüz, izli cevap içeren bir yedeğin geri yüklenmesiyle denendi: bölüm doğru çizildi, geçersiz durumlu kayıt
  elendi.

**Codex:**
- Tur 1 CHANGES REQUIRED: sayı biçimi (tek basamak, işaret, tarih); belge bütçesi; doğrulama gibi görünen ifadeler;
  geri yüklenen çipin belgesi; markdown bölme.
- Tur 2 CHANGES REQUIRED: sayfa işaretinin numarası.
- Tur 3 APPROVED.

**Sınır:**
- Anlamı doğrulamaz. Olumsuzlama ya da koşulun tersine çevrilmesi "eşleşti" çıkabilir; arayüz bunu açıkça söylüyor.
- Bounding box yok, sayfa ve alıntı var.
- Bağlantıdan okunan web sayfaları izlenmez.
