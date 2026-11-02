// Who sees which shared folder. With no rule a folder is open to every signed-in user; a rule closes it and everything under it to
// all but the names it lists (and admins). The closest rule to a file decides, so a subfolder can be opened or closed on its own.
// Pure: tests drive it. Paths: "ortak/Personel" in the shared library, "galeri/2025" in the gallery.

export interface FolderRule { folder: string; users: string[] }

const clean = (p: string) => p.normalize("NFC").split("/").map((s) => s.trim()).filter(Boolean).join("/");

/**
 * How paths compare. A rule must never miss its folder by a letter's case or by how a NAS spells "ş" (composed or not): the
 * mistake would open it. Two folders differing only in case fall under the same rule, which is the safe side.
 */
export const pathKey = (p: string) => p.normalize("NFC").toLowerCase();

export function canSee(file: string, who: { username: string; role: string }, rules: readonly FolderRule[]): boolean {
  if (who.role === "admin") return true;
  const f = pathKey(file);
  let best: FolderRule | undefined;
  for (const r of rules) {
    const k = pathKey(r.folder);
    if ((f === k || f.startsWith(`${k}/`)) && (!best || k.length > pathKey(best.folder).length)) best = r;
  }
  return !best || best.users.includes(who.username);
}

/** The rules as saved; a malformed rule drops out. A setting that can't be read at all throws: the caller then shows nothing. */
export function parseRules(raw: string | undefined): FolderRule[] {
  if (!raw) return [];
  const j = JSON.parse(raw) as unknown;
  if (!Array.isArray(j)) throw new Error("bad_rules");
  return j.flatMap((x): FolderRule[] => {
    const r = x as { folder?: unknown; users?: unknown };
    const folder = typeof r.folder === "string" ? clean(r.folder) : "";
    if (!folder) return [];
    return [{ folder, users: Array.isArray(r.users) ? r.users.filter((u): u is string => typeof u === "string") : [] }];
  });
}

/** A rule from the admin's form: the folder, and names split by commas or spaces. Empty names: admins only. */
export function ruleFrom(folder: unknown, users: unknown): FolderRule | null {
  const f = typeof folder === "string" ? clean(folder) : "";
  if (!f || f.length > 500 || f.split("/").some((s) => s === "." || s === "..")) return null;
  const names = typeof users === "string" ? users.toLowerCase().split(/[\s,;]+/).filter(Boolean) : [];
  return { folder: f, users: [...new Set(names)].slice(0, 500) };
}

export const withRule = (rules: readonly FolderRule[], rule: FolderRule) => [...rules.filter((r) => pathKey(r.folder) !== pathKey(rule.folder)), rule].sort((a, b) => a.folder.localeCompare(b.folder, "tr"));
export const withoutRule = (rules: readonly FolderRule[], folder: string) => rules.filter((r) => pathKey(r.folder) !== pathKey(clean(folder)));
/** A rule that points nowhere protects nothing: the admin page says so. */
export const ruleFindsFolder = (rule: FolderRule, folders: readonly string[]) => folders.some((d) => pathKey(d) === pathKey(rule.folder) || pathKey(d).startsWith(`${pathKey(rule.folder)}/`));
