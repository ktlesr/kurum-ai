// Creates (or promotes + resets) an active admin. Password comes from ADMIN_PASSWORD, never from argv
// (argv ends up in shell history and `ps`).
// Usage: ADMIN_PASSWORD=… node --env-file=.env.local scripts/create-admin.ts <username>
import { db } from "../lib/db.ts";
import { hashPassword, passwordProblem, USERNAME_RE } from "../lib/password.ts";

const username = (process.argv[2] ?? "").toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
if (!USERNAME_RE.test(username)) throw new Error("Kullanım: ADMIN_PASSWORD=… node --env-file=.env.local scripts/create-admin.ts <kullanıcı-adı>");
const problem = passwordProblem(password);
if (problem) throw new Error(`ADMIN_PASSWORD: ${problem}`);

const sql = await db();
await sql`
  INSERT INTO users (username, pass_hash, role, status) VALUES (${username}, ${await hashPassword(password)}, 'admin', 'active')
  ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, role = 'admin', status = 'active'`;
console.log(`Yönetici hazır: ${username}`);
await sql.end();
