"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle, ArrowUp, Check, Copy, Download, File as FileIcon, FileSpreadsheet, FileText, FileType,
  HardDrive, LogOut, Menu, Pencil, Pin, PinOff, Plus, Search, Square, Trash2, Upload, Users, X,
} from "lucide-react";
import { useChats } from "./use-chats";
import { searchChats, titleFrom, type Message, type StoredChat } from "@/lib/local-store";
import { ThemeToggle } from "./theme-toggle";
import { logout } from "./login/actions";
import { contextRatio, ERROR_SEP, META_SEP, STATUS_SEP, type ChatMeta } from "@/lib/context";
import type { DocKind, DocMeta } from "@/lib/server";

type Card = Partial<DocMeta> & {
  id: string; name: string; size: number; kind: DocKind; status: "uploading" | "ready" | "error"; error?: string;
  serverId?: string;
  progress?: { stage: string; done: number; total: number };
};
type UploadEvent =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "done"; doc: DocMeta }
  | { type: "error"; error: string };

const ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md";
const MAX_BYTES = 25 * 1024 * 1024;
const ICONS = { pdf: FileText, docx: FileType, sheet: FileSpreadsheet, text: FileIcon } as const;

const kindOf = (name: string): DocKind => {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "sheet";
  return "text";
};
const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
// The server answers from the last 8 turns; sending more only risks the 200-message request limit.
const HISTORY = 8;
const fmtNum = (n: number) => n.toLocaleString("tr-TR");
/** fetch for our API: an expired session (401) goes back to the login page. */
const api = (url: string, init?: RequestInit) =>
  fetch(url, init).then((r) => {
    // Full reload on purpose: drops all client state of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.status === 401) location.assign("/login");
    return r;
  });

