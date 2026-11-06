"use client";
// Loading a new version of the support workbook and what came of it: the load's steps live, then the reconciliation
// with the İcmal sheets, the workbook's own inconsistencies, the data-quality findings, and the versions so far.
import { AlertTriangle, CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { IngestReport } from "@/lib/destek/store";

type Snap = { id: number; file: string; loadedAt: string; activatedAt: string | null; status: string; active: boolean; error: string | null; by: string | null };
interface State {
  job: { file: string; by: string; startedAt: number; step: string; running: boolean; endedAt?: number; error?: string } | null;
  active: Snap | null;
  snapshots: Snap[];
  report: IngestReport | null;
  dq: { kind: string; aile: string | null; satir: number | null; kolon: string | null; detail: string }[];
}

const num = (n: number) => n.toLocaleString("tr-TR");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "");
const KIND: Record<string, string> = {
  schema_drift: "Sözlükte olmayan başlık", formul_sonucu_yok: "Formülün kayıtlı sonucu yok", hata_degeri: "Excel hata değeri (#DIV/0!, #VALUE!)",
  sayi_metin: "Sayı kolonunda metin", tarih_metin: "Tarih kolonunda metin", yazim: "Yazım düzeltildi", bosluk: "Boşluk kaldırıldı",
  bos_il: "İl boş (proje sayılmadı)", liste_yazim: "Asil/Yedek yazım farkı", anahtar_tekil_degil: "Satır anahtarı tekil değil",
  esanlam: "Eş anlamlı değerler", icmal_kolon: "Tanınmayan İcmal kolonu", deflator_yok: "Deflatör tablosu yok",
};

