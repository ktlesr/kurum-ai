"use client";

// Photos from the archive: the answer's grid with a large view, and the studio's picker. Pictures are named only by id; the server
// decides who may see what.
import { ChevronLeft, ChevronRight, Download, Film, Folder, Images, Loader2, Palette, Play, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryPhoto } from "@/lib/local-store";

export const imageUrl = (id: string, size: "thumb" | "view" | "full" = "thumb") => `/api/gallery/image?id=${encodeURIComponent(id)}&size=${size}`;

function Thumb({ p, onOpen }: { p: GalleryPhoto; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button type="button" onClick={onOpen} title={p.caption ?? p.name} aria-label={`${p.name} büyüt`} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-line bg-subtle">
      {broken ? (
        <span className="grid size-full place-items-center p-2 text-center text-xs text-muted">{p.video ? <Film size={24} /> : "Resim yüklenemedi"}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed-in, private pictures with their own sizes: no optimizer in between
        <img src={imageUrl(p.id)} alt={p.caption ?? p.name} loading="lazy" onError={() => setBroken(true)} className="size-full object-cover transition-transform group-hover:scale-[1.03]" />
      )}
      {p.video && <span className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-black/55 text-white"><Play size={18} fill="currentColor" /></span></span>}
    </button>
  );
}

function Viewer({ items, at, onMove, onClose }: { items: GalleryPhoto[]; at: number; onMove: (i: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const p = items[at];
  useEffect(() => {
    if (box.current && !box.current.open) box.current.showModal();
  }, []);
  const step = (d: number) => onMove((at + d + items.length) % items.length);
  return (
    <dialog
      ref={box}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
      aria-label={p.name}
      className="m-auto max-h-[calc(100dvh-24px)] w-[min(1100px,calc(100vw-24px))] rounded-2xl border border-line bg-panel p-0 text-fg shadow-card backdrop:bg-black/70"
    >
      <div className="flex max-h-[calc(100dvh-24px)] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={p.folder ? `${p.folder}/${p.name}` : p.name}>{p.name}</p>
          {!p.video && <a href={`/studio?galeri=${encodeURIComponent(p.id)}`} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-subtle"><Palette size={14} /> Stüdyoda kullan</a>}
          <a href={`${imageUrl(p.id, "full")}&indir=1`} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-subtle"><Download size={14} /> İndir</a>
          <button type="button" onClick={onClose} aria-label="Kapat" className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"><X size={16} /></button>
        </header>
        <div className="relative min-h-0 flex-1 bg-black/90">
          {p.video && p.playable && failed !== p.id ? (
            <video key={p.id} src={imageUrl(p.id, "full")} poster={imageUrl(p.id, "view")} controls preload="none" onError={() => setFailed(p.id)} className="mx-auto max-h-[72dvh] w-auto max-w-full" />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- see Thumb */}
              <img key={p.id} src={imageUrl(p.id, "view")} alt={p.caption ?? p.name} className={`mx-auto max-h-[72dvh] w-auto max-w-full object-contain ${p.video ? "opacity-60" : ""}`} />
              {p.video && <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white">Bu video biçimi tarayıcıda oynatılamıyor. İndirip izleyebilirsiniz.</p>}
            </>
          )}
          {items.length > 1 && (
            <>
              <button type="button" onClick={() => step(-1)} aria-label="Önceki" className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronLeft size={20} /></button>
              <button type="button" onClick={() => step(1)} aria-label="Sonraki" className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronRight size={20} /></button>
            </>
          )}
        </div>
        <footer className="border-t border-line px-3 py-2 text-xs text-muted">
          {p.folder && <p className="flex items-center gap-1 truncate"><Folder size={12} className="shrink-0" /> {p.folder}</p>}
          {p.caption && <p className="mt-0.5">Otomatik açıklama (hatalı olabilir): {p.caption}</p>}
        </footer>
      </div>
    </dialog>
  );
}

export function GalleryGrid({ items }: { items: GalleryPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ul aria-label="Bulunan fotoğraflar" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((p, i) => <li key={p.id}><Thumb p={p} onOpen={() => setOpen(i)} /></li>)}
      </ul>
      {open !== null && <Viewer items={items} at={open} onMove={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

const PAGE = 24;

/** The studio's way into the archive: search, or walk the folders; a press hands the picture over as a file. */
export function GalleryPicker({ onPick }: { onPick: (f: File) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [items, setItems] = useState<GalleryPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [taking, setTaking] = useState<string | null>(null);
  const box = useRef<HTMLDialogElement>(null);

  const load = useCallback(async (params: URLSearchParams, more: boolean) => {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch(`/api/gallery?${params}`);
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { items: GalleryPhoto[]; total: number; folders?: string[]; down?: boolean };
      if (j.folders) setFolders(j.folders);
      setTotal(j.total);
      setItems((x) => (more ? [...x, ...j.items] : j.items));
      if (j.down) setNote("Galeri klasörüne şu an ulaşılamıyor; son bilinen liste gösteriliyor.");
      else if (!j.folders && !j.total) setNote("Eşleşen fotoğraf bulunamadı.");
    } catch {
      setNote("Galeri okunamadı. Tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }, []);

  const show = () => {
    setOpen(true);
    setFolder(null);
    setItems([]);
    void load(new URLSearchParams({ q: "", kind: "photo" }), false);
  };
  useEffect(() => {
    if (open && box.current && !box.current.open) box.current.showModal();
  }, [open]);

  const params = (offset: number) => new URLSearchParams({ ...(folder !== null ? { folder } : { q }), kind: "photo", n: String(PAGE), offset: String(offset) });
  const take = async (p: GalleryPhoto) => {
    setTaking(p.id);
    setNote("");
    try {
      const r = await fetch(imageUrl(p.id, "view"));
      if (!r.ok) throw new Error();
      onPick(new File([await r.blob()], p.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      setOpen(false);
    } catch {
      setNote("Fotoğraf alınamadı. Tekrar deneyin.");
    } finally {
      setTaking(null);
    }
  };

  return (
    <>
      <button type="button" onClick={show} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm hover:bg-subtle"><Images size={15} /> Galeriden seç</button>
      {open && (
        <dialog ref={box} onCancel={(e) => { e.preventDefault(); setOpen(false); }} aria-label="Galeri" className="m-auto w-[min(900px,calc(100vw-24px))] rounded-2xl border border-line bg-panel p-0 text-fg shadow-card backdrop:bg-black/40">
          <div className="flex h-[min(720px,calc(100dvh-48px))] flex-col">
            <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); setFolder(null); void load(new URLSearchParams({ q, kind: "photo", n: String(PAGE) }), false); }}>
                <Search size={15} className="shrink-0 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Galeride ara (örn. uşak kilim)" aria-label="Galeride ara" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              </form>
              <button type="button" onClick={() => setOpen(false)} aria-label="Kapat" className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"><X size={16} /></button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              <nav aria-label="Klasörler" className="max-h-32 shrink-0 overflow-y-auto border-b border-line p-2 text-xs sm:max-h-none sm:w-56 sm:border-b-0 sm:border-r">
                {folders.length === 0 && !busy && <p className="px-1 text-muted">Klasör yok.</p>}
                {folders.map((f) => (
                  <button key={f} type="button" title={f} aria-current={folder === f ? "true" : undefined} onClick={() => { setFolder(f); void load(new URLSearchParams({ folder: f, kind: "photo", n: String(PAGE) }), false); }} className={`flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left hover:bg-subtle ${folder === f ? "bg-accent-soft" : ""}`}>
                    <Folder size={12} className="shrink-0 text-accent" /> <span className="truncate">{f || "(Ana klasör)"}</span>
                  </button>
                ))}
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {note && <p role="status" className="mb-2 text-xs text-warn-fg">{note}</p>}
                {!items.length && !busy && !note && <p className="text-sm text-muted">Bir klasör seçin ya da arayın.</p>}
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((p) => (
                    <li key={p.id} className="relative">
                      <Thumb p={p} onOpen={() => void take(p)} />
                      {taking === p.id && <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/40 text-white"><Loader2 size={20} className="animate-spin" /></span>}
                    </li>
                  ))}
                </ul>
                {busy && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> Yükleniyor…</p>}
                {!busy && items.length > 0 && items.length < total && (
                  <button type="button" onClick={() => void load(params(items.length), true)} className="mt-3 h-9 w-full rounded-lg border border-line text-sm hover:bg-subtle">Daha fazla ({total - items.length})</button>
                )}
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
