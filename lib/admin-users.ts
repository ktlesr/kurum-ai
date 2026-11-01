// Bulk user lines, pure so it can be tested: "kullanıcı" or "kullanıcı,parola" (comma, semicolon or tab), one per line.
import { randomBytes } from "node:crypto";
import { USERNAME_RE, passwordProblem } from "./password.ts";

export const MAX_BULK = 200;
export type BulkRow = { username: string; password?: string; error?: string };

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
    const password = at < 0 ? "" : line.slice(at + 1).trim();
    if (!USERNAME_RE.test(username)) return { username, error: "Geçersiz kullanıcı adı" };
    if (seen.has(username)) return { username, error: "Listede iki kez var" };
    seen.add(username);
    if (!password) return { username };
    const problem = passwordProblem(password);
    return problem ? { username, error: problem } : { username, password };
  });
}
