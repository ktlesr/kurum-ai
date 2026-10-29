// Run: pnpm test. Chunking for retrieval and scans: locations, coverage, sizes, section headings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, isHeading, windows } from "./chunk.ts";

const para = (w: string, n: number) => Array.from({ length: n }, (_, i) => `${w} cümlesi ${i} burada anlatılır ve devam eder.`).join("\n");

test("chunkText: every chunk carries its page or sheet; front matter is 'Başlangıç'", () => {
  const text = `Özet notlar\n--- Sayfa 1 ---\n${para("bir", 3)}\n--- Sayfa 2 ---\n${para("iki", 3)}\n## Sheet: Bütçe\n| a | b |`;
  const cs = chunkText("r.pdf", text);
  assert.deepEqual(cs.map((c) => c.label), ["Başlangıç", "Sayfa 1", "Sayfa 2", "Sheet: Bütçe"]);
  assert.ok(cs.every((c) => c.doc === "r.pdf"));
  assert.deepEqual(chunkText("t.txt", "düz metin").map((c) => c.label), ["Bölüm 1"]);
});

test("chunkText: long pages are cut within the size, overlapping, and nothing is lost", () => {
  const body = para("uzun", 400);
  const cs = chunkText("r.pdf", `--- Sayfa 7 ---\n${body}`, 2000);
  assert.ok(cs.length > 5);
  assert.ok(cs.every((c) => c.text.length <= 2000 + 200 && c.label === "Sayfa 7"), String(Math.max(...cs.map((c) => c.text.length))));
  for (const line of body.split("\n")) assert.ok(cs.some((c) => c.text.includes(line)), line);
});

test("windows: consecutive pages merge up to the limit with a range label", () => {
  const text = [1, 2, 3, 4].map((n) => `--- Sayfa ${n} ---\n${para(`s${n}`, 5)}`).join("\n");
  const ws = windows([{ name: "r.pdf", text }], 700);
  assert.ok(ws.length >= 2);
  assert.match(ws[0].label, /^Sayfa 1( – \d+)?$/);
  assert.ok(ws.every((w) => w.text.length <= 700 + 50));
});

test("isHeading: headings in, sentences and table rows out", () => {
  for (const h of ["# Giriş", "3.2. Destek Oranları", "4) Uygun Maliyetler", "MADDE 5 – Başvuru", "BÖLÜM 2", "PROJE BÜTÇESİ VE FİNANSMAN", "1 Amaç ve Kapsam"]) assert.ok(isHeading(h), h);
  for (const t of ["Destek oranı %50'dir.", "| Kalem | Tutar |", "1. Başvuru sahibi vergi mükellefi olmalıdır.", "kısa", "TL", "Not:", "2025"]) assert.ok(!isHeading(t), t);
});

test("chunkText: a cut falls before a heading; a chunk in the middle of a section carries its heading, across pages", () => {
  const text = `--- Sayfa 1 ---\n3.2. Destek Oranları\n${para("oran", 30)}\n4. Uygun Maliyetler\n${para("maliyet", 30)}\n--- Sayfa 2 ---\n${para("devam", 10)}`;
  const cs = chunkText("r.pdf", text, 1600);
  assert.ok(cs.some((c) => c.text.startsWith("4. Uygun Maliyetler")), "a chunk starts at the heading");
  assert.ok(!cs.some((c) => /4\. Uygun Maliyetler/.test(c.text) && /oran cümlesi/.test(c.text.split("4. Uygun Maliyetler")[1] ?? "")), "no section's text after the next heading in the same chunk");
  const mid = cs.find((c) => c.text.includes("oran cümlesi 25"))!;
  assert.ok(mid.text.startsWith("[3.2. Destek Oranları]") || mid.text.startsWith("3.2. Destek Oranları"), mid.text.slice(0, 60));
  const p2 = cs.find((c) => c.label === "Sayfa 2")!;
  assert.ok(p2.text.startsWith("[4. Uygun Maliyetler]"), p2.text.slice(0, 60));
});

test("chunkText: a large document with many headings stays fast", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `--- Sayfa ${i + 1} ---\n${i + 1}. Bölüm Başlığı ${i}\n${para(`p${i}`, 25)}\nALT BAŞLIK ${i}\n${para(`q${i}`, 25)}`).join("\n");
  const t0 = Date.now();
  const cs = chunkText("b.pdf", text);
  assert.ok(cs.length > 3000);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms, ${text.length} chars`);
});

test("chunkText (review): an unpaged 25 MB text with many headings is linear; windows keep their limit", () => {
  const block = `3.1. Başlık\n${"metin satırı burada devam eder ".repeat(4)}\n`;
  const big = block.repeat(Math.ceil((25 * 1024 * 1024) / block.length));
  const t0 = Date.now();
  chunkText("b.txt", big);
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0} ms`);
  const ws = windows([{ name: "x", text: `# Heading\n${"x".repeat(1000)}` }], 200);
  assert.ok(ws.every((w) => w.text.length <= 200), ws.map((w) => w.text.length).join(","));
  assert.ok(!isHeading("MADDE 5 kapsamında yapılacak başvurular değerlendirilir…"));
});

test("chunkText (review 2): a long heading can't push a window past its limit; any overlap still ends", () => {
  const ws = windows([{ name: "x", text: `# ${"H".repeat(100)}\n${"x".repeat(1000)}` }], 100);
  assert.ok(ws.every((w) => w.text.length <= 100), ws.map((w) => w.text.length).join(","));
  const cs = chunkText("x", "x".repeat(1000), 200, 200);
  assert.ok(cs.length > 0 && cs.length <= 1000);
});

test("chunkText (review 3): tiny windows get no prefix and keep their limit", () => {
  for (const size of [1, 2, 3, 8, 15]) {
    const cs = chunkText("x", `# Başlık\n${"y".repeat(60)}`, size, 0);
    assert.ok(cs.every((c) => c.text.length <= size), `${size}: ${cs.map((c) => c.text.length).join(",")}`);
  }
});
