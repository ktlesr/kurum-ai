// The shared library's list (names and folders, no contents): every signed-in user may see and read it.
import { requireApiUser } from "@/lib/auth";
import { sharedList } from "@/lib/library";

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  return Response.json(sharedList());
}
