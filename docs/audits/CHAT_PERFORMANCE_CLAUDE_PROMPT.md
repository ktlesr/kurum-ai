# Claude Code — Sohbet sayfası yavaşlığını giderme talimatı

Tarih: 4 Kasım 2026. Depo: `D:\localdocs`.

Bu dosyanın tamamını Claude Code'a ver. Amaç, mevcut sohbet sayfasındaki yazma, kaydırma, kaynak açma ve yanıt akışı yavaşlığını ölçerek ve küçük değişikliklerle gidermektir. Aşağıdaki gözlemler bir ön incelemeden gelir; canlı sekmenin profil kaydı veya kesin bir bellek sızıntısı teşhisi değildir.

---

## Görev ve yetki

Kullanıcı sohbet sayfasının “slow motion gibi, RAM dolmuş gibi” çalıştığını bildiriyor. Yavaşlığın yalnızca cevap beklerken değil; yazarken, gezinirken, yanıt akarken, belge/kaynak açarken ve yüklemede hissedildiğini belirtti.

Bu performans sorununu düzelt. Önce mevcut kodu ve performans yamasını doğrula, kısa bir uygulama planı oluştur, ardından kapsam içindeki küçük ve geri alınabilir düzeltmeleri uygula ve test et. Yalnızca rapor yazıp bırakma; gerekli bir engel yoksa uygulama ve doğrulamayı tamamla. Geniş mimari değişiklikleri, yeni bağımlılıkları veya veri şeması değişikliklerini bu işin otomatik parçası sayma.

Kullanıcının mevcut işleri, belgeleri, sohbetleri ve devam eden değişiklikleri korunacak. Çözüm daha az veri göstermek, yanıtı kesmek veya belge doğrulamasını kaldırmak olmamalı. Görünür alanı sınırlamak gerekiyorsa bütün içeriğe erişim korunmalı.

## Önce mevcut durumu doğrula

1. Kök ve kapsamlı proje talimatlarını, `CLAUDE.md` dosyasını ve ilgili Next.js rehberlerini oku. Kurulu Next.js sürümü için `node_modules/next/dist/docs/` kaynaklarını esas al.
2. `git status`, HEAD ve mevcut diff'i kaydet. `git reset`, `checkout --`, `restore`, temizleme veya stash ile mevcut işi kaldırma.
3. Bu dosya hazırlanırken `app/chat.tsx` ve `app/library.tsx` zaten değiştirilmişti. Bunlar Codex tarafından yapılan değişiklikler değildir. Mevcut iyileştirmeleri koru ve kendi farkını ayrı değerlendir.
4. Dosya/sembol adlarını yeniden bul; aşağıdaki satır numaraları güncel kalmayabilir.
5. Ana Next.js uygulamasını `kurum-ai/` altındaki ayrı Open WebUI kurulumuyla karıştırma.
6. Üretimde hangi sürümün açık olduğunu bilmiyorsan bunu açıkça belirt. Yerel çalışma kopyasındaki düzeltmenin canlıya çıktığını varsayma.

## Önemli güncelleme: önceki rapordaki bazı sorunlara yama eklenmiş

Bu dosya yazılmadan hemen önce çalışma kopyasında şunlar görüldü:

- `Bubble` ve `LibraryPanel`, `memo` ile sarılmış.
- İlgili callback'lerin bir kısmı sabitlenmiş.
- Akış ekran güncellemesi `requestAnimationFrame` ile birleştiriliyor.
- `SourcePanel` artık `memo` ile sarılmış ve `onClose` sabit bir callback.
- Yeni `SourceSection` bileşeni `memo` kullanıyor; `plainNumbering` sonucu `useMemo` ile tutuluyor.
- `SECTION_PREVIEW = 12_000` üzerinden uzun bölümlerde “Devamını göster” eklenmiş.

**Bu nedenle “kaynak paneli hâlâ her tuşta bütün belgeyi yeniden işler” ifadesini güncel kod için doğrulamadan tekrarlama.** Ön incelemede bu durum vardı, sonrasında yama eklendi. Aynı düzeltmeleri tekrar yapma; gerçekten renderı önleyip önlemediklerini ölç.

Bu yamada hâlâ değerlendirilmesi gerekenler:

- Bütün bölümler `doc.sections.map` ile oluşturuluyor. Bölüm başına önizleme, yüzlerce kısa bölümün toplam maliyetini sınırlamıyor.
- Hedeflenen bölüm için `useState(hit)` tam içeriği açıyor. Çok büyük bir sheet'e kaynak bağlantısıyla gidilince ilk render pahalı olabilir.
- Önizleme satır sonu arıyor. Uzun tek satırlı içerikte kesme bulunamazsa tam içerik render edilebilir.
- `requestAnimationFrame`, pahalı Markdown ayrıştırmasını kendiliğinden ucuzlatmaz.

