import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { db, getSetting, setSetting } from "@/lib/db";
import { doclingOffline } from "@/lib/extract";
import { modelConfig } from "@/lib/model-config";
import { customAddresses, presets, serverOf } from "@/lib/models";
import { ThemeToggle } from "../theme-toggle";
import { ModelsForm } from "./models-form";

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

async function setWeb(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin") return;
  const v = form.get("web");
  if (v !== "true" && v !== "false") return;
  await setSetting("web_fetch", v);
  revalidatePath("/admin");
}

async function setOffline(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin") return;
  const v = form.get("offline");
  if (v !== "true" && v !== "false") return;
  await setSetting("docling_offline", v);
  revalidatePath("/admin");
}

export default async function AdminPage() {
  const me = await getUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") notFound(); // don't advertise the page to regular users

  const sql = await db();
  const users = await sql<{ id: string; username: string; role: string; status: keyof typeof STATUS; created_at: Date }[]>`
    SELECT id, username, role, status, created_at FROM users ORDER BY status = 'pending' DESC, created_at DESC`;
  const offline = await doclingOffline();
  const webOn = (await getSetting("web_fetch").catch(() => undefined)) === "true";
  const [cfg, savedModels] = await Promise.all([modelConfig(), getSetting("models")]);

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

      <h2 className="mt-10 mb-3 text-base font-semibold tracking-tight">Ayarlar</h2>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Docling çevrimdışı modu: {offline ? <span className="text-ok">Açık</span> : <span className="text-warn-fg">Kapalı</span>}</p>
          <p className="mt-1 text-xs text-muted">
            Açıkken Docling model indirmek için internete çıkmaz (Hugging Face çevrimdışı modu, önerilen). İlk kurulumda OCR/tablo modellerini indirmek için kapatın, bir PDF yükleyin, sonra yeniden açın. Bir sonraki belge okumasından itibaren geçerlidir.
          </p>
        </div>
        <form action={setOffline}>
          <input type="hidden" name="offline" value={offline ? "false" : "true"} />
          <button className={btn}>{offline ? "Kapat (modelleri indir)" : "Aç"}</button>
        </form>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Bağlantıdan okuma: {webOn ? <span className="text-ok">Açık</span> : <span className="text-muted">Kapalı</span>}</p>
          <p className="mt-1 text-xs text-muted">
            Açıkken kullanıcı sorusuna bir web adresi yazarsa sayfa okunur ve cevapta kullanılır (güncel bilgi için). Cevap sayfada yoksa aynı sitedeki en ilgili 2 bağlantı da okunur (ör. TCMB ana sayfasından günlük kur verisi). Yalnızca bu adreslere sayfa isteği gider; belgeler ve soru metni dışarı gönderilmez. İç ağ adresleri okunmaz.
          </p>
        </div>
        <form action={setWeb}>
          <input type="hidden" name="web" value={webOn ? "false" : "true"} />
          <button className={btn}>{webOn ? "Kapat" : "Aç"}</button>
        </form>
      </div>
      <div className="mt-4">
        <ModelsForm cfg={cfg} server={serverOf(cfg)} saved={!!savedModels} custom={customAddresses(cfg, presets(process.env))} />
      </div>
    </main>
  );
}
