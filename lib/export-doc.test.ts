import assert from "node:assert/strict";
import test from "node:test";
import { cellValue, exportDoc, fileNameOf, parseAnswer, sheetsOf, textOf, toJson, toMarkdown, toText, turnOf } from "./export-doc.ts";
import { exportRequest } from "./export-intent.ts";

const ANSWER = `# Yatırım Özeti

**Önemli** bir *bilgi* ve \`kod\`, ayrıca [site](https://zafer.org.tr) ile [yerel](#sayfa-1).

## Bölgeler

- Birinci
  - İç madde
- İkinci

1. Bir
2. İki

| İl | Tutar | Oran | Kod |
|:---|---:|---|---|
| Afyon | 1.250,50 | %42 | 0123 |
| Uşak | 300 | 12,5% | abc |

> Bir alıntı

\`\`\`js
a < b
\`\`\`

---
Son söz.`;

test("the answer reads into blocks with its styles, lists and tables", () => {
  const b = parseAnswer(ANSWER);
  assert.deepEqual(b.map((x) => x.kind), ["heading", "paragraph", "heading", "list", "list", "table", "quote", "code", "rule", "paragraph"]);
  const p = b[1];
  assert.ok(p.kind === "paragraph");
  assert.ok(p.inlines.some((i) => i.bold && i.text === "Önemli"));
  assert.ok(p.inlines.some((i) => i.italic && i.text === "bilgi"));
  assert.ok(p.inlines.some((i) => i.code && i.text === "kod"));
  assert.equal(p.inlines.find((i) => i.text === "site")?.link, "https://zafer.org.tr");
  assert.equal(p.inlines.find((i) => i.text === "yerel")?.link, undefined, "an in-app link isn't a link in a file");
  const list = b[3];
  assert.ok(list.kind === "list" && list.items[0].some((x) => x.kind === "list"), "nested");
  const t = b[5];
  assert.ok(t.kind === "table");
  assert.deepEqual(t.aligns, ["left", "right", null, null]);
  assert.equal(textOf(t.rows[0][1]), "1.250,50");
  // Scripts in an answer stay text.
  assert.equal(JSON.stringify(parseAnswer("<script>alert(1)</script>")).includes("<script"), false);
});

const doc = () => exportDoc([turnOf({ question: "Yatırımları özetle", answer: ANSWER, sources: ["Sayfa 3", "Sayfa 3"], web: [{ title: "Site", url: "https://a.org" }] })], "Sohbet", new Date(2026, 10, 1, 9, 5).getTime());

test("title and file name", () => {
  const d = doc();
  assert.equal(d.title, "Yatırım Özeti", "what the answer calls itself");
  assert.equal(fileNameOf(d, "docx"), "Yatırım Özeti 2026-11-01.docx");
  assert.equal(exportDoc([turnOf({ question: "Bu ne?", answer: "Düz." })]).title, "Bu ne?");
  const bad = exportDoc([turnOf({ question: 'a/b:c*d?"e<f>|g\\h ... ', answer: "x" })], undefined, d.createdAt);
  assert.equal(fileNameOf(bad, "pdf"), "a b c d e f g h 2026-11-01.pdf");
  assert.equal(exportDoc([turnOf({ answer: "x" })], undefined, d.createdAt).title, "Zafer AI cevabı");
  assert.equal(fileNameOf(exportDoc([turnOf({ question: "CON...", answer: "x" })], undefined, d.createdAt), "md"), "CON 2026-11-01.md");
});

test("plain text, markdown and JSON", () => {
  const txt = toText(doc());
  assert.ok(txt.startsWith("Yatırım Özeti\n"));
  assert.ok(txt.includes("Soru: Yatırımları özetle"));
  assert.ok(txt.includes("- Birinci") && txt.includes("  - İç madde"));
  assert.ok(txt.includes("1. Bir") && txt.includes("2. İki"));
  assert.match(txt, /İl\s+Tutar\s+Oran\s+Kod/);
  assert.ok(!txt.includes("**") && !txt.includes("|"), "no markup left");
  assert.ok(txt.includes("Kaynaklar:\n- Sayfa 3\n- Site: https://a.org"));
  const md = toMarkdown(doc());
  assert.ok(md.includes(ANSWER.split("\n").slice(2).join("\n").trim()), "the answer as written, its title once");
  assert.ok(md.includes("- [Site](https://a.org)"));
  const j = JSON.parse(toJson(doc()));
  assert.equal(j.turns[0].question, "Yatırımları özetle");
  assert.deepEqual(j.turns[0].tables[0].columns, ["İl", "Tutar", "Oran", "Kod"]);
  assert.equal(j.turns[0].tables[0].records[1]["İl"], "Uşak");
  assert.deepEqual(j.turns[0].sources, ["Sayfa 3"]);
});

test("cells: Turkish figures become numbers, codes stay text", () => {
  assert.equal(cellValue("1.250,50"), 1250.5);
  assert.equal(cellValue("1.250"), 1250);
  assert.equal(cellValue("300"), 300);
  assert.equal(cellValue("12,5"), 12.5);
  assert.equal(cellValue("-7"), -7);
  assert.deepEqual(cellValue("%42"), { percent: 0.42 });
  assert.deepEqual(cellValue("12,5%"), { percent: 0.125 });
  for (const s of ["0123", "abc", "1.5.2026", "12345678901234567890", "=1+1", "3.5", ""]) assert.equal(cellValue(s), s, s);
});

