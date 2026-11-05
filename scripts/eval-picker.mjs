// The source picker on the real model (lib/sources PICK_PROMPT): does it read other words for the same place ("giden"
// for "gönderilen"), keep the documents for a follow-up, keep them for another subject, and look again when told it
// looks in the wrong place? A made-up library, no real document. The code's side is in lib/source-behaviors.test.ts.
//
//   MODEL_URL=http://localhost:8000/v1 MODEL=RedHatAI/gemma-4-26B-A4B-it-NVFP4 node scripts/eval-picker.mjs
//
// A scenario added here when a behaviour is noticed; each run prints the misses and exits 1 if there is one.
import { PICK_PROMPT, pickerInput, readPick } from "../lib/sources.ts";

const { MODEL_URL = "http://localhost:8000/v1", MODEL } = process.env;
if (!MODEL) {
  console.error("Kullanım: MODEL_URL=… MODEL=… node scripts/eval-picker.mjs");
  process.exit(1);
}
const LIB = [
  "10) Paydaş Veri Tabanı/Paydaş Veri Tabanı.xlsx",
  "Bakanlığa Gönderilen Tablolar/Yazışma Listesi 2026.xlsx",
  "Bakanlığa Gönderilen Tablolar/Yazışma Listesi 2025.xlsx",
  "Bakanlığa Gönderilen Tablolar/Gelen Evrak 2026.xlsx",
  "Bütçe/2025 Bütçe Planı.xlsx",
  "Bütçe/2026 Bütçe Teklifi.xlsx",
  "Kooperatifler/Domaniç Kadın Kooperatifi Faaliyet Raporu.pdf",
  "Kooperatifler/Kooperatif Destek Programı 2025.docx",
  "Sunumlar/Yatırım Ortamı Sunumu.pptx",
  "Raporlar/KURUM_2025_Raporu.pdf",
].map((path, i) => ({ id: `s-${i}`, path }));
const at = (name) => LIB.filter((e) => e.path.includes(name));

/** keep: the documents in use stay; pick: the files that must be among those chosen (and `not`: never). */
const CASES = [
  { current: ["Paydaş Veri Tabanı"], q: "bakanlığa giden tablolardan bak", pick: ["Bakanlığa Gönderilen Tablolar/Yazışma"], not: ["Paydaş"] },
  { current: ["Paydaş Veri Tabanı"], q: "en son bakanlığa gönderilen yazışma listesindeki en son şey ne", pick: ["Yazışma Listesi 2026"], not: ["Paydaş"] },
  { current: ["Paydaş Veri Tabanı"], recent: ["paydaş listesinde kaç kurum var"], q: "yanlış yere bakıyorsun, ortak belgelerde bakanlığa giden yazışmalar var", pick: ["Yazışma Listesi"], not: ["Paydaş"] },
  { current: ["Yazışma Listesi 2026"], recent: ["bakanlığa gönderilen yazışma listesinde son kayıt ne"], q: "bir önceki kayıt ne peki", keep: true },
  { current: ["Yazışma Listesi 2026"], recent: ["bakanlığa gönderilen yazışma listesinde son kayıt ne"], q: "bu tablodaki en eski tarih hangisi", keep: true },
  { current: ["Yazışma Listesi 2026"], recent: ["bakanlığa gönderilen yazışma listesinde son kayıt ne"], q: "bana kısa bir teşekkür e-postası yaz", keep: true },
  { current: ["Yazışma Listesi 2026"], q: "merhaba", keep: true },
  { current: ["Yazışma Listesi 2026"], recent: ["son kayıt ne"], q: "peki gelen evraklarda durum ne", pick: ["Gelen Evrak 2026"] },
  { current: ["2025 Bütçe Planı"], q: "geçen yılın bütçesiyle bu yılın bütçe teklifini karşılaştır", pick: ["2025 Bütçe Planı", "2026 Bütçe Teklifi"] },
  { current: [], q: "domaniç kadın kooperatifi hakkında elimizde ne var", pick: ["Domaniç Kadın Kooperatifi"] },
  { current: [], q: "yatırım ortamı sunusunu özetle", pick: ["Yatırım Ortamı Sunumu"] },
];

async function ask(content) {
  const res = await fetch(`${MODEL_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 60, messages: [{ role: "system", content: PICK_PROMPT }, { role: "user", content }], chat_template_kwargs: { enable_thinking: false } }),
  });
  if (!res.ok) throw new Error(`model_http_${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

let misses = 0;
for (const c of CASES) {
  const current = c.current.flatMap(at);
  const said = await ask(pickerInput(LIB.map((e) => e.path), current.map((e) => e.path), c.recent ?? [], c.q));
  const r = readPick(said, LIB);
  const got = r === "keep" ? current : r;
  const paths = got.map((e) => e.path);
  const ok = c.keep
    ? r === "keep" || (current.length > 0 && current.every((e) => paths.includes(e.path)))
    : c.pick.every((p) => paths.some((x) => x.includes(p))) && !(c.not ?? []).some((p) => paths.some((x) => x.includes(p)));
  if (!ok) misses++;
  console.log(`${ok ? "✓" : "✗"} ${c.q}\n    → ${r === "keep" ? "devam (mevcut kalır)" : paths.join(" | ") || "(hiçbiri)"}${ok ? "" : `   [model: ${said.trim()}]`}`);
}
console.log(`\n${CASES.length - misses}/${CASES.length} doğru`);
process.exit(misses ? 1 : 0);
