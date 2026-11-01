import { Clock, MessageSquare, UserCheck, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { ONLINE_MINUTES, USAGE_LABELS, usageSummary } from "@/lib/usage";

export const metadata = { title: "Dashboard · Zafer AI" };

const num = (n: number) => n.toLocaleString("tr-TR");

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">{icon} {label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{num(value)}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function Dashboard() {
  await requireAdmin();
  const s = await usageSummary();
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
