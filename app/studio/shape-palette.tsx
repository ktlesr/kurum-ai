"use client";

// The shape library: the Öğeler panel and, compact, "Şekli değiştir" in the right-click menu.
import { useState } from "react";
import { SHAPES, shapeStyleOf, type ShapeEl, type ShapeId, type ShapeStyle } from "@/lib/studio";

/** Which library shape an element is (by kind and points), "custom" for imported ones. */
export function shapeIdOf(e: ShapeEl): ShapeId | "custom" {
  const kind = e.shape ?? "rect";
  const ids = (Object.keys(SHAPES) as ShapeId[]).filter((id) => SHAPES[id].shape === kind);
  if (kind === "poly") return ids.find((id) => JSON.stringify((SHAPES[id] as { points?: unknown }).points) === JSON.stringify(e.points)) ?? "custom";
  if (kind === "line") return e.arrow ? "arrowLine" : "line";
  if (kind === "rect") return !e.radius ? "rect" : e.radius >= Math.min(e.w, e.h) / 2 - 0.5 ? "pill" : "rounded";
  return ids[0] ?? "custom";
}
export function ShapeStyleTabs({ style, onStyle }: { style: ShapeStyle; onStyle: (s: ShapeStyle) => void }) {
  return (
    <div role="group" aria-label="Şekil biçimi" className="grid grid-cols-4 gap-1 rounded-lg bg-subtle p-1">
      {([["fill", "Dolu"], ["outline", "Kontur"], ["dash", "Kesikli"], ["holder", "Resim"]] as const).map(([s, label]) => (
        <button key={s} onClick={() => onStyle(s)} aria-pressed={style === s} className={`h-7 rounded-md text-xs font-medium ${style === s ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg"}`}>{label}</button>
      ))}
    </div>
  );
}
/** The shape library, in the Öğeler panel and (compact) in the right-click menu. */
export function ShapeGrid({ style, onPick, verb, compact, current }: { style: ShapeStyle; onPick: (id: ShapeId) => void; verb: string; compact?: boolean; current?: string }) {
  return (
    <div className={compact ? "grid grid-cols-6 gap-1" : "grid grid-cols-4 gap-1.5"}>
      {(Object.keys(SHAPES) as ShapeId[]).filter((id) => style !== "holder" || SHAPES[id].shape !== "line").map((id) => (
        <button key={id} onClick={() => onPick(id)} aria-label={`${SHAPES[id].label} ${verb}`} title={SHAPES[id].label} aria-current={id === current || undefined} className={`grid aspect-square place-items-center border outline-none hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent ${compact ? "rounded-md [&_svg]:size-5" : "rounded-lg [&_svg]:size-7"} ${id === current ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>
          <ShapeIcon id={id} style={style} />
        </button>
      ))}
    </div>
  );
}
/** "Şekli değiştir" in the right-click menu: starts at the look the shape has now. */
export function ShapeChooser({ el, onPick }: { el: ShapeEl; onPick: (id: ShapeId, style: ShapeStyle) => void }) {
  const [style, setStyle] = useState(() => shapeStyleOf(el));
  return (
    <div className="space-y-2 px-2 pb-1 pt-0.5">
      <ShapeStyleTabs style={style} onStyle={setStyle} />
      <ShapeGrid compact style={style} current={shapeIdOf(el)} verb="olarak değiştir" onPick={(id) => onPick(id, style)} />
    </div>
  );
}

/** A small preview of a library shape for the menu. */
function ShapeIcon({ id, style }: { id: ShapeId; style: ShapeStyle }) {
  const ink = style === "fill" ? { fill: "currentColor" } : style === "holder" ? { fill: "currentColor", fillOpacity: 0.3, stroke: "currentColor", strokeWidth: 0.8, strokeLinejoin: "round" as const } : { fill: "none", stroke: "currentColor", strokeWidth: 1.1, strokeLinejoin: "round" as const, ...(style === "dash" ? { strokeDasharray: "2 1.3" } : {}) };
  const d = SHAPES[id] as { shape: string; ratio: number; round?: number; points?: readonly (readonly [number, number])[] };
  const [w, h] = d.shape === "line" ? [14, 2] : d.ratio >= 1 ? [14, 14 / d.ratio] : [14 * d.ratio, 14];
  const [x, y] = [(16 - w) / 2, (16 - h) / 2];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-current">
      {d.shape === "ellipse" ? <ellipse cx="8" cy="8" rx={w / 2} ry={h / 2} {...ink} />
        : d.shape === "line" ? <line x1="1" x2="15" y1="8" y2="8" stroke="currentColor" strokeWidth="1.6" strokeDasharray={style === "dash" ? "2.6 1.6" : undefined} />
        : d.points ? <polygon points={d.points.map(([px, py]) => `${x + px * w},${y + py * h}`).join(" ")} {...ink} />
        : <rect x={x} y={y} width={w} height={h} rx={d.round ? Math.min(w, h) * d.round : 0} {...ink} />}
      {id === "arrowLine" && <polygon points="15,8 11,5.5 11,10.5" fill="currentColor" />}
    </svg>
  );
}
