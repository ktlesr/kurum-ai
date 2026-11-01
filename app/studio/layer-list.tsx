"use client";

// The Katmanlar panel: top layer first, as it is seen. Drag a row (with those chosen along with it) to give it a new level;
// on the keyboard the arrows walk the rows and Ctrl with them moves the row.
import { GripVertical, Image as ImageIcon, Lock, LockOpen, Square, Type } from "lucide-react";
import { useRef } from "react";
import { layerFloor, moveLayers, type El } from "@/lib/studio";
import { useDragOrder } from "./use-drag-order";

const label = (e: El) => (e.kind === "text" && e.text.trim() ? `${e.name}: ${e.text.trim().slice(0, 24)}` : e.name);

export function LayerList({ els, picked, onSelect, onToggle, onLock, onOrder }: {
  els: El[]; picked: string[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onLock: (id: string, locked: boolean) => void;
  /** The whole list in its new order. */
  onOrder: (next: El[]) => void;
}) {
  const rows = [...els].reverse().filter((e) => !e.master);
  const ids = rows.map((e) => e.id).join();
  /** What moves with this row: everything chosen if it is one of them. */
  const moving = (id: string) => (picked.includes(id) ? picked : [id]);
  const { list, drag, listProps, itemProps, justDropped } = useDragOrder<HTMLUListElement>({
    axis: "y",
    changes: ids,
    limit: layerFloor(els),
    onDrop: (from, gap) => {
      const row = rows[from];
      if (!row) return;
      const next = moveLayers(els, moving(row.id), gap);
      if (next !== els) onOrder(next);
      if (!picked.includes(row.id)) onSelect(row.id); // what was just moved is what is being worked on
    },
  });
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const held = drag ? rows[drag.from] : undefined;
  const heldIds = held ? moving(held.id) : [];
  const heldFree = rows.filter((e) => heldIds.includes(e.id) && !e.locked);
  const iconBtn = "grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg";
  const iconOf = (e: El) => (e.kind === "text" ? <Type size={14} className="shrink-0 text-muted" /> : e.kind === "image" ? <ImageIcon size={14} className="shrink-0 text-muted" /> : <Square size={14} className="shrink-0 text-muted" />);

  return (
    <>
      <p className="mb-2 text-xs text-muted">Üstteki katman önde görünür. Sırasını değiştirmek için sürükleyin; seçili katmanlar birlikte taşınır.</p>
      <ul ref={list} aria-label="Katmanlar. Yön tuşlarıyla gezin, Ctrl ile birlikte katmanı taşıyın." className="space-y-0.5" {...listProps}>
        {rows.map((e, i) => {
          const canMove = !e.locked;
          const inHand = heldFree.some((h) => h.id === e.id);
          return (
            <li
              key={e.id}
              {...(canMove ? itemProps(i) : {})}
              className={`relative flex select-none items-center gap-1 rounded-md pr-1 text-sm [-webkit-touch-callout:none] ${canMove ? "cursor-grab active:cursor-grabbing" : ""} ${inHand ? "opacity-40" : ""} ${picked.includes(e.id) ? "bg-accent-soft text-fg" : "hover:bg-subtle"}`}
            >
              {/* Where it will land. */}
              {drag && drag.gap === i && <span className="absolute inset-x-0 -top-px h-0.5 rounded bg-accent" aria-hidden />}
              {drag && drag.gap === rows.length && i === rows.length - 1 && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-accent" aria-hidden />}
              <span className={`pl-0.5 ${canMove ? "text-muted" : "invisible"}`} aria-hidden><GripVertical size={13} /></span>
              <button
                ref={(b) => {
                  if (b) buttons.current.set(e.id, b);
                  else buttons.current.delete(e.id);
                }}
                className="flex min-w-0 flex-1 cursor-[inherit] items-center gap-2 py-1.5 pr-2 text-left"
                aria-pressed={picked.includes(e.id)}
                onClick={(ev) => {
                  if (justDropped()) return;
                  if (ev.shiftKey || ev.ctrlKey || ev.metaKey) onToggle(e.id);
                  else onSelect(e.id);
                }}
                onKeyDown={(ev) => {
                  if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
                  ev.preventDefault();
                  ev.stopPropagation(); // not a nudge of the element on the canvas
                  const up = ev.key === "ArrowUp";
                  if (ev.ctrlKey || ev.metaKey) {
                    // One row in this list, whatever the slide master keeps between them.
                    const next = moveLayers(els, [e.id], i + (up ? -1 : 2));
                    if (next !== els) onOrder(next);
                    return;
                  }
                  const to = rows[i + (up ? -1 : 1)];
                  if (!to) return;
                  onSelect(to.id);
                  buttons.current.get(to.id)?.focus();
                }}
              >
                {iconOf(e)}
                <span className="truncate">{label(e)}</span>
              </button>
              <button data-no-drag className={iconBtn} onClick={() => onLock(e.id, !e.locked)} aria-label={e.locked ? `${e.name} kilidini aç` : `${e.name} kilitle`} title={e.locked ? "Kilidi aç" : "Kilitle"}>
                {e.locked ? <Lock size={13} /> : <LockOpen size={13} />}
              </button>
            </li>
          );
        })}
      </ul>
      {drag && heldFree[0] && (
        <div className="pointer-events-none fixed z-50 flex max-w-56 -translate-y-1/2 items-center gap-2 rounded-md border border-accent bg-panel px-2 py-1.5 text-sm shadow-xl" style={{ left: drag.x + 8, top: drag.y }} aria-hidden>
          {iconOf(heldFree[0])}
          <span className="truncate">{heldFree.length > 1 ? `${heldFree.length} katman` : label(heldFree[0])}</span>
        </div>
      )}
    </>
  );
}
