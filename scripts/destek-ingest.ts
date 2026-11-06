// Loads a new version of the ZAFER support workbook (lib/destek/store): parse, write a snapshot, reconcile with the
// İcmal sheets, make it active only if that passes. Same work as the admin page's "Yeni sürüm yükle".
// Usage: pnpm destek:ingest "<path to .xlsx>"   (reads DATABASE_URL / PG* from .env.local)
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { db } from "../lib/db.ts";
import { ingest } from "../lib/destek/store.ts";

const path = process.argv[2];
if (!path) throw new Error('Kullanım: pnpm destek:ingest "<dosya.xlsx>"');
const sql = await db();
try {
  const r = await ingest(sql, await readFile(path), basename(path), "cli", (s) => console.log(s));
  if (r.status === "same") console.log(`Bu sürüm zaten etkin (snapshot ${r.snapshotId}); değişiklik yok.`);
  else {
    for (const [aile, n] of Object.entries(r.rows)) console.log(`  ${aile}: ${n.loaded} proje${n.skipped ? `, ${n.skipped} satır İl boş olduğu için alınmadı` : ""}`);
    console.log(`Mutabakat: ${r.reconcile.checked} İcmal ilçe hücresi karşılaştırıldı, ${r.reconcile.mismatches.length} fark.`);
    for (const c of r.reconcile.coverage) console.log(`  KAPSAM ${c}`);
    for (const m of r.reconcile.mismatches.slice(0, 20)) console.log(`  FARK ${m.aile} satır ${m.satir} ${m.il}/${m.ilce} ${m.metric}: İcmal ${m.icmal}, hesap ${m.hesap}`);
    if (r.unlisted.length) console.log(`İcmal'de satırı olmayan il/ilçe: ${r.unlisted.map((u) => `${u.aile} ${u.il}/${u.ilce ?? "-"} (${u.n})`).join(", ")}`);
    for (const t of r.icmalTotals.slice(0, 20)) console.log(`  İcmal toplam satırı tutmuyor: ${t.aile} satır ${t.satir} (${t.tur} ${t.il}) ${t.kolon}: kayıtlı ${t.kayitli}, satırların toplamı ${t.beklenen}`);
    console.log(`Def-TL kontrolü: ${r.defCheck.checked} tamamlanmış projede formül yeniden uygulandı, ${r.defCheck.mismatches.length} fark.`);
    console.log(`Veri kalitesi: ${Object.entries(r.dq).map(([k, n]) => `${k} ${n}`).join(", ") || "bulgu yok"}`);
    console.log(r.status === "ready" ? `Etkin sürüm: snapshot ${r.snapshotId} (${r.ms} ms)` : `YÜKLENMEDİ: mutabakat geçmedi; önceki sürüm etkin kalıyor (snapshot ${r.snapshotId} raporu kaydedildi).`);
    process.exitCode = r.status === "ready" ? 0 : 1;
  }
} finally {
  await sql.end();
}
