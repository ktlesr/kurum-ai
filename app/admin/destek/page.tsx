import { revalidatePath } from "next/cache";
import { getUser, requireAdmin } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/db";
import { ACCESS_KEY, accessOf } from "@/lib/destek/chat";
import { DestekAdmin } from "./destek-admin";

export const metadata = { title: "Destek verisi · Zafer AI" };

async function setAccess(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin" || me.mustChange) return;
  await setSetting(ACCESS_KEY, accessOf(String(form.get("access") ?? "")));
  revalidatePath("/admin/destek");
}

export default async function Page() {
  await requireAdmin();
  const access = accessOf(await getSetting(ACCESS_KEY));
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Destek verisi</h1>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        &quot;ZAFER Destekler – Veriler (Deflatörlü)&quot; Excel dosyası. Sohbetteki sayısal sorular (proje sayısı, destek, bütçe, oran, il/ilçe/yıl/program kırılımı)
        bu dosyanın etkin sürümünden hesaplanır. Yeni sürüm, dosyadaki İcmal sayfalarıyla kuruşu kuruşuna tutarsa etkin olur; tutmazsa önceki sürüm kullanılmaya devam eder.
        Dosya adındaki yıl değişebilir (2026 → 2027); her yükleme öncekinin yerine geçer.
      </p>
      <DestekAdmin />
      <section className="mt-6 rounded-xl border border-line bg-panel p-4 text-sm">
        <h2 className="font-medium">Kimler kullanabilir</h2>
        <form action={setAccess} className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5"><input type="radio" name="access" value="all" defaultChecked={access === "all"} /> Bütün kullanıcılar</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="access" value="admin" defaultChecked={access === "admin"} /> Yalnızca yöneticiler</label>
          <button className="rounded-md border border-line px-2.5 py-1 font-medium hover:bg-subtle">Kaydet</button>
        </form>
        <p className="mt-2 text-xs text-muted">Dosyada başvuru sahiplerinin adları ve tutarlar var; ajans dışına açık bir kullanıcı varsa &quot;Yalnızca yöneticiler&quot; seçin.</p>
      </section>
    </>
  );
}
