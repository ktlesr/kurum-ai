import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Container healthcheck: the process answers and the database is reachable. No auth, no details. */
export async function GET() {
  try {
    const sql = await db();
    await sql`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
