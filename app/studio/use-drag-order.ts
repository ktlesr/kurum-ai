"use client";

// Putting a list's items in another order by dragging: the slide strip and the layers panel. Pointer events, not the browser's
// drag, so mouse and finger work alike in every browser. A finger holds a moment first (a quick swipe still scrolls); near the
// end of a scrolling list it scrolls by itself; Esc puts the item down; a list changing underneath ends the drag.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

export type DragState = { from: number; gap: number; x: number; y: number };
type Press = { id: number; from: number; x0: number; y0: number; x: number; y: number; touch: boolean; timer?: ReturnType<typeof setTimeout>; scroll?: ReturnType<typeof setInterval> };

/** The nearest box around `el` (itself included) that scrolls along this axis. */
function scrollerOf(el: HTMLElement | null, axis: "x" | "y"): HTMLElement | null {
  for (let e = el; e; e = e.parentElement) {
    const style = getComputedStyle(e);
    const over = axis === "x" ? style.overflowX : style.overflowY;
    if ((over === "auto" || over === "scroll") && (axis === "x" ? e.scrollWidth > e.clientWidth : e.scrollHeight > e.clientHeight)) return e;
  }
  return null;
}

export function useDragOrder<T extends HTMLElement>({ axis, onDrop, changes, limit }: {
  axis: "x" | "y";
  /** The item at `from` dropped into the gap before item `gap` (the item count: after the last). */
  onDrop: (from: number, gap: number) => void;
  /** Different when the list changed: what is in hand no longer means the same place. */
  changes: string | number;
  /** The last gap it may go to (a locked background stays at the bottom). */
  limit?: number;
}) {
  const list = useRef<T>(null);
  const press = useRef<Press | null>(null);
  const dragging = useRef(false);
  const dropped = useRef(false);
  const max = useRef(limit);
  useEffect(() => {
    max.current = limit;
  });
  const [drag, setDrag] = useState<DragState | null>(null);

  const gapAt = (x: number, y: number) => {
    const items = [...(list.current?.children ?? [])];
    const i = items.findIndex((li) => {
      const r = li.getBoundingClientRect();
      return axis === "x" ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
    });
    const gap = i < 0 ? items.length : i;
    return max.current === undefined ? gap : Math.min(gap, max.current);
  };
  const end = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    if (p?.scroll) clearInterval(p.scroll);
    press.current = null;
    dragging.current = false;
    setDrag(null);
  };
  const begin = () => {
    const p = press.current;
    if (!p) return;
    dragging.current = true;
    list.current?.setPointerCapture(p.id);
    setDrag({ from: p.from, gap: gapAt(p.x, p.y), x: p.x, y: p.y });
    p.scroll = setInterval(() => {
      const q = press.current;
      const box = scrollerOf(list.current, axis);
      if (!q || !box) return;
      const r = box.getBoundingClientRect();
      const [at, lo, hi] = axis === "x" ? [q.x, r.left, r.right] : [q.y, r.top, r.bottom];
      const by = at < lo + 40 ? -14 : at > hi - 40 ? 14 : 0;
      if (!by) return;
      if (axis === "x") box.scrollLeft += by;
      else box.scrollTop += by;
      setDrag((d) => d && { ...d, gap: gapAt(q.x, q.y) });
    }, 30);
  };

  useEffect(() => {
    const el = list.current;
    // Once a finger holds an item, moving it drags instead of scrolling: only a listener of our own can say so.
    const hold = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if (!dragging.current) return;
      // While an item is in hand, no shortcut (undo, delete) changes the list under it.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") end();
    };
    // Let go outside the list before it became a drag: the press is over all the same.
    const released = () => {
      if (press.current && !dragging.current) end();
    };
    window.addEventListener("pointerup", released);
    window.addEventListener("pointercancel", released);
    el?.addEventListener("touchmove", hold, { passive: false });
    window.addEventListener("keydown", keys, true);
    return () => {
      el?.removeEventListener("touchmove", hold);
      window.removeEventListener("pointerup", released);
      window.removeEventListener("pointercancel", released);
      window.removeEventListener("keydown", keys, true);
      end();
    };
    // For the life of the list; everything it touches is in refs.
  }, []);
  useEffect(() => {
    if (press.current) end(); // held or only just pressed: the index no longer means the same item
    // Only when the list changes.
  }, [changes]);

  return {
    list,
    drag,
    /** On the list. */
    listProps: {
      onPointerMove: (e: PointerEvent) => {
        const p = press.current;
        if (!p || e.pointerId !== p.id) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (dragging.current) return setDrag((d) => d && { ...d, gap: gapAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY });
        const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
        if (p.touch) {
          if (moved > 8) end(); // a finger moving at once is scrolling
        } else if (moved > 5) begin();
      },
      onPointerUp: (e: PointerEvent) => {
        const p = press.current;
        if (!p || e.pointerId !== p.id) return;
        if (dragging.current) {
          dropped.current = true;
          setTimeout(() => (dropped.current = false), 0);
          onDrop(p.from, gapAt(e.clientX, e.clientY));
        }
        end();
      },
      onPointerCancel: end,
    },
    /** On each item. */
    itemProps: (i: number) => ({
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0 || press.current) return; // a second finger doesn't start a second drag
        if ((e.target as Element).closest("[data-no-drag]")) return;
        const touch = e.pointerType !== "mouse";
        press.current = { id: e.pointerId, from: i, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch };
        if (touch) press.current.timer = setTimeout(begin, 350);
      },
      onContextMenu: (e: MouseEvent) => {
        if (dragging.current || press.current?.touch) e.preventDefault(); // holding a finger opens no menu
      },
    }),
    /** The click that ends a drag isn't a click on the item. */
    justDropped: () => dropped.current,
  };
}
