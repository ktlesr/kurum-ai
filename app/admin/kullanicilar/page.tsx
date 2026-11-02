import { revalidatePath } from "next/cache";
import { getUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailReady } from "@/lib/iletisim";
import { CreateUsers } from "./create-users";
import { UserMail } from "./user-mail";

export const metadata = { title: "Kullanıcılar · Zafer AI" };

const STATUS = { pending: "Onay bekliyor", active: "Etkin", disabled: "Devre dışı" } as const;

async function setStatus(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin" || me.mustChange) return;
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  if (!(status in STATUS) || !/^[0-9a-f-]{36}$/i.test(id)) return;
  const sql = await db();
  // Self-check in SQL (uuid equality), not on the string: "ABC…" and "abc…" are the same user.
  const [u] = await sql`UPDATE users SET status = ${status} WHERE id = ${id} AND id <> ${me.id} RETURNING id`;
  if (u && status !== "active") await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
  revalidatePath("/admin/kullanicilar");
}

export default async function UsersPage() {
  const me = await requireAdmin();
  const sql = await db();
  const users = await sql<{ id: string; username: string; role: string; status: keyof typeof STATUS; created_at: Date; email: string | null }[]>`
    SELECT id, username, role, status, created_at, email FROM users ORDER BY status = 'pending' DESC, created_at DESC`;
  const mailOn = mailReady();
  const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-subtle";
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Kullanıcılar</h1>
      <CreateUsers mailOn={mailOn} />
      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-left text-xs text-muted">
            <tr><th className="px-4 py-2 font-medium">Kullanıcı</th><th className="px-4 py-2 font-medium">E-posta</th><th className="px-4 py-2 font-medium">Durum</th><th className="px-4 py-2 font-medium">Kayıt</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2.5">{u.username}{u.role === "admin" && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">yönetici</span>}</td>
                <td className="min-w-72 px-4 py-2"><UserMail id={u.id} username={u.username} email={u.email} canSend={mailOn && u.status === "active" && u.role === "user"} canEdit={u.role === "user" || u.id === me.id} /></td>
                <td className={`whitespace-nowrap px-4 py-2.5 ${u.status === "pending" ? "text-warn-fg" : u.status === "disabled" ? "text-muted" : ""}`}>{STATUS[u.status]}</td>
                <td className="px-4 py-2.5 text-muted">{u.created_at.toLocaleDateString("tr-TR")}</td>
                <td className="px-4 py-2.5 text-right">
                  {u.id !== me.id && (
                    <form action={setStatus} className="inline-flex gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      {u.status !== "active" && <button name="status" value="active" className={`${btn} whitespace-nowrap`}>{u.status === "pending" ? "Onayla" : "Etkinleştir"}</button>}
                      {u.status !== "disabled" && <button name="status" value="disabled" className={`${btn} whitespace-nowrap text-danger`}>{u.status === "pending" ? "Reddet" : "Devre dışı bırak"}</button>}
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
