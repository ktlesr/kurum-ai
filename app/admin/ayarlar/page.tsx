import { revalidatePath } from "next/cache";
import { getUser, requireAdmin } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/db";
import { doclingOffline } from "@/lib/extract";
import { modelConfig } from "@/lib/model-config";
import { customAddresses, presets, serverOf } from "@/lib/models";
import { ModelsForm } from "../models-form";

export const metadata = { title: "Ayarlar · Zafer AI" };

async function setWeb(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin") return;
  const v = form.get("web");
  if (v !== "true" && v !== "false") return;
  await setSetting("web_fetch", v);
  revalidatePath("/admin/ayarlar");
}

async function setOffline(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin") return;
  const v = form.get("offline");
  if (v !== "true" && v !== "false") return;
  await setSetting("docling_offline", v);
  revalidatePath("/admin/ayarlar");
}

export default async function SettingsPage() {
  await requireAdmin();
  const offline = await doclingOffline();
  const webOn = (await getSetting("web_fetch").catch(() => undefined)) === "true";
  const [cfg, savedModels] = await Promise.all([modelConfig(), getSetting("models")]);
  const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-subtle";
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Ayarlar</h1>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
        <div className="min-w-0 flex-1 basis-64">
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
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-medium">Bağlantıdan okuma: {webOn ? <span className="text-ok">Açık</span> : <span className="text-muted">Kapalı</span>}</p>
          <p className="mt-1 text-xs text-muted">
            Açıkken kullanıcı sorusuna bir web adresi yazarsa sayfa okunur ve cevapta kullanılır (güncel bilgi için). Sayfalar gömülü tarayıcıda açılır, sonradan yüklenen veriler de (ör. kurlar) okunur; tarayıcı iç ağa erişemez. Cevap sayfada yoksa aynı sitedeki en ilgili 2 bağlantı da okunur. Yalnızca bu adreslere sayfa isteği gider; belgeler ve soru metni dışarı gönderilmez. İç ağ adresleri okunmaz.
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
    </>
  );
}
