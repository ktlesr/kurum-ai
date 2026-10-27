import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ThemeToggle } from "../theme-toggle";

export const metadata = { title: "Kullanıcılar · Kurum AI" };

const STATUS = { pending: "Onay bekliyor", active: "Etkin", disabled: "Devre dışı" } as const;

async function setStatus(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin") return;
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  if (!(status in STATUS) || !/^[0-9a-f-]{36}$/i.test(id)) return;
  const sql = await db();
  // Self-check in SQL (uuid equality), not on the string: "ABC…" and "abc…" are the same user.
  const [u] = await sql`UPDATE users SET status = ${status} WHERE id = ${id} AND id <> ${me.id} RETURNING id`;
  if (u && status !== "active") await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
  revalidatePath("/admin");
}

export default async function AdminPage() {
  const me = await getUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") notFound(); // don't advertise the page to regular users

  const sql = await db();
  const users = await sql<{ id: string; username: string; role: string; status: keyof typeof STATUS; created_at: Date }[]>`
    SELECT id, username, role, status, created_at FROM users ORDER BY status = 'pending' DESC, created_at DESC`;

  const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-subtle";
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Kullanıcılar</h1>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-accent hover:underline">Asistana dön</Link>
          <ThemeToggle />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-left text-xs text-muted">
            <tr><th className="px-4 py-2 font-medium">Kullanıcı</th><th className="px-4 py-2 font-medium">Durum</th><th className="px-4 py-2 font-medium">Kayıt</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-2.5">{u.username}{u.role === "admin" && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">yönetici</span>}</td>
                <td className={`px-4 py-2.5 ${u.status === "pending" ? "text-warn-fg" : u.status === "disabled" ? "text-muted" : ""}`}>{STATUS[u.status]}</td>
                <td className="px-4 py-2.5 text-muted">{u.created_at.toLocaleDateString("tr-TR")}</td>
                <td className="px-4 py-2.5 text-right">
                  {u.id !== me.id && (
                    <form action={setStatus} className="inline-flex gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      {u.status !== "active" && <button name="status" value="active" className={btn}>{u.status === "pending" ? "Onayla" : "Etkinleştir"}</button>}
                      {u.status !== "disabled" && <button name="status" value="disabled" className={`${btn} text-danger`}>{u.status === "pending" ? "Reddet" : "Devre dışı bırak"}</button>}
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
