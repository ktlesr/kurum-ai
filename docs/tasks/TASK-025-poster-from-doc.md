# TASK-025 — FAZ 5: belgeden afiş/görsel

**İstek:** Plan §6 ve FAZ 5: seçili bir belgeden kaynaklı metin önerisi; belgedeki bilgiyle afiş ya da sosyal medya
görseli.

**Değişiklik:**
- `app/api/studio/route.ts`:
  - İsteğe bağlı `docId`, sahiplik kontrolüyle (`getDoc`). Başkasının belgesi "bulunamadı" (404) olarak döner.
  - 14.000 karaktere kadar belge olduğu gibi, daha uzunu en ilgili bölümleriyle (`retrieve`) modele verilir.
  - Kural: metinler yalnızca belgedeki bilgilerle yazılır; tarih, yer, rakam ya da ad uydurulmaz, yoksa alan boş kalır.
    Belge veri olarak verilir.
  - Kullanıcının açıklaması ve belge metni istemdeki `<konu>` ve `<belge>` bloklarını açıp kapatamaz; sahte belge
    bloğu üretilemez.
  - Başlık, açıklama ve detay için belgedeki yer `traceTexts` ile bulunur (sayfa ve alıntı ya da "eşleşmedi").
    TASK-021'in eşleştirmesi kullanılır.
- `lib/trace.ts`: `traceTexts` ayrıldı (kısa metinler için); `traceClaims`'in davranışı değişmedi.
- `app/studio/studio.tsx`:
  - Kullanıcının yüklediği belgeler listelenir ("Belgeden yaz", isteğe bağlı).
  - Belge seçiliyse açıklama yazmadan da öneri alınabilir.
  - Her metin alanının yanında belgedeki sayfa ve durum gösterilir (yeşil, sarı, kırmızı); alıntı ipucu olarak görünür.
    Eşleşmeyen alan için uyarı çıkar.
  - Kaynak, bulunduğu metinle birlikte saklanır; alanın metni değişince (sol panel, tuval, geri alma) etiket
    kendiliğinden kaybolur.

**Doğrulama:**
- Doğrulama yolları:
  - açıklama ve belge yok → 400;
  - başkasının belgesi → 404;
  - geçersiz kimlik → 400;
  - kendi belgesi, açıklama yok → model adımına kadar ilerler (yerelde model yok, 503).
- Belge listesi görünüyor. Editör e2e regresyonu yeşil.
- `traceTexts` testi. Toplam 154 geçti, 3 atlandı (önceden de atlanıyordu). tsc ve eslint temiz.

**Codex:**
- Tur 1 CHANGES REQUIRED: açıklama sahte belge bloğu açabiliyordu; kaynak etiketi tuval düzenlemesinden ve geri
  almadan sonra kalıyordu.
- Tur 2 APPROVED.

**Sınır:** Model çıktısı sunucuda (vLLM) denenmedi. Altın set ve canlı kullanımla izlenecek.
