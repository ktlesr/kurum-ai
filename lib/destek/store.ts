// Loading a workbook version (prompt §4): parsed rows go into a new snapshot; the snapshot is reconciled against the
// workbook's own İcmal tables in SQL; only then is it made the active one, in one transaction. A version that fails
// stays inactive with its report, and the version before it keeps answering. Used by the admin page and by
// scripts/destek-ingest.ts alike. No "server-only": the script runs it too.
import type postgres from "postgres";
import { CANON, type Canon } from "./columns.ts";
import { parseWorkbook, type Dq, type Parsed } from "./load.ts";
import { coverageProblems, DEF_CHECK_SQL, DEF_CHECKED_SQL, icmalMetric, mismatchSql, TOTALS_SQL, UNLISTED_SQL } from "./reconcile.ts";
import { foldTr } from "../gallery-search.ts";

export interface IngestReport {
  snapshotId: number;
  file: string;
  sha256: string;
  status: "ready" | "failed" | "same";
  rows: Record<string, { loaded: number; skipped: number }>;
  reconcile: { checked: number; coverage: string[]; mismatches: { aile: string; satir: number; il: string; ilce: string | null; metric: string; icmal: string; hesap: string }[] };
  unlisted: { aile: string; il: string; ilce: string | null; n: number }[];
  icmalTotals: { aile: string; satir: number; tur: string; il: string; kolon: string; kayitli: string | null; beklenen: string | null }[];
  defCheck: { checked: number; mismatches: { aile: string; kaynak_satir: number; kayitli: string; hesap: string | null }[] };
  dq: Record<string, number>;
  ms: number;
}

const COLS = Object.keys(CANON) as Canon[];
const CHUNK = 500;

export async function ingest(sql: postgres.Sql, buf: Buffer, file: string, by: string | null, step: (s: string) => void = () => {}): Promise<IngestReport> {
  const t0 = Date.now();
  step("Dosya okunuyor…");
  const p = await parseWorkbook(buf, file);
  const [same] = await sql<{ id: string }[]>`SELECT id FROM destek.snapshots WHERE active AND sha256 = ${p.sha256}`;
  if (same) return { ...emptyReport(Number(same.id), p), status: "same", ms: Date.now() - t0 };

  step("Satırlar veritabanına yazılıyor…");
  const [{ id }] = await sql<{ id: string }[]>`INSERT INTO destek.snapshots (file_name, sha256, loaded_by, status) VALUES (${file}, ${p.sha256}, ${by}, 'loading') RETURNING id`;
  const snapshotId = Number(id);
  try {
    const dq = [...p.dq, ...findings(p)];
    await sql.begin(async (tx) => {
      await writeRows(tx, snapshotId, p);
      for (let i = 0; i < dq.length; i += CHUNK)
        await tx`INSERT INTO destek.dq_issues ${tx(dq.slice(i, i + CHUNK).map((d) => ({ snapshot_id: snapshotId, kind: d.kind, aile: d.aile ?? null, sayfa: d.sheet || null, satir: d.row ?? null, kolon: d.col ?? null, detail: d.detail })))}`;
    });
    step("İcmal ile mutabakat yapılıyor…");
    const report = await check(sql, snapshotId, p);
    report.ms = Date.now() - t0;
    // Projects whose il/ilçe the İcmal has no row for are in no İcmal number: unverified, so they block it too.
    if (report.unlisted.length) report.reconcile.coverage.push(`İcmal'de satırı olmayan il/ilçe: ${report.unlisted.map((u) => `${u.aile} ${u.il}/${u.ilce ?? "(boş)"} (${u.n} proje)`).join(", ")}`);
    const ok = report.reconcile.mismatches.length === 0 && report.reconcile.coverage.length === 0 && report.reconcile.checked > 0;
    // 4: the stored report says what happened (the admin page reads it), not the "failed" it starts as.
    report.status = ok ? "ready" : "failed";
    await sql.begin(async (tx) => {
      if (ok) {
        await tx`UPDATE destek.snapshots SET active = false WHERE active`;
        await tx`UPDATE destek.snapshots SET status = 'ready', active = true, activated_at = now(), report = ${tx.json(report as never)} WHERE id = ${snapshotId}`;
      } else {
        await tx`UPDATE destek.snapshots SET status = 'failed', report = ${tx.json(report as never)}, error = ${report.reconcile.coverage.length ? `İcmal kapsamı eksik: ${report.reconcile.coverage.join("; ")}`.slice(0, 1000) : report.reconcile.checked ? "İcmal mutabakatı geçmedi" : "Karşılaştırılacak İcmal satırı yok"} WHERE id = ${snapshotId}`;
      }
    });
    return report;
  } catch (e) {
    await sql`UPDATE destek.snapshots SET status = 'failed', error = ${String((e as Error)?.message ?? e).slice(0, 500)} WHERE id = ${snapshotId}`.catch(() => {});
    throw e;
  }
}