test("each table on its own sheet, the text after, sources last", () => {
  const s = sheetsOf(doc());
  assert.deepEqual(s.map((x) => x.name), ["Bölgeler", "Cevap", "Kaynaklar"]);
  assert.deepEqual(s[0].rows[1], ["Afyon", 1250.5, { percent: 0.42 }, "0123"]);
  assert.equal(s[0].headerRow, true);
  assert.ok(s[1].rows.some((r) => r[0] === "• Birinci"));
  assert.ok(s[1].rows.some((r) => r[0] === "Soru: Yatırımları özetle"));
  // Names Excel forbids, repeats.
  const two = sheetsOf(exportDoc([turnOf({ answer: "## A/B:C*D?E[F]G\n|a|\n|-|\n|1|\n\n## A/B:C*D?E[F]G\n|b|\n|-|\n|2|" })]));
  assert.deepEqual(two.map((x) => x.name), ["A B C D E F G", "A B C D E F G 2", "Cevap"]);
  // A short row is filled out to the header's width.
  const short = sheetsOf(exportDoc([turnOf({ answer: "|a|b|\n|-|-|\n|1|" })]));
  assert.equal(short[0].rows[1].length, 2);
});

test("several turns make one document (a whole chat)", () => {
  const d = exportDoc([turnOf({ question: "Bir?", answer: "# Başlık\nA" }), turnOf({ question: "İki?", answer: "B" })], "Sohbet adı");
  assert.equal(d.title, "Sohbet adı");
  const t = toText(d);
  assert.ok(t.indexOf("Soru: Bir?") < t.indexOf("Soru: İki?"));
});

test("a request for a file, with or without a question in it", () => {
  const yes: [string, string[], string][] = [
    ["bunu word olarak ver", ["docx"], ""],
    ["Bunu PDF yap", ["pdf"], ""],
    ["cevabı excel'e aktar", ["xlsx"], ""],
    ["tabloyu excel olarak indir", ["xlsx"], ""],
    ["son cevabı pdf formatında istiyorum lütfen", ["pdf"], ""],
    ["word ve pdf olarak ver", ["docx", "pdf"], ""],
    ["bunu pdf, word ve excel olarak hazırla", ["pdf", "docx", "xlsx"], ""],
    ["md olarak kaydet", ["md"], ""],
    ["json olarak ver", ["json"], ""],
    ["txt dosyası olarak indir", ["txt"], ""],
    ["düz metin olarak ver", ["txt"], ""],
    ["markdown formatında ver", ["md"], ""],
    ["bunu docx yap", ["docx"], ""],
    ["word dosyası hazırla", ["docx"], ""],
    ["2025 yatırımlarını özetle ve pdf olarak ver", ["pdf"], "2025 yatırımlarını özetle"],
    ["illere göre destekleri excel olarak hazırla", ["xlsx"], "illere göre destekleri"],
    ["Belgeyi özetleyip word dosyası olarak ver", ["docx"], "Belgeyi özetleyip"],
  ];
  for (const [m, formats, rest] of yes) {
    const r = exportRequest(m);
    assert.ok(r, m);
    assert.deepEqual([...r.formats].sort(), [...formats].sort(), m);
    assert.equal(r.rest, rest, m);
  }
  const no = [
    "pdf'teki tabloyu özetle",
    "pdf'te kaç sayfa var",
    "excel dosyasını özetle",
    "word dosyasındaki hataları bul",
    "word nasıl kaydedilir",
    "pdf olarak yüklediğim belgeyi özetle",
    "pdf ile word arasındaki fark nedir",
    "json nedir",
    "Excel formülü yazarken nelere dikkat etmeli",
    "Bu rapor word'den mi geliyor?",
    "tasarım dosyası hazırla",
    "keyword listesini ver",
    "password yap",
    "merhaba",
    "Excel verilerini özetle",
    "JSON verisini doğrula",
    "word yazılımı hakkında bilgi",
    "pdf alınan belgeleri listele",
  ];
  for (const m of no) assert.equal(exportRequest(m), null, m);
});

test("the title isn't printed twice; a stray dot goes", () => {
  const d = exportDoc([turnOf({ question: "Soru", answer: "# Rapor\n\nMetin" })]);
  assert.equal(d.title, "Rapor");
  assert.equal(d.turns[0].blocks[0].kind, "paragraph");
  assert.equal(toMarkdown(d).match(/# Rapor/g)?.length, 1);
  assert.equal(turnOf({ answer: "15 Mi̇lyon" }).answer, "15 Milyon");
});

test("no picture in a file fetches anything; a very long answer still makes a file", () => {
  const md = toMarkdown(exportDoc([turnOf({ answer: 'Metin ![x](https://kotu.example/?s=GIZLI) ![y][r] <img src="https://kotu.example/a">\n\n[r]: https://kotu.example/b' })]));
  assert.ok(!md.includes("kotu.example"), md);
  assert.ok(md.includes("[görsel: x]"));
  const long = Array.from({ length: 150_000 }, (_, i) => `p${i}`).join("\n\n");
  assert.ok(toText(exportDoc([turnOf({ answer: long })])).includes("p149999"));
});

