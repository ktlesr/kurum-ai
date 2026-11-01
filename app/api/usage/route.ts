// The signed-in check itself marks the user as seen (lib/auth); a body says which finished studio work to count.
// ponytail: a signed-in user could inflate these totals by hand; they are internal figures, add a limit if that ever matters.
import { requireApiUser } from "@/lib/auth";
import { readLimited } from "@/lib/filetype";
import { BROWSER_KINDS, countUsage, type UsageKind } from "@/lib/usage";

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const raw = await readLimited(req.body, 256).catch(() => null);
  if (raw?.length) {
    let kind: unknown;
    try {
      kind = (JSON.parse(new TextDecoder().decode(raw)) as { kind?: unknown })?.kind;
    } catch {}
    if (BROWSER_KINDS.includes(kind as UsageKind)) countUsage(kind as UsageKind);
  }
  return new Response(null, { status: 204 });
}
