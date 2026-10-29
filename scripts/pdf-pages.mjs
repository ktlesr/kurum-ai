// Golden-set preparation (plan §5.3): page-by-page text of every PDF in a folder, written next to them in _text/.
// Usage: node scripts/pdf-pages.mjs D:/20pdf   (the documents and their text stay in that folder, never in git)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Kullanım: node scripts/pdf-pages.mjs <klasör>");
  process.exit(1);
}
// Documents and their text must never land in the repo: refuse a folder inside it (symlinks resolved).
const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const real = fs.realpathSync(path.resolve(dir));
if (real === repo || real.startsWith(repo + path.sep)) {
  console.error("Klasör depo içinde olamaz: belgeler ve metinleri git'e girmemeli.");
  process.exit(1);
}
const out = path.join(dir, "_text");
fs.mkdirSync(out, { recursive: true });
const index = [];
for (const name of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort()) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(dir, name))));
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t, i) => `--- Sayfa ${i + 1} ---\n${t.trim()}`).join("\n\n");
    const chars = text.reduce((n, t) => n + t.trim().length, 0);
    fs.writeFileSync(path.join(out, `${name}.txt`), pages);
    index.push({ file: name, pages: totalPages, chars, scanned: chars / Math.max(1, totalPages) < 20 });
  } catch (e) {
    index.push({ file: name, error: String(e?.message ?? e) });
  }
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 1));
for (const i of index) console.log(i.error ? `HATA ${i.file}: ${i.error}` : `${String(i.pages).padStart(4)} sayfa ${String(i.chars).padStart(7)} karakter${i.scanned ? " (taranmış?)" : ""}  ${i.file}`);
