# TASK-012: Premium arayüz ve gece/gündüz teması (FAZ 3)

**Kapsam**
- **Tasarım token'ları** (plan §3.1 paleti): lacivert `#14263D` metin/marka, mavi `#2E5E8C` vurgu, açık gri `#EDF3F8` yüzey, yeşil yalnızca onay durumlarında. Gece teması lacivert tonlarında. Her metin/arka plan çifti ölçüldü: gündüz en düşük 5.3:1, gece 5.9:1 (WCAG AA ≥ 4.5).
- **Tema:** varsayılan gündüz (plan); üç durumlu düğme Gündüz → Gece → Sistem; boyamadan önce uygulanır (titreme yok); sistem modunda işletim sistemi değişikliği izlenir.
- **Kabuk:** sol gezinme (marka, Yeni sohbet, arama, geçmiş, Belgelerim, yerel veri/yedek, hesap), orta çalışma alanı, sağ **kaynak paneli**. Mobilde sol menü çekmece, kaynak paneli tam ekran.
- **Ana ekran:** saate göre selamlama + geniş composer (ataç, dosya çipleri) + hazır işler: Özetle, Karşılaştır (≥2 belge), Rakamları kontrol et, Şartları çıkar, Ana başlıklar, Sütunları açıkla (tablo varsa).
- **İşlem profilleri** gerçek parametrelere bağlı: Otomatik = düşünme açık + sunucu kapsamı seçer (önceki varsayılan); Hızlı = düşünme kapalı; Derin analiz = düşünme açık + `scope: "all"` (sığmazsa bölüm bölüm tarama).
- **Kaynak paneli:** cevaptaki kaynak çipine ya da belge kartına tıklayınca belgenin çıkarılmış metni sayfa/sheet bölümleriyle açılır, atıf yapılan bölüme kaydırılıp vurgulanır. Yeni uç: `GET /api/upload?id=` — sahiplik denetimli, başkasının belgesi 404 (izolasyon testine eklendi). Görseller/dış bağlantılar cevaplardaki gibi devre dışı.
- **Erişilebilirlik:** her yerde görünür klavye odağı, `prefers-reduced-motion`, radyo grubu olarak profil seçici, `aria-current` ile açık sohbet, ikon düğmelerde etiket, Esc: önce akışı durdurur, yoksa paneli kapatır.

**Kabul (Chrome, sahte Ollama ile tam akış)**

| Kriter | Sonuç |
|---|---|
| Gündüz: selamlama, composer, hazır işler, geçmiş, belgeler | ✅ ekran görüntüsü |
| Hazır iş → akışlı cevap, tablo, kaynak çipi | ✅ |
| Kaynak çipi → sağ panelde belge metni | ✅ |
| Gece teması tüm yüzeylerde | ✅ |
| `docSections`/`parseSource` birim testleri; `pnpm test` 56/56, `tsc`, `lint` | ✅ |

**Bilinen sınırlar:** dar ekran görünümü bu oturumda tarayıcıda ölçülemedi (pencere yeniden boyutlanmadı); Playwright ile mobil/klavye E2E sonraki iş. Orijinal PDF sayfa görüntüsü yok — panel çıkarılmış metni gösterir (açıkça belirtiliyor).

**Codex bulguları ve karar**
