# TASK-014 — FAZ 4: kaynak izlenebilirliği (sayfa referansları)

**Sorun:** Cevaptaki "Sayfa N" referansları doğrulanmıyordu (plan §5.3: sahte sayfa numarası kabul edilmez) ve
cevabın içinden kaynağa gidilemiyordu; yalnızca alttaki çipler tıklanabiliyordu.

**Değişiklik:**
- `lib/checks.ts` `checkPages` / `pageNumbers`: cevapta geçen ve seçili belgelerde olmayan sayfalar `meta.badPages`;
  arayüzde kırmızı uyarı. Sayfa işareti olmayan belgede (TXT/DOCX) kontrol yapılmaz.
- `lib/context.ts` `linkPages`: remark eklentisi; yalnızca metin düğümlerinde, tek belgeli cevapta ve o belgede
  gerçekten olan sayfalar (`meta.pages`) için "Sayfa N" → kaynak panelini açan bağlantı. Kod ve mevcut bağlantılar
  korunur. Bağlantı her cevapta rastgele bir anahtar taşır; modelin yazdığı `#sayfa-N` bağlantı sayılmaz.
- `parseSource(chip, docNames, doc?)`: tek belgeli cevap yalnızca kendi belgesine (`meta.doc`) çözülür, belge
  listede yoksa hiçbir şey açılmaz; çok belgede tam ad önce, sonra en uzun önek + geçerli bölüm etiketi.

**Testler:** checkPages, linkPages (mdast), parseSource çakışma durumları; 66/66. Yerel tarayıcıda sahte modelle:
Sayfa 1 bağlantısı doğru belge/sayfayı açar, Sayfa 47 bağlanmaz ve uyarı çıkar.

**Codex:** 6 tur. Tur 1–5 bulguları (model yazımı bağlantı, markdown bozulması, `09` normalizasyonu, yanlış belge,
işaretsiz belge, ad çakışmaları) düzeltildi; tur 6 APPROVED WITH NOTES.

**Bilinen sınır:** adında " · Sheet: " geçen bir belge silinirse eski bir çip kısa adlı belgeye düşebilir; kesin çözüm
yapılandırılmış belge/etiket kimliği. Eski kayıtlı cevaplarda (`meta.doc` yok) sayfa bağlantısı oluşmaz.
