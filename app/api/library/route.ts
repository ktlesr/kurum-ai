// The shared library's list (names and folders, no contents), as far as this person may see it.
import { requireApiUser } from "@/lib/auth";
import { libraryDown, sharedFor } from "@/lib/library";

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const list = await sharedFor(user);
  // The share is away: the last list stays usable where cached, and the page can say why new files don't come.
  return Response.json(list, { headers: libraryDown() ? { "X-Library-Status": "down" } : {} });
}
