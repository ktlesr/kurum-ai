# TASK-032: Görsel Stüdyo genişletme ve Sunum modu

Kullanıcı stüdyoyu yetersiz buldu; iki repoyu (presenton, HyCanvas) ve şu kaynakları incelememizi istedi: gridaco/library,
Coolshapes, Kromatika, Open Color. Plan §6.1'deki "kod alınmaz" kararı veri için değişti (aşağıda).

## Biten
- Format değişince düzenlemeler korunur (`refit`), sağ tık menüsü, çoklu seçim ve birbirine göre hizalama/dağıtma.
- Şekil kütüphanesi, kenarlık, gölge, döndürme, çevirme, eğik/altı çizili yazı.
- Yazı tipleri: 22 OFL aile, bilgisayardaki yazı tipleri (Chrome/Edge izinle), dosya yükleme.
- 16 tema (renk + yazı tipi eşleşmesi), Open Color paleti, 114 hazır şekil (Coolshapes).
- Sunum: 16 presenton şablonu, 273 düzen; taslak → düzen seçimi → alan doldurma; PPTX.

## Kaynak kararları
| Kaynak | Lisans | Karar |
| --- | --- | --- |
| presenton şablon JSON'ları | Apache-2.0 | Alındı, `scripts/import-presenton.py` ile çevrildi; `public/slides/NOTICE.txt`. PNG/JPG sanat ve Proxima Nova (ticari) alınmadı. Şablon SVG'lerinin ayrı lisans bilgisi yok; kök lisansa dayanıyoruz. |
| HyCanvas | AGPL-3.0 | Kod alınmadı; yalnızca özellik listesi fikir olarak kullanıldı. |
| Coolshapes | MIT | Alındı (paket kodu çalıştırılmadan metinden ayrıştırıldı). Beş dosyadaki kaynak hatası düzeltildi. |
| Open Color | MIT | Alındı (palet, temalar). |
| Kromatika | MIT | Alınmadı: Open Color yeterli, okunabilirlik kendi testimizde. |
| gridaco/library | CC0 | Alınmadı: repoda hazır varlık değil üretim betikleri var. |

## Sınırlar
- Grafik, tablo ve infografik içeren düzenler bu sürümde yok (110 düzen).
- Model ikon seçmez: ikon yerine küçük bir işaret çizilir.
- PPTX'e yazı tipi gömülmez. PowerPoint'te gerçek açılış henüz denenmedi: dosya python-pptx ile doğrulandı.
- Modelle uçtan uca üretim denenmedi: tarayıcı testinde model yanıtı taklit edildi.

## Bekleyen
- Sunum için Codex incelemesi (limit nedeniyle ertelendi), sonra `main`e birleştirme.