function emptyReport(snapshotId: number, p: Parsed): IngestReport {
  return {
    snapshotId, file: p.file, sha256: p.sha256, status: "same", rows: {}, reconcile: { checked: 0, coverage: [], mismatches: [] }, unlisted: [], icmalTotals: [],
    defCheck: { checked: 0, mismatches: [] }, dq: {}, ms: 0,
  };
}

async function writeRows(tx: postgres.TransactionSql, snapshotId: number, p: Parsed) {
  for (const f of p.families) {
    for (let i = 0; i < f.rows.length; i += CHUNK) {
      const part = f.rows.slice(i, i + CHUNK);
      await tx`INSERT INTO destek.projeler ${tx(part.map((r) => {
        const o: Record<string, postgres.ParameterOrJSON<never>> = { snapshot_id: snapshotId, aile: f.aile, kaynak_sayfa: f.sheet, kaynak_satir: r.row };
        for (const c of COLS) o[c] = r.values[c] ?? null;
        o.ara = foldTr([r.values.basvuru_sahibi, r.values.proje_adi, r.values.yuklenici, r.values.program_kodu].filter(Boolean).join(" "));
        o.extra = r.extra as postgres.JSONValue;
        return o;
      }), ["snapshot_id", "aile", "kaynak_sayfa", "kaynak_satir", ...COLS, "ara", "extra"])}`;
      const pays = part.flatMap((r) => r.payments.map((x) => ({ snapshot_id: snapshotId, kaynak_sayfa: f.sheet, kaynak_satir: r.row, tur: x.tur, tarih: x.tarih, tutar: x.tutar })));
      if (pays.length) await tx`INSERT INTO destek.odemeler ${tx(pays)}`;
    }
  }
  const defl = p.deflator.map((d) => ({ snapshot_id: snapshotId, ...d }));
  for (let i = 0; i < defl.length; i += CHUNK) await tx`INSERT INTO destek.deflator ${tx(defl.slice(i, i + CHUNK))}`;
  const cells = p.icmal.flatMap((r) => Object.entries(r.values).flatMap(([h, v]) => {
    const m = icmalMetric(h);
    return m ? [{ snapshot_id: snapshotId, aile: r.aile, satir: r.row, tur: r.kind, il: r.il, ilce: r.ilce, kolon: m, deger: v }] : [];
  }));
  for (let i = 0; i < cells.length; i += CHUNK) await tx`INSERT INTO destek.icmal ${tx(cells.slice(i, i + CHUNK))}`;
}

/** Findings over whole tables, beside the per-cell ones of the reader. */
function findings(p: Parsed): Dq[] {
  const out: Dq[] = [];
  for (const h of p.icmalHeaders) {
    for (const x of h.headers.slice(2)) if (x && !icmalMetric(x)) out.push({ kind: "icmal_kolon", aile: h.aile, sheet: `${h.aile} İcmal`, detail: `İcmal kolonu tanınmadı, mutabakata alınmadı: "${x}"` });
  }
  for (const f of p.families) {
    const variants = new Map<string, number>();
    const keys = new Map<string, number>();
    let ozel = 0, ozelSektor = 0;
    for (const r of f.rows) {
      const l = r.values.liste;
      if (l && l !== "Asil" && l !== "Yedek" && /^(as[iı]l|yedek)/iu.test(l)) variants.set(l.replace(/-\d+$/u, "-N"), (variants.get(l.replace(/-\d+$/u, "-N")) ?? 0) + 1);
      const k = [r.values.program_kodu, r.values.basvuru_sira_no, r.values.basvuru_sahibi].join("\u0000");
      keys.set(k, (keys.get(k) ?? 0) + 1);
      if (r.values.ana_yasal_statu === "Özel") ozel++;
      if (r.values.ana_yasal_statu === "Özel Sektör") ozelSektor++;
    }
    for (const [v, n] of variants) out.push({ kind: "liste_yazim", aile: f.aile, sheet: f.sheet, detail: `${n} satırda liste "${v}" yazılmış: İcmal formülü yalnızca "Asil"/"Yedek" sayar, bu satırlar Asil/Yedek sayısına girmez` });
    const dup = [...keys.values()].filter((n) => n > 1).length;
    if (dup) out.push({ kind: "anahtar_tekil_degil", aile: f.aile, sheet: f.sheet, detail: `(program, başvuru sıra no, başvuru sahibi) ${dup} kez tekrarlıyor: sürüm karşılaştırmasında satır sırası da kullanılmalı` });
    if (ozel && ozelSektor) out.push({ kind: "esanlam", aile: f.aile, sheet: f.sheet, detail: `Ana yasal statüde "Özel" (${ozel}) ve "Özel Sektör" (${ozelSektor}) ayrı yazılmış; birleştirilmedi` });
  }
  return out;
}

