import { test } from "node:test";
import assert from "node:assert/strict";
import { citedPages, has, profileOptions, refuses } from "./golden-score.ts";

test("refuses: the app's own 'not in the document' answers count; an answer with the fact doesn't", () => {
  for (const a of ["Belgede yok.", "Sunulan belge bölümlerinde yok.", "Belgede yok.\n\nGenel bilgime göre: …", "Bu bilgi belgede yer almamaktadır."]) assert.ok(refuses(a), a);
  assert.ok(!refuses("Toplam bütçe 1.250.000 TL'dir (Sayfa 4)."));
  assert.ok(!refuses("Toplam bütçe 1.250.000 TL'dir. Süre 18 aydır. Ek bilgi belgede yok."), "an aside after the facts isn't a refusal");
});

test("has, citedPages: numbers in any notation, pages and ranges", () => {
  assert.ok(has("Bütçe 1.250.000 TL", "1250000"));
  assert.ok(!has("Bütçe 120 TL", "20"));
  assert.ok(has("30 milyon TL ayrıldı", "30 milyon"));
  assert.deepEqual(citedPages("Sayfa 3 ve Sayfa 5-7"), [3, 5, 6, 7]);
});

test("profileOptions: deep is what the UI sends (whole document, no thinking); thinking only when asked", () => {
  assert.deepEqual(profileOptions("deep", false), { scope: "all" });
  assert.deepEqual(profileOptions(undefined, false), {});
  assert.deepEqual(profileOptions("deep", true), { scope: "all", think: true });
});
