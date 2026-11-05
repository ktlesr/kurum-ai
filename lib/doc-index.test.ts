import { test } from "node:test";
import assert from "node:assert/strict";
import { contentArgs, hitsText, indexRows, rankFiles, snippet, someoneWaits, stems, tsQuery, type Hit } from "./doc-index.ts";

test("stems: Turkish endings and soft consonants fall in the dropped part; numbers, short words and asking words stay out or whole", () => {
  assert.deepEqual(stems("Bakanlığa gönderilen tablolarda"), ["bakanli", "gonder", "tablo"]);
  assert.deepEqual(stems("verilerinin kapasitesi kitapta"), ["veri", "kapasi", "kitap"]);
  // "bakanlik" typed without Turkish letters meets "Bakanlığa", "Bakanlığın": the stems are the same start.
  assert.ok("bakanliga".startsWith(stems("bakanlik")[0]) && "bakanligin".startsWith(stems("bakanlık")[0]));
  assert.deepEqual(stems("İSTANBUL IŞIK"), ["istanbul", "isik"]);
  assert.deepEqual(stems("2026 Kütahya en son dosya"), ["2026", "kutah"]);
  assert.deepEqual(stems("en son ne var"), []);
});

test("tsQuery: only letters and digits reach Postgres, every stem a prefix", () => {
  assert.equal(tsQuery(["bakanli", "2026"], "&"), "bakanli:* & 2026:*");
  assert.equal(tsQuery(["a'b|c", "!(x)"], "|"), "abc:* | x:*");
  assert.equal(tsQuery([], "&"), "");
});

test("indexRows: sections carry their page or sheet, and the folded text with it", () => {
  const rows = indexRows("Raporlar/İl Bazlı.xlsx", "## Sheet: İl Bazlı\n| İl | Değer |\n| --- | --- |\n| Uşak | 5 |");
  assert.equal(rows[0].label, "Sheet: İl Bazlı");
  assert.match(rows[0].bodyFold, /usak/u);
  assert.equal(rows[0].pathFold, "raporlar il bazli xlsx");
  assert.ok(!indexRows("a.pdf", "--- Sayfa 1 ---\nmetin\u0000burada")[0].body.includes("\u0000"));
});

const hit = (fileId: string, label: string, body: string, rank: number, path = `${fileId}.pdf`): Hit => ({ fileId, path, label, body, pathFold: path.toLowerCase(), bodyFold: body.toLowerCase(), rank });

test("rankFiles: more asked stems before a higher rank, a file's folder counts, at most two sections a file", () => {
  const st = ["hidro", "kapas"];
  const files = rankFiles([
    hit("a", "Sayfa 1", "hidro only", 0.9),
    hit("b", "Sayfa 2", "hidro and kapas", 0.1),
    hit("c", "Sayfa 1", "kapas", 0.5, "etut/hidrojen/c.pdf"),
    hit("b", "Sayfa 3", "hidro kapas again", 0.05),
    hit("b", "Sayfa 4", "hidro kapas third", 0.01),
  ], st);
  // c holds "kapas" and its folder "hidrojen": both stems, the higher rank of the two that have both.
  assert.deepEqual(files.map((f) => f.fileId), ["c", "b", "a"]);
  assert.deepEqual(files[1].sections.map((s) => s.label), ["Sayfa 2", "Sayfa 3"]);
});

test("snippet: the words around the asked stem, from the original text", () => {
  const body = `${"giriş metni ".repeat(80)}Elektrolizör kapasitesi 20 MW öngörülmektedir. ${"son metin ".repeat(80)}`;
  const s = snippet(body, ["elektr"], 120);
  assert.match(s, /Elektrolizör kapasitesi 20 MW/u);
  assert.ok(s.startsWith("…") && s.endsWith("…"));
});