export default function Chat({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [files, setFiles] = useState<Card[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [think, setThink] = useState(true);
  const [numCtx, setNumCtx] = useState(16384);
  const [cpt, setCpt] = useState<Record<string, number>>({});
  const [modelOk, setModelOk] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const streamingRef = useRef(false);
  const chatIdRef = useRef<string | null>(null);
  useEffect(() => { streamingRef.current = streaming; chatIdRef.current = chatId; });
  const local = useChats(username, async (id) => {
    // Another tab changed the open chat: show its version unless this tab is mid-answer.
    if (id !== chatIdRef.current || streamingRef.current) return;
    const c = await local.get(id);
    if (c) setMessages(c.messages);
    else { setChatId(null); setMessages([]); }
  });
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());

  const checkModels = useCallback(async () => {
    const r = (await api("/api/models").then((res) => res.json())) as {
      ok: boolean; models: string[]; defaultModel: string; numCtx: number; charsPerToken: Record<string, number>;
    };
    setModelOk(r.ok);
    setModels(r.models);
    setNumCtx(r.numCtx);
    setCpt(r.charsPerToken);
    // Keep the choice only while the server still offers it (allowlist can change, the model server can come back with fewer models).
    setModel((cur) => (r.models.includes(cur) ? cur : r.models.includes(r.defaultModel) ? r.defaultModel : (r.models[0] ?? r.defaultModel)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch, then poll
    checkModels();
    const t = setInterval(checkModels, 15000);
    return () => clearInterval(t);
  }, [checkModels]);

  // Files uploaded earlier are kept on the server; bring their cards back.
  useEffect(() => {
    api("/api/upload")
      .then((r) => r.json() as Promise<DocMeta[]>)
      .then((list) =>
        setFiles((fs) => {
          // Effects run twice in dev (Strict Mode): skip docs that are already listed.
          const have = new Set(fs.map((f) => f.serverId));
          return [...list.filter((d) => !have.has(d.id)).map((d) => ({ ...d, serverId: d.id, status: "ready" as const })), ...fs];
        }),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && abortRef.current?.abort();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const upload = (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      const tmp: Card = { id: crypto.randomUUID(), name: f.name, size: f.size, kind: kindOf(f.name), status: "uploading" };
      const patch = (p: Partial<Card>) => setFiles((fs) => fs.map((x) => (x.id === tmp.id ? { ...x, ...p } : x)));
      setFiles((fs) => [...fs, tmp]);
      if (f.size > MAX_BYTES) {
        patch({ status: "error", error: "Dosya 25 MB sınırını aşıyor." });
        continue;
      }
      const body = new FormData();
      body.append("file", f);
      const ac = new AbortController();
      uploads.current.set(tmp.id, ac);
      (async () => {
        const res = await api("/api/upload", { method: "POST", body, signal: ac.signal });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          return patch({ status: "error", error: j.error ?? `Yükleme başarısız (${res.status}).` });
        }
        // NDJSON: progress events, then done/error
        let buf = "";
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += value;
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const l of lines.filter(Boolean)) {
            const ev = JSON.parse(l) as UploadEvent;
            if (ev.type === "progress") patch({ progress: { stage: ev.stage, done: ev.done, total: ev.total } });
            else if (ev.type === "done") patch({ ...ev.doc, id: tmp.id, serverId: ev.doc.id, status: "ready", progress: undefined });
            else patch({ status: "error", error: ev.error, progress: undefined });
          }
        }
      })()
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) patch({ status: "error", error: "Sunucuya ulaşılamadı." });
        })
        .finally(() => uploads.current.delete(tmp.id));
    }
    setDrawer(false);
  };

  const remove = (c: Card) => {
    setFiles((fs) => fs.filter((x) => x.id !== c.id));
    uploads.current.get(c.id)?.abort();
    if (c.serverId) api(`/api/upload?id=${c.serverId}`, { method: "DELETE" });
  };

  const ready = files.filter((f) => f.status === "ready");
  const ratio = contextRatio(ready.reduce((n, f) => n + (f.chars ?? 0), 0), numCtx, cpt[model]);
  const hasSheet = ready.some((f) => f.kind === "sheet");

  /** scope "all": the question needs the whole document (summaries etc.), so a too-large doc is scanned, not searched. */
  const send = async (text: string, scope?: "all") => {
    const q = text.trim();
    if (!q || streaming || !ready.length) return;
    const history: Message[] = [...messages.filter((m) => !m.error), { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let last: Message = { role: "assistant", content: "" };
    const setLast = (fn: (m: Message) => Message) => {
      last = fn(last);
      const m = last;
      setMessages((ms) => [...ms.slice(0, -1), m]);
    };
    // Saved before the answer starts (a closed tab keeps the question) and again when it ends.
    const id = chatId ?? crypto.randomUUID();
    const prev = chatId ? local.chats.find((c) => c.id === chatId) : undefined;
    const createdAt = prev?.createdAt ?? Date.now();
    const persist = (msgs: Message[]) =>
      local.save({
        id, createdAt, updatedAt: Date.now(), pinned: prev?.pinned, model,
        title: prev?.title ?? titleFrom(q),
        docIds: ready.map((f) => f.serverId!).filter(Boolean),
        messages: msgs.filter((m) => m.content || m.error).map(({ role, content, error, meta }) => ({ role, content, ...(error ? { error } : {}), ...(meta ? { meta } : {}) })),
      });
    setChatId(id);
    persist(history);

    try {
      const res = await api("/api/chat", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, think, scope, fileIds: ready.map((f) => f.serverId), messages: history.slice(-HISTORY).map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 503) setModelOk(false);
        setLast(() => ({ role: "assistant", content: j.error ?? `Beklenmeyen hata (${res.status}).`, error: true }));
        return;
      }
      // Answer text, then META_SEP + ChatMeta JSON once the answer is complete.
      let raw = "";
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += value;
        // Progress lines (STATUS_SEP…STATUS_SEP) are shown while waiting and never become part of the answer.
        const body = raw.split(META_SEP)[0].split(ERROR_SEP)[0];
        const statuses = body.match(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"));
        const content = body.replace(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"), "");
        const status = statuses ? statuses[statuses.length - 1].slice(1, -1) : undefined;
        setLast((m) => ({ ...m, content, status }));
      }
      // A failure mid-answer: show it as an error turn, which also keeps it out of the next request's history.
      const failure = raw.split(ERROR_SEP)[1];
      if (failure !== undefined) return setLast(() => ({ role: "assistant", content: failure, error: true }));
      const [, metaJson] = raw.split(META_SEP);
      if (metaJson) setLast((m) => ({ ...m, meta: JSON.parse(metaJson) as ChatMeta }));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setLast(() => ({ role: "assistant", content: "Bağlantı koptu. Lütfen tekrar deneyin.", error: true }));
        checkModels();
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      persist([...history, last]);
    }
  };

  const openChat = (c: StoredChat) => {
    if (streaming) return;
    setChatId(c.id);
    setMessages(c.messages);
    setDrawer(false);
  };
  const newChat = () => {
    if (streaming) return;
    setChatId(null);
    setMessages([]);
    setDrawer(false);
  };
  const deleteChat = (c: StoredChat) => {
    if (c.id === chatId) newChat();
    local.remove(c);
  };
  const visibleChats = searchChats(local.chats, query);

  const hasReport = ready.some((f) => f.kind === "pdf" || f.kind === "docx");
  const CONSISTENCY =
    "Dokümanı tutarlılık açısından incele: tablolardaki değerler, [Kod kontrolü] sonuçları ve sonuç/değerlendirme bölümü birbiriyle uyumlu mu? Bulguları sayfa numarasıyla madde madde listele; uyumsuzluk yoksa bunu açıkça söyle.";
  // All of these need the whole document.
  const suggestions: [label: string, prompt: string][] = [
    ["Özetle", "Dokümanın tamamını özetle: amacı ve kapsamı, ana bölümleri, temel bulguları ve sonuçları."],
    ["Ana başlıklar", "Dokümanın ana başlıklarını ve bölümlerini sırayla, sayfa numaralarıyla listele."],
    ["Önemli rakamlar", "Dokümandaki önemli rakamları (tutarlar, oranlar, sonuç değerleri) dokümanda yazdığı gibi, sayfa numaralarıyla listele."],
    ...(hasSheet ? [["Sütunları açıkla", "Tablolardaki sütunları ve ne anlama geldiklerini açıkla."] as [string, string]] : []),
    ...(hasReport ? [["Tutarlılık kontrolü", CONSISTENCY] as [string, string]] : []),
  ];

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Doküman Asistanı</h1>
          <p className="text-xs text-muted">Kurum sunucusunda işlenir · harici AI servisine gönderilmez</p>
        </div>
        <button className="rounded-md p-1.5 text-muted hover:bg-subtle md:hidden" onClick={() => setDrawer(false)} aria-label="Paneli kapat">
          <X size={18} />
        </button>
      </div>

      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Sohbetler</span>
          <button onClick={newChat} disabled={streaming} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-40">
            <Plus size={14} /> Yeni sohbet
          </button>
        </div>
        {local.chats.length > 0 && (
          <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-sm focus-within:border-accent">
            <Search size={14} className="shrink-0 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sohbetlerde ara" aria-label="Sohbetlerde ara" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </label>
        )}
        <ul className="-mx-1 flex max-h-56 flex-col overflow-y-auto px-1">
          {visibleChats.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-md pr-1 ${c.id === chatId ? "bg-subtle" : "hover:bg-subtle"}`}>
              {renaming === c.id ? (
                <input
                  autoFocus
                  defaultValue={c.title}
                  aria-label="Sohbet adı"
                  className="m-1 h-7 min-w-0 flex-1 rounded border border-accent bg-panel px-1.5 text-sm outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); }
                  }}
                  onBlur={(e) => {
                    const t = e.currentTarget.value.trim();
                    if (renaming && t && t !== c.title) local.patch(c.id, { title: t.slice(0, 200) });
                    setRenaming(null);
                  }}
                />
              ) : (
                <button onClick={() => openChat(c)} disabled={streaming} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed">
                  {c.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Sabitlendi" />}
                  <span className="truncate" title={c.title}>{c.title}</span>
                </button>
              )}
              <span className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button onClick={() => local.patch(c.id, { pinned: !c.pinned })} className="rounded p-1 text-muted hover:text-fg" aria-label={c.pinned ? "Sabitlemeyi kaldır" : "Sabitle"} title={c.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}>
                  {c.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button onClick={() => setRenaming(c.id)} className="rounded p-1 text-muted hover:text-fg" aria-label="Yeniden adlandır" title="Yeniden adlandır">
                  <Pencil size={13} />
                </button>
                <button onClick={() => deleteChat(c)} disabled={streaming && c.id === chatId} className="rounded p-1 text-muted hover:text-danger disabled:opacity-40" aria-label="Sil" title="Sil">
                  <Trash2 size={13} />
                </button>
              </span>
            </li>
          ))}
          {query && !visibleChats.length && <li className="px-2 py-1.5 text-xs text-muted">Eşleşen sohbet yok.</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor="model" className="text-xs font-medium text-muted">Model</label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={!models.length}
          className="h-9 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-accent disabled:opacity-60"
        >
          {!models.length && <option>{model || "Model yok"}</option>}
          {models.map((m) => <option key={m}>{m}</option>)}
        </select>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={think} onChange={(e) => setThink(e.target.checked)} className="mt-0.5 accent-accent" />
          <span>
            Düşünerek cevapla
            <span className="block text-xs text-muted">Daha yavaş; çok adımlı sorularda daha isabetli olabilir.</span>
          </span>
        </label>
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <span className="text-xs font-medium text-muted">Dosyalar</span>
        <button
          onClick={() => fileInput.current?.click()}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-5 text-center text-sm text-muted transition-colors hover:border-accent hover:text-fg"
        >
          <Upload size={18} />
          <span>Dosya seçin veya sürükleyin</span>
          <span className="text-xs">PDF, DOCX, XLSX, CSV, TXT · maks. 25 MB</span>
        </button>
        <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />

        <ul className="-mx-1 flex flex-col gap-2 overflow-y-auto px-1 pb-1">
          {files.map((f) => {
            const Icon = ICONS[f.kind];
            const details = [
              fmtSize(f.size),
              f.pages && `${fmtNum(f.pages)} sayfa`,
              f.sheets && `${f.sheets} sheet`,
              f.rows && f.kind !== "pdf" && `${fmtNum(f.rows)} satır`,
              f.chars !== undefined && `${fmtNum(f.chars)} karakter`,
              f.verify && `${f.verify.tables} tablo çift okundu`,
            ].filter(Boolean);
            const pct = f.progress ? Math.round((f.progress.done / f.progress.total) * 100) : 0;
            return (
              <li key={f.id} className="relative overflow-hidden rounded-lg border border-line bg-panel p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                <div className="flex items-start gap-2.5">
                  <Icon size={18} className={f.status === "error" ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-accent"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{f.status === "uploading" ? (f.progress ? `${f.progress.stage} · ${f.progress.done}/${f.progress.total}` : "Okunuyor…") : details.join(" · ")}</p>
                    {f.error && <p className="mt-1 text-xs text-danger">{f.error}</p>}
                    {f.verify && f.verify.uncertain > 0 && (
                      <p className="mt-1 text-xs text-warn-fg">
                        {fmtNum(f.verify.uncertain)} / {fmtNum(f.verify.numbers)} tablo sayısında iki okuma uyuşmadı; bunlar (?) ile işaretli.
                      </p>
                    )}
                    {f.warning && <p className="mt-1 text-xs text-warn-fg">{f.warning}</p>}
                  </div>
                  <button onClick={() => remove(f)} className="shrink-0 rounded p-0.5 text-muted hover:bg-subtle hover:text-fg" aria-label={`${f.name} kaldır`}>
                    <X size={15} />
                  </button>
                </div>
                {f.status === "uploading" && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-subtle">
                    {f.progress ? (
                      <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    ) : (
                      <div className="progress-bar h-full w-2/5 bg-accent" />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-1.5 text-xs text-muted">
        <p className="flex items-start gap-1.5">
          <HardDrive size={13} className="mt-px shrink-0" />
          <span>
            Sohbetler yalnızca bu tarayıcıda saklanır; cihazlar arası eşitleme yok.
            {local.storage?.usage !== undefined && ` Kullanılan: ${fmtSize(local.storage.usage)}.`}
            {local.storage && !local.storage.persisted && " Tarayıcı yer açmak için silebilir; düzenli yedek alın."}
          </span>
        </p>
        <div className="flex gap-1">
          <button onClick={local.exportBackup} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-subtle hover:text-fg">
            <Download size={13} /> Yedek al
          </button>
          <button onClick={() => backupInput.current?.click()} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-subtle hover:text-fg">
            <Upload size={13} /> Yedekten yükle
          </button>
          <input
            ref={backupInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setBackupNote(await local.importBackup(f));
            }}
          />
        </div>
        {backupNote && <p role="status">{backupNote}</p>}
        <p>Bağlam: {fmtNum(numCtx)} token</p>
      </section>
      <div className="-mx-2 flex items-center gap-1 border-t border-line px-2 pt-3 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted" title={username}>{username}</span>
        {isAdmin && (
          <a href="/admin" className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Kullanıcılar" title="Kullanıcılar">
            <Users size={16} />
          </a>
        )}
        <form action={logout}>
          <button className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Çıkış yap" title="Çıkış yap">
            <LogOut size={16} />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div
      className="flex h-dvh"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
    >
      {drawer && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setDrawer(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-75 border-r border-line bg-bg transition-transform md:static md:translate-x-0 ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebar}
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-panel">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <button className="rounded-md p-1.5 text-muted hover:bg-subtle md:hidden" onClick={() => setDrawer(true)} aria-label="Paneli aç">
            <Menu size={18} />
          </button>
          <span className="truncate text-sm text-muted">{ready.length ? `${ready.length} dosya bağlamda` : "Dosya yok"}</span>
          <ThemeToggle />
        </header>

        {local.error && (
          <div role="alert" className="flex items-center gap-2 border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{local.error}</span>
          </div>
        )}
        {!modelOk && (
          <div role="alert" className="flex items-center gap-2 border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
            <AlertTriangle size={16} className="shrink-0" />
            <span>Model sunucusuna ulaşılamıyor. Yöneticinize bildirin.</span>
          </div>
        )}
        {ratio < 1 && (
          <div className="flex items-center gap-2 border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
            <AlertTriangle size={16} className="shrink-0" />
            <span>Dosyalar tek seferde bağlama sığmıyor. Belirli bir bilgi soran sorularda en ilgili bölümler aranıyor; özet gibi bütünü gerektiren sorularda doküman bölüm bölüm taranıyor (daha yavaş).</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-base font-medium">Bir dosya bırakın ve soru sorun</p>
              <p className="max-w-sm text-sm text-muted">
                Cevaplar yalnızca yüklediğiniz dosyalara dayanır. Dosyalar kurum sunucusunda işlenir; harici AI servisine gönderilmez.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
              {messages.map((m, i) => (
                <Bubble key={i} m={m} live={streaming && i === messages.length - 1} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          {ready.length > 0 && messages.length === 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map(([s, prompt]) => (
                <button key={s} onClick={() => send(prompt, "all")} className="rounded-full border border-line px-3 py-1 text-sm text-muted transition-colors hover:border-accent hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-line bg-panel p-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)] focus-within:border-accent">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder={ready.length ? "Dosya hakkında bir soru sorun…" : "Önce bir dosya yükleyin"}
              disabled={!ready.length}
              className="field-sizing-content max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-muted disabled:cursor-not-allowed"
            />
            {streaming ? (
              <button onClick={() => abortRef.current?.abort()} className="grid size-9 shrink-0 place-items-center rounded-lg bg-fg text-bg" aria-label="Durdur (Esc)" title="Durdur (Esc)">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || !ready.length}
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg transition-opacity disabled:opacity-40"
                aria-label="Gönder"
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-muted">Enter gönder · Shift+Enter yeni satır · Esc durdur</p>
        </div>

        {local.pendingDelete && (
          <div role="status" className="absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-fg px-4 py-2 text-sm text-bg shadow-lg">
            <span className="max-w-60 truncate">“{local.pendingDelete.title}” silindi</span>
            <button onClick={local.undoDelete} className="font-medium underline underline-offset-2">Geri al</button>
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-accent">
            Dosyaları buraya bırakın
          </div>
        )}
      </main>
    </div>
  );
}

function Bubble({ m, live }: { m: Message; live: boolean }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-subtle px-4 py-2.5">{m.content}</div>;
  }
  if (m.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-line px-4 py-3 text-sm text-danger">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{m.content}</span>
      </div>
    );
  }
  return (
    <div className="group">
      {live && !m.content && m.status && <p className="mb-2 text-sm text-muted">{m.status}</p>}
      <div className={`md ${live ? "streaming" : ""}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
            // Never load images a model answer points to: a URL can carry document text off-site (audit N1). CSP blocks them too.
            img: ({ alt }) => <span className="text-muted">[görsel: {alt || "adsız"}]</span>,
            // External links aren't clickable either: a click would hand the URL (and anything the model put in it) to that site.
            a: ({ href, children }) =>
              // Only same-site paths and anchors stay links; any scheme (https:, mailto:, …) or //host does not.
              href && /^(#|\/(?!\/))/.test(href) ? (
                <a href={href}>{children}</a>
              ) : (
                <span title={href}>{children} <span className="text-xs text-muted">(dış bağlantı devre dışı)</span></span>
              ),
          }}
        >
          {m.content}
        </ReactMarkdown>
      </div>
      {!live && m.meta && <MetaNotes meta={m.meta} />}
      {!live && m.content && (
        <button
          onClick={() => navigator.clipboard.writeText(m.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted opacity-70 hover:bg-subtle hover:text-fg group-hover:opacity-100"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      )}
    </div>
  );
}

function MetaNotes({ meta }: { meta: ChatMeta }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 text-muted">
        <span>{meta.mode === "rag" ? "Kullanılan bölümler:" : meta.mode === "scan" ? "Taranan bölümler:" : "Kaynak:"}</span>
        {meta.sources.map((s) => (
          <span key={s} className="rounded-md border border-line bg-subtle px-1.5 py-0.5">{s}</span>
        ))}
      </div>
      {meta.note && <p className="text-warn-fg">{meta.note}</p>}
      {meta.unverified.length > 0 && (
        <p className="flex items-start gap-1.5 text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Kaynakta bulunamayan sayılar: {meta.unverified.join(", ")}. Hesaplanmış ya da uydurulmuş olabilir; kontrol edin.</span>
        </p>
      )}
      {meta.uncertain.length > 0 && (
        <p className="flex items-start gap-1.5 text-warn-fg">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Belirsiz okunan sayılar: {meta.uncertain.join(", ")}. İki okuma uyuşmadı; orijinal sayfadan doğrulayın.</span>
        </p>
      )}
    </div>
  );
}
