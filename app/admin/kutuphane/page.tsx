import { AlertTriangle, CheckCircle2, Image as ImageIcon, Library, Trash2 } from "lucide-react";
import { revalidatePath } from "next/cache";
import { getUser, requireAdmin } from "@/lib/auth";
import { db, getSetting, setSetting } from "@/lib/db";
import { parseRules, ruleFrom, withRule, withoutRule } from "@/lib/folder-access";
import type { Skipped } from "@/lib/folder-scan";
import { galleryStatus } from "@/lib/gallery";
import { dropRulesCache, libraryStatus } from "@/lib/library";

export const metadata = { title: "Kütüphane · Zafer AI" };

const num = (n: number) => n.toLocaleString("tr-TR");
const adminOnly = async () => {
  const me = await getUser();
  return me?.role === "admin" && !me.mustChange;
};

async function addRule(form: FormData) {
  "use server";
  if (!(await adminOnly())) return;
  const rule = ruleFrom(form.get("folder"), form.get("users"));
  if (!rule) return;
  await setSetting("folder_access", JSON.stringify(withRule(parseRules(await getSetting("folder_access")), rule)));
  dropRulesCache();
  revalidatePath("/admin/kutuphane");
}

async function removeRule(form: FormData) {
  "use server";
  if (!(await adminOnly())) return;
  await setSetting("folder_access", JSON.stringify(withoutRule(parseRules(await getSetting("folder_access")), String(form.get("folder") ?? ""))));
  dropRulesCache();
  revalidatePath("/admin/kutuphane");
}

async function setCaptions(form: FormData) {
  "use server";
  if (!(await adminOnly())) return;
  const v = form.get("on");
  if (v !== "true" && v !== "false") return;
  await setSetting("gallery_captions", v);
  revalidatePath("/admin/kutuphane");
}

const REASONS: Record<string, string> = {
  timeout: "Klasör zamanında yanıt vermedi (NAS yavaş ya da kapalı olabilir).",
  ENOENT: "Klasör bulunamadı (bağlantı kopmuş olabilir).",
  EACCES: "Klasöre okuma izni yok.",
  EPERM: "Klasöre okuma izni yok.",
  EIO: "Klasör okunurken disk ya da ağ hatası oluştu.",
  ESTALE: "NAS bağlantısı geçersiz, yeniden bağlanmalı.",
  not_a_folder: "Verilen yol bir klasör değil.",
};

