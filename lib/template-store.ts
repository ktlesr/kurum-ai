// A person's own saved blank forms ("Şablonlarım"): the file itself, because a form is filled from its own bytes. Under
// .cache/usertemplates/<owner>/, owner-only by construction: every path is built from the signed-in user's id. Only fs: tests drive it.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic.ts";

export const MAX_MY_TEMPLATES = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isMyTemplateId = (id: string) => id.startsWith("t-") && UUID.test(id.slice(2));

export interface MyTemplate { id: string; name: string; folder?: string; size: number; at: number }

const defaultRoot = () => path.join(process.cwd(), ".cache", "usertemplates");
const dirOf = (owner: string, root: string) => {
  if (!UUID.test(owner)) throw new Error("bad_owner");
  return path.join(root, owner);
};

/** Words only: a name or folder comes from a request and goes into a list, never into a path. */
export const cleanName = (s: unknown) => (typeof s === "string" ? s.replace(/[\u0000-\u001f"<>\\/]/g, "").trim().slice(0, 150) : "");
export const cleanFolder = (s: unknown) => (typeof s === "string" ? s.split("/").map((p) => p.replace(/[\u0000-\u001f"<>\\]/g, "").trim().slice(0, 60)).filter((p) => p && p !== "." && p !== "..").slice(0, 4).join("/") : "");

export async function listMyTemplates(owner: string, root = defaultRoot()): Promise<MyTemplate[]> {
  let names: string[];
  try {
    names = await readdir(dirOf(owner, root));
  } catch {
    return [];
  }
  const out: MyTemplate[] = [];
  for (const n of names.filter((x) => x.endsWith(".json"))) {
    try {
      out.push(JSON.parse(await readFile(path.join(dirOf(owner, root), n), "utf8")) as MyTemplate);
    } catch {}
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** null: the list is full. */
export async function saveMyTemplate(owner: string, name: string, folder: string, bytes: Uint8Array, root = defaultRoot()): Promise<MyTemplate | null> {
  const mine = await listMyTemplates(owner, root);
  if (mine.length >= MAX_MY_TEMPLATES) return null;
  const clean = cleanName(name) || "şablon";
  const place = cleanFolder(folder);
  // The same name in the same folder is the newer version of that form.
  const same = mine.find((t) => t.name === clean && (t.folder ?? "") === place);
  const t: MyTemplate = { id: same?.id ?? `t-${randomUUID()}`, name: clean, ...(place ? { folder: place } : {}), size: bytes.length, at: Date.now() };
  const dir = dirOf(owner, root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  writeFileAtomic(path.join(dir, `${t.id}.bin`), Buffer.from(bytes));
  writeFileAtomic(path.join(dir, `${t.id}.json`), JSON.stringify(t));
  return t;
}

export async function readMyTemplate(owner: string, id: string, root = defaultRoot()): Promise<{ meta: MyTemplate; bytes: Uint8Array } | null> {
  if (!isMyTemplateId(id)) return null;
  try {
    const dir = dirOf(owner, root);
    const meta = JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8")) as MyTemplate;
    return { meta, bytes: new Uint8Array(await readFile(path.join(dir, `${id}.bin`))) };
  } catch {
    return null;
  }
}

export async function deleteMyTemplate(owner: string, id: string, root = defaultRoot()): Promise<boolean> {
  if (!isMyTemplateId(id)) return false;
  const dir = dirOf(owner, root);
  const had = await readFile(path.join(dir, `${id}.json`)).then(() => true, () => false);
  await rm(path.join(dir, `${id}.bin`), { force: true });
  await rm(path.join(dir, `${id}.json`), { force: true });
  await rmdir(dir).catch(() => {}); // only when empty
  return had;
}
