// Bulk user lines, pure so it can be tested: "kullanıcı", "kullanıcı;parola", "kullanıcı;eposta", "kullanıcı;eposta;parola" or
// "kullanıcı;parola;eposta[;ad]" (comma, semicolon or tab), one per line.
import { randomBytes } from "node:crypto";
import { EMAIL_RE } from "./credentials-mail.ts";
import { USERNAME_RE, passwordProblem } from "./password.ts";

export const MAX_BULK = 200;
export type BulkRow = { username: string; password?: string; email?: string; error?: string };
const TWO_ADDRESSES = "İki e-posta var: hangisinin adres, hangisinin parola olduğu anlaşılamıyor";

/** The address in what follows the name, and the password around it. A password can hold separators, so it stays as written. */
function readRest(rest: string): { password: string; email?: string; error?: string } {
  const parts = [...rest.matchAll(/[^,;\t]+/g)];
  const found = parts.filter((p) => EMAIL_RE.test(p[0].trim()));
  // Guessing could mail someone's password to an address that was only ever a password.
  if (found.length > 1) return { password: "", error: TWO_ADDRESSES };
  if (!found.length) return { password: rest };
  const email = found[0][0].trim().toLowerCase();
  const end = found[0].index + found[0][0].length;
  // First: all after it is the password. Later: all before it is, and what follows (a name) isn't needed.
  const password = found[0].index === 0 ? rest.slice(end + 1) : rest.slice(0, found[0].index - 1);
  return { password: password.trim(), email };
}

/** Starts with a letter and is otherwise hex: a spreadsheet opening the list takes it neither for a formula nor for a number. */
export const generatePassword = () => `k${randomBytes(9).toString("hex")}`;

export function parseBulk(text: string): BulkRow[] {
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // The header of a list made in a spreadsheet.
  if (/^(kullan[ıi]c[ıi]( ad[ıi])?|username)\s*([,;	]|$)/i.test(lines[0] ?? "")) lines.shift();
  return lines.map((line) => {
    const at = line.search(/[,;\t]/);
    const username = (at < 0 ? line : line.slice(0, at)).trim().toLowerCase();
    const { password, email, error } = readRest(at < 0 ? "" : line.slice(at + 1).trim());
    if (!USERNAME_RE.test(username)) return { username, error: "Geçersiz kullanıcı adı" };
    if (seen.has(username)) return { username, error: "Listede iki kez var" };
    seen.add(username);
    if (error) return { username, error };
    const mail = email ? { email } : {};
    if (!password) return { username, ...mail };
    const problem = passwordProblem(password);
    return problem ? { username, error: problem } : { username, password, ...mail };
  });
}
