// The support workbook's admin API (app/admin/destek): GET the load in progress, the versions and the latest report;
// POST a new version (the file's bytes, ?name=…) to load in the background. Admins only; anyone else gets a 404.
import { requireApiUser } from "@/lib/auth";
import { db, getSetting } from "@/lib/db";
import { contentProblem, readLimited } from "@/lib/filetype";
import { ACCESS_KEY, accessOf } from "@/lib/destek/chat";
import { jobState, startIngest } from "@/lib/destek/job";
import { snapshotsForAdmin, type Snapshot } from "@/lib/destek/store";

export const dynamic = "force-dynamic";
const MAX_BYTES = 50 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

async function admin(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  if (user.role !== "admin") return Response.json({ error: "Bulunamadı." }, { status: 404 });
  return user;
}

export async function GET(req: Request) {
  const user = await admin(req);
  if (user instanceof Response) return user;
  const sql = await db();
  const { active, recent: snaps } = await snapshotsForAdmin(sql, 10);
  const latest = snaps[0];
  const view = (s: Snapshot) => ({ id: s.id, file: s.file_name, loadedAt: s.loaded_at, activatedAt: s.activated_at, status: s.status, active: s.active, error: s.error, by: s.loaded_by });
  const dq = latest
    ? await sql<{ kind: string; aile: string | null; satir: number | null; kolon: string | null; detail: string }[]>`
        SELECT kind, aile, satir, kolon, detail FROM destek.dq_issues WHERE snapshot_id = ${latest.id}
        ORDER BY CASE kind WHEN 'schema_drift' THEN 0 WHEN 'formul_sonucu_yok' THEN 1 WHEN 'hata_degeri' THEN 2 ELSE 3 END, aile, satir LIMIT 150`
    : [];
  return Response.json({
    job: jobState() ?? null,
    access: accessOf(await getSetting(ACCESS_KEY)),
    // The active version apart from the list: ten failed loads after it must not make the page say there is none.
    active: active ? view(active) : null,
    snapshots: snaps.map(view),
    report: latest?.report ?? null,
    dq,
  }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const user = await admin(req);
  if (user instanceof Response) return user;
  const name = (new URL(req.url).searchParams.get("name") ?? "").replace(/[\\/]/g, "_").slice(0, 200);
  if (!/\.xlsx$/iu.test(name)) return Response.json({ error: "Yalnızca .xlsx dosyası yüklenebilir." }, { status: 400 });
  const raw = await readLimited(req.body, MAX_BYTES).catch(() => undefined);
  if (raw === null) return Response.json({ error: "Dosya 50 MB'den büyük." }, { status: 413 });
  if (!raw?.byteLength) return Response.json({ error: "Dosya boş ya da okunamadı." }, { status: 400 });
  const problem = await contentProblem("xlsx", raw).catch(() => "Dosya okunamadı. Bozuk olabilir.");
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (!startIngest(Buffer.from(raw), name, user.username)) return Response.json({ error: "Şu an başka bir yükleme sürüyor; bitince tekrar deneyin." }, { status: 409 });
  return Response.json({ ok: true }, { status: 202, headers: NO_STORE });
}
