// The gold set (prompt §7): question → the plan the model should write → the engine's table, checked value by value
// against tests/destek-independent (plain TS on the parsed rows, no compiler, no SQL). Expected values are never
// stored in the repository (the workbook is the agency's data): each run computes them from the file again.
// Needs the workbook and a throwaway Postgres it may write to, never the server's:
//   docker run -d --name destek-test-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55498:5432 postgres:17-alpine
//   DESTEK_DB=postgres://postgres:test@127.0.0.1:55498/postgres DESTEK_XLSX="D:/ZAFER Destekler - … .xlsx" node --test tests/destek-gold.test.ts
// Plan accuracy (the model writing these plans) needs the model: scripts/eval-destek.ts asks the same set through the
// app. This checks values, "no data" vs "no match", and speed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { closeRatio, engineValue, expectAggregate, expectTable } from "./destek-independent.ts";
import { AGG } from "./destek-gold-set.ts";
import type { ProjectRow } from "../lib/destek/load.ts";

const DB = process.env.DESTEK_DB, XLSX = process.env.DESTEK_XLSX;
type R = ProjectRow;
const val = (r: R, c: keyof R["values"]) => r.values[c] ?? null;
const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/[ıİ]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");


test("destek gold set: every value of the engine equals the independent computation", { skip: !DB || !XLSX ? "DESTEK_DB / DESTEK_XLSX tanımlı değil" : false }, async () => {
  process.env.DATABASE_URL = DB;
  delete process.env.PGHOST;
  const { db } = await import("../lib/db.ts");
  const { ingest, activeSnapshot } = await import("../lib/destek/store.ts");
  const { runDestek } = await import("../lib/destek/tool.ts");
  const { parseWorkbook } = await import("../lib/destek/load.ts");
  const { METRICS } = await import("../lib/destek/semantic.ts");
  const sql = await db();
  try {
    const buf = readFileSync(XLSX!);
    const parsed = await parseWorkbook(buf, basename(XLSX!));
    const rows = parsed.families.flatMap((f) => f.rows);
    const rep = await ingest(sql, buf, basename(XLSX!), "test");
    assert.ok(rep.status === "ready" || rep.status === "same", `yükleme: ${rep.status} ${JSON.stringify(rep.reconcile.mismatches.slice(0, 3))}`);
    const snap = (await activeSnapshot(sql))!;
    const times: number[] = [];
    const run = async (plan: Record<string, unknown>) => {
      const t0 = performance.now();
      const r = await runDestek(sql, snap, JSON.stringify(plan));
      times.push(performance.now() - t0);
      return r;
    };
    await run({ type: "metadata" }); // the catalog, once (as the first chat question after a load)
    times.length = 0;

    for (const c of AGG) {
      const r = await run(c.plan);
      assert.ok(r.raw, `${c.id}: ${r.out}`);
      const want = expectAggregate(rows, c.keep, c.group, c.metrics);
      const got = new Map<string, Record<string, unknown>>();
      for (const row of r.raw.rows) got.set(c.group.map((d) => String(row[d])).join("|"), row);
      if (r.raw.total) got.set("__total", r.raw.total);
      if (!c.group.length) got.set("", r.raw.rows[0]);
      assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort(), `${c.id}: gruplar`);
      for (const [k, w] of want) for (const m of c.metrics) {
        const isRatio = METRICS[m].kind === "ratio";
        const e = engineValue(got.get(k)![m], isRatio);
        assert.ok(isRatio ? closeRatio(e, w[m]) : e === w[m], `${c.id} [${k}] ${m}: motor ${e}, bağımsız ${w[m]}`);
      }
    }

    // The first gold question, as the user sees it (prompt §7 table): every formatted cell, the weighted total ratio,
    // all formatted again independently (no value is written in this file).
    const g = await run(AGG[0].plan);
    const want = expectTable(rows, AGG[0].keep, "il", [
      { name: "gelen_proje", kind: "count" }, { name: "sozlesme_imzalanan", kind: "count" }, { name: "butce_sozlesme", kind: "amount" },
      { name: "destek_sozlesme", kind: "amount" }, { name: "destek_orani_sozlesme", kind: "ratio" },
    ]);
    assert.ok(want.size > 2, "SOGEP 2025: illere bölünmüş satırlar var");
    assert.deepEqual(new Map(g.table!.rows.map((r) => [r[0], r])), new Map([...want].filter(([k]) => k !== "__total")));
    assert.deepEqual(g.table!.total, want.get("__total"));
    assert.match(g.table!.footer, /Tutar tabanı: Sözleşme/u);
    assert.match(g.table!.footer, new RegExp(`· ${rows.filter(AGG[0].keep).length} proje satırı$`, "u"));

    // Tip 4: the ten projects with the most support, the order and the rows independently.
    const top = await run({ type: "list_projects", order_by: [{ field: "destek", dir: "desc" }], limit: 10 });
    const sortKey = (r: R) => BigInt(Math.round(Number(val(r, "def_destek") ?? "-1e18") * 100));
    const wantTop = [...rows].sort((a, b) => (sortKey(b) > sortKey(a) ? 1 : sortKey(b) < sortKey(a) ? -1 : a.aile.localeCompare(b.aile) || a.row - b.row)).slice(0, 10);
    assert.deepEqual(top.raw!.rows.map((x) => x.kaynak), wantTop.map((r) => `${r.sheet} › ${r.row}`), "en çok destek alan 10 proje");

    // Tip 6: a project found by name; every row whose name text has all the words.
    for (const metin of ["Çobanlar Belediyesi", "kadın kooperatif"]) {
      const found = await run({ type: "lookup_project", filters: { metin } });
      const words = fold(metin).split(/\s+/u);
      const want = rows.filter((r) => { const t = fold([val(r, "basvuru_sahibi"), val(r, "proje_adi"), val(r, "yuklenici"), val(r, "program_kodu")].filter(Boolean).join(" ")); return words.every((w) => t.includes(w)); });
      assert.equal(found.raw?.matched ?? 0, want.length, `"${metin}" eşleşen sayısı`);
      assert.ok((found.raw?.rows.length ?? 0) === Math.min(20, want.length));
    }

    // Tip 12: an empty family says so; a name that isn't in the file is "no match", not "no data".
    const fkd = await run({ type: "aggregate", filters: { aile: ["FKD"] }, metrics: ["gelen_proje"] });
    assert.match(fkd.out, /boş şablon/u);
    const nowhere = await run({ type: "aggregate", filters: { il: ["Çanakkale"] }, metrics: ["gelen_proje"] });
    assert.match(nowhere.out, /filtre eşleşmedi, veri yokluğu değil/u);
    const empty = await run({ type: "aggregate", filters: { aile: ["SOGEP"], yil: { in: [2010] } }, metrics: ["gelen_proje"] });
    assert.match(empty.out, /veri yok/u);
    // A plan with an unknown metric is refused with the list of good ones (the model gets one more try).
    assert.match((await run({ type: "aggregate", metrics: ["hibe_toplami"] })).out, /sorgu planı geçersiz/u);

    const sorted = [...times].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.log(`destek gold: ${AGG.length} toplama sorusu + sıralama, arama, kapsam dışı · veri sorgusu p50 ${p(0.5).toFixed(1)} ms, p95 ${p(0.95).toFixed(1)} ms`);
    assert.ok(p(0.95) < 100, `p95 ${p(0.95).toFixed(1)} ms (hedef < 100 ms)`);
  } finally {
    await sql.end();
  }
});