Bu maddeler otomatik hata ilanı değil; yük testi yapılacak senaryolardır. İçerik doğruluğunu ve kaynak sayfasına erişimi koruyarak gerekliyse düzelt.

## Ön incelemede doğrulanan maliyetli yollar

### 1. Canlı cevap büyüdükçe tam metin yeniden işleniyor

Dosya: `app/chat.tsx`, `send`, `show`, `Bubble`.

Akış `raw` içine ekleniyor. Güncellemede birikmiş metin `split`, durum işareti eşleme/temizleme ve `setLast` üzerinden tekrar işleniyor. `Bubble` canlı cevabın tamamını `ReactMarkdown` ile ayrıştırıyor. Uzun tabloda her güncelleme giderek daha pahalı hale gelebilir.

Mevcut kare başına birleştirmeyi koru. İlk olarak üretim derlemesinde ölç: güncelleme sıklığı, Markdown süresi, React commit süresi ve uzun görevler. Gerekirse kontrollü güncelleme aralığı, değişmeyen içerikte güncelleme yapmama veya tamamlanmış blokların tekrar işlenmesini önleme gibi en küçük çözümü seç. Her karakteri ayrı DOM düğümüne dönüştürme; eksik Markdown tablo/kod blokları bozulmasın.

Son parça, hata, iptal ve metaveri ayrıştırması kaybolmamalı. İptal sonrası bekleyen frame/timer kapalı veya başka sohbete yazmamalı. Kontrol ayraçları metne sızmamalı.

### 2. Tüm sohbet arşivi belleğe alınıyor ve kayıtlarda yeniden okunuyor

Dosyalar: `app/use-chats.ts`, `reload`, `write`, `upsert`; `lib/local-store.ts`, `openStore`, `list`.

`list()` IndexedDB'de `getAll()` kullanıyor; mesajlar ve metaverileri dahil bütün sohbetleri getiriyor. `reload()` bunları state'e alıyor. Bir yazma sonrasında bütün liste yeniden yükleniyor. Normal gönderimde soru öncesi ve cevap sonrası kayıt var.

Bu bir bellek sızıntısı kanıtı değildir; arşiv büyüdükçe sürekli elde tutulan veri ve yeniden oluşturulan nesne hacmini artıran bir tasarımdır.

İlk aşamada en küçük güvenli iyileştirmeyi değerlendir: tek sohbet değişince bütün arşivi gereksiz okumayı azaltmak. Liste/başlık verisi ile açık sohbet içeriğini ayırmak daha büyük değişiklik gerektiriyorsa ayrı iş paketi yap. Yeni indeks/store/schema migration'ı veya saklama modeli değişikliğini örtülü biçimde ekleme; gerekliliğini, eski veri uyumluluğunu ve geçiş testlerini somutlaştır.

Şunları koru: read-modify-write atomikliği, çok sekmeli güncellemeler, yeniden adlandırma/sabitleme sırasında cevap kaydetme, içe aktarma birleştirmesi, silme geri alma, kullanıcıya özel IndexedDB ve yedek biçimi. Sadece hız için kullanıcı verisini düşürme.

### 3. Arama her ana renderda bütün mesajları tarayabiliyor

Dosyalar: `app/chat.tsx`, `visibleChats`; `lib/local-store.ts`, `searchChats`.

`searchChats(local.chats, query)` ana renderda doğrudan çağrılıyor. Arama metni doluyken bütün mesaj içerikleri Türkçe küçük harfe çevrilerek aranabiliyor. Böylece arama kutusunda metin kalmışken normal soru kutusuna yazma ve yanıt akışı da aynı aramayı tekrar yapabiliyor.

Aramayı gerçek girdilerine bağlı hesapla; gerekiyorsa arama alanının güncellenmesini kontrollü geciktir. Yeni arama motoru/kütüphanesi ekleme. Arama boşken mevcut hızlı dönüşü ve Türkçe eşleşme davranışını koru.

### 4. Kütüphane ağacı düzenli yeniden kuruluyor ve kapalı dallar da oluşturuluyor

Dosyalar: `app/library.tsx`, `treeOf`, `Rows`, `DirRow`, `allFiles`; `app/chat.tsx`, `refreshLibrary`.

