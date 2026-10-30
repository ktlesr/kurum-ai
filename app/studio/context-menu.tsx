"use client";

// Right-click menu of the studio canvas: the selected element's actions in one place (the inspector has the same ones
// as controls). Keyboard: arrows move, Enter/Space runs, Escape closes; focus goes back to where it came from.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem = { label: string; icon?: ReactNode; keys?: string; run: () => void; disabled?: boolean; danger?: boolean } | "-";

export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const back = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  // Kept on screen: opened near the right or bottom edge, it opens toward the inside.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const out = (e: Event) => !ref.current?.contains(e.target as Node) && close.current();
    // Not on scroll: the menu is fixed on screen, and panels scroll on their own (focus moving in the layer list).
    const away = () => close.current();
    document.addEventListener("pointerdown", out, true);
    window.addEventListener("blur", away);
    window.addEventListener("resize", away);
    const restore = back.current;
    const menu = ref.current;
    return () => {
      document.removeEventListener("pointerdown", out, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("resize", away);
      // Back where it was, unless the action moved focus on purpose (the text editor it opened).
      const at = document.activeElement;
      if (restore?.isConnected && (!at || at === document.body || menu?.contains(at))) restore.focus();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the studio's own shortcuts don't run under the menu
    const all = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") return e.preventDefault(), onClose();
    if (e.key === "ArrowDown") return e.preventDefault(), all[(i + 1) % all.length]?.focus();
    if (e.key === "ArrowUp") return e.preventDefault(), all[(i - 1 + all.length) % all.length]?.focus();
    if (e.key === "Home") return e.preventDefault(), all[0]?.focus();
    if (e.key === "End") return e.preventDefault(), all.at(-1)?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Öğe işlemleri"
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 max-h-[80vh] min-w-[220px] overflow-y-auto rounded-lg border border-line bg-panel py-1 text-sm shadow-xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((it, i) =>
        it === "-" ? (
          <div key={i} role="separator" className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.run();
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none hover:bg-subtle focus:bg-subtle disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}
          >
            <span className="flex w-4 shrink-0 justify-center text-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.keys && <kbd className="font-sans text-[11px] text-muted">{it.keys}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
