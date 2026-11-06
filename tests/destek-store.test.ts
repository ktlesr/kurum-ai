// Loading versions of a made-up support workbook (lib/destek/store): a version becomes active only when its rows
// reconcile with its own İcmal, in one step; a broken one leaves the version before it active (prompt §4, §8).
// Needs a throwaway Postgres it may write to, never the server's (see tests/destek-gold.test.ts):
//   DESTEK_DB=postgres://postgres:test@127.0.0.1:55498/postgres node --test tests/destek-store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const DB = process.env.DESTEK_DB;

const PROJ = ["Yılı", "Program Kısaltması", "Başvuru Sahibi", "İlçe", "İl", "Teknik ve Mali Değerlendirme Sonucu", "Sözleşme Ajans Destek Miktarı (TL)", "Sözleşme Toplam Bütçe (TL)", "Sözleşme İmzaladı Mı?", "Proje Tamamlanma Durumu"];
const ICMAL = ["İl", "İlçe", "Gelen Proje Sayısı", "Sözleşme İmzalanan Proje Sayısı", "Sözleşme Ajans Destek Miktarı (TL)"];

/** A workbook: projects, and an İcmal with one row per (il, ilçe) given; `icmal` overrides its numbers. */
async function workbook(projects: (string | number)[][], icmal: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("SOGEP").addTable({ name: "SOGEP_Projeler", ref: "A1", headerRow: true, columns: PROJ.map((name) => ({ name })), rows: projects });
  wb.addWorksheet("SOGEP İcmal").addTable({ name: "SOGEP_İcmal", ref: "A2", headerRow: true, columns: ICMAL.map((name) => ({ name })), rows: icmal });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const P1 = [2025, "SOGEP25", "A Belediyesi", "Merkez", "Uşak", "Başarılı", 100.25, 200, "Evet", "Devam Ediyor"];
const P2 = [2025, "SOGEP25", "B Derneği", "Banaz", "Uşak", "Başarısız", 0, 0, "Hayır", "U.D."];
const GOOD = [["Uşak", "Merkez", 1, 1, 100.25], ["Uşak", "Banaz", 1, 0, 0]];

test("destek store: reconciled versions become active; a broken one never does, the one before stays", { skip: !DB ? "DESTEK_DB tanımlı değil" : false }, async () => {
  process.env.DATABASE_URL = DB;
  delete process.env.PGHOST;
  const { db } = await import("../lib/db.ts");
  const { ingest, activeSnapshot, snapshotsForAdmin } = await import("../lib/destek/store.ts");
  const sql = await db();
  try {
    const v1 = await workbook([P1, P2], GOOD);
    const good = await ingest(sql, v1, "v1.xlsx", "test");
    assert.equal(good.status, "ready", JSON.stringify(good.reconcile));
    const first = (await activeSnapshot(sql))!;
    assert.equal(first.id, good.snapshotId);
    assert.equal(first.report?.status, "ready", "the stored report says it was loaded");

    assert.equal((await ingest(sql, v1, "v1-kopya.xlsx", "test")).status, "same", "the same bytes again: nothing new");

    // An İcmal number 2 kuruş off its rows (1 kuruş is within the tolerance): the version fails, v1 answers on.
    const off = await ingest(sql, await workbook([P1, P2], [["Uşak", "Merkez", 1, 1, 100.27], ["Uşak", "Banaz", 1, 0, 0]]), "v2.xlsx", "test");
    assert.equal(off.status, "failed");
    assert.deepEqual(off.reconcile.mismatches.map((m) => m.metric), ["destek_sozlesme"]);
    assert.equal((await activeSnapshot(sql))!.id, first.id);

    // A project in an ilçe the İcmal has no row for: no İcmal number covers it, so it isn't checked: fails too.
    const unlisted = await ingest(sql, await workbook([P1, P2, [2025, "SOGEP25", "C Kooperatifi", "Eşme", "Uşak", "Başarılı", 50, 100, "Evet", "Devam Ediyor"]], GOOD), "v3.xlsx", "test");
    assert.equal(unlisted.status, "failed");
    assert.match(unlisted.reconcile.coverage.join(" "), /Uşak\/Eşme \(1 proje\)/u);
    assert.equal((await activeSnapshot(sql))!.id, first.id);

    // A family whose İcmal is gone: fails.
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("SOGEP").addTable({ name: "SOGEP_Projeler", ref: "A1", headerRow: true, columns: PROJ.map((name) => ({ name })), rows: [P1] });
    const noIcmal = await ingest(sql, Buffer.from(await wb.xlsx.writeBuffer()), "v4.xlsx", "test");
    assert.equal(noIcmal.status, "failed");
    assert.match(noIcmal.reconcile.coverage[0], /İcmal tablosu .* bulunamadı/u);

    // A good new version replaces v1 in one step: exactly one active.
    const v5 = await ingest(sql, await workbook([P1], [["Uşak", "Merkez", 1, 1, 100.25]]), "v5.xlsx", "test");
    assert.equal(v5.status, "ready");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM destek.snapshots WHERE active`;
    assert.equal(n, 1);
    assert.equal((await activeSnapshot(sql))!.id, v5.snapshotId);
    const [{ rows }] = await sql<{ rows: number }[]>`SELECT count(*)::int AS rows FROM destek.projeler WHERE snapshot_id = ${v5.snapshotId}`;
    assert.equal(rows, 1);

    // More failed loads than the admin page lists: it still shows the version that answers.
    for (let i = 0; i < 11; i++) assert.equal((await ingest(sql, await workbook([P1], [["Uşak", "Merkez", 1, 1, 999 + i]]), `bozuk-${i}.xlsx`, "test")).status, "failed");
    const page = await snapshotsForAdmin(sql, 10);
    assert.equal(page.recent.length, 10);
    assert.ok(page.recent.every((x) => !x.active), "the active one is out of the last ten");
    assert.equal(page.active?.id, v5.snapshotId);
  } finally {
    await sql.end();
  }
});
