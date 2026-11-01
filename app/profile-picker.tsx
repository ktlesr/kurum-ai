"use client";

// How much the assistant works on an answer, chosen beside the send button. The list says what each one does: on a phone
// there is no hovering to find out.
import { Brain, Check, ChevronDown, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type Profile = "auto" | "fast" | "deep";
export const PROFILES: { id: Profile; label: string; hint: string; Icon: LucideIcon }[] = [
  { id: "auto", label: "Otomatik", hint: "Soruya göre ilgili bölümleri ya da tüm belgeyi kullanır.", Icon: Sparkles },
  { id: "fast", label: "Hızlı", hint: "En hızlı cevap; büyük belgede ilgili bölümleri kullanır. Hazır işler yine tüm belgeyi kapsar.", Icon: Zap },
  { id: "deep", label: "Derin analiz", hint: "Belgenin tamamını kullanır; daha yavaş, daha kapsamlı.", Icon: Brain },
];

export function ProfilePicker({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const now = PROFILES.find((p) => p.id === value) ?? PROFILES[0];

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation(); // Esc also stops an answer being written: here it only closes the list
      return close();
    }
    if (e.key === "Tab") return setOpen(false);
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    items[(items.indexOf(document.activeElement as HTMLButtonElement) + step + items.length) % items.length]?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`İşlem profili: ${now.label}`}
        title={now.hint}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors hover:bg-subtle hover:text-fg ${value === "auto" ? "text-muted" : "text-accent"} ${open ? "bg-subtle" : ""}`}
      >
        <now.Icon size={15} /> {now.label} <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" aria-label="İşlem profili" className="absolute bottom-full right-0 z-30 mb-1.5 w-72 max-w-[calc(100vw-5.5rem)] rounded-xl border border-line bg-panel p-1 shadow-card">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === value}
              onClick={() => {
                onChange(p.id);
                close();
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-subtle focus-visible:bg-subtle"
            >
              <p.Icon size={16} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block text-xs text-muted">{p.hint}</span>
              </span>
              {p.id === value && <Check size={16} className="mt-0.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