export function DestekAdmin() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Bumped after an upload: the status is read again, then every 2 s while that load runs (nothing changes otherwise).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const r = await fetch("/api/admin/destek", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const next = (await r.json()) as State;
        if (stop) return;
        setS(next);
        if (next.job?.running) timer = setTimeout(read, 2_000);
      } catch {
        if (stop) return;
        setError("Durum alınamadı.");
        timer = setTimeout(read, 5_000);
      }
    };
    void read();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [tick]);

  const send = async () => {
    const f = input.current?.files?.[0];
    if (!f) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/destek?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      if (!r.ok) setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Yüklenemedi (${r.status}).`);
      else if (input.current) input.current.value = "";
    } catch {
      setError("Yüklenemedi: bağlantı kesildi.");
    } finally {
      setSending(false);
      setTick((t) => t + 1);
    }
  };

  const active = s?.active;
  const rep = s?.report;
  const running = !!s?.job?.running;
  return (
    <div className="grid gap-3">
      <section className="rounded-xl border border-line bg-panel p-4 text-sm">
        <h2 className="font-medium">Etkin sürüm</h2>
        {active ? (
          <p className="mt-1 text-muted"><CheckCircle2 size={14} className="mr-1 inline text-accent" />{active.file} · {when(active.activatedAt ?? active.loadedAt)}{active.by ? ` · ${active.by}` : ""}</p>
        ) : (
          <p className="mt-1 text-muted">{s ? "Henüz yüklenmiş bir sürüm yok; sohbette destek soruları cevaplanamaz." : "Yükleniyor…"}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".xlsx" aria-label="Excel dosyası" className="text-xs file:mr-2 file:rounded-md file:border file:border-line file:bg-bg file:px-2 file:py-1 file:text-xs" />
          <button onClick={send} disabled={sending || running} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-subtle disabled:opacity-50">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Yeni sürüm yükle
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-warn-fg" role="alert">{error}</p>}
        {s?.job && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" role="status">
            {s.job.running ? <Loader2 size={13} className="animate-spin" /> : s.job.error ? <XCircle size={13} className="text-warn-fg" /> : <CheckCircle2 size={13} className="text-accent" />}
            {s.job.file}: {s.job.error ?? s.job.step}
          </p>
        )}
      </section>

      {rep && <Report rep={rep} />}

      {!!s?.dq.length && (
        <section className="rounded-xl border border-line bg-panel p-4 text-sm">
          <h2 className="font-medium">Veri kalitesi bulguları (son yükleme)</h2>
          <p className="mt-1 text-xs text-muted">{Object.entries(rep?.dq ?? {}).map(([k, n]) => `${KIND[k] ?? k}: ${num(n)}`).join(" · ")}</p>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted">İlk {s.dq.length} bulgu</summary>
            <ul className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
              {s.dq.map((d, i) => <li key={i}>{d.aile ? `${d.aile} ` : ""}{d.satir ? `satır ${d.satir}${d.kolon ? ` (${d.kolon})` : ""}: ` : ""}{d.detail}</li>)}
            </ul>
          </details>
        </section>
      )}

      {!!s?.snapshots.length && (
        <section className="rounded-xl border border-line bg-panel p-4 text-sm">
          <h2 className="font-medium">Sürümler</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {s.snapshots.map((x) => (
              <li key={x.id} className="flex flex-wrap gap-x-2">
                <span className={x.active ? "font-medium text-accent" : x.status === "failed" ? "text-warn-fg" : "text-muted"}>{x.active ? "Etkin" : x.status === "failed" ? "Yüklenmedi" : x.status === "loading" ? "Yükleniyor" : "Eski"}</span>
                <span>{x.file}</span>
                <span className="text-muted">{when(x.loadedAt)}{x.by ? ` · ${x.by}` : ""}</span>
                {x.error && <span className="text-warn-fg">{x.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Report({ rep }: { rep: IngestReport }) {
  const ok = rep.status === "ready" || rep.status === "same";
  return (
    <section className="rounded-xl border border-line bg-panel p-4 text-sm">
      <h2 className="flex items-center gap-1.5 font-medium">
        {ok ? <CheckCircle2 size={15} className="text-accent" /> : <AlertTriangle size={15} className="text-warn-fg" />} Son yüklemenin raporu: {rep.file}
      </h2>
      {rep.status !== "same" && (
        <>
          <p className="mt-1 text-xs text-muted">{Object.entries(rep.rows).map(([a, r]) => `${a} ${num(r.loaded)} proje${r.skipped ? ` (${num(r.skipped)} satır İl boş)` : ""}`).join(" · ")}</p>
          <p className={`mt-2 text-xs ${rep.reconcile.mismatches.length || rep.reconcile.coverage.length ? "text-warn-fg" : ""}`}>
            İcmal mutabakatı: {num(rep.reconcile.checked)} il/ilçe hücresi karşılaştırıldı, {num(rep.reconcile.mismatches.length)} fark.
          </p>
          {rep.reconcile.coverage.map((c, i) => <p key={i} className="text-xs text-warn-fg">Kapsam: {c}</p>)}
          {rep.reconcile.mismatches.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-warn-fg">
              {rep.reconcile.mismatches.slice(0, 50).map((m, i) => <li key={i}>{m.aile} İcmal satır {m.satir} ({m.il}/{m.ilce}) {m.metric}: İcmal {m.icmal}, hesap {m.hesap}</li>)}
            </ul>
          )}
          {rep.unlisted.length > 0 && <p className="mt-1 text-xs text-muted">İcmal&apos;de satırı olmayan il/ilçe (İcmal toplamlarına girmiyor, cevaplarda sayılıyor): {rep.unlisted.map((u) => `${u.aile} ${u.il}/${u.ilce ?? "-"} (${u.n})`).join(", ")}</p>}
          {rep.icmalTotals.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-warn-fg">İcmal&apos;in kendi toplam satırlarında {rep.icmalTotals.length} tutarsız hücre (cevaplarda kullanılmaz)</summary>
              <ul className="mt-1 space-y-0.5">
                {rep.icmalTotals.map((t, i) => <li key={i}>{t.aile} İcmal satır {t.satir} ({t.il}) {t.kolon}: kayıtlı {t.kayitli ?? "boş"}, satırların toplamı {t.beklenen}</li>)}
              </ul>
            </details>
          )}
          <p className="mt-2 text-xs text-muted">Def-TL kontrolü: {num(rep.defCheck.checked)} tamamlanmış projede formül yeniden uygulandı, {num(rep.defCheck.mismatches.length)} fark.</p>
        </>
      )}
      {rep.status === "same" && <p className="mt-1 text-xs text-muted">Bu dosya etkin sürümle aynı; değişiklik yapılmadı.</p>}
    </section>
  );
}
