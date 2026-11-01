"use client";

// Getting an answer as a file: the "İndir" menu under every answer, and the card of files asked for in words.
import { AlertTriangle, Braces, Download, FileText, FileType2, Loader2, Sheet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FILE_FORMATS, fileNameOf, type ExportDoc, type FileFormat } from "@/lib/export-doc";
import ContextMenu, { type MenuItem } from "./studio/context-menu";

const ICONS: Record<FileFormat, ReactNode> = {
  docx: <FileText size={15} />,
  pdf: <FileType2 size={15} />,
  xlsx: <Sheet size={15} />,
  md: <FileText size={15} />,
  txt: <FileText size={15} />,
  json: <Braces size={15} />,
};
const ERROR = "Dosya hazırlanamadı. Tekrar deneyin.";
const save = async (doc: ExportDoc, f: FileFormat) => (await import("./export-file")).downloadDoc(doc, f);

/** The button under an answer, and over a whole chat. */
export function DownloadMenu({ doc, label = "İndir", title, compact }: { doc: () => ExportDoc; label?: string; title?: string; compact?: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (f: FileFormat) => {
    setBusy(true);
    setFailed(false);
    try {
      await save(doc(), f);
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const items: MenuItem[] = (Object.keys(FILE_FORMATS) as FileFormat[]).map((f) => ({ label: `${FILE_FORMATS[f].label} (.${FILE_FORMATS[f].ext})`, icon: ICONS[f], run: () => void run(f) }));
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        title={title ?? "Dosya olarak indir"}
        aria-label={title ?? "Dosya olarak indir"}
        disabled={busy}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 4 });
        }}
        className={compact ? "grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg disabled:opacity-50" : "flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-50"}
      >
        {busy ? <Loader2 size={compact ? 16 : 13} className="animate-spin" /> : <Download size={compact ? 16 : 13} />} {!compact && label}
      </button>
      {failed && <span role="alert" className="text-xs text-danger">{ERROR}</span>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}

/** The files asked for in the message: each ready to be taken with one press. */
export function FileCards({ doc, formats }: { doc: () => ExportDoc; formats: FileFormat[] }) {
  const [busy, setBusy] = useState<FileFormat | null>(null);
  const [failed, setFailed] = useState<FileFormat | null>(null);
  const run = async (f: FileFormat) => {
    setBusy(f);
    setFailed(null);
    try {
      await save(doc(), f);
    } catch (e) {
      console.error(e);
      setFailed(f);
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="mt-3 flex flex-col gap-2" aria-label="Hazırlanan dosyalar">
      {formats.map((f) => (
        <li key={f} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 shadow-card">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{ICONS[f]}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" title={fileNameOf(doc(), f)}>{fileNameOf(doc(), f)}</span>
            <span className="block text-xs text-muted">{failed === f ? <span role="alert" className="inline-flex items-center gap-1 text-danger"><AlertTriangle size={12} /> {ERROR}</span> : `${FILE_FORMATS[f].label} dosyası`}</span>
          </span>
          <button type="button" onClick={() => void run(f)} disabled={busy !== null} aria-label={`${FILE_FORMATS[f].label} dosyasını indir`} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
            {busy === f ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} İndir
          </button>
        </li>
      ))}
    </ul>
  );
}
