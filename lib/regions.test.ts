import { test } from "node:test";
import assert from "node:assert/strict";
import { isProvince, knownTerms } from "./regions.ts";

test("knownTerms: İBBS codes and agencies as fact, with their provinces", () => {
  const k = knownTerms("seçilen dosyaya göre TR33 bölgesi illerini özet bir tablo yapar mısın");
  assert.deepEqual(k.names, ["Manisa", "Afyonkarahisar", "Kütahya", "Uşak"]);
  assert.match(k.facts[0], /^TR33 \(İBBS Düzey 2 bölgesi, Zafer Kalkınma Ajansı\)/);
  assert.deepEqual(knownTerms("tr81 ve TR33'ün farkı").names, ["Zonguldak", "Karabük", "Bartın", "Manisa", "Afyonkarahisar", "Kütahya", "Uşak"]);
  assert.deepEqual(knownTerms("TR3 bölgesi").names, ["İzmir", "Aydın", "Denizli", "Muğla", "Manisa", "Afyonkarahisar", "Kütahya", "Uşak"]);
  assert.deepEqual(knownTerms("Zafer Kalkınma Ajansı bölgesindeki iller").names, ["Manisa", "Afyonkarahisar", "Kütahya", "Uşak"]);
  assert.deepEqual(knownTerms("TRB2 ve trc1").names, ["Van", "Muş", "Bitlis", "Hakkari", "Gaziantep", "Adıyaman", "Kilis"]);
  // Not codes: inside words, unknown numbers, lower-case level 1.
  for (const q of ["tra bir kelime", "STR33 parça", "TR99 yok", "tr3 küçük harf", "Trabzon"]) assert.deepEqual(knownTerms(q), { facts: [], names: [] }, q);
  assert.ok(isProvince("uşak") && isProvince("Afyon") && !isProvince("Banaz"));
});
