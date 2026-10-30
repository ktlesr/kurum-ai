"use client";

// Sunum mode's pieces: the panel that starts a deck, the slide strip, the layout gallery. The elements themselves are
// edited by the studio's canvas and inspector.
import { memo, useId, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Loader2, Plus, Presentation, Sparkles, Trash2, X } from "lucide-react";
import { slideFrom, type DeckTemplate, type Layout, type TemplateInfo } from "@/lib/deck";
import { draw, type El, type Measure } from "@/lib/studio";
import { PrimView } from "./editor";

/** A slide drawn small: the same primitives as the canvas, with the fonts the page has loaded. */
export const SlideThumb = memo(function SlideThumb({ els, measure }: { els: El[]; measure: Measure }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 1920 1080" className="block w-full rounded bg-white" aria-hidden>
      {draw(els, measure).map((p, i) => <PrimView key={i} p={p} k={i} uid={uid} />)}
    </svg>
  );
});

export async function loadTemplate(id: string): Promise<DeckTemplate> {
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error("şablon");
  const r = await fetch(`/slides/${id}.json`);
  if (!r.ok) throw new Error("şablon");
  return r.json();
}

/** One step of the model's work; "too many requests" waits as told (a deck is more than 20 calls a minute at most). */
async function step<T>(body: unknown, signal: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch("/api/slides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (r.status === 429 && i < 4) {
      await new Promise((ok) => setTimeout(ok, (Number(r.headers.get("retry-after")) || 60) * 1000));
      signal.throwIfAborted();
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "Sunum hazırlanamadı.");
    return j as T;
  }
}

