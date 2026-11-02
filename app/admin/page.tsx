import { ArrowDownToLine, ArrowUpFromLine, Clock, Coins, MessageSquare, PiggyBank, UserCheck, Wifi } from "lucide-react";
import { revalidatePath } from "next/cache";
import type { ReactNode } from "react";
import { getUser, requireAdmin } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/db";
import { checkPrice, costUsd, readPrice } from "@/lib/token-price";
import { ONLINE_MINUTES, USAGE_LABELS, usageSummary } from "@/lib/usage";

export const metadata = { title: "Dashboard · Zafer AI" };

const num = (n: number) => n.toLocaleString("tr-TR");

// Millions don't fit a tile: short there, exact in the table below and on hover.
const short = (n: number) => n.toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const money = (n: number, currency: "TRY" | "USD") => n.toLocaleString("tr-TR", { style: "currency", currency, maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 });
const trDate = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const PERIODS = [["today", "Bugün"], ["week", "7 gün"], ["month", "30 gün"], ["total", "Toplam"]] as const;

function Stat({ icon, label, value, hint, exact, good }: { icon: ReactNode; label: string; value: number | string; hint?: string; exact?: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">{icon} {label}</p>
      <p title={exact} className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${good ? "text-ok" : ""}`}>{typeof value === "number" ? num(value) : value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

async function savePrice(form: FormData) {
  "use server";
  const me = await getUser();
  if (me?.role !== "admin" || me.mustChange) return;
  const price = checkPrice(Object.fromEntries(form), new Date().toISOString().slice(0, 10));
  if (typeof price === "string") return; // the inputs already refuse these; this is for hand-made requests
  await setSetting("token_price", JSON.stringify(price));
  revalidatePath("/admin");
}

export default async function Dashboard() {
  await requireAdmin();
  const [s, savedPrice] = await Promise.all([usageSummary(), getSetting("token_price").catch(() => undefined)]);
  const price = readPrice(savedPrice);
  const usd = (k: (typeof PERIODS)[number][0]) => costUsd(s.tokens.input[k], s.tokens.output[k], price);
  const allTokens = s.tokens.input.total + s.tokens.output.total;
  const field = "h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-sm text-fg outline-none focus:border-accent";
  const queries = s.usage.find((u) => u.kind === "query")!;
  const top = Math.max(1, ...s.queriesByDay.map((d) => d.count));
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Dashboard</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Wifi size={14} />} label="Çevrimiçi" value={s.online} hint={`Son ${ONLINE_MINUTES} dakikada açık`} />
        <Stat icon={<UserCheck size={14} />} label="Etkin kullanıcı" value={s.users} />
        <Stat icon={<Clock size={14} />} label="Onay bekleyen" value={s.pending} />
        <Stat icon={<MessageSquare size={14} />} label="Bugünkü sorgu" value={queries.today} />
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold tracking-tight">Token ve tasarruf</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Coins size={14} />} label="Toplam token" value={short(allTokens)} exact={num(allTokens)} />
        <Stat icon={<ArrowUpFromLine size={14} />} label="İstek token" value={short(s.tokens.input.total)} exact={num(s.tokens.input.total)} hint="Modele gönderilen" />
        <Stat icon={<ArrowDownToLine size={14} />} label="Yanıt token" value={short(s.tokens.output.total)} exact={num(s.tokens.output.total)} hint="Modelin ürettiği" />
        <Stat icon={<PiggyBank size={14} />} label="Bulutta tutacağı tutar" value={money(usd("total") * price.usdTry, "TRY")} hint={`${money(usd("total"), "USD")} · ${price.label}`} good />
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Dönem</th>
              {PERIODS.map(([k, h]) => <th key={k} className="whitespace-nowrap px-4 py-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {([
              ["İstek token", (k) => num(s.tokens.input[k])],
              ["Yanıt token", (k) => num(s.tokens.output[k])],
              ["Toplam token", (k) => num(s.tokens.input[k] + s.tokens.output[k])],
              ["Karşılığı (₺)", (k) => money(usd(k) * price.usdTry, "TRY")],
              ["Karşılığı ($)", (k) => money(usd(k), "USD")],
            ] as [string, (k: (typeof PERIODS)[number][0]) => string][]).map(([label, cell]) => (
              <tr key={label} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2.5">{label}</td>
                {PERIODS.map(([k]) => <td key={k} className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{cell(k)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        {s.tokens.since ? `${trDate(s.tokens.since)} tarihinden itibaren sayılıyor; önceki kullanım bilinmiyor. ` : "Henüz sayılmış token yok. "}
        Tutar, aynı tokenlerin {price.label} fiyatıyla (1 milyon istek tokeni {price.input.toLocaleString("tr-TR")} $, yanıt tokeni {price.output.toLocaleString("tr-TR")} $; 1 $ = {price.usdTry.toLocaleString("tr-TR")} ₺, {trDate(price.at)}) ne tutacağını gösterir. Brüt karşılaştırmadır: donanım, elektrik ve bakım giderleri düşülmemiştir; bulutun önbellek indirimleri hesaba katılmamıştır. Belge arama (embedding) tokenleri dahil değildir. İptal edilen yanıtlar tahminle sayılır.
      </p>
      <details className="mt-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium">Fiyat ve kuru değiştir</summary>
        <form action={savePrice} className="mt-3 grid gap-3 text-xs text-muted sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">Karşılaştırılan hizmet<input name="label" defaultValue={price.label} required maxLength={60} className={field} /></label>
          <label className="flex flex-col gap-1">İstek, $ / 1 milyon token<input name="input" type="number" step="any" min="0" max="1000000" defaultValue={price.input} required className={field} /></label>
          <label className="flex flex-col gap-1">Yanıt, $ / 1 milyon token<input name="output" type="number" step="any" min="0" max="1000000" defaultValue={price.output} required className={field} /></label>
          <label className="flex flex-col gap-1">1 $ kaç ₺<input name="usdTry" type="number" step="any" min="0.01" max="1000000" defaultValue={price.usdTry} required className={field} /></label>
          <div className="flex items-end"><button className="h-9 rounded-md border border-accent px-3 text-xs font-medium text-accent hover:bg-subtle">Kaydet</button></div>
        </form>
        <p className="mt-2 text-xs text-muted">Yeni değerler geçmiş dönemlerin tutarını da yeniden hesaplar; tokenler olduğu gibi kalır.</p>
      </details>

      <h2 className="mb-3 mt-8 text-base font-semibold tracking-tight">Kullanım</h2>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">İşlem</th>
              {["Bugün", "7 gün", "30 gün", "Toplam"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {s.usage.map((u) => (
              <tr key={u.kind} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2.5">{USAGE_LABELS[u.kind]}</td>
                {[u.today, u.week, u.month, u.total].map((v, i) => <td key={i} className="px-4 py-2.5 text-right tabular-nums">{num(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold tracking-tight">Son 14 günde sorgu</h2>
      <div className="flex h-40 items-end gap-1 rounded-xl border border-line bg-panel p-4" role="img" aria-label={`Son 14 günde toplam ${num(s.queriesByDay.reduce((a, d) => a + d.count, 0))} sorgu`}>
        {s.queriesByDay.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${d.day.slice(8)}.${d.day.slice(5, 7)}: ${num(d.count)} sorgu`}>
            <div className="min-h-0.5 rounded-t bg-accent" style={{ height: `${(d.count / top) * 100}%` }} />
            <span className="text-center text-[10px] tabular-nums text-muted">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">Sayılar bu özelliğin devreye girdiği günden itibaren tutulur ve yalnızca günlük toplamdır: kim yaptığı ya da içerik saklanmaz. Sunum PowerPoint indirildiğinde, sosyal medya görseli indirildiğinde, video oluşturulduğunda sayılır; aynı işin tekrar indirilmesi yeniden sayılır.</p>
    </>
  );
}