Liste 15 saniyede bir yenileniyor. Aynı içerik yeni diziler olarak state'e yazılıyor. `LibraryPanel` memo olsa bile prop'lar değişince ağaç tekrar kuruluyor. Kapalı `<details>` çocukları da JSX içinde oluşturuluyor. Her klasör alt dosyaları tekrar topluyor.

Önce ölçeği ve yenileme etkisini ölç. Veri gerçekten değişmediğinde gereksiz state/renderı azaltmayı ve kapalı dalların içeriğini ihtiyaç anında oluşturmayı değerlendir. Salt `details` kapalı diye React maliyetinin yok olduğunu varsayma.

Belge/klasör seçimi, klasördeki tüm dosyaların kapsanması, ACL sonrası liste yenileme, NAS kopma durumu, taşıma/silme ve checkbox sayıları doğru kalmalı. Performans önbelleği yüzünden yetkisi kaldırılmış dosyayı görünür tutma.

### 5. Yüklenen File referanslarının yaşam süresi belirsiz

Dosya: `app/chat.tsx`, `uploadedFiles`.

`uploadedFiles.current.set(tmp.id, f)` var. Ön incelemede sohbetten çıkarma/yeni sohbet/sohbet değiştirme yollarında bu harita için temizleme görülmedi. Bu map, şablon doldurmanın orijinal dosya baytlarına ihtiyacı olduğu için mevcut.

File referansı tutulması bütün dosya baytlarının mutlaka JS heap'inde olduğunu kanıtlamaz. Yine de uzun oturumda kaynak tutma miktarının büyümesine yol açabilir. Kullanım yollarını doğrula; kullanılmayan referansı güvenle bırak. Devam eden yüklemeyi, şablon işlemini ve kullanıcının halen ihtiyaç duyduğu dosyayı bozma. Sunucudaki belgeyi silmek bu işin parçası değildir.

### 6. Mesaj ve kaynak DOM'u görünür alanla sınırlandırılmıyor

Dosya: `app/chat.tsx`, `messages.map`, kaynak bölüm listesi, `scrollIntoView` etkisi.

`memo` tekrar renderı azaltır; zaten oluşturulmuş binlerce DOM düğümünün yerleşim ve bellek maliyetini ortadan kaldırmaz. Her mesaj değişiminde alta kaydırma da çalışıyor.

Önce mevcut küçük düzeltmelerin yeterli olup olmadığını ölç. Gerekirse eski mesajlar/kaynak bölümleri için kademeli gösterme veya mevcut imkanlarla görünür alan sınırlaması öner. Yeni virtualization bağımlılığına hemen geçme. Kullanıcı yukarı kaydırmışken akışın onu zorla aşağı çekmesi, kaynak bağlantıları, klavye odağı, kopyalama ve bütün sohbeti dışa aktarma davranışlarını kontrol et.

Çalışma kopyasında `askedBefore(messages, i)` mesaj haritasında çağrılıyor ve `slice(0, i)` oluşturuyor. Çok uzun sohbette her renderın ek dizi oluşturma maliyetini ölç; gerekirse yalnızca bu hesaplamayı düzelt. Sırf teorik karmaşıklık nedeniyle geniş refaktör yapma.

### 7. Dosya kartlarında ad göstermek için belge tekrar ayrıştırılıyor

Dosyalar: `app/export-ui.tsx`, `FileCards`; `app/chat.tsx`, `turnForAnswer`; `lib/export-doc.ts`, `turnOf`, `parseAnswer`.

Dosya adı için `fileNameOf(doc(), f)` aynı kartta iki kez çağrılıyor. `doc()` yolu cevap metnini `turnOf` üzerinden yeniden ayrıştırıyor. `useCallback` fonksiyon kimliğini korur; hesap sonucunu önbelleklemez.

Çok biçimli dosya kartında aynı cevabın yalnızca ad göstermek için tekrar tekrar ayrıştırılmasını ölç ve gerekliyse azalt. Ağır Word/PDF/Excel üreticilerinin mevcut dinamik import düzenini koru. Dosyanın içeriği, başlığı, kaynakları ve son revizyonu güncel kalmalı.

### 8. Sunucu beklemesi ile tarayıcı donması aynı ölçüm değildir

`lib/trace.ts` gibi belge eşleme/doğrulama işlemleri sunucuda maliyetli olabilir. Bunlar yanıt sonunu geciktirebilir; tek başına klavyenin veya yerel kaydırmanın takılmasını açıklamaz.

Tarayıcı renderı, ağ beklemesi, model kuyruğu ve doğrulama sürelerini ayrı kaydet. Öncelikle tarayıcı tarafındaki doğrulanmış maliyetlere odaklan. Bu performans işi için model talimatlarını, retrieval doğruluğunu, sayı kontrollerini veya güvenlik kontrollerini kaldırma.

