// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { docSections, parseSource } from "./context.ts";

test("docSections splits on page and sheet markers, keeps the outline", () => {
  const t = "Özet satırı\n--- Sayfa 1 ---\nbir\n--- Sayfa 2 ---\niki\n## Sheet: Bütçe\n| a |";
  assert.deepEqual(docSections(t), [
    { label: "Başlangıç", text: "Özet satırı" },
    { label: "Sayfa 1", text: "bir" },
    { label: "Sayfa 2", text: "iki" },
    { label: "Sheet: Bütçe", text: "| a |" },
  ]);
  assert.deepEqual(docSections("düz metin"), [{ label: "", text: "düz metin" }]);
});

test("parseSource maps chips to doc + section", () => {
  const names = ["rapor.pdf", "tablo.xlsx"];
  assert.deepEqual(parseSource("Sayfa 3 – 5", ["rapor.pdf"]), { doc: "rapor.pdf", label: "Sayfa 3" });
  assert.deepEqual(parseSource("tablo.xlsx · Sheet: Bütçe", names), { doc: "tablo.xlsx", label: "Sheet: Bütçe" });
  assert.deepEqual(parseSource("rapor.pdf", names), { doc: "rapor.pdf", label: undefined });
  assert.equal(parseSource("yok.pdf · Sayfa 1", names), null);
});
