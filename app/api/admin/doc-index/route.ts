// The content index's progress for the admin page's live card (app/admin/kutuphane/index-progress.tsx). Admins only:
// anyone else gets the same 404 as for any unknown address (the paths of every folder are in it).
import { requireApiUser } from "@/lib/auth";
import { indexStatus } from "@/lib/doc-indexer";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  if (user.role !== "admin") return Response.json({ error: "Bulunamadı." }, { status: 404 });
  return Response.json(await indexStatus(), { headers: { "Cache-Control": "no-store" } });
}