export function DeckPanel({ docs, onStart, onNote }: {
  docs: { id: string; name: string }[];
  onStart: (template: DeckTemplate, info: TemplateInfo, slides: El[][]) => void;
  onNote: (kind: "ok" | "error", text: string) => void;
}) {
  const [index, setIndex] = useState<TemplateInfo[]>([]);
  const [tpl, setTpl] = useState("general");
  const [brief, setBrief] = useState("");
  const [docId, setDocId] = useState("");
  const [count, setCount] = useState(8);
  const [progress, setProgress] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/slides/index.json").then((r) => r.json()).then((l: TemplateInfo[]) => live && setIndex(l)).catch(() => {});
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, []);
  const info = index.find((t) => t.id === tpl);

  const blank = async () => {
    if (!info) return;
    try {
      const t = await loadTemplate(tpl);
      onStart(t, info, [slideFrom(t.layouts[0], undefined, info.primary)]);
    } catch {
      onNote("error", "Şablon yüklenemedi.");
    }
  };
  const generate = async () => {
    if (!info) return;
    const ac = (abort.current = new AbortController());
    setProgress("Taslak hazırlanıyor…");
    try {
      const t = await loadTemplate(tpl);
      const { slides } = await step<{ slides: { layout: string; title: string; points: string[] }[] }>({ step: "outline", brief, docId: docId || undefined, count, layouts: t.layouts.map((l) => ({ id: l.id, desc: l.desc })) }, ac.signal);
      const out: El[][] = [];
      for (const [i, s] of slides.entries()) {
        setProgress(`Slayt ${i + 1} / ${slides.length}: ${s.title}`);
        const layout = t.layouts.find((l) => l.id === s.layout) ?? t.layouts[i % t.layouts.length];
        // One slide failing doesn't lose the others: it stays with its title in the layout's first text.
        let values: Record<string, string>;
        try {
          ({ values } = await step<{ values: Record<string, string> }>({ step: "fill", brief, docId: docId || undefined, slide: s, slots: layout.slots }, ac.signal));
        } catch (e) {
          if (ac.signal.aborted) throw e;
          values = { [layout.slots[0].key]: s.title.slice(0, layout.slots[0].max) };
        }
        out.push(slideFrom(layout, values, info.primary));
      }
      onStart(t, info, out);
      onNote("ok", `${out.length} slayt hazır. Metinler modelin önerisidir: göndermeden önce kontrol edin.`);
    } catch (e) {
      if (!ac.signal.aborted) onNote("error", (e as Error).message || "Sunum hazırlanamadı.");
    } finally {
      setProgress(null);
    }
  };

  const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent";
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted">{index.length} şablon, her biri onlarca hazır sayfa düzeni. Düzenlenebilir PowerPoint (PPTX) olarak indirilir.</p>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Sunum şablonu">
        {index.map((t) => (
          <button key={t.id} onClick={() => setTpl(t.id)} aria-pressed={t.id === tpl} title={t.desc} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${t.id === tpl ? "border-accent bg-accent-soft" : "border-line hover:border-accent"}`}>
            <span className="size-3.5 shrink-0 rounded-full border border-line" style={{ background: t.primary }} />
            <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
            <span className="text-[11px] text-muted">{t.layouts}</span>
          </button>
        ))}
      </div>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={2000} placeholder="Sunumun konusu, hedef kitlesi, öne çıkacak noktalar" aria-label="Sunumun konusu" className={`${field} resize-y`} lang="tr" />
      {docs.length > 0 && (
        <select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Belgeden sunum" className={field}>
          <option value="">Belge kullanma</option>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        Slayt sayısı
        <input type="number" min={2} max={20} value={count} onChange={(e) => setCount(Math.min(20, Math.max(2, +e.target.value || 2)))} className="h-8 w-16 rounded-md border border-line bg-panel px-2 text-sm text-fg" />
      </label>
      {progress ? (
        <div className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-xs" role="status">
          <Loader2 size={14} className="shrink-0 animate-spin" /> <span className="min-w-0 flex-1 truncate">{progress}</span>
          <button onClick={() => abort.current?.abort()} className="font-medium text-accent">İptal</button>
        </div>
      ) : (
        <button onClick={generate} disabled={!info || (!brief.trim() && !docId)} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
          <Sparkles size={15} /> Sunumu oluştur
        </button>
      )}
      <button onClick={blank} disabled={!info} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm hover:border-accent hover:text-accent disabled:opacity-40">
        <Presentation size={15} /> Boş sunumla başla
      </button>
      <p className="text-[11px] text-muted">Konu ve seçilen belge yalnızca kurum sunucusundaki modele gider. Şablonlar: presenton (Apache-2.0).</p>
    </div>
  );
}

export function SlideStrip({ slides, at, measure, onGo, onAdd, onDuplicate, onDelete, onMove, onClose }: {
  slides: El[][]; at: number; measure: Measure; onGo: (i: number) => void; onAdd: () => void; onDuplicate: () => void; onDelete: () => void; onMove: (d: -1 | 1) => void; onClose: () => void;
}) {
  const btn = "grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg disabled:opacity-30";
  return (
    <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2">
      <div className="flex shrink-0 flex-col">
        <button className={btn} onClick={onAdd} aria-label="Slayt ekle" title="Slayt ekle"><Plus size={15} /></button>
        <button className={btn} onClick={onDuplicate} aria-label="Slaytı çoğalt" title="Çoğalt"><Copy size={14} /></button>
      </div>
      <ol className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5" aria-label="Slaytlar">
        {slides.map((els, i) => (
          <li key={i} className="w-28 shrink-0">
            <button onClick={() => onGo(i)} aria-current={i === at ? "true" : undefined} aria-label={`Slayt ${i + 1}`} className={`block w-full overflow-hidden rounded border-2 ${i === at ? "border-accent" : "border-line hover:border-accent/50"}`}>
              <SlideThumb els={els} measure={measure} />
            </button>
            <span className="block text-center text-[11px] text-muted">{i + 1}</span>
          </li>
        ))}
      </ol>
      <div className="grid shrink-0 grid-cols-2">
        <button className={btn} disabled={at === 0} onClick={() => onMove(-1)} aria-label="Slaytı sola taşı" title="Öne al"><ArrowLeft size={14} /></button>
        <button className={btn} disabled={at === slides.length - 1} onClick={() => onMove(1)} aria-label="Slaytı sağa taşı" title="Sona al"><ArrowRight size={14} /></button>
        <button className={`${btn} hover:text-danger`} disabled={slides.length < 2} onClick={onDelete} aria-label="Slaytı sil" title="Sil"><Trash2 size={14} /></button>
        <button className={btn} onClick={onClose} aria-label="Sunumdan çık" title="Sunumdan çık"><X size={15} /></button>
      </div>
    </div>
  );
}

export function LayoutPicker({ template, accent, measure, onPick, onClose }: { template: DeckTemplate; accent: string; measure: Measure; onPick: (l: Layout) => void; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  // Built once per opening: ids are new each time.
  const [previews] = useState(() => template.layouts.map((l) => ({ l, els: slideFrom(l, undefined, accent) })));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onPointerDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="t-layouts" className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 id="t-layouts" className="flex-1 text-sm font-semibold">Sayfa düzeni: {template.name}</h2>
          <button ref={close} className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {previews.map(({ l, els }) => (
            <button key={l.id} onClick={() => onPick(l)} title={l.desc} aria-label={`Düzen: ${l.id.replace(/_/g, " ")}`} className="overflow-hidden rounded-lg border border-line hover:border-accent">
              <SlideThumb els={els} measure={measure} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
