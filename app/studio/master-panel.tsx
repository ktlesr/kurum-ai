"use client";

// "Asıl slayt": what all inner slides carry, set in one place. Each logo has a coloured and a white version, and each slide
// takes the one that reads on its own background unless told otherwise.
import { Check, ImagePlus, Wand2 } from "lucide-react";
import { MASTER_SIZES, type DeckMaster, type MasterPick } from "@/lib/deck-master";
import type { SavedLogo } from "./logos";

const PICKS: [MasterPick, string][] = [["auto", "Otomatik"], ["color", "Renkli"], ["white", "Beyaz"], ["none", "Logosuz"]];
const CORNERS: [DeckMaster["corner"], string][] = [["tr", "Sağ üst"], ["br", "Sağ alt"], ["tl", "Sol üst"], ["bl", "Sol alt"]];

export function MasterPanel({ master, logos, pick, at, total, onChange, onPick, onWhiteFile, onWhiteAuto }: {
  master: DeckMaster; logos: SavedLogo[]; pick: MasterPick; at: number; total: number;
  onChange: (m: DeckMaster) => void; onPick: (p: MasterPick) => void;
  onWhiteFile: (l: SavedLogo, f: File | undefined) => void; onWhiteAuto: (l: SavedLogo) => void;
}) {
  const chosen = (l: SavedLogo) => master.logos.some((x) => x.color.src === l.pic.src);
  const toggle = (l: SavedLogo) =>
    onChange({ ...master, logos: chosen(l) ? master.logos.filter((x) => x.color.src !== l.pic.src) : [...master.logos, { color: l.pic, ...(l.white ? { white: l.white } : {}) }] });
  const heading = "text-[11px] font-semibold uppercase tracking-wider text-muted";
  const field = "h-8 w-full rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent";
  const covered = !master.onCovers && total > 1 && (at === 0 || at === total - 1);
  return (
    <section className="space-y-3 p-3">
      <p className="text-xs text-muted">Burada seçilenler tüm iç slaytlara uygulanır ve PowerPoint dosyasında gerçek Asıl Slayt olarak yer alır.</p>
      <h3 className={heading}>Logolar</h3>
      {!logos.length && <p className="text-xs text-muted">Önce Marka panelinden logo ekleyin.</p>}
      <ul className="space-y-1.5">
        {logos.map((l) => (
          <li key={l.id} className={`rounded-lg border p-1.5 ${chosen(l) ? "border-accent" : "border-line"}`}>
            <button onClick={() => toggle(l)} aria-pressed={chosen(l)} disabled={!chosen(l) && master.logos.length >= 6} title={!chosen(l) && master.logos.length >= 6 ? "En fazla 6 logo" : undefined} className="flex w-full items-center gap-2 text-left disabled:opacity-50">
              <span className={`grid size-4 shrink-0 place-items-center rounded border ${chosen(l) ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>{chosen(l) && <Check size={12} />}</span>
              <span className="grid h-10 w-16 shrink-0 place-items-center rounded bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- the user's own logo, a local data: URL */}
                <img src={l.pic.src} alt="" className="max-h-full max-w-full object-contain" />
              </span>
              <span className="grid h-10 w-16 shrink-0 place-items-center rounded bg-[#14263d] p-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- the user's own logo, a local data: URL */}
                {l.white ? <img src={l.white.src} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-white/70">Beyaz yok</span>}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">{l.name}</span>
            </button>
            <span className="mt-1 flex gap-1">
              <label className="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded border border-line text-[11px] hover:border-accent hover:text-accent focus-within:ring-2 focus-within:ring-accent/40">
                <ImagePlus size={12} /> Beyaz sürüm yükle
                <input type="file" accept=".png,.webp,.svg" className="sr-only" onChange={(e) => { onWhiteFile(l, e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <button onClick={() => onWhiteAuto(l)} title="Saydam zeminli logodan beyaz sürüm üretir" className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-line text-[11px] hover:border-accent hover:text-accent"><Wand2 size={12} /> Otomatik üret</button>
            </span>
          </li>
        ))}
      </ul>
      <label className="block text-xs text-muted">Konum
        <select value={master.corner} onChange={(e) => onChange({ ...master, corner: e.target.value as DeckMaster["corner"] })} className={`${field} mt-0.5 text-fg`}>
          {CORNERS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
        </select>
      </label>
      <label className="block text-xs text-muted">Logo yüksekliği: {master.size} px
        <input type="range" min={MASTER_SIZES.min} max={MASTER_SIZES.max} value={master.size} onChange={(e) => onChange({ ...master, size: +e.target.value })} className="mt-0.5 w-full accent-[var(--accent)]" />
      </label>
      <h3 className={heading}>Altbilgi</h3>
      <input value={master.date} onChange={(e) => onChange({ ...master, date: e.target.value })} maxLength={60} placeholder="Tarih (ör. Kasım 2026)" aria-label="Tarih" className={field} />
      <input value={master.footer} onChange={(e) => onChange({ ...master, footer: e.target.value })} maxLength={100} placeholder="Altbilgi metni (ör. kurum adı)" aria-label="Altbilgi metni" className={field} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={master.number} onChange={(e) => onChange({ ...master, number: e.target.checked })} /> Sayfa numarası</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={master.onCovers} onChange={(e) => onChange({ ...master, onCovers: e.target.checked })} /> Kapak ve son slaytta da göster</label>
      <h3 className={heading}>Bu slayttaki logo ({at + 1}. slayt)</h3>
      {covered ? <p className="text-xs text-muted">Kapak ve son slayt asıl slayttan muaf.</p> : (
        <div role="group" aria-label="Bu slayttaki logo" className="grid grid-cols-4 gap-1 rounded-lg bg-subtle p-1">
          {PICKS.map(([p, label]) => <button key={p} onClick={() => onPick(p)} aria-pressed={pick === p} className={`h-7 rounded-md text-[11px] font-medium ${pick === p ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg"}`}>{label}</button>)}
        </div>
      )}
      <p className="text-[11px] text-muted">Otomatik: koyu zeminde beyaz, açık zeminde renkli sürüm kullanılır. Beyaz sürümü olmayan logo renkli kalır.</p>
    </section>
  );
}
