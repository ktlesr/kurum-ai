"use client";

// Side menu's document library: "Ortak belgeler" (the server's shared folder) and "Belgelerim" (the user's own), as
// folder trees, closed until opened. Nothing here reaches a chat by itself: a tick adds a document (or a folder) to the
// open chat only.
import { useState, type ReactNode } from "react";
import { Check, ChevronRight, File as FileIcon, Folder, FolderInput, Library as LibraryIcon, Plus, Trash2, Upload, Users } from "lucide-react";

export interface LibItem { id: string; path: string; name: string; size: number; kind: string }
type Node = { name: string; dirs: Map<string, Node>; files: LibItem[] };

function treeOf(items: LibItem[]): Node {
  const root: Node = { name: "", dirs: new Map(), files: [] };
  for (const it of items) {
    let at = root;
    for (const p of it.path.split("/").slice(0, -1)) {
      if (!at.dirs.has(p)) at.dirs.set(p, { name: p, dirs: new Map(), files: [] });
      at = at.dirs.get(p)!;
    }
    at.files.push(it);
  }
  return root;
}
const allFiles = (n: Node): LibItem[] => [...n.files, ...[...n.dirs.values()].flatMap(allFiles)];

interface RowProps {
  attached: ReadonlySet<string>;
  onToggle: (items: LibItem[], on: boolean) => void;
  onOpen: (id: string) => void;
  /** Personal library only. */
  onDelete?: (id: string) => void;
  onMove?: (id: string, folder: string) => void;
  folders?: string[];
}

function FileRow({ f, p }: { f: LibItem; p: RowProps }) {
  const on = p.attached.has(f.id);
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const mini = "shrink-0 rounded p-0.5 text-muted opacity-0 hover:text-fg focus:opacity-100 group-hover/row:opacity-100";
  return (
    <li>
      <div className="group/row flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-subtle">
        <button onClick={() => p.onToggle([f], !on)} role="checkbox" aria-checked={on} aria-label={`${f.name}: bu sohbette kullan`} title="Bu sohbette kullan" className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>
          {on && <Check size={11} />}
        </button>
        <button onClick={() => p.onOpen(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs" title={`${f.path} — aç`}>
          <FileIcon size={12} className="shrink-0 text-muted" /> <span className="truncate">{f.name}</span>
        </button>
        {p.onMove && <button onClick={() => setMoving((m) => !m)} className={mini} aria-label={`${f.name}: klasöre taşı`} title="Klasöre taşı"><FolderInput size={12} /></button>}
        {p.onDelete && (confirm ? (
          <button onClick={() => p.onDelete!(f.id)} onBlur={() => setConfirm(false)} autoFocus className="shrink-0 rounded bg-danger px-1 text-[11px] text-white">Sil?</button>
        ) : (
          <button onClick={() => setConfirm(true)} className={`${mini} hover:text-danger`} aria-label={`${f.name} sil`} title="Sil"><Trash2 size={12} /></button>
        ))}
      </div>
      {moving && p.onMove && (
        <form
          className="py-1 pl-5"
          onSubmit={(e) => {
            e.preventDefault();
            p.onMove!(f.id, String(new FormData(e.currentTarget).get("folder") ?? ""));
            setMoving(false);
          }}
        >
          <input name="folder" autoFocus list="kai-folders" placeholder="Klasör adı (boş: en üst)" aria-label="Klasör adı" defaultValue={f.path.split("/").slice(0, -1).join("/")} className="h-7 w-full rounded border border-line bg-panel px-2 text-xs outline-none focus:border-accent" />
          <datalist id="kai-folders">{p.folders?.map((x) => <option key={x} value={x} />)}</datalist>
        </form>
      )}
    </li>
  );
}

function DirRow({ node, p }: { node: Node; p: RowProps }) {
  const files = allFiles(node);
  const on = files.filter((f) => p.attached.has(f.id)).length;
  return (
    <li>
      <details className="group/dir">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pr-1 text-xs hover:bg-subtle">
          <ChevronRight size={12} className="shrink-0 text-muted transition-transform group-open/dir:rotate-90" />
          <Folder size={12} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
          <span className="text-[11px] text-muted">{on ? `${on}/` : ""}{files.length}</span>
          <button
            onClick={(e) => {
              e.preventDefault();
              p.onToggle(files, on < files.length);
            }}
            aria-label={`${node.name} klasörünü bu sohbette ${on < files.length ? "kullan" : "kullanma"}`}
            title={on < files.length ? "Klasörü bu sohbette kullan" : "Klasörü sohbetten çıkar"}
            className="shrink-0 rounded p-0.5 text-muted hover:text-accent"
          >
            {on < files.length ? <Plus size={12} /> : <Check size={12} />}
          </button>
        </summary>
        <div className="ml-2 border-l border-line pl-1.5"><Rows node={node} p={p} /></div>
      </details>
    </li>
  );
}

function Rows({ node, p }: { node: Node; p: RowProps }) {
  return (
    <ul>
      {[...node.dirs.values()].map((d) => <DirRow key={d.name} node={d} p={p} />)}
      {node.files.map((f) => <FileRow key={f.id} f={f} p={p} />)}
    </ul>
  );
}

function Section({ title, icon, count, children, action }: { title: string; icon: ReactNode; count: number; children: ReactNode; action?: ReactNode }) {
  return (
    <details className="group/sec">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-xs font-medium text-muted hover:text-fg">
        <ChevronRight size={13} className="shrink-0 transition-transform group-open/sec:rotate-90" />
        {icon}
        <span className="flex-1">{title}</span>
        <span className="text-[11px]">{count}</span>
        {action}
      </summary>
      <div className="max-h-64 overflow-y-auto pb-1 pl-1">{children}</div>
    </details>
  );
}

export function LibraryPanel({ shared, personal, attached, onToggle, onOpen, onDelete, onMove, onUpload }: {
  shared: LibItem[]; personal: LibItem[]; attached: ReadonlySet<string>;
  onToggle: (items: LibItem[], on: boolean) => void; onOpen: (id: string) => void; onDelete: (id: string) => void; onMove: (id: string, folder: string) => void; onUpload: () => void;
}) {
  const folders = [...new Set(personal.map((f) => f.path.split("/").slice(0, -1).join("/")).filter(Boolean))];
  return (
    <section aria-label="Belge kütüphanesi" className="border-t border-line px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 px-0.5 text-[11px] text-muted"><LibraryIcon size={12} /> Sohbette yalnızca işaretlediğiniz ya da istediğiniz belgeler okunur.</p>
      <Section title="Ortak belgeler" icon={<Users size={13} />} count={shared.length}>
        {shared.length ? <Rows node={treeOf(shared)} p={{ attached, onToggle, onOpen }} /> : <p className="px-1 py-1 text-xs text-muted">Sunucudaki ortak klasör henüz boş.</p>}
      </Section>
      <Section
        title="Belgelerim"
        icon={<Folder size={13} />}
        count={personal.length}
        action={
          <button onClick={(e) => { e.preventDefault(); onUpload(); }} className="rounded p-0.5 hover:bg-subtle hover:text-fg" aria-label="Belge yükle" title="Belge yükle"><Upload size={13} /></button>
        }
      >
        {personal.length ? <Rows node={treeOf(personal)} p={{ attached, onToggle, onOpen, onDelete, onMove, folders }} /> : <p className="px-1 py-1 text-xs text-muted">Henüz belge yok. Yükle düğmesiyle ya da sürükleyerek ekleyin.</p>}
      </Section>
    </section>
  );
}
