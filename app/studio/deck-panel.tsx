"use client";

// Sunum mode's pieces: the panel that starts a deck, the slide strip, the layout gallery. The elements themselves are
// edited by the studio's canvas and inspector.
import { memo, useId, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Loader2, Plus, Presentation, Sparkles, Trash2, X } from "lucide-react";
import { SAMPLE_DECK, composeDeck } from "@/lib/deck-compose";
import { DESIGNS, designFromFamily, type DeckDesign } from "@/lib/deck-design";
import { applyMaster, type DeckMaster } from "@/lib/deck-master";
import type { DeckPlan, SectionContent } from "@/lib/deck-doc";
import { slideFrom, type DeckTemplate, type Layout, type TemplateInfo } from "@/lib/deck";
import { draw, type El, type Measure } from "@/lib/studio";
import { ensureFont } from "./fonts";
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

/** Every design: our own, then each library family as one. */
export async function loadDesign(id: string): Promise<DeckDesign> {
  const own = DESIGNS.find((d) => d.id === id);
  if (own) return own;
  const index = (await (await fetch("/slides/index.json")).json()) as TemplateInfo[];
  const info = index.find((t) => t.id === id);
  if (!info) return DESIGNS[0];
  return designFromFamily(info, await loadTemplate(id));
}

/** The designs to choose from; clicking one previews it, here and after a deck is made. */
export function DesignList({ current, onPick }: { current?: string; onPick: (d: DeckDesign) => void }) {
  const [library, setLibrary] = useState<TemplateInfo[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/slides/index.json").then((r) => r.json()).then((l: TemplateInfo[]) => live && setLibrary(l.filter((t) => !DESIGNS.some((d) => d.id === t.id)))).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const item = "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs";
  const on = (id: string) => (id === current ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent");
  return (
    <div className="space-y-2" role="group" aria-label="Sunum tasarımı">
      <div className="grid grid-cols-2 gap-1.5">
        {DESIGNS.map((d) => (
          <button key={d.id} onClick={() => onPick(d)} aria-pressed={d.id === current} title={d.mood} className={`${item} ${on(d.id)}`}>
            <span className="flex h-6 w-9 shrink-0 overflow-hidden rounded border border-line" style={{ background: d.bg }} aria-hidden>
              <span className="w-1/2" style={{ background: d.primary }} /><span className="m-auto size-2 rounded-full" style={{ background: d.accent }} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
          </button>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted">Kütüphane ({library.length})</summary>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {library.map((t) => (
            <button key={t.id} onClick={() => void loadDesign(t.id).then(onPick)} aria-pressed={t.id === current} title={t.desc} className={`${item} ${on(t.id)}`}>
              <span className="size-3.5 shrink-0 rounded-full border border-line" style={{ background: t.primary }} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

export interface DeckContent { plan: DeckPlan; sections: SectionContent[]; docName: string }

/** A design shown large: the real deck if there is one, the sample otherwise. Nothing changes until it is applied. */
export function DesignPreview({ design, content, slides, measure, master, username, onApply, onApplyDownload, onClose }: {
  design: DeckDesign; content?: DeckContent; slides?: El[][]; measure: Measure; master: DeckMaster; username: string;
  onApply?: () => void; onApplyDownload?: () => void; onClose: () => void;
}) {
  const [shown, setShown] = useState<{ id: string; slides: El[][] } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([design.headFont, design.bodyFont].map((id) => ensureFont(id, username))).then(() => {
      if (!live) return;
      const out = slides ?? composeDeck((content ?? SAMPLE_DECK).plan, (content ?? SAMPLE_DECK).sections, content?.docName ?? "Örnek içerik", measure, design).slides;
      setShown({ id: design.id, slides: applyMaster(out, master, design.bodyFont) });
    });
    return () => {
      live = false;
    };
  }, [design, content, slides, measure, master, username]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{design.name} <span className="font-normal text-muted">· {onApply ? "önizleme" : "örnek içerikle önizleme"}{shown ? ` · ${shown.slides.length} slayt` : ""}</span></h2>
        {onApply && <button onClick={onApply} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90">Bu tasarımı uygula</button>}
        {onApplyDownload && <button onClick={onApplyDownload} className="h-8 rounded-md border border-line px-3 text-sm hover:border-accent hover:text-accent">Uygula ve PowerPoint indir</button>}
        <button onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg" aria-label="Önizlemeyi kapat"><X size={15} /></button>
      </div>
      {onApply && <p className="bg-subtle px-3 py-1.5 text-xs text-muted">Uygulayınca slaytlar bu tasarımla yeniden kurulur; elle yaptığınız düzenlemeler taşınmaz. Sol panelden önceki hâline dönebilirsiniz.</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {shown?.id === design.id ? (
          <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]" aria-label="Slayt önizlemeleri">
            {shown.slides.map((els, i) => (
              <li key={i} className="overflow-hidden rounded border border-line shadow-sm"><SlideThumb els={els} measure={measure} /></li>
            ))}
          </ol>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted" role="status"><Loader2 size={14} className="animate-spin" /> Hazırlanıyor…</p>
        )}
      </div>
    </div>
  );
}


const MAX_SOURCES = 5;
/** Which of the user's documents to write from. */
export function SourcePicker({ docs, value, onChange }: { docs: { id: string; name: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="rounded-lg border border-line p-2">
      <legend className="px-1 text-xs text-muted">Kaynaklar (en fazla {MAX_SOURCES})</legend>
      <ul className="max-h-36 space-y-1 overflow-y-auto">
        {docs.map((d) => {
          const on = value.includes(d.id);
          return (
            <li key={d.id}>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={on} disabled={!on && value.length >= MAX_SOURCES} onChange={() => onChange(on ? value.filter((y) => y !== d.id) : [...value, d.id])} />
                <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function DeckPanel({ docs, measure, username, design, onDesign, onStart, onBlank, onNote }: {
  measure?: Measure;
  username?: string;
  docs: { id: string; name: string }[];
  design: DeckDesign;
  onDesign: (d: DeckDesign) => void;
  onStart: (design: DeckDesign, content: DeckContent, slides: El[][]) => void;
  onBlank: (design: DeckDesign) => void;
  onNote: (kind: "ok" | "error", text: string) => void;
}) {
  const [brief, setBrief] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [count, setCount] = useState(0); // 0: the content decides
  const [progress, setProgress] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const generate = async () => {
    if (!measure) return;
    const ac = (abort.current = new AbortController());
    setProgress("Bölümler belirleniyor…");
    try {
      await Promise.allSettled([design.headFont, design.bodyFont].map((id) => ensureFont(id, username ?? "")));
      const { plan } = await step<{ plan: DeckPlan }>({ step: "plan", brief, docIds, ...(count ? { count } : {}) }, ac.signal);
      const sections: SectionContent[] = [];
      for (const [i, s] of plan.sections.entries()) {
        setProgress(`Bölüm ${i + 1} / ${plan.sections.length}: ${s.title}`);
        const others = plan.sections.filter((o) => o !== s).map((o) => o.title);
        try {
          sections.push(await step<SectionContent>({ step: "section", brief, docIds, title: s.title, query: s.query, others }, ac.signal));
        } catch (e) {
          if (ac.signal.aborted) throw e;
          sections.push({ title: s.title, source: "", blocks: [], dropped: [] }); // said below; the others aren't lost with it
        }
      }
      const docName = docIds.map((id) => docs.find((d) => d.id === id)?.name.replace(/\.[^.]+$/, "") ?? "").filter(Boolean).join(", ").slice(0, 120);
      const { slides, missing, left } = composeDeck(plan, sections, docName, measure, design);
      const dropped = sections.reduce((n, s) => n + s.dropped.length, 0);
      if (missing.length === plan.sections.length) throw new Error(docIds.length ? "Seçilen kaynaklarda istenen konularda bilgi bulunamadı." : "Model içerik üretemedi. Tekrar deneyin.");
      onStart(design, { plan, sections, docName }, slides);
      const notes = [
        docIds.length ? `${slides.length} slayt hazır. İçerik kaynaklardan alındı; kullanmadan önce kontrol edin.` : `${slides.length} slayt hazır. İçerik modelin genel bilgisinden yazıldı, kaynağa dayanmıyor: kullanmadan önce kontrol edin.`,
        missing.length ? `İçerik bulunamayan bölümler: ${missing.join(", ")}.` : "",
        left.length ? `Slayt sınırına ulaşıldı, sunuma tam sığmayan bölümler: ${left.join(", ")}.` : "",
        dropped ? `Kaynakla uyuşmayan ${dropped} bilgi çıkarıldı.` : "",
        sections.some((s) => s.cut) ? `Şu bölümler model sınırına takıldı, eksik olabilir: ${sections.filter((s) => s.cut).map((s) => s.title).join(", ")}.` : "",
      ];
      onNote(missing.length || left.length || sections.some((s) => s.cut) ? "error" : "ok", notes.filter(Boolean).join(" "));
    } catch (e) {
      if (!ac.signal.aborted) onNote("error", (e as Error).message || "Sunum hazırlanamadı.");
    } finally {
      setProgress(null);
    }
  };

  const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent";
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted">Bir tasarıma tıklayın, önizlemesi sağda açılır. Sunum oluştuktan sonra da değiştirebilirsiniz.</p>
      <DesignList current={design.id} onPick={onDesign} />
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={2000} placeholder="Sunumun konusu, hedef kitlesi, öne çıkacak noktalar" aria-label="Sunumun konusu" className={`${field} resize-y`} />
      {docs.length > 0 && (
        <SourcePicker docs={docs} value={docIds} onChange={setDocIds} />
      )}
      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        Slayt sayısı
        <select value={count} onChange={(e) => setCount(+e.target.value)} className="h-8 rounded-md border border-line bg-panel px-2 text-sm text-fg">
          <option value={0}>Otomatik (içeriğe göre)</option>
          {[5, 8, 10, 15, 20, 30].map((n) => <option key={n} value={n}>Yaklaşık {n}</option>)}
        </select>
      </label>
      {progress ? (
        <div className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-xs" role="status">
          <Loader2 size={14} className="shrink-0 animate-spin" /> <span className="min-w-0 flex-1 truncate">{progress}</span>
          <button onClick={() => abort.current?.abort()} className="font-medium text-accent">İptal</button>
        </div>
      ) : (
        <button onClick={generate} disabled={!measure || (!brief.trim() && !docIds.length)} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
          <Sparkles size={15} /> Sunumu oluştur
        </button>
      )}
      <button onClick={() => onBlank(design)} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm hover:border-accent hover:text-accent">
        <Presentation size={15} /> Boş sunumla başla
      </button>
      <p className="text-[11px] text-muted">Konu ve seçilen kaynaklar yalnızca kurum sunucusundaki modele gider. Kütüphane düzenleri: presenton (Apache-2.0).</p>
    </div>
  );
}

export function SlideStrip({ slides, at, measure, onGo, onAdd, onDuplicate, onDelete, onMove, onReorder, onClose }: {
  slides: El[][]; at: number; measure: Measure; onGo: (i: number) => void; onAdd: () => void; onDuplicate: () => void; onDelete: () => void; onMove: (d: -1 | 1) => void;
  /** The slide at `from` dropped into the gap before slide `gap` (the slide count: after the last). */
  onReorder: (from: number, gap: number) => void; onClose: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  // Pointer events, not the browser's drag: the same code for mouse and finger, in every browser.
  const press = useRef<{ id: number; from: number; x0: number; y0: number; x: number; touch: boolean; timer?: ReturnType<typeof setTimeout>; scroll?: ReturnType<typeof setInterval> } | null>(null);
  const dragging = useRef(false);
  const justDropped = useRef(false);
  const [drag, setDrag] = useState<{ from: number; gap: number; x: number; y: number } | null>(null);
  const endDrag = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    if (p?.scroll) clearInterval(p.scroll);
    press.current = null;
    dragging.current = false;
    setDrag(null);
  };
  const beginDrag = (y: number) => {
    const p = press.current;
    if (!p) return;
    dragging.current = true;
    list.current?.setPointerCapture(p.id);
    setDrag({ from: p.from, gap: gapAt(p.x), x: p.x, y });
    // Held near an end of the bar: the bar moves, so a far slide can be reached.
    p.scroll = setInterval(() => {
      const ol = list.current, q = press.current;
      if (!ol || !q) return;
      const r = ol.getBoundingClientRect();
      const by = q.x < r.left + 40 ? -14 : q.x > r.right - 40 ? 14 : 0;
      if (!by) return;
      ol.scrollLeft += by;
      setDrag((d) => d && { ...d, gap: gapAt(q.x) });
    }, 30);
  };
  useEffect(() => {
    // Once a finger holds a slide, moving it drags instead of scrolling: only a listener of our own can say so.
    const ol = list.current;
    const hold = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    const cancel = (e: KeyboardEvent) => {
      if (!dragging.current) return;
      // While a slide is in hand, no shortcut (undo, delete) changes the list under it. Esc puts it down.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") endDrag();
    };
    // Let go outside the bar before it became a drag: the press is over all the same.
    const released = () => {
      if (press.current && !dragging.current) endDrag();
    };
    window.addEventListener("pointerup", released);
    window.addEventListener("pointercancel", released);
    ol?.addEventListener("touchmove", hold, { passive: false });
    window.addEventListener("keydown", cancel, true);
    return () => {
      ol?.removeEventListener("touchmove", hold);
      window.removeEventListener("pointerup", released);
      window.removeEventListener("pointercancel", released);
      window.removeEventListener("keydown", cancel, true);
      endDrag();
    };
  }, []);
  // The list changed under a slide in hand (another finger or mouse on the buttons): its place no longer means anything.
  useEffect(() => {
    if (dragging.current) endDrag();
  }, [slides.length, at]);
  // The current slide stays in view, and keyboard focus goes along with it.
  useEffect(() => {
    const ol = list.current;
    const b = ol?.children[at]?.querySelector("button");
    if (!ol || !b) return;
    b.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (ol.contains(document.activeElement)) b.focus({ preventScroll: true });
  }, [at]);
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    const to = e.key === "Home" ? 0 : e.key === "End" ? slides.length - 1 : step !== undefined ? at + step : null;
    if (to === null) return;
    // Not for the bar to scroll, nor for the element chosen on the canvas to be nudged.
    e.preventDefault();
    e.stopPropagation();
    if (to < 0 || to >= slides.length) return;
    if ((e.ctrlKey || e.metaKey) && step !== undefined) onMove(step as -1 | 1);
    else onGo(to);
  };
  const gapAt = (x: number) => {
    const items = [...(list.current?.children ?? [])];
    const i = items.findIndex((li) => {
      const r = li.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return i < 0 ? items.length : i;
  };
  const btn = "grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg disabled:opacity-30";
  return (
    <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2">
      <div className="flex shrink-0 flex-col">
        <button className={btn} onClick={onAdd} aria-label="Slayt ekle" title="Slayt ekle"><Plus size={15} /></button>
        <button className={btn} onClick={onDuplicate} aria-label="Slaytı çoğalt" title="Çoğalt"><Copy size={14} /></button>
      </div>
      <ol
        ref={list}
        className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-0.5"
        aria-label="Slaytlar. Yön tuşlarıyla geçin, Ctrl ile birlikte slaytı taşıyın."
        onKeyDown={onKey}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || e.pointerId !== p.id) return;
          p.x = e.clientX;
          if (dragging.current) return setDrag((d) => d && { ...d, gap: gapAt(e.clientX), x: e.clientX, y: e.clientY });
          const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
          if (p.touch) {
            if (moved > 8) endDrag(); // a finger moving at once is scrolling the bar
          } else if (moved > 5) beginDrag(e.clientY);
        }}
        onPointerUp={(e) => {
          const p = press.current;
          if (!p || e.pointerId !== p.id) return;
          if (dragging.current) {
            justDropped.current = true;
            setTimeout(() => (justDropped.current = false), 0); // the click that ends this press isn't a choice of slide
            onReorder(p.from, gapAt(e.clientX));
          }
          endDrag();
        }}
        onPointerCancel={endDrag}
      >
        {slides.map((els, i) => (
          <li
            key={i}
            onPointerDown={(e) => {
              if (e.button !== 0 || press.current) return; // a second finger doesn't start a second drag
              const touch = e.pointerType !== "mouse";
              press.current = { id: e.pointerId, from: i, x0: e.clientX, y0: e.clientY, x: e.clientX, touch };
              // A finger holds a moment first: a quick swipe still scrolls the bar.
              if (touch) press.current.timer = setTimeout(() => beginDrag(e.clientY), 350);
            }}
            onContextMenu={(e) => {
              if (dragging.current || press.current?.touch) e.preventDefault(); // holding a finger opens no menu
            }}
            title="Sürükleyerek taşıyın"
            className={`relative w-28 shrink-0 cursor-grab select-none active:cursor-grabbing [-webkit-touch-callout:none] ${drag?.from === i ? "opacity-40" : ""}`}
          >
            {/* Where it will land; no mark where it would stay put. */}
            {drag && drag.gap === i && i !== drag.from && i !== drag.from + 1 && <span className="absolute -left-[5px] inset-y-0 w-0.5 rounded bg-accent" aria-hidden />}
            {drag && drag.gap === slides.length && i === slides.length - 1 && i !== drag.from && <span className="absolute -right-[5px] inset-y-0 w-0.5 rounded bg-accent" aria-hidden />}
            <button onClick={() => !justDropped.current && onGo(i)} aria-current={i === at ? "true" : undefined} aria-label={`Slayt ${i + 1}`} className={`block w-full cursor-[inherit] overflow-hidden rounded border-2 ${i === at ? "border-accent" : "border-line hover:border-accent/50"}`}>
              <SlideThumb els={els} measure={measure} />
            </button>
            <span className="block text-center text-[11px] text-muted">{i + 1}</span>
          </li>
        ))}
      </ol>
      {drag && slides[drag.from] && (
        <div className="pointer-events-none fixed z-50 w-28 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded border-2 border-accent opacity-90 shadow-xl" style={{ left: drag.x, top: drag.y }} aria-hidden>
          <SlideThumb els={slides[drag.from]} measure={measure} />
        </div>
      )}
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
