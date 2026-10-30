"use client";

// Font list of the inspector: the app's library (each name in its own font), this computer's fonts, added files.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Upload } from "lucide-react";
import { familyOf } from "@/lib/studio";
import { LIBRARY_OPTIONS, addFontFile, ensureFont, localFontsSupported, queryLocal, uploadedFonts, type FontOption } from "./fonts";

export default function FontPicker({ value, username, onPick, compact }: { value?: string; username: string; onPick: (id: string | undefined) => void; /** In the bar above the canvas: no label, the list floats. */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<FontOption[]>([]);
  const [local, setLocal] = useState<FontOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  // A font still loading when the selection changes (this picker gone) isn't applied to anything.
  const alive = useRef(true);
  const request = useRef(0); // the latest choice wins over one still loading
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Library previews load when the list opens (under 2 MB in all); the computer's fonts only when one is chosen.
  useEffect(() => {
    if (!open) return;
    let live = true;
    uploadedFonts(username).then((f) => live && setFiles(f)).catch(() => {});
    for (const f of LIBRARY_OPTIONS) ensureFont(f.id, username).then(() => live && setReady((r) => new Set(r).add(f.id))).catch(() => {});
    return () => {
      live = false;
    };
  }, [open, username]);

  const all = useMemo(() => [...LIBRARY_OPTIONS, ...files, ...local], [files, local]);
  const current = all.find((f) => f.id === value)?.label ?? (value ? "Özel yazı tipi" : "Varsayılan (Geist)");
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = needle ? all.filter((f) => f.label.toLocaleLowerCase("tr").includes(needle)) : all;
  const cats = [...new Set(shown.map((f) => f.cat))];

  const choose = async (f: FontOption) => {
    setError("");
    setBusy(true);
    const mine = ++request.current;
    try {
      await ensureFont(f.id, username);
      if (!alive.current || mine !== request.current) return;
      onPick(f.id);
      setOpen(false);
    } catch {
      setError(`${f.label} yüklenemedi.`);
    } finally {
      setBusy(false);
    }
  };
  const askLocal = async () => {
    setError("");
    try {
      setLocal(await queryLocal());
    } catch {
      setError("Bilgisayardaki yazı tiplerine izin verilmedi.");
    }
  };
  const addFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const mine = ++request.current;
      const f = await addFontFile(username, file);
      if (!alive.current || mine !== request.current) return;
      setFiles((l) => [...l.filter((x) => x.id !== f.id), f]);
      onPick(f.id);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const row = "flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-subtle";
  return (
    <div className={compact ? "relative" : undefined}>
      {!compact && <span className="mb-0.5 block text-[11px] text-muted">Yazı tipi</span>}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-8 w-full items-center justify-between rounded-md border border-line bg-panel px-2 text-sm hover:border-accent" style={{ fontFamily: familyOf(value) }}>
        <span className="truncate">{current}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className={`mt-1 rounded-lg border border-line bg-panel p-1.5 ${compact ? "absolute left-0 top-full z-30 w-72 shadow-card" : ""}`}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yazı tipi ara" aria-label="Yazı tipi ara" className="mb-1 h-8 w-full rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent" />
          <div className="max-h-64 overflow-y-auto">
            {!needle && <button type="button" className={`${row} text-sm`} aria-pressed={!value} onClick={() => { request.current++; onPick(undefined); setOpen(false); }} style={{ fontFamily: familyOf() }}>Varsayılan (Geist)</button>}
            {cats.map((c) => (
              <div key={c}>
                <p className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{c}</p>
                {shown.filter((f) => f.cat === c).map((f) => (
                  <button key={f.id} type="button" className={`${row} text-[15px] ${f.id === value ? "bg-accent-soft" : ""}`} aria-pressed={f.id === value} disabled={busy} onClick={() => choose(f)} style={{ fontFamily: ready.has(f.id) ? familyOf(f.id) : undefined }}>
                    <span className="truncate">{f.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && <p className="px-2 py-2 text-xs text-muted">Sonuç yok.</p>}
          </div>
          <div className="mt-1 space-y-1 border-t border-line pt-1.5">
            {localFontsSupported() ? (
              !local.length && <button type="button" onClick={askLocal} className="h-8 w-full rounded-md border border-line text-xs hover:border-accent hover:text-accent">Bilgisayarımdaki yazı tiplerini göster</button>
            ) : (
              <p className="text-[11px] text-muted">Bu tarayıcı bilgisayardaki yazı tiplerini listeleyemiyor (Chrome ve Edge destekler); dosya yükleyebilirsiniz.</p>
            )}
            <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-line text-xs text-muted hover:border-accent hover:text-accent focus-within:border-accent">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Yazı tipi dosyası yükle
              <input type="file" accept=".ttf,.otf,.woff,.woff2" className="sr-only" onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <p className="text-[11px] text-muted">Bilgisayarınızdan seçtiğiniz yazı tipi dışa aktarılan görsele gömülür; lisansının bu kullanıma izin verdiğinden emin olun. Başka bilgisayarda açılan tasarımda bulunamazsa varsayılan yazı tipi kullanılır.</p>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
