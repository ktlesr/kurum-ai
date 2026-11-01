"use client";

// "Logoyu değiştir": the logo library in a dialog. Choosing one, or adding a new one from the computer, puts it in the chosen
// logo's place; the design has it from then on, so deleting it here leaves the design as it is.
import { Plus, Trash2, X } from "lucide-react";
import type { SavedLogo } from "./logos";

export function LogoPicker({ logos, current, error, onPick, onAdd, onDrop, onClose }: {
  logos: SavedLogo[]; current?: string; error?: string;
  onPick: (l: SavedLogo) => void; onAdd: (files: FileList | null) => void; onDrop: (l: SavedLogo) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="t-logos"
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 id="t-logos" className="flex-1 text-sm font-semibold">Logoyu değiştir</h2>
          <button className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg" onClick={onClose} aria-label="Kapat" autoFocus><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {logos.length === 0 && <p className="text-sm text-muted">Kütüphanede henüz logo yok. Bilgisayarınızdan bir logo ekleyin.</p>}
          {logos.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {logos.map((l) => {
                const active = l.pic.src === current;
                return (
                  <li key={l.id} className={`overflow-hidden rounded-lg border ${active ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent"}`}>
                    <button onClick={() => onPick(l)} aria-current={active || undefined} aria-label={`${l.name}: bu logoyu kullan`} title={l.name} className="block h-20 w-full bg-white p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- the user's own logo, a local data: URL */}
                      <img src={l.pic.src} alt="" className="size-full object-contain" />
                    </button>
                    <span className="flex items-center gap-1 border-t border-line px-1 py-0.5">
                      <span className="min-w-0 flex-1 truncate px-1 text-[11px] text-muted">{active ? "Kullanımda" : l.name}</span>
                      <button className="grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-danger" onClick={() => onDrop(l)} aria-label={`${l.name}: kütüphaneden sil`} title="Kütüphaneden sil"><Trash2 size={14} /></button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm font-medium hover:border-accent hover:text-accent focus-within:ring-2 focus-within:ring-accent/40">
            <Plus size={15} /> Logo ekle
            <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.svg" className="sr-only" onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
          </label>
          <p className="text-xs text-muted">Bir logoya tıklayın, seçili logonun yerine geçer. Yeni eklenen logo kütüphaneye de kaydedilir ve yalnızca bu tarayıcıda saklanır.</p>
        </div>
      </div>
    </div>
  );
}
