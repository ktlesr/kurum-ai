// The forms to choose from: the institution's Şablonlar folder, and the person's own saved ones.
import { requireApiUser } from "@/lib/auth";
import { MAX_BYTES } from "@/lib/server";
import { readLimited } from "@/lib/filetype";
import { sharedTemplatesFor } from "@/lib/library";
import { formatOf, templateProblem } from "@/lib/template-file";
import { MAX_MY_TEMPLATES, deleteMyTemplate, listMyTemplates, saveMyTemplate } from "@/lib/template-store";

export const runtime = "nodejs";
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const shared = await sharedTemplatesFor(user);
  return Response.json({
    shared: shared.map((e) => ({ id: e.id, path: e.path, name: e.name })),
    mine: (await listMyTemplates(user.id)).map((t) => ({ id: t.id, path: t.folder ? `${t.folder}/${t.name}` : t.name, name: t.name })),
  });
}

/** Saves a form to "Şablonlarım". The same checks as filling one: what is kept here is a file that will be opened again. */
export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  const raw = await readLimited(req.body, MAX_BYTES + 1024 * 1024).catch(() => undefined);
  if (raw === null) return fail("Şablon 25 MB sınırını aşıyor.", 413);
  const form = raw && (await new Response(raw, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null));
  const file = form?.get("file");
  if (!form || !(file instanceof File) || !file.size) return fail("Şablon dosyası bulunamadı.");
  const format = formatOf(file.name);
  if (!format) return fail("Şablon Excel (.xlsx), Word (.docx), PDF ya da JSON olmalı.", 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = await templateProblem(format, bytes).catch(() => "Şablon okunamadı. Bozuk olabilir.");
  if (problem) return fail(problem, 415);
  const saved = await saveMyTemplate(user.id, file.name, String(form.get("folder") ?? ""), bytes);
  if (!saved) return fail(`En fazla ${MAX_MY_TEMPLATES} şablon kaydedilebilir. Önce birini silin.`, 409);
  return Response.json({ id: saved.id, path: saved.folder ? `${saved.folder}/${saved.name}` : saved.name, name: saved.name });
}

export async function DELETE(req: Request) {
  const user = await requireApiUser(req);
  if (user instanceof Response) return user;
  return (await deleteMyTemplate(user.id, new URL(req.url).searchParams.get("id") ?? "")) ? new Response(null, { status: 204 }) : fail("Şablon bulunamadı.", 404);
}