// "Deflatörlü" means these three columns (user, 2026-11-06). The engine sums the first two and weighs the ratio as their
// quotient: that holds only while each row's own "Nihai Fiili Destek Oranı (Def-%)" is that quotient. Checked on every file.
test("destek: each row's Def-% column is its Def-TL support over its Def-TL budget", { skip: !XLSX ? "DESTEK_XLSX tanımlı değil" : false }, async () => {
  const { parseWorkbook } = await import("../lib/destek/load.ts");
  const parsed = await parseWorkbook(readFileSync(XLSX!), basename(XLSX!));
  let checked = 0;
  for (const r of parsed.families.flatMap((f) => f.rows)) {
    const col = r.extra["Nihai Fiili Destek Oranı (Def-%)"];
    if (col === undefined || col === null || col === "") continue;
    const d = Number(val(r, "def_destek") ?? 0), b = Number(val(r, "def_fiili_butce") ?? 0);
    if (b === 0) {
      assert.equal(Number(col), 0, `${r.sheet} satır ${r.row}: bütçe 0, oran ${col}`);
      continue;
    }
    const c = Number(col) > 1.5 ? Number(col) / 100 : Number(col);
    assert.ok(Math.abs(d / b - c) < 1e-9, `${r.sheet} satır ${r.row}: Excel ${col}, hesap ${d / b}`);
    checked++;
  }
  assert.ok(checked > 100, `kontrol edilen satır: ${checked}`);
});
