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
const hash = await hashPassword(password);
await sql.begin(async (tx) => {
  const [u] = await tx<{ id: string }[]>`
    INSERT INTO users (username, pass_hash, role, status) VALUES (${username}, ${hash}, 'admin', 'active')
    ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, role = 'admin', status = 'active'
    RETURNING id`;
  // Password reset: sessions opened with the old password must not inherit admin rights.
  await tx`DELETE FROM sessions WHERE user_id = ${u.id}`;
});
console.log(`Yönetici hazır: ${username}`);
await sql.end();
