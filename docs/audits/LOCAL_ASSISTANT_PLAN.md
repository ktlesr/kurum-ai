# Kurum AI asistan davranışı: inceleme ve uygulama planı

Tarih: 2026-11-04. Girdi: `docs/audits/LOCAL_ASSISTANT_CLAUDE_PROMPT.md`. İnceleme kaynak kod üzerindendir. Bağımsız ikinci görüş için Codex (`codex exec -s read-only`) kullanıldı. Codex dosya değiştirmedi; `.env`, veri ve belge dosyalarını açmadı. Canlı model kalitesi bu incelemede ölçülmedi.

## 1. Mevcut akış

Tek ürün yolu Next.js uygulamasıdır: `app/` ve `lib/`, Dokploy ile `deploy/compose.yml` üzerinden çalışır. `kurum-ai/` klasöründeki Open WebUI kurulumu ayrı ve eski bir yoldur. Oradaki beceriler ve `import-skills.py` başlığı ana ürünü etkilemez.

Sohbet isteği (`app/api/chat/route.ts` → `POST`) şu sırayı izler:

1. **İstemci (`app/chat.tsx` → `send`).** Galeri, şablon ve "daha fazla" istekleri istemcide ayrılır; bunlar `local` turlar olarak model geçmişine girmez. Son 8 mesaj gönderilir. `think: false` sabittir.
2. **Belge seçimi.** Ekli belgeler kullanılır. Ek belge yoksa ve mesaj kaynak istiyorsa ad eşleşmesi yapılır, gerekirse model ad listesinden seçer.
3. **Bağlantılar ve web.** Mesajdaki URL'ler okunur (`web_fetch` ayarına bağlı). Belge yoksa model arama gerekip gerekmediğine karar verir; gerekiyorsa SearXNG'de arar.
4. **Soru yorumu (2026-11-03'ten beri).** `UNDERSTAND` adımında model, belgeyi görmeden, sorudaki kod, kısaltma ve grup ifadelerini açar. İBBS kodları ve kalkınma ajansları `lib/regions.ts` tablosundan resmi tanım olarak gelir.
5. **Bağlam.** Belge sığıyorsa tamamı verilir. Sığmıyorsa:
   - Soruda geçen adların satırları (`rowsNamed`) sığıyorsa onlar verilir.
   - Değilse soru sınıflandırılır (`CLASSIFY`): "TÜM" çıkarsa bölüm notları kullanılır (`digestOf`), "BELİRLİ" çıkarsa BM25 + anlamsal arama ile 6 parça alınır (`retrieve`).
6. **Kanıt kapısı (`EVIDENCE`).** Belirli bir olgu soruluyor ve belge bunu söylemiyorsa cevap yazdırılmaz, "Belgede yok." döner. Bu kapı yalnızca `SEARCH_URL` tanımlıyken çalışır.
7. **Cevap.** `SYSTEM` + belge bağlamı tek bir sistem mesajında gider, geçmiş arkasından eklenir.
8. **Sonrası.**
   - Kodla kontroller: sayı doğrulama (`verifyNumbers`), sayfa ve sütun kontrolleri, cümle izi (`traceClaims`).
   - Model kararıyla internete ek arama yapılabilir; sonuçlar ilgililik denetiminden (`RELEVANT`) geçer.

Bir belge sorusu böylece 3–6 model çağrısı yapar: yorum, sınıflama, kanıt, cevap, yargı, arama sorgusu ve ilgililik. Tek GPU kuyruğunda bu, çok kullanıcılı süreyi doğrudan etkiler (kabul senaryosu 20).

## 2. Brif bulgularının doğrulaması

Sınıf kısaltmaları: P = prompt kısıtı, M = uygulamada eksik mekanizma, U = model/sunucu uyumluluğu, G = gizlilik ve yetki sınırı.

| # | Bulgu | Sonuç (Claude + Codex) | Sınıf | Not |
|---|---|---|---|---|
| A | `SYSTEM` mutlak hesap yasağı ve "Belgede yok." zorunluluğu | Doğru | P | Belge bağlıyken belgeyle ilgisiz bir istek (çeviri, yazım) için ayrı yol yok. |
| B | Düşünme bütün profillerde kapalı | Doğru | U | Sağlayıcı `enable_thinking` gönderiyor ve hem `reasoning` hem `reasoning_content` alanını okuyor; eksik olan model bazlı politika ve ölçüm. Kapatılma nedeni (bozuk metin, döngü) MTP açıkken görüldü; MTP şu an kapalı, yeniden ölçülmedi. |
| C | Geçmiş 8 mesaj, arama sorusu son 2 kullanıcı mesajı | Doğru | M | İstemci ve sunucu ayrı ayrı kesiyor. |
| D | Araç çağırma döngüsü yok | Doğru | M + U | vLLM'de `--enable-auto-tool-choice`, `--tool-call-parser gemma4` ve araç şablonu da yok. |
| E | Tek geçişli arama, kayıplı notlar | Doğru, kısmen giderildi | M | `rowsNamed` ve soru yorumu, adlı sorularda tablo satırlarını kayıpsız veriyor; serbest metinde ikinci arama yok. |
| F | Görsel sonradan yeniden görülemiyor | Doğru | M | `Doc` yapısında özgün görsel saklanmıyor. |
| G | Sayı ve cümle kontrolleri sınırlı | Doğru | M | Arayüzdeki temkinli dil korunuyor. |
| H | Beceriler ayrı Open WebUI yolunda | Doğru | — | Ana ürünü etkilemiyor. |
| I | Dosya üretimi var, zincir parçalı | Doğru | M | Excel çok sayfalı ve tipli hücreli çıkıyor; eksik olan formül ve hesap doğrulaması. |
| J | `SEARCH_URL` varsayılan olarak SearXNG'ye gidiyor | Doğru | G | **Kullanıcı kararıyla çelişiyor; bkz. §3.** |
| K | Belge bağlamı sistem mesajında | Doğru | G | Web blokları ve not çıkarımı (`digestOf`) belgeyi zaten kullanıcı mesajında taşıyor; ana cevap ve kanıt çağrısı taşımıyor. |
| L | Altın set belge olgularını ölçüyor, taban çizgisi yok | Kısmen | — | **Puanlayıcı bozuk; bkz. §4.** |

## 3. Korunacak sınırlar ve kullanıcı kararları

Korunacaklar:
- Kullanıcı izolasyonu ve ortak klasör erişim kuralları (ACL).
- Oturum ve Origin kontrolleri.
- Salt okunur NAS erişimi.
- Modelin kendine yetki verememesi.
- Arama sorgusundan belge verisinin ayıklanması (`safeQuery`).
- Kod kontrolleri (sayı, sayfa, sütun).

Bunlara dokunulmayacak.

**Çelişki (J).** Brif ve Codex, varsayılan dış aramanın kapatılmasını ilk iş olarak öneriyor. Kullanıcı ise daha önce aramanın varsayılan olarak açık kalmasına ve aç/kapa düğmesi olmamasına karar verdi (2026-11-03). Ayrıca kanıt kapısı `SEARCH_URL` tanımlı olmasına bağlı: aramayı kapatmak yerel olgu denetimini de kapatır. Bu paket, kullanıcı onayı olmadan ve iki şey birbirinden ayrılmadan uygulanmayacak:
- kanıt kapısını `SEARCH_URL`'den bağımsız hale getirmek;
- "katı kapalı devre" profilini ayrı bir ortam değişkeni olarak eklemek.

## 4. Brifin kaçırdığı noktalar

1. **Altın set puanlayıcısı uygulamanın doğru ret cevabını "yanlış" sayıyor.** `scripts/eval-golden.mjs` içindeki `REFUSAL` deseni ne "Belgede yok." ne de "Sunulan belge bölümlerinde yok." cevabını tanıyor (doğrulandı). Bu düzelmeden yapılan hiçbir ölçüm güvenilir değil.
2. **Değerlendirme ve arayüz farklı ayarları ölçüyor.** Betik `--profile deep` için `think: true` gönderiyor, arayüz `false` gönderiyor.
3. **Model sıkıştırması.** vLLM Gemma 4 tarifi, 26B-A4B için 4-bit sıkıştırmanın küçük uzman boyutlarında kaliteyi düşürdüğünü yazıyor ve `int8_per_channel_weight_only` öneriyor. Deploy varsayılanı NVFP4 (4-bit). Bu bir ölçüm değil, bir risk. Yine de son günlerde görülen uydurma il, bozuk JSON ve düşünme sırasında bozulan metin bununla ilişkili olabilir.
3a. **31B dense adayı (model kartı, google/gemma-4-31B-it).** Bizim iş türlerimizde fark büyük:

    | Ölçüt | 31B | 26B-A4B |
    |---|---|---|
    | MRCR v2 128k (uzun bağlamda bilgi bulma) | 66.4 | 44.1 |
    | Tau2 (araçlı ajan görevleri) | 76.9 | 68.2 |
    | BigBench Extra Hard (akıl yürütme) | 74.4 | 64.8 |
    | MMLU Pro | 85.2 | 82.6 |

    Bedeli hız. Dense model token başına bütün ağırlıkları okur. GB10'un yaklaşık 273 GB/s bant genişliğinden kaba tahmin: BF16 (~62 GB) ~4 token/sn, FP8 (~31 GB) ~8 token/sn. 26B-A4B'de bu ~40–60 token/sn. Ayrıca kullanıcı başına 3–6 çağrı yapılıyor. Seçenekler:
    - 31B'yi FP8 ile **ikinci model** ("Derin analiz") olarak eklemek (`ALLOWED_MODELS`), ya da
    - karar çağrılarını 26B'de bırakıp yalnızca nihai cevabı 31B'ye vermek.

    İkisi de P1 ölçümüyle seçilir. Bellek: vLLM payı (`VLLM_GPU_MEMORY_UTILIZATION=0.5`, ~64 GB) iki modeli birlikte taşımaz. İki model aynı anda çalışacaksa bu pay yeniden hesaplanmalı (Docling ve Ollama da aynı belleği kullanıyor).
3b. **Örnekleme.** Model kartı `temperature 1.0`, `top_p 0.95`, `top_k 64` öneriyor. Uygulama her çağrıda `temperature 0` kullanıyor. Bu belirlenimcilik için bilinçli bir seçim, ancak Gemma'da 0 sıcaklıkta tekrar döngüleri görüldü (`lib/checks.ts` `isLooping` bunun için var). Değişiklik yalnızca P1 ölçümüyle yapılacak (brif §5.5).
4. **Bağlam payı.** `RESERVED_TOKENS` toplam 8192; cevap sınırı (`MAX_ANSWER`) da tek başına 8192. Sistem mesajı ve uzun geçmiş eklenince taşma mümkün.
5. **Yapılandırılmış çıktı.** Sağlayıcı yalnızca `json_object` gönderiyor. vLLM `json_schema` destekliyor; şablon doldurma ve soru yorumu şemayla kısıtlanabilir.

## 5. Hedef davranış sözleşmesi (sistem promptu çekirdeği)

Brifin §4'teki önerisi, gerçek yeteneklere göre şu şartlarla uygulanacak:
- **Hesap.** "Yerel hesaplama aracını kullan" cümlesi, araç (P4) gelene kadar prompta girmeyecek. Ara dönemde: "Hesap gerekiyorsa işlemi ve girdileri göster; sonuç kod kontrolünden geçmez, 'hesaplanan' diye belirt."
- **"Belgede yok."** Bu ifade yalnızca belgeye ait bir olgu soruluyorsa kullanılacak. Belge bağlıyken belgeyle ilgisiz istekler normal asistan gibi cevaplanacak.
- **Kapsam.** Yalnızca ilgili bölümler görüldüyse "belgenin tamamında yok" denmeyecek. Bu kural zaten "Sunulan belge bölümlerinde yok." ifadesiyle var.

## 6. İş paketleri (öncelik sırasıyla)

Her paket ayrı bir diff, dar bir test, geri alma yolu ve kabul ölçütü içerir. Deploy, ortam değişkeni ve compose değişiklikleri **kullanıcı onayıyla** yapılır.

| Sıra | Paket | Sınıf | Dosyalar | Kabul | Risk / geri alma |
|---|---|---|---|---|---|
| **P0** | Ölçümü düzelt: ret desenine uygulamanın iki standart cevabını ekle; `deep` profili arayüzle aynı ayarları göndersin (`scope: all`, `think: false`); bir `--think` bayrağı ayrı olsun. | M | `scripts/eval-golden.mjs` | "Belgede yok." ve "Sunulan belge bölümlerinde yok." ret sayılır; olumlu bir cevap ret sayılmaz (saf fonksiyon testi). | Çok düşük; yalnızca betik. |
| **P1** | Model taban çizgisi: aynı altın sette NVFP4 ile `google/gemma-4-26B-A4B-it` + `--quantization int8_per_channel_weight_only` karşılaştırması; düşünme açık ve kapalı; **31B dense FP8** (§4 madde 3a), ilk token süresi ve token/sn dahil. | U | `deploy/compose.yml` (ortam değişkeni), rapor | Doğruluk, ret doğruluğu, ilk token süresi ve toplam süre tablosu. | vLLM yeniden başlar; **onay gerekir**. Geri alma: `VLLM_MODEL` eski değerine. |
| **P2** | Belge verisini talimattan ayır: ana cevap ve kanıt çağrısında belge bağlamı kullanıcı mesajına taşınsın. | G | `app/api/chat/route.ts` | Sahte sağlayıcıyla mesaj rolleri test edilir; sentetik "önceki kuralları unut" belgesi; altın sette gerileme yok. | Düşük–orta; prefix cache davranışı değişir. |
| **P3** | `SYSTEM` düzeltmesi: "Belgede yok." yalnızca belge olgusu için; belgeyle ilgisiz istek normal cevaplanır; hesap yasağı yerine "hesabı göster, 'hesaplanan' de". | P | `route.ts` | Senaryo 2, 3, 4, 5 (brif §6) önce ve sonra. | Model regresyonu; P0 ve P1 ölçümü şart. |
| **P4** | **Uygulanan kapsam (2026-11-04):** Cevapta "a + b = c" biçiminde yazılan her hesap kodla yeniden yapılır (`lib/calc.ts`). Doğru sonuç, girdilerinin hepsi kaynakta varsa ya da kendileri böyle türetilmişse "kaynakta yok" diye işaretlenmez. Yanlış sonuç "Tutmayan hesap … (doğrusu X)" olarak gösterilir. Hesabın tamamı görülemiyorsa karar verilmez. **Kapsam dışı, P6'ya:** Modelin belge hücrelerini seçip hesabı araca yaptırması, ayrıca işlemi yazılmamış bir sonucun ("Toplam 400 TL") denetimi. Bu, hangi hücrelerin toplandığını bilmeyi gerektirir; araç çağırma gelince yapılabilir. | M | `lib/calc.ts`, `lib/checks.ts` (`knownNumbers`), `route.ts`, `app/chat.tsx` | Senaryo 4; yazılı hesabın doğru sonucu "kaynakta yok" diye işaretlenmez, yanlışı yakalanır. | Orta. |
| **P5** | Bağlam bütçesi: sistem + geçmiş + belge + cevap aynı bütçeden düşer; geçmiş token bütçeli olur, yalnızca 8 mesaj değil. | M | `lib/context.ts`, `route.ts`, `app/chat.tsx` | Senaryo 7 ve 8; taşma testi. | Orta. |
| **P6** | **Uygulanan kapsam (2026-11-04):** vLLM `--enable-auto-tool-choice --tool-call-parser=gemma4` ve imajdaki `tool_chat_template_gemma4.jinja` (compose, env ile geri alınır). Belge bağlama sığmadığında cevaptan önce salt okunur ikinci bakış (`lib/lookup.ts`): `belgede_ara`, `bolum_oku`, `hesapla`; en çok 3 adım, token ölçülü alan, tekrar/hata/iptal sınırları; bulunanlar belgeler bloğuna eklenir, kanıt kapısı ve kontroller aynen. `hesapla` cevap çağrısında her zaman sunulur; işlenen sayılar belgede olmalı, hesap BigInt ile tam. Sunucu araçları reddederse kendiliğinden kapanır; Ollama'da kapalı. **Canlı doğrulama bekliyor.** | U + M | compose, `lib/provider.ts`, `route.ts` | Senaryo 6, 9, 10, 18, 19. | Yüksek; ayrı aşama. |
| **P7** | Katı kapalı devre profili (J) ve kanıt kapısının `SEARCH_URL`'den ayrılması. | G | compose, `route.ts` | Senaryo 16, 17. | **Kullanıcı kararı gerekir.** |
| **P8** | Görsel yeniden okuma (F) ve beceri kataloğu (H). | M | — | Senaryo 11. | Saklama, kota ve izolasyon tasarımı gerekir. |

Yalnızca promptla çözülecek olan: P3. Kod gerektirenler: P0, P2, P4, P5, P6, P8. Model ve sunucu gerektirenler: P1, P6. Yetki ve gizlilik kararı gerektiren: P7.

## 7. Ölçülen ile varsayılan

**Ölçülen (2026-11-04):**
- Birim testleri: 335/335 (2026-11-03, son push öncesi).
- `REFUSAL` deseninin standart ret cevaplarını tanımadığı kaynak koddan doğrulandı.

**Çalıştırılmayan:**
- Canlı altın set.
- Gerçek model ile önce/sonra karşılaştırması.
- Araç çağırma parser'ının NGC `26.09` imajında çalışıp çalışmadığı.
- Ağ çıkışı ve izolasyon testi.

**Varsayım:** NVFP4'ün kalite kaybı; MTP kapalıyken düşünmenin düzgün çalışacağı; 31B dense'in GB10'da yaklaşık 4 token/sn (BF16) hız vereceği (bant genişliğinden tahmin).

## 8. İlk değişiklik

**P0:** `scripts/eval-golden.mjs` dosyasında ret deseni ve profil düzeltmesi. Saf fonksiyon testiyle gelir; uygulama davranışına ve deploy'a dokunmaz. Sonraki her paketin "gerileme yok" kanıtı bu ölçüme dayanacağı için önce bu yapılmalı.
