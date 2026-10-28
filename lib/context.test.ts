// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { docSections, linkPages, parseSource, type ChatMeta, type MdNode } from "./context.ts";

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
  // A name containing the separator resolves to itself, not to a shorter name before it.
  assert.deepEqual(parseSource("a.pdf · ek.pdf · Sayfa 1", ["a.pdf", "a.pdf · ek.pdf"]), { doc: "a.pdf · ek.pdf", label: "Sayfa 1" });
  assert.deepEqual(parseSource("a.pdf · ek.pdf", ["a.pdf", "a.pdf · ek.pdf"]), { doc: "a.pdf · ek.pdf", label: undefined });
  assert.equal(parseSource("a.pdf · ek.pdf · Sayfa 1", ["a.pdf"]), null); // the long-named doc is gone
  assert.equal(parseSource("a.pdf · Sayfa 2.pdf · Sayfa 1", ["a.pdf"]), null);
  assert.deepEqual(parseSource("a.pdf · Sayfa 3 – 5", ["a.pdf", "b.pdf"]), { doc: "a.pdf", label: "Sayfa 3" });
  // Single-document answer: resolved against its own doc only.
  assert.deepEqual(parseSource("Sayfa 4", ["b.pdf", "rapor.pdf"], "rapor.pdf"), { doc: "rapor.pdf", label: "Sayfa 4" });
  assert.equal(parseSource("Sayfa 4", ["b.pdf"], "rapor.pdf"), null);
});

test("linkPages links single-doc page refs in text only; only existing pages; skips code, links, several docs", () => {
  const meta = { mode: "full" as const, sources: ["rapor.pdf"], doc: "rapor.pdf", pages: [1, 2, 3, 4], unverified: [], uncertain: [] };
  const run = (tree: MdNode, ...m: [ChatMeta?]) => (linkPages(m.length ? m[0] : meta, "n1")()(tree), tree);
  const para = (...children: MdNode[]) => ({ type: "root", children: [{ type: "paragraph", children }] });
  const t = (value: string) => ({ type: "text", value });
  assert.deepEqual(run(para(t("Bkz. Sayfa 04 ve Sayfa 9."))), para(
    t("Bkz. "), { type: "link", url: "#sayfa-n1-4", children: [t("Sayfa 04")] }, t(" ve Sayfa 9."),
  ));
  const kept = () => para({ type: "inlineCode", value: "Sayfa 4" }, { type: "linkReference", children: [t("Sayfa 4")] }, { type: "code", value: "Sayfa 4" });
  assert.deepEqual(run(kept()), kept());
  assert.deepEqual(run(para(t("Sayfa 4")), { ...meta, doc: undefined, sources: ["a.pdf · Sayfa 4", "b.pdf · Sayfa 2"] }), para(t("Sayfa 4")));
  assert.deepEqual(run(para(t("Sayfa 4")), { ...meta, doc: undefined, sources: ["a.pdf", "b.pdf"] }), para(t("Sayfa 4")));
  assert.deepEqual(run(para(t("Sayfa 4")), undefined), para(t("Sayfa 4")));
  // No page markers (TXT/DOCX): pages can't be checked, so no links.
  assert.deepEqual(run(para(t("Sayfa 4")), { ...meta, pages: undefined }), para(t("Sayfa 4")));
});