test("hitsText: where and what was found, and a folder not fully read is said so", () => {
  const files = rankFiles([hit("a", "Sayfa 3", "Personel giderleri 48.250.000 TL", 1, "Raporlar/2025 Faaliyet.pdf")], ["perso"]);
  const t = hitsText("personel gideri", files, ["perso"], { indexed: 10, total: 12, failed: 1 });
  assert.match(t, /1\. Raporlar\/2025 Faaliyet\.pdf\n {3}\[Sayfa 3\] Personel giderleri 48\.250\.000 TL/u);
  assert.match(t, /12 okunabilir dosyanın 10 tanesi tarandı, 1 tanesi okunamadı/u);
  assert.match(t, /"hepsine baktım" deme/u);
  assert.match(hitsText("x", [], ["x"], { indexed: 3, total: 3, failed: 0 }), /eşleşen bölüm yok.*tamamı tarandı/u);
});

test("contentArgs: a query of words, or an error the model can act on", () => {
  assert.equal(contentArgs('{"sorgu":"Kütahya istihdam"}'), "Kütahya istihdam");
  assert.ok(typeof contentArgs("{bad") !== "string");
  assert.ok(typeof contentArgs('{"sorgu":"en son"}') !== "string");
  assert.ok(typeof contentArgs("[]") !== "string");
});

test("someoneWaits: a background read steps aside for a person waiting on Docling or the model, not for its own calls", async () => {
  const { Semaphore } = await import("./limits.ts");
  const docling = new Semaphore(1, 4);
  const model = new Semaphore(2, 4);
  const release = await docling.acquire(); // the background read holds the one Docling slot
  assert.equal(someoneWaits(docling, model), false);
  const waiting = docling.acquire(); // a person's upload
  assert.equal(docling.queued, 1);
  assert.equal(someoneWaits(docling, model), true);
  release();
  (await waiting)();
  assert.equal(someoneWaits(docling, model), false);
  // The read's own vision calls (a table's strips read side by side): they fill the slots and queue behind each other.
  const { asBackground } = await import("./limits.ts");
  const own: (() => void)[] = [];
  await asBackground(async () => {
    own.push(await model.acquire(), await model.acquire());
  });
  const third = asBackground(() => model.run(async () => {}));
  assert.equal(someoneWaits(docling, model), false, "its own queued call is not someone");
  const chat = model.acquire(); // a chat answering waits for one
  assert.equal(someoneWaits(docling, model), true);
  own.forEach((r) => r());
  await third;
  (await chat)();
  assert.equal(someoneWaits(docling, model), false);
});

test("strengthOf: nothing found, fewer than half the stems in the best section, or good", async () => {
  const { strengthOf } = await import("./doc-index.ts");
  const files = rankFiles([hit("a", "Sayfa 1", "kutahya istihdam", 1)], ["kutah", "istihdam", "2026"]);
  assert.equal(strengthOf(files, ["kutah", "istihdam", "2026"]), "good");
  assert.equal(strengthOf(files, ["kutah", "uretim", "2026", "manisa"]), "weak");
  assert.equal(strengthOf([], ["kutah"]), "none");
});

test("indexStateOf: off, the share down, reading, all done, a pause after a failure or for a person, else waiting for idle", async () => {
  const { indexStateOf } = await import("./doc-index.ts");
  const base = { off: false, down: false, working: false, pending: 5, now: 1000, failUntil: 0, yieldUntil: 0 };
  assert.equal(indexStateOf({ ...base, off: true, down: true }), "off");
  assert.equal(indexStateOf({ ...base, down: true, working: true }), "down");
  assert.equal(indexStateOf({ ...base, working: true }), "working");
  assert.equal(indexStateOf({ ...base, pending: 0 }), "done");
  assert.equal(indexStateOf({ ...base, failUntil: 2000 }), "paused_fail");
  assert.equal(indexStateOf({ ...base, yieldUntil: 2000 }), "paused_yield");
  assert.equal(indexStateOf(base), "waiting_idle");
});