## Daha önce alınan ölçümler ve sınırları

### Bilgisayarın genel durumu

Ön incelemede yaklaşık değerler:

| Ölçüm | Gözlem |
| --- | --- |
| Fiziksel RAM | 63,38 GiB |
| Kullanılabilir RAM | 13,4–14,6 GiB civarı |
| Bellek taahhüdü kullanımı | %86–87 |
| Pagefile kullanımı | 82,3 GiB civarı |
| Bellek sıkıştırma çalışma kümesi | 5,5 GiB civarı |
| Chrome süreçleri | 98 |
| Chrome çalışma kümeleri toplamı | 15,3 GiB civarı |
| WSL özel bellek | 45,5 GiB civarı |

Bu değerler bütün bilgisayara aittir; Zafer AI sekmesine mal edilemez. Çalışma kümesi toplamında ortak sayfalar sayılabilir; özel bellek tamamıyla fiziksel RAM değildir. Örneklenen anlarda `PagesInputPersec` ve `PageReadsPersec` sıfırdı; sürekli aktif swap olduğu kanıtlanmadı.

Yüksek sistem belleği kullanımı render sorununu ağırlaştırabilir; uygulama hatasını “daha fazla RAM al” diyerek kapatma. Chrome/Docker süreçlerini kapatma, pagefile/WSL/firewall/işletim sistemi ayarlarını değiştirme.

### Sentetik deneyler

Kurulu React + ReactMarkdown + remark-gfm ile Node üzerinde sentetik tablo metni ayrıştırma ve React HTML üretimi ölçüldü. Üç çalıştırmanın medyanı:

| Karakter | Süre |
| --- | --- |
| 4.173 | 15 ms |
| 16.485 | 44,8 ms |
| 65.661 | 173,7 ms |

16.485 karakterlik yanıtın 33 büyüyen parçasını yeniden işlemek toplam yaklaşık 397 ms sürdü. Bunlar tarayıcı FPS/INP ölçümü değildir, DOM layout/paint içermez, üretim performans garantisi vermez.

Gerçek `searchChats` fonksiyonuyla sentetik eşleşmeyen arama:

| Sohbet / mesaj | İçerik karakteri | Süre |
| --- | --- | --- |
| 100 / 1.200 | 2,34 milyon | 5,1 ms |
| 1.000 / 12.000 | 23,4 milyon | 35 ms |
| 5.000 / 60.000 | 117 milyon | 186,2 ms |

Bu veri kullanıcının gerçek arşivi değildir. Gerçek sekmenin JS heap'i, DOM sayısı, frame kaydı ve React Profiler kaydı alınmadı. Üretim sunucusunun RAM/GPU durumu da ölçülmedi. Bu boşlukları ölçüm yapılmış gibi sunma.

## Uygulama sırası

1. Mevcut memo/kaynak önizleme yamasını doğrula; zaten çözülmüş noktaları tekrarlama.
2. Yazarken ve akışta tetiklenen gereksiz pahalı hesaplamaları izole et: kaynak, arama, dosya kartı ve kütüphane.
3. Canlı Markdown güncellemelerini ölçülü hale getir; akış protokolünü ve iptal davranışını koru.
4. Dosya referansları ve gereksiz arşiv yeniden yüklemeleri için küçük, bağımsız düzeltmeleri yap.
5. Kalan maliyet veri hacmi/DOM ölçeğinden geliyorsa kademeli gösterme veya depolama ayrımını ayrı gerekçeli paket olarak sun.

Bu liste tüm maddeleri mutlaka değiştir talimatı değildir. Ölçümde etkisiz kalan veya mevcut yamayla çözülen noktaya dokunma. Her değişiklik belirli bir senaryo ve ölçümle bağlantılı olsun.

## Doğrulama ve kabul senaryoları

Gerçek kurumsal belge/sohbeti dışarı göndermeden, ayrı yerel test profili ve sentetik veriyle önce/sonra karşılaştır. Kullanıcının IndexedDB'sine test sohbetleri doldurma. Canlı modele gereksiz uzun test yükü gönderme; mümkünse akışı test ortamında sabit içerikle taklit et.

Şu senaryoları kapsa:

1. Boş yeni sohbet ve uzun sohbet: yazma, silme, yapıştırma ve imleç tepkisi.
2. Uzun tablolu cevap akarken yazma, kaydırma ve durdurma; akışın son parçası ve hata/metadata sınırları.
3. Kaynak kapalı/açık karşılaştırması; çok sayfalı PDF, binlerce satırlı tek sheet, uzun tek satırlı bölüm ve kaynak bağlantısıyla doğrudan büyük bölüme gitme.
4. Kaynakta “Devamını göster”: bütün içerik erişilebilir, tablo/kod bozulmuyor, odağın konumu korunuyor.
5. Sol sohbet araması dolu/boşken normal soru kutusunda yazma; Türkçe arama sonuçları doğru.
6. Kütüphane küçük/büyük ve klasörler kapalı/açık; 15 saniyelik yenilemede takılma, gereksiz ağaç/DOM üretimi.
7. Uzun arşiv açılışı, tek sohbet kaydı, yeniden adlandırma ve sabitleme; bütün arşiv gereksiz yeniden işlenmiyor.
8. İki sekmede aynı sohbet: mesajlar kaybolmuyor, eski kopya yenisini ezmiyor, restore ve silme geri alma çalışıyor.
9. Art arda dosya yükleme → çıkarma → yeni sohbet döngüleri; kullanılmayan referanslar bırakılıyor, devam eden şablon/yükleme korunuyor.
10. Çok formatlı dosya kartları: ad ve içerik güncel, Word/PDF/Excel/JSON çıktıları ve bütün sohbet dışa aktarımı doğru.
11. Kaynak bağlantıları, açık bölüm, mobil panel, Esc, odak geri dönüşü ve kullanıcı yukarıdayken kaydırma davranışı korunuyor.
12. Yetki değişikliği, oturum kapanması ve belge silinmesi: performans önbellekleri erişim sınırını bozmuyor.

Üretim derlemesinde ölç; geliştirme modu ve Strict Mode sonuçlarını ayrı tut. Tarayıcıya erişimin yoksa bunu açıkça söyle; Node sentetik sonuçlarını tarayıcı performansı diye raporlama.

Ölçümler: input-to-paint gecikmesi, uzun görev sayısı/süresi, React commit sayısı/süresi, canlı Markdown güncelleme sıklığı, DOM düğüm sayısı, JS heap trendi, IndexedDB okuma hacmi ve panel açılış süresi. Heap'te işlem sonrası kalıcı yükselme gözlenmeden “sızıntı çözüldü” deme. Tarayıcı ölçümü yapılabiliyorsa normal yazmada p95 etkileşim gecikmesi için başlangıç hedefi 100 ms altı olsun; ölçülmüş taban çizgisi ve test donanımını da kaydet. Bu hedef önceden sağlanmış sonuç değildir.

Mevcut ilgili testleri kullan; yalnızca değişikliğin anlamlı regresyonunu kapsayan dar test ekle. Geniş test altyapısı kurma. Aşama sonunda uygun kontroller: ilgili testler, `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`. Kaynak kısıtı veya ortam eksikliği varsa çalıştırılamayan kontrolü ve nedenini belirt. Build'in geçtiğini etkileşim performansının kanıtı sayma.

## Sınırlar ve son teslim

- Paket ekleme, framework değişimi, genel refaktör, görsel tasarım değişikliği yapma.
- Model davranışını/bağlamını, belge kapsamını veya kaynak doğrulamasını hız için budama.
- DB/schema/env/auth/deploy değişikliği gerekiyorsa ayrı gerekçelendir; mevcut yetki sınırlarının dışına sessizce çıkma.
- Sohbet geçmişini temizleme, IndexedDB'yi sıfırlama, dosya silme veya kullanıcıya veri kaybettiren geçici çözüm uygulama.
- Üretim servislerine müdahale etme; commit, push ve deploy yapma.
- Gerçek belgeleri, mesajları, heap dökümündeki özel içeriği veya anahtarları Git'e/rapora koyma.

İşin sonunda Türkçe olarak şunları ver:

1. Gerçekten doğrulanan nedenler; ölçülmeyen olasılıklar ayrı.
2. Mevcut yamadan korunanlar ve senin eklediğin değişiklikler.
3. Dosya bazında ne değişti, hangi maliyeti azalttı ve neden en küçük güvenli çözüm olduğu.
4. Önce/sonra ölçümleri; cihaz, build modu, veri hacmi ve senaryo bilgisiyle.
5. Test sonuçları, çalıştırılamayan kontroller ve kalan riskler.
6. Daha büyük tasarım gerektiren kalan işler varsa, bunları yapılan küçük düzeltmelerden ayıran kısa takip planı.

Performansın düzeldiğini yalnızca kodda `memo`/`useMemo` bulunduğu için ilan etme. Kullanıcı etkileşiminin ve gerçek işlevlerin birlikte korunduğunu göster.
