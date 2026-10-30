"use client";

// The studio's first screen: what to make. Each kind opens its own editor, so a poster never sits next to PowerPoint themes.
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Clapperboard, FolderOpen, Image as ImageIcon, Library, Presentation } from "lucide-react";
import { FORMATS, type FormatId } from "@/lib/studio";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import type { Work } from "./works";

export type Mode = "gorsel" | "sunum" | "video";

const KINDS: { mode: Mode; title: string; text: string; tags: string; icon: ReactNode; tone: string }[] = [
  { mode: "gorsel", title: "Sosyal medya görseli", text: "Duyuru, etkinlik ve bilgi görselleri", tags: "PNG · JPEG · WebP · SVG", icon: <ImageIcon size={26} />, tone: "from-[#2e5e8c] to-[#14263d]" },
  { mode: "sunum", title: "Sunum", text: "Konudan ya da belgeden hazır slaytlar", tags: "PowerPoint (PPTX)", icon: <Presentation size={26} />, tone: "from-[#b5651d] to-[#6b3410]" },
  { mode: "video", title: "Video / Reels", text: "Tasarımlarınızı sahne sahne videoya çevirin", tags: "Müzik · altyazı", icon: <Clapperboard size={26} />, tone: "from-[#157a5b] to-[#0b4534]" },
];

export default function Home({ recent, onStart, onOpen, onLibrary, onProject }: {
  recent: Work[];
  onStart: (mode: Mode, format?: FormatId) => void;
  onOpen: (w: Work) => void;
  onLibrary: () => void;
  onProject: (f: File | undefined) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 md:px-4">
        <Link href="/" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">
          <ArrowLeft size={16} /> Asistan
        </Link>
        <span className="h-5 w-px bg-line" aria-hidden />
        <Logo size={24} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">Görsel Stüdyo</h1>
        <button className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg" onClick={onLibrary} aria-haspopup="dialog">
          <Library size={16} /> <span className="hidden sm:inline">Çalışmalarım</span>
        </button>
        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg focus-within:ring-2 focus-within:ring-accent/40">
          <FolderOpen size={16} /> <span className="hidden sm:inline">Dosya aç</span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { onProject(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
        <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">Bugün ne oluşturmak istiyorsunuz?</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {KINDS.map((k) => (
            <button key={k.mode} onClick={() => onStart(k.mode)} className="group overflow-hidden rounded-2xl border border-line bg-panel text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-accent focus-visible:border-accent">
              <span className={`grid h-32 place-items-center bg-gradient-to-br text-white ${k.tone}`}>
                <span className="grid size-14 place-items-center rounded-2xl bg-white/15 transition-transform group-hover:scale-105">{k.icon}</span>
              </span>
              <span className="block p-4">
                <span className="block font-semibold">{k.title}</span>
                <span className="mt-1 block text-sm text-muted">{k.text}</span>
                <span className="mt-2 block text-xs text-muted">{k.tags}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-muted">Hızlı başlangıç:</span>
          {(Object.keys(FORMATS) as FormatId[]).map((f) => (
            <button key={f} onClick={() => onStart("gorsel", f)} title={`${FORMATS[f].w}×${FORMATS[f].h}`} className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent hover:text-accent">
              <span className="block rounded-[2px] border-[1.5px] border-current" style={{ width: FORMATS[f].w >= FORMATS[f].h ? 16 : (16 * FORMATS[f].w) / FORMATS[f].h, height: FORMATS[f].w > FORMATS[f].h ? (16 * FORMATS[f].h) / FORMATS[f].w : 16 }} aria-hidden />
              {FORMATS[f].label}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <section className="mt-12" aria-labelledby="t-recent">
            <div className="flex items-baseline justify-between">
              <h2 id="t-recent" className="font-semibold">Son çalışmalar</h2>
              <button onClick={onLibrary} className="text-sm text-accent hover:underline">Tümünü gör</button>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {recent.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <button onClick={() => onOpen(w)} className="block w-full overflow-hidden rounded-xl border border-line bg-panel text-left transition-colors hover:border-accent">
                    <span className="grid h-32 place-items-center bg-subtle">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local thumbnail */}
                      {w.thumb && <img src={w.thumb} alt="" className="max-h-full max-w-full object-contain" />}
                    </span>
                    <span className="block truncate px-2.5 pt-2 text-xs font-medium">{w.name}</span>
                    <span className="block px-2.5 pb-2 text-[11px] text-muted">{w.deck ? `Sunum · ${w.deck.slides.length} slayt` : FORMATS[w.format].label} · {new Date(w.updatedAt).toLocaleDateString("tr-TR")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
