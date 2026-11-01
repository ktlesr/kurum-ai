// Numbers for the admin dashboard: per-day totals of what happened, nothing about who or what was in it (lib/db.ts's rule:
// never chat or document content). Counting must never get in the way of the work it counts.
import { db } from "./db.ts";

export const USAGE_LABELS = {
  query: "Sorgu",
  upload: "Yüklenen dosya",
  delete: "Silinen dosya",
  deck: "Sunum",
  reels: "Reels / video",
  social: "Sosyal medya görseli",
} as const;
export type UsageKind = keyof typeof USAGE_LABELS;
/** What only the browser knows happened (the studio works there): anything else is counted by the server itself. */
export const BROWSER_KINDS: readonly UsageKind[] = ["deck", "reels", "social"];
/** Someone who has done anything, or has a page open, within this long is online. */
export const ONLINE_MINUTES = 3;

const TODAY = "(now() AT TIME ZONE 'Europe/Istanbul')::date";

export function countUsage(kind: UsageKind) {
  void (async () => {
    const sql = await db();
    await sql`INSERT INTO usage_daily (day, kind, count) VALUES (${sql.unsafe(TODAY)}, ${kind}, 1)
      ON CONFLICT (day, kind) DO UPDATE SET count = usage_daily.count + 1`;
  })().catch((e) => console.error(`usage: ${(e as Error).name}`));
}

export type UsageRow = { kind: UsageKind; today: number; week: number; month: number; total: number };

export async function usageSummary() {
  const sql = await db();
  const rows = await sql<{ kind: string; today: string; week: string; month: string; total: string }[]>`
    SELECT kind,
      coalesce(sum(count) FILTER (WHERE day = ${sql.unsafe(TODAY)}), 0) AS today,
      coalesce(sum(count) FILTER (WHERE day > ${sql.unsafe(TODAY)} - 7), 0) AS week,
      coalesce(sum(count) FILTER (WHERE day > ${sql.unsafe(TODAY)} - 30), 0) AS month,
      sum(count) AS total
    FROM usage_daily GROUP BY kind`;
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const usage: UsageRow[] = (Object.keys(USAGE_LABELS) as UsageKind[]).map((kind) => {
    const r = byKind.get(kind);
    return { kind, today: Number(r?.today ?? 0), week: Number(r?.week ?? 0), month: Number(r?.month ?? 0), total: Number(r?.total ?? 0) };
  });
  const days = await sql<{ day: string; count: string }[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(u.count, 0) AS count
    FROM generate_series(${sql.unsafe(TODAY)} - 13, ${sql.unsafe(TODAY)}, interval '1 day') d
    LEFT JOIN usage_daily u ON u.day = d::date AND u.kind = 'query' ORDER BY d`;
  const [people] = await sql<{ total: string; pending: string; online: string }[]>`
    SELECT
      (SELECT count(*) FROM users WHERE status = 'active') AS total,
      (SELECT count(*) FROM users WHERE status = 'pending') AS pending,
      (SELECT count(DISTINCT user_id) FROM sessions WHERE expires_at > now() AND last_seen > now() - make_interval(mins => ${ONLINE_MINUTES})) AS online`;
  return {
    usage,
    queriesByDay: days.map((d) => ({ day: d.day, count: Number(d.count) })),
    users: Number(people.total), pending: Number(people.pending), online: Number(people.online),
  };
}
