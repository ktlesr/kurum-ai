// Keyword-retrieval check on the golden set (TASK-022): for each answerable question, is the expected page among the
// top 6 BM25 chunks, and first? No model needed. Reads only <dir>/_text and <dir>/_golden; prints counts, no content.
//   node --experimental-strip-types scripts/measure-retrieval.mjs D:/20pdf
import fs from "node:fs";
import path from "node:path";
import { chunkText } from "../lib/chunk.ts";
import { bm25, ranked } from "../lib/search.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("Kullanım: node --experimental-strip-types scripts/measure-retrieval.mjs <klasör>");
  process.exit(1);
}
const g = path.join(dir, "_golden");
const items = fs.readdirSync(g).filter((f) => f.endsWith(".json") && !f.startsWith("report")).flatMap((f) => JSON.parse(fs.readFileSync(path.join(g, f), "utf8")));
const names = new Map(fs.readdirSync(path.join(dir, "_text")).map((f) => [f.normalize("NFC"), f]));
const read = (f) => fs.readFileSync(path.join(dir, "_text", names.get(`${f}.txt`.normalize("NFC"))), "utf8");
let n = 0, top6 = 0, first = 0;
const miss = [];
for (const q of items) {
  if (q.type === "yok" || q.type === "ocr" || !q.pages?.length) continue; // scanned files have no text layer here
  const all = q.files.flatMap((f) => chunkText(f, read(f)));
  const top = ranked(bm25(all.map((c) => `${c.label} ${c.text}`), q.question)).slice(0, 6).map((i) => all[i]);
  const want = new Set(q.pages.map((p) => `Sayfa ${p}`));
  n++;
  if (top.some((c) => want.has(c.label))) top6++;
  else miss.push(q.id);
  if (top[0] && want.has(top[0].label)) first++;
}
console.log(`${n} soru · doğru sayfa ilk 6 parçada: ${top6} (%${Math.round((100 * top6) / n)}) · ilk sırada: ${first} (%${Math.round((100 * first) / n)})`);
if (miss.length) console.log(`kaçanlar: ${miss.join(", ")}`);