function SkippedList({ s }: { s: Skipped | null }) {
  if (!s) return null;
  const types = Object.entries(s.type).sort((a, b) => b[1] - a[1]);
  const lines = [
    s.tooBig ? `${num(s.tooBig)} dosya boyut sınırını aşıyor` : "",
    s.tooDeep ? `${num(s.tooDeep)} klasör çok derinde` : "",
    s.overLimit ? `${num(s.overLimit)} dosya sayı sınırını aştığı için alınmadı` : "",
    s.unreadable ? `${num(s.unreadable)} öğe okunamadı` : "",
    types.length ? `Desteklenmeyen türler: ${types.slice(0, 12).map(([t, n]) => `.${t} (${num(n)})`).join(", ")}${types.length > 12 ? "…" : ""}` : "",
  ].filter(Boolean);
  if (!lines.length) return <p className="mt-2 text-xs text-muted">Atlanan dosya yok.</p>;
  return (
    <div className="mt-2 text-xs text-muted">
      <p className="font-medium text-fg">Görünmeyenler</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

function Health({ ok, error, at }: { ok: boolean; error?: string; at: number }) {
  const when = at ? new Date(at).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) : "";
  return ok ? (
    <p className="flex items-center gap-1.5 text-xs text-ok"><CheckCircle2 size={13} /> Ulaşılıyor{when ? `, son tarama ${when}` : ""}</p>
  ) : (
    <p className="flex items-start gap-1.5 text-xs text-danger"><AlertTriangle size={13} className="mt-px shrink-0" /> {REASONS[error ?? ""] ?? "Klasör okunamadı."} Son başarılı liste kullanılıyor.</p>
  );
}

export default async function LibraryAdmin() {
  await requireAdmin();
  const sql = await db();
  const [lib, gal, rawRules, people] = await Promise.all([
    libraryStatus(),
    galleryStatus(),
    getSetting("folder_access").catch(() => undefined),
    sql<{ username: string }[]>`SELECT username FROM users WHERE status = 'active' AND role = 'user' ORDER BY username`,
  ]);
  let rules: ReturnType<typeof parseRules> = [];
  let broken = false;
  try {
    rules = parseRules(rawRules);
  } catch {
    broken = true;
  }
  const folders = [...lib.dirs, ...gal.dirs.map((d) => `galeri/${d}`), "galeri"];
  const field = "h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-sm text-fg outline-none focus:border-accent";
  const pct = gal.count ? Math.floor((100 * gal.captioned) / gal.count) : 0;
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Kütüphane</h1>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-panel p-4 text-sm">
          <h2 className="flex items-center gap-1.5 font-medium"><Library size={15} /> Ortak belgeler</h2>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{num(lib.count)} <span className="text-sm font-normal text-muted">belge, {num(lib.templates)} şablon</span></p>
          <div className="mt-2"><Health ok={lib.ok} error={lib.error} at={lib.at} /></div>
          <SkippedList s={lib.skipped} />
          <p className="mt-2 text-xs text-muted">Şablonlar: adı <code>Şablonlar</code> olan bir klasör ve alt klasörleri. Sohbette belge olarak görünmez, Şablon doldur panelinde listelenir.</p>
        </section>
        <section className="rounded-xl border border-line bg-panel p-4 text-sm">
          <h2 className="flex items-center gap-1.5 font-medium"><ImageIcon size={15} /> Galeri</h2>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{num(gal.count - gal.videos)} <span className="text-sm font-normal text-muted">fotoğraf, {num(gal.videos)} video</span></p>
          <div className="mt-2"><Health ok={gal.ok} error={gal.error} at={gal.at} /></div>
          <SkippedList s={gal.skipped} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-medium">İçerikle arama: {gal.on ? <span className="text-ok">Açık</span> : <span className="text-muted">Kapalı</span>}</p>
              <p className="mt-1 text-xs text-muted">Yerel görsel model fotoğrafları ve videolardan alınan birer kareyi tek tek tarif eder; yalnızca kimse modeli beklemiyorken çalışır. {num(gal.captioned)} / {num(gal.count)} (%{pct}) tamam. Açıklamalar bu sunucuda kalır.</p>
            </div>
            <form action={setCaptions}>
              <input type="hidden" name="on" value={gal.on ? "false" : "true"} />
              <button className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-subtle">{gal.on ? "Durdur" : "Başlat"}</button>
            </form>
          </div>
        </section>
      </div>

      <h2 className="mb-1 mt-8 text-base font-semibold tracking-tight">Klasör yetkileri</h2>
      <p className="mb-3 text-xs text-muted">Kural olmayan klasörü giriş yapan herkes görür. Kural konan klasörü ve altındakileri yalnızca yazılan kullanıcılar ve yöneticiler görür; kullanıcı yazılmazsa yalnızca yöneticiler. En yakın kural geçerlidir, alt klasöre ayrı kural konabilir. Sohbette, aramada ve şablonlarda aynı şekilde uygulanır.</p>
      {broken && <p role="alert" className="mb-3 text-xs text-danger">Kayıtlı yetkiler okunamadı: bu durumda yönetici dışında kimse ortak klasör ve galeri görmez.</p>}
      <form action={addRule} className="grid gap-3 rounded-xl border border-line bg-panel p-4 text-xs text-muted sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1">Klasör
          <input name="folder" required maxLength={500} list="kai-all-folders" placeholder="ortak/Personel ya da galeri/2025" className={field} />
          <datalist id="kai-all-folders">{folders.slice(0, 2000).map((f) => <option key={f} value={f} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1">Görebilecek kullanıcılar (virgülle)
          <input name="users" list="kai-all-users" placeholder="boş: yalnızca yöneticiler" className={field} />
          <datalist id="kai-all-users">{people.map((p) => <option key={p.username} value={p.username} />)}</datalist>
        </label>
        <div className="flex items-end"><button className="h-9 rounded-md border border-accent px-3 text-xs font-medium text-accent hover:bg-subtle">Kuralı kaydet</button></div>
      </form>
      {rules.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-left text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Klasör</th><th className="px-4 py-2 font-medium">Görebilenler</th><th className="w-10" /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.folder} className="border-t border-line">
                  <td className="px-4 py-2.5">{r.folder}</td>
                  <td className="px-4 py-2.5 text-muted">{r.users.length ? r.users.join(", ") : "Yalnızca yöneticiler"}</td>
                  <td className="px-2 py-1.5">
                    <form action={removeRule}>
                      <input type="hidden" name="folder" value={r.folder} />
                      <button aria-label={`${r.folder} kuralını sil`} title="Kuralı sil" className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-danger"><Trash2 size={14} /></button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
