"use client";

// "Add to the home screen". Chrome and Edge on Android and computers can ask by themselves; iPhone, iPad and other browsers
// only allow it from their own menu, so there the button says where to find it.
import { Smartphone } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// It can fire before this component is on the page, so it's caught from the moment the code loads.
let waiting: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    waiting = e as InstallEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    waiting = null;
    changed();
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isPhone = () => matchMedia("(pointer: coarse)").matches;

export function InstallApp() {
  const prompt = useSyncExternalStore(subscribe, () => waiting, () => null);
  // Known only in the browser; the server's page has no button, so the first paint matches it.
  const [where, setWhere] = useState<"ios" | "menu" | null>(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (isInstalled() || !isPhone()) return;
    const id = setTimeout(() => setWhere(isIos() ? "ios" : "menu"));
    return () => clearTimeout(id);
  }, []);

  if (!prompt && !where) return null;
  const install = async () => {
    if (!prompt) return setHint((h) => !h);
    await prompt.prompt();
    // Each event can be used once; the browser sends another if it can still be installed.
    waiting = null;
    changed();
  };
  return (
    <div className="border-t border-line px-3 py-2 text-sm">
      <button type="button" onClick={() => void install()} aria-expanded={prompt ? undefined : hint} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-muted hover:bg-subtle hover:text-fg">
        <Smartphone size={15} className="shrink-0" /> Uygulama olarak ekle
      </button>
      {hint && !prompt && (
        <p role="status" className="mt-1 px-1 text-xs text-muted">
          {where === "ios"
            ? "Safari'de alttaki Paylaş düğmesine dokunun, sonra “Ana Ekrana Ekle”yi seçin."
            : "Tarayıcınızın menüsünden “Ana ekrana ekle” ya da “Uygulamayı yükle”yi seçin."}
        </p>
      )}
    </div>
  );
}
