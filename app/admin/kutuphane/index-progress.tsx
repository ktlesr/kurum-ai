"use client";
// The shared folder's content index, live: polled every few seconds while the page is open and visible.
import { AlertTriangle, CheckCircle2, FileSearch, Loader2, PauseCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { indexStatus } from "@/lib/doc-indexer";

type Status = Awaited<ReturnType<typeof indexStatus>>;
const POLL_MS = 3_000;
const num = (n: number) => n.toLocaleString("tr-TR");
const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} sn` : s < 3600 ? `${Math.round(s / 60)} dk` : `${Math.round(s / 3600)} sa`;
};
const time = (at: number) => new Date(at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

const STATE: Record<Status["state"], string> = {
  off: "Kapalı (DOC_INDEX=off).",
  down: "Ortak klasöre ulaşılamıyor; klasör geri gelince devam edecek.",
  working: "Okunuyor",
  paused_fail: "Bir dosya okunamadı; kısa bir moladan sonra devam edecek.",
  paused_yield: "Bir kullanıcı modeli ya da belge okuyucuyu bekliyordu; ona yer açıldı, birazdan devam edecek.",
  waiting_idle: "Model kullanımda; sohbetler bitip sistem boşalınca devam edecek.",
  done: "Tamamlandı: okunabilir bütün dosyalar tarandı.",
};

export function IndexProgress() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      // Not while the tab is hidden: nobody reads it, and it costs a database query each time.
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/admin/doc-index", { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          const next = (await r.json()) as Status;
          if (!stop) {
            setS(next);
            setError(false);
          }
        } catch {
          if (!stop) setError(true);
        }
      }
      if (!stop) {
        setNow(Date.now());
        timer = setTimeout(load, POLL_MS);
      }
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const pct = s && s.total ? Math.floor((100 * (s.indexed + s.failed)) / s.total) : 0;
  return (
    <section className="rounded-xl border border-line bg-panel p-4 text-sm lg:col-span-2" aria-live="polite">
      <h2 className="flex items-center gap-1.5 font-medium"><FileSearch size={15} /> İçerik dizini (belge_ara)</h2>
      {!s && !error && <p className="mt-2 text-muted">Yükleniyor…</p>}
      {error && <p className="mt-2 flex items-center gap-1.5 text-danger"><AlertTriangle size={14} /> Durum alınamadı; tekrar deneniyor.</p>}
      {s && (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {num(s.indexed)} <span className="text-sm font-normal text-muted">/ {num(s.total)} dosya tarandı (%{pct})</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Tarama ilerlemesi">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>Bekleyen: {num(s.pending)}</span>
            <span>Okunamayan: {num(s.failed)}</span>
            {s.retrying > 0 && <span>Yeniden denenecek: {num(s.retrying)}</span>}
            <span>Son 1 saatte: {num(s.lastHour)} dosya</span>
          </p>
          <p className="mt-3 flex items-start gap-1.5">
            {s.state === "working" ? <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent" />
              : s.state === "done" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
              : s.state === "down" ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              : <PauseCircle size={14} className="mt-0.5 shrink-0 text-muted" />}
            <span className="min-w-0">
              {STATE[s.state]}
              {s.current && <>: <span className="break-all font-mono text-xs">{s.current.path}</span> <span className="text-muted">({ago(now - s.current.since)})</span></>}
              {s.until && s.until > now && <span className="text-muted"> (yaklaşık {ago(s.until - now)} sonra)</span>}
            </span>
          </p>
          {s.last && s.state !== "working" && (
            <p className="mt-1 text-xs text-muted">Son okunan ({time(s.last.at)}{s.last.ok ? "" : ", okunamadı"}): <span className="break-all font-mono">{s.last.path}</span></p>
          )}
          {s.failures.length > 0 && (
            <details className="mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer text-xs font-medium">Okunamayan dosyalar ({num(s.failed)}{s.failed > s.failures.length ? `, son ${s.failures.length}` : ""})</summary>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs">
                {s.failures.map((f) => (
                  <li key={f.path}><span className="break-all font-mono">{f.path}</span> <span className="text-muted">— {f.error || "okunamadı"}</span></li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-3 text-xs text-muted">Yalnızca sistem boşken çalışır ve bir kullanıcı gelince kenara çekilir; ilk tarama klasörün büyüklüğüne göre saatler ya da günler sürebilir. Taranmamış dosyalar içerik aramasında henüz çıkmaz.</p>
        </>
      )}
    </section>
  );
}
