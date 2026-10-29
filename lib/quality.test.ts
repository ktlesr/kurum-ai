// Run: pnpm test. Reading-quality notes on extracted text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityNotes } from "./quality.ts";

const page = (n: number, t: string) => `--- Sayfa ${n} ---\n${t}`;
const prose = "Bölgesel kalkınma ajansı destek programı kapsamında başvurular değerlendirilir. ".repeat(6);

test("qualityNotes: a clean document has no notes", () => {
  assert.deepEqual(qualityNotes([1, 2, 3].map((n) => page(n, prose)).join("\n")), []);
  assert.deepEqual(qualityNotes("Kısa bir metin dosyası; sayfa işareti yok."), []);
});

test("qualityNotes: nearly empty pages among text pages are named (image pages)", () => {
  const [n] = qualityNotes([page(1, prose), page(2, "  12 "), page(3, prose), page(4, "")].join("\n"));
  assert.match(n, /^Sayfa 2, 4 neredeyse boş/);
  // a scan from start to end is the parser's own message, not this one
  assert.deepEqual(qualityNotes([page(1, ""), page(2, "")].join("\n")), []);
});

test("qualityNotes: pages of symbols", () => {
  const noise = "%&/()=?*+#$§½{[]}\|<>".repeat(15);
  assert.match(qualityNotes([page(1, prose), page(2, noise), page(3, prose)].join("\n"))[0], /^Sayfa 2 düzgün okunamamış/);
});

test("qualityNotes: Turkish read with the wrong code page, unreadable characters", () => {
  assert.match(qualityNotes("Baþvuru þartlarý ve Ýstihdam desteði için gerekli belgeler: kimlik, ikametgâh ðibi.")[0], /Türkçe harfler bozuk/);
  assert.match(qualityNotes("BaÅŸvuru ÅŸartlarÄ± ve Ã§alÄ±ÅŸan sayÄ±sÄ± ile Ã¼cret bilgisi.")[0], /Türkçe harfler bozuk/);
  assert.deepEqual(qualityNotes("İstihdam, başvuru, şartları, ığdır, ğ ş ı İ Ğ Ş: doğru Türkçe; Þ tek başına sorun değil."), []);
  assert.match(qualityNotes(`Ba�vuru �artlar� ve �stihdam �.`)[0], /5 okunamayan karakter/);
});

test("qualityNotes: tables of contents and number tables aren't noise", () => {
  const toc = Array.from({ length: 40 }, (_, i) => `${i + 1}. Bölüm başlığı ${"." .repeat(60)} ${i * 3 + 1}`).join("\n");
  const numbers = Array.from({ length: 60 }, (_, i) => `${i * 1234},5 | %${i},2 | ${i * 7}.000`).join("\n");
  assert.deepEqual(qualityNotes([page(1, prose), page(2, toc), page(3, numbers), page(4, prose)].join("\n")), []);
});

test("qualityNotes (review): a huge run of dots neither throws nor takes long", () => {
  const t0 = Date.now();
  qualityNotes([page(1, prose), page(2, ".".repeat(4_000_000)), page(3, prose)].join("\n"));
  qualityNotes([page(1, prose), page(2, ".".repeat(25 * 1024 * 1024))].join("
"));
  assert.ok(Date.now() - t0 < 5000);
});
