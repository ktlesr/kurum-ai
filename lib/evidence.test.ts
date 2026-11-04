// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatePolicy, parseGate, quoteInDocs } from "./evidence.ts";

test("parseGate: reads the two lines, however the model dresses them", () => {
  assert.deepEqual(parseGate("TÜR: ANALİZ\nALINTI: YOK"), { kind: "analysis" });
  assert.deepEqual(parseGate("TÜR: GENEL\nALINTI: YOK"), { kind: "general" });
  assert.deepEqual(parseGate("**TÜR:** genel"), { kind: "general" });
  assert.deepEqual(parseGate("**TÜR:** analiz"), { kind: "analysis" });
  assert.deepEqual(parseGate("tür: olgu\nalıntı: yok"), { kind: "fact", quote: null });
  assert.deepEqual(parseGate("TÜR: OLGU\nALINTI: YOK."), { kind: "fact", quote: null });
  assert.deepEqual(parseGate('TÜR: OLGU\nALINTI: "Kurum merkezden oluşur."'), { kind: "fact", quote: "Kurum merkezden oluşur." });
});

test("parseGate: anything else is no verdict, so the usual answer goes ahead", () => {
  for (const raw of ["", "Bilmiyorum", "ALINTI: YOK", "TÜR: OLGU"]) assert.equal(parseGate(raw), null, raw);
});

test("quoteInDocs: finds it across line breaks and letter case; an invention or a bare name doesn't pass", () => {
  const docs = ["Başka metin.", "MADDE 7- Başkanlık,\nTürk İşbirliği Ajansı Başkanlığını ifade eder."];
  assert.ok(quoteInDocs("başkanlık, türk işbirliği ajansı başkanlığını", docs));
  assert.ok(!quoteInDocs("493. madde Türk İşbirliği Ajansına aittir", docs));
  assert.ok(quoteInDocs("Başka metin.", docs));
  assert.ok(!quoteInDocs("", docs));
});

test("quoteInDocs: an altered number or a part of a word isn't the document's text", () => {
  const docs = ["Bedel 15,00 TL, süre 130 gündür, fark -20."];
  assert.ok(quoteInDocs("Bedel 15,00 TL", docs));
  assert.ok(!quoteInDocs("Bedel 1500 TL", docs));
  assert.ok(!quoteInDocs("30 gündür", docs));
  assert.ok(quoteInDocs("fark -20", docs));
  assert.ok(!quoteInDocs("fark 20", docs));
  assert.ok(!quoteInDocs("Oran 20.", ["Oran 20% oldu."]));
  assert.ok(!quoteInDocs("20 kişi geldi.", ["-20 kişi geldi."]));
  assert.ok(!quoteInDocs("Bedel 15", docs));
  assert.ok(quoteInDocs("Süre 30 gündür.", ["Süre 30 gündür. Sonra biter."]));
  assert.ok(quoteInDocs("Toplam 20", ["Toplam 20, kalan 5."]));
});

test("gatePolicy: a plain request skips document checks unless its words are about the document; 'not stated' only where the gate ran", () => {
  const quoted = (q: string) => q === "Bütçe 5 TL'dir.";
  const general = { kind: "general" } as const;
  assert.deepEqual(gatePolicy(general, { ofDoc: false, factGate: true, quoted }), { general: true, analysis: true, unstated: false });
  assert.deepEqual(gatePolicy(general, { ofDoc: true, factGate: true, quoted }), { general: false, analysis: false, unstated: false }, "about the document: checks stay");
  assert.equal(gatePolicy({ kind: "fact", quote: null }, { ofDoc: false, factGate: true, quoted }).unstated, true);
  assert.equal(gatePolicy({ kind: "fact", quote: null }, { ofDoc: false, factGate: false, quoted }).unstated, false, "no web part / whole document: no forced refusal");
  assert.equal(gatePolicy({ kind: "fact", quote: "Bütçe 5 TL'dir." }, { ofDoc: false, factGate: true, quoted }).unstated, false);
  assert.equal(gatePolicy({ kind: "fact", quote: "uydurma" }, { ofDoc: false, factGate: true, quoted }).unstated, true);
  assert.deepEqual(gatePolicy(null, { ofDoc: false, factGate: true, quoted }), { general: false, analysis: false, unstated: false });
});
