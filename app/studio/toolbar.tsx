"use client";

// The bar above the canvas: follows the selection. The everyday controls live here; "Tüm ayarlar" opens the full panel.
import type { ReactNode } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, Copy, ImagePlus, Italic, Lock, LockOpen, Minus, Plus, SlidersHorizontal, Trash2, Underline,
} from "lucide-react";
import type { AlignTo, El } from "@/lib/studio";
import FontPicker from "./font-picker";

const btn = "grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";
const on = "bg-accent-soft text-accent";
const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />;

function ColorBtn({ label, value, set }: { label: string; value: string; set: (c: string) => void }) {
  return (
    <label className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-subtle" title={label}>
      <span className="size-5 rounded-full border border-line" style={{ background: value }} aria-hidden />
      <input type="color" aria-label={label} value={value} onChange={(e) => set(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}

function Icon({ label, active, onClick, disabled, children }: { label: string; active?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button className={`${btn} ${active ? on : ""}`} aria-label={label} title={label} {...(active === undefined ? {} : { "aria-pressed": active })} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function Toolbar({ el, count, username, aligns, onPatch, onFont, onDuplicate, onRemove, onOrder, onAlign, onReplace, onMore }: {
  el: El | null;
  count: number;
  username: string;
  aligns: [AlignTo, string, ReactNode][];
  onPatch: (p: Partial<El>) => void;
  onFont: (f: string | undefined) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onOrder: (to: "front" | "back") => void;
  onAlign: (how: AlignTo) => void;
  onReplace: (f: File | undefined) => void;
  onMore: () => void;
}) {
  const shell = "flex min-h-12 flex-wrap items-center gap-0.5 border-b border-line bg-panel px-3 py-1.5";
  const more = (
    <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg" onClick={onMore}>
      <SlidersHorizontal size={15} /> <span className="hidden sm:inline">Tüm ayarlar</span>
    </button>
  );
  const common = (locked?: boolean) => (
    <>
      <Sep />
      <Icon label="En öne getir" onClick={() => onOrder("front")} disabled={locked}><ArrowUpToLine size={15} /></Icon>
      <Icon label="En arkaya gönder" onClick={() => onOrder("back")} disabled={locked}><ArrowDownToLine size={15} /></Icon>
      <Icon label="Çoğalt (Ctrl+D)" onClick={onDuplicate} disabled={locked}><Copy size={15} /></Icon>
      <Icon label="Sil (Delete)" onClick={onRemove} disabled={locked}><Trash2 size={15} /></Icon>
    </>
  );

  if (count > 1) {
    return (
      <div className={shell} role="toolbar" aria-label="Seçili öğeler">
        <span className="mr-2 text-sm font-medium">{count} öğe seçili</span>
        {aligns.map(([how, label, icon]) => <Icon key={how} label={label} onClick={() => onAlign(how)}>{icon}</Icon>)}
        {common()}
        <Sep />
        {more}
      </div>
    );
  }
  if (!el) {
    return <div className={`${shell} text-xs text-muted`}>Bir öğeye tıklayın · Çift tık: metni düzenle · Shift: oranı koru · Alt: hizalamasız taşı</div>;
  }

  const L = el.locked;
  return (
    <div className={shell} role="toolbar" aria-label={`${el.name} ayarları`}>
      {el.kind === "text" && (
        <>
          <div className="w-44 shrink-0">
            <FontPicker key={el.id} compact value={el.font} username={username} onPick={onFont} />
          </div>
          <Sep />
          <Icon label="Yazıyı küçült" disabled={L} onClick={() => onPatch({ size: Math.max(6, Math.round(el.size) - 2), auto: false })}><Minus size={14} /></Icon>
          <input
            type="number" min={6} max={600} aria-label="Yazı boyutu" disabled={L}
            value={Math.round(el.size)}
            onChange={(e) => +e.target.value >= 6 && +e.target.value <= 600 && onPatch({ size: +e.target.value, auto: false })}
            className="h-8 w-12 rounded-md border border-line bg-panel text-center text-sm tabular-nums outline-none [appearance:textfield] focus:border-accent [&::-webkit-inner-spin-button]:appearance-none"
          />
          <Icon label="Yazıyı büyüt" disabled={L} onClick={() => onPatch({ size: Math.min(600, Math.round(el.size) + 2), auto: false })}><Plus size={14} /></Icon>
          <Sep />
          <ColorBtn label="Yazı rengi" value={el.color} set={(color) => onPatch({ color })} />
          <Icon label="Kalın" active={el.weight >= 600} disabled={L} onClick={() => onPatch({ weight: el.weight >= 600 ? 400 : 700 })}><Bold size={15} /></Icon>
          <Icon label="Eğik" active={!!el.italic} disabled={L} onClick={() => onPatch({ italic: !el.italic || undefined })}><Italic size={15} /></Icon>
          <Icon label="Altı çizili" active={!!el.underline} disabled={L} onClick={() => onPatch({ underline: !el.underline || undefined })}><Underline size={15} /></Icon>
          <Sep />
          {([["start", AlignLeft, "Sola hizala"], ["middle", AlignCenter, "Ortaya hizala"], ["end", AlignRight, "Sağa hizala"]] as const).map(([a, I, label]) => (
            <Icon key={a} label={label} active={el.align === a} disabled={L} onClick={() => onPatch({ align: a })}><I size={15} /></Icon>
          ))}
        </>
      )}
      {el.kind === "shape" && (
        <>
          {el.shape !== "line" && !el.noFill && el.fill.kind === "solid" && <ColorBtn label="Dolgu rengi" value={el.fill.color} set={(color) => onPatch({ fill: { kind: "solid", color } })} />}
          {el.stroke && <ColorBtn label={el.shape === "line" ? "Çizgi rengi" : "Kenarlık rengi"} value={el.stroke.color} set={(color) => onPatch({ stroke: { ...el.stroke!, color } })} />}
        </>
      )}
      {el.kind === "image" && (
        <>
          <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg focus-within:ring-2 focus-within:ring-accent/40">
            <ImagePlus size={15} /> {el.logo ? "Logoyu değiştir" : "Görseli değiştir"}
            <input type="file" disabled={L} accept={el.logo ? ".png,.jpg,.jpeg,.webp,.svg" : ".png,.jpg,.jpeg,.webp"} className="sr-only" onChange={(e) => { onReplace(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {!el.logo && (
            <button disabled={L} className="h-8 shrink-0 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg disabled:opacity-30" onClick={() => onPatch({ fit: el.fit === "cover" ? "contain" : "cover" })}>
              {el.fit === "cover" ? "Tamamını göster" : "Kutuyu doldur"}
            </button>
          )}
        </>
      )}
      {common(L)}
      <Icon label={L ? "Kilidi aç" : "Kilitle"} active={!!L} onClick={() => onPatch({ locked: !L })}>{L ? <Lock size={15} /> : <LockOpen size={15} />}</Icon>
      <Sep />
      {more}
    </div>
  );
}
