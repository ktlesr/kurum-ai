"use client";

// Gallery of the ready-made art shapes (public/shapes, Coolshapes). A chosen one becomes an ordinary picture element.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ART_SHAPES, tintSvg } from "@/lib/studio-assets";

const GROUPS: Record<string, string> = { star: "Yıldız", flower: "Çiçek", wheel: "Çark", polygon: "Çokgen", ellipse: "Elips", moon: "Ay", rectangle: "Dörtgen", triangle: "Üçgen", misc: "Karışık", number: "Rakam" };

export default function ArtPicker({ colors, onPick, onClose }: { colors: { primary: string; accent: string }; onPick: (name: string, tinted: boolean) => void; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const [tinted, setTinted] = useState(false);
  const [tints, setTints] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!tinted) return;
    let live = true;
    // The previews in brand colours; the files are small and already cached by the plain previews.
    void Promise.all(ART_SHAPES.map(async (n) => {
      const r = await fetch(`/shapes/${n}.svg`);
      return [n, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tintSvg(await r.text(), colors.primary, colors.accent))}`] as const;
    })).then((all) => {
      if (live) setTints(Object.fromEntries(all));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [tinted, colors.primary, colors.accent]);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => {
      if (back?.isConnected) back.focus();
    };
  }, []);
  const groups = [...new Set(ART_SHAPES.map((n) => n.split("-")[0]))];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="t-art"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 id="t-art" className="flex-1 text-sm font-semibold">Hazır şekiller</h2>
          <div role="group" aria-label="Şekil renkleri" className="flex gap-1 rounded-lg bg-subtle p-1">
            {([[false, "Özgün renkler"], [true, "Marka renkleri"]] as const).map(([v, label]) => (
              <button key={label} onClick={() => setTinted(v)} aria-pressed={tinted === v} className={`h-7 rounded-md px-2 text-xs font-medium ${tinted === v ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg"}`}>{label}</button>
            ))}
          </div>
          <button ref={close} className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{GROUPS[g] ?? g}</h3>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {ART_SHAPES.filter((n) => n.startsWith(`${g}-`)).map((n) => (
                  <button key={n} onClick={() => onPick(n, tinted)} className="aspect-square rounded-lg border border-line p-1.5 hover:border-accent" aria-label={`${GROUPS[g] ?? g} ${n.split("-")[1]}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- static vector file */}
                    <img src={(tinted && tints[n]) || `/shapes/${n}.svg`} alt="" loading="lazy" className="size-full" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Coolshapes (MIT). Görsel olarak eklenir: boyutlandırılır, döndürülür. Renkler eklerken seçilir.</p>
      </div>
    </div>
  );
}
