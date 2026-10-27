"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";
const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const LABEL: Record<Theme, string> = { light: "Gündüz teması", dark: "Gece teması", system: "Sistem teması" };
const ICON = { light: Sun, dark: Moon, system: Monitor };

const read = (): Theme => {
  try {
    const t = localStorage.getItem("theme");
    return t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light";
  }
};
const apply = (t: Theme) =>
  document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches));

/** Day → night → system. The pre-paint script in layout.tsx applies the stored choice before hydration. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
  useEffect(() => setTheme(read()), []);
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);

  const next = NEXT[theme];
  const Icon = ICON[theme];
  return (
    <button
      onClick={() => {
        setTheme(next);
        apply(next);
        try { localStorage.setItem("theme", next); } catch {}
      }}
      className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg"
      aria-label={`${LABEL[theme]} (değiştir: ${LABEL[next]})`}
      title={`${LABEL[theme]} — tıklayın: ${LABEL[next]}`}
    >
      <Icon size={17} />
    </button>
  );
}