async function check(sql: postgres.Sql, snapshotId: number, p: Parsed): Promise<IngestReport> {
  const metrics = [...new Set(p.icmal.flatMap((r) => Object.keys(r.values).map(icmalMetric).filter((m): m is string => !!m)))];
  const mismatches = metrics.length ? await sql.unsafe(mismatchSql(metrics), [snapshotId]) : [];
  const [{ n: checked }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM destek.icmal WHERE snapshot_id = ${snapshotId} AND tur = 'ilce'`;
  const unlisted = await sql.unsafe(UNLISTED_SQL, [snapshotId]);
  const icmalTotals = await sql.unsafe(TOTALS_SQL, [snapshotId]);
  const defMis = await sql.unsafe(DEF_CHECK_SQL, [snapshotId]);
  const [{ n: defChecked }] = await sql.unsafe(DEF_CHECKED_SQL, [snapshotId]) as unknown as { n: number }[];
  const dq = await sql<{ kind: string; n: number }[]>`SELECT kind, count(*)::int AS n FROM destek.dq_issues WHERE snapshot_id = ${snapshotId} GROUP BY kind`;
  return {
    snapshotId, file: p.file, sha256: p.sha256, status: "failed",
    rows: Object.fromEntries(p.families.map((f) => [f.aile, { loaded: f.rows.length, skipped: f.skipped }])),
    reconcile: {
      checked, mismatches: mismatches.slice(0, 200) as never,
      coverage: coverageProblems(
        p.families.map((f) => ({ aile: f.aile, loaded: f.rows.length })),
        [...new Set(p.icmal.map((r) => r.aile))].map((aile) => ({
          aile,
          ilceRows: p.icmal.filter((r) => r.aile === aile && r.kind === "ilce").length,
          metrics: new Set(p.icmal.filter((r) => r.aile === aile).flatMap((r) => Object.keys(r.values).map(icmalMetric).filter((m): m is string => !!m))),
        })),
      ),
    },
    unlisted: unlisted as never,
    icmalTotals: icmalTotals.slice(0, 200) as never,
    defCheck: { checked: defChecked, mismatches: defMis.slice(0, 50) as never },
    dq: Object.fromEntries(dq.map((d) => [d.kind, d.n])),
    ms: 0,
  };
}

export interface Snapshot { id: number; file_name: string; sha256: string; loaded_at: Date; activated_at: Date | null; status: string; active: boolean; report: IngestReport | null; error: string | null; loaded_by: string | null }

export async function activeSnapshot(sql: postgres.Sql): Promise<Snapshot | undefined> {
  const [s] = await sql<Snapshot[]>`SELECT id::int AS id, file_name, sha256, loaded_at, activated_at, status, active, report, error, loaded_by FROM destek.snapshots WHERE active`;
  return s;
}

/** For the admin page: the active version on its own (however many failed loads came after it) and the latest ones. */
export async function snapshotsForAdmin(sql: postgres.Sql, n = 10): Promise<{ active: Snapshot | undefined; recent: Snapshot[] }> {
  return { active: await activeSnapshot(sql), recent: await recentSnapshots(sql, n) };
}

export async function recentSnapshots(sql: postgres.Sql, n = 10): Promise<Snapshot[]> {
  return sql<Snapshot[]>`SELECT id::int AS id, file_name, sha256, loaded_at, activated_at, status, active, report, error, loaded_by FROM destek.snapshots ORDER BY id DESC LIMIT ${n}`;
}
