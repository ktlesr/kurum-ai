"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle, ArrowUp, BookOpen, Check, ChevronDown, Copy, Download, File as FileIcon, FileSpreadsheet, FileText,
  FileType, HardDrive, LogOut, Menu, Paperclip, Pencil, Pin, PinOff, Plus, Search, Square, Trash2, Upload, Users, X,
} from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { logout } from "./login/actions";
import { useChats } from "./use-chats";
import { contextRatio, ERROR_SEP, META_SEP, parseSource, STATUS_SEP, type ChatMeta, type DocSection } from "@/lib/context";
import { searchChats, titleFrom, type Message, type StoredChat } from "@/lib/local-store";
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

/**
 * Processing profiles (plan §3.1): each maps to real request parameters.
 * auto = reasoning on, the server decides between whole-doc and search; fast = no reasoning;
 * deep = reasoning + always read the whole document (section scan when it doesn't fit).
 */
type Profile = "auto" | "fast" | "deep";
const PROFILES: { id: Profile; label: string; hint: string }[] = [
  { id: "auto", label: "Otomatik", hint: "Soruya göre ilgili bölümleri ya da tüm belgeyi kullanır." },
  { id: "fast", label: "Hızlı", hint: "Düşünme adımı olmadan, en kısa sürede cevap." },
  { id: "deep", label: "Derin analiz", hint: "Belgenin tamamını bölüm bölüm okur; daha yavaş, daha kapsamlı." },
];

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

const readProfile = (): Profile => {
  try {
    const p = localStorage.getItem("profile");
    return p === "fast" || p === "deep" ? p : "auto";
  } catch {
    return "auto";
  }
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
};

export default function Chat({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [files, setFiles] = useState<Card[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [profile, setProfile] = useState<Profile>("auto");
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
  const [source, setSource] = useState<{ serverId: string; label?: string } | null>(null);
  const mobile = useMedia("(max-width: 767px)");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
  useEffect(() => setProfile(readProfile()), []);
  const chooseProfile = (p: Profile) => {
    setProfile(p);
    try { localStorage.setItem("profile", p); } catch {}
  };

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (abortRef.current) abortRef.current.abort();
      else setSource(null);
    };
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
    if (c.serverId && source?.serverId === c.serverId) setSource(null);
  };

  const ready = files.filter((f) => f.status === "ready");
  const ratio = contextRatio(ready.reduce((n, f) => n + (f.chars ?? 0), 0), numCtx, cpt[model]);
  const hasSheet = ready.some((f) => f.kind === "sheet");
  const hasReport = ready.some((f) => f.kind === "pdf" || f.kind === "docx");

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
    // Read-modify-write: a rename or pin made while the answer streams (or in another tab) is kept.
    const id = chatId ?? crypto.randomUUID();
    const docIds = ready.map((f) => f.serverId!).filter(Boolean);
    const persist = (msgs: Message[]) =>
      local.upsert(id, (cur) => ({
        ...(cur ?? { id, createdAt: Date.now(), title: titleFrom(q) }),
        updatedAt: Date.now(), model, docIds,
        messages: msgs.filter((m) => m.content || m.error).map(({ role, content, error, meta }) => ({ role, content, ...(error ? { error } : {}), ...(meta ? { meta } : {}) })),
      }));
    setChatId(id);
    persist(history);

    try {
      const res = await api("/api/chat", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          think: profile !== "fast",
          scope: scope ?? (profile === "deep" ? "all" : undefined),
          fileIds: ready.map((f) => f.serverId),
          messages: history.slice(-HISTORY).map(({ role, content }) => ({ role, content })),
        }),
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
  const current = chatId ? local.chats.find((c) => c.id === chatId) : undefined;

  /** A source chip from an answer → open that doc at that page/sheet in the side panel. */
  const openSource = (chip: string) => {
    const hit = parseSource(chip, ready.map((f) => f.name));
    const doc = hit && ready.find((f) => f.name === hit.doc);
    if (hit && doc?.serverId) setSource({ serverId: doc.serverId, label: hit.label });
  };

  const CONSISTENCY =
    "Dokümanı tutarlılık açısından incele: tablolardaki değerler, [Kod kontrolü] sonuçları ve sonuç/değerlendirme bölümü birbiriyle uyumlu mu? Bulguları sayfa numarasıyla madde madde listele; uyumsuzluk yoksa bunu açıkça söyle.";
  // Quick tasks (plan §3.2). All of them need the whole document.
  const suggestions: [label: string, prompt: string][] = [
    ["Özetle", "Dokümanın tamamını özetle: amacı ve kapsamı, ana bölümleri, temel bulguları ve sonuçları."],
    ...(ready.length > 1 ? [["Karşılaştır", "Dokümanları karşılaştır: ortak noktaları, farkları ve birbiriyle çelişen bilgileri dosya adı ve sayfa numarasıyla listele."] as [string, string]] : []),
    ["Rakamları kontrol et", hasReport ? CONSISTENCY : "Dokümandaki önemli rakamları (tutarlar, oranlar, toplamlar) dokümanda yazdığı gibi, konumlarıyla listele; birbiriyle tutarsız görünenleri ayrıca belirt."],
    ["Şartları çıkar", "Dokümandaki şartları, yükümlülükleri, süreleri ve koşulları madde madde, sayfa numaralarıyla çıkar."],
    ["Ana başlıklar", "Dokümanın ana başlıklarını ve bölümlerini sırayla, sayfa numaralarıyla listele."],
    ...(hasSheet ? [["Sütunları açıkla", "Tablolardaki sütunları ve ne anlama geldiklerini açıkla."] as [string, string]] : []),
  ];

  const composer = (
    <div className="w-full">
      <div className="rounded-2xl border border-line bg-panel shadow-card transition-colors focus-within:border-accent">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {files.map((f) => (
              <FileChip key={f.id} f={f} onOpen={() => f.serverId && setSource({ serverId: f.serverId })} onRemove={() => remove(f)} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 p-2">
          <button
            onClick={() => fileInput.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
            aria-label="Belge ekle"
            title="Belge ekle (PDF, DOCX, XLSX, CSV, TXT · en fazla 25 MB)"
          >
            <Paperclip size={18} />
          </button>
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
            aria-label="Soru"
            placeholder={ready.length ? "Belgeleriniz hakkında bir soru sorun…" : "Önce bir belge ekleyin"}
            disabled={!ready.length}
            className="field-sizing-content max-h-48 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] outline-none placeholder:text-muted disabled:cursor-not-allowed"
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
      </div>
      <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
    </div>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-semibold text-bg" aria-hidden>K</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight tracking-tight">Kurum AI</p>
          <p className="text-xs text-muted">Belge asistanı</p>
        </div>
        <button className="rounded-md p-1.5 text-muted hover:bg-subtle md:hidden" onClick={() => setDrawer(false)} aria-label="Menüyü kapat">
          <X size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-2 px-3">
        <button onClick={newChat} disabled={streaming} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40">
          <Plus size={16} /> Yeni sohbet
        </button>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-sm focus-within:border-accent">
          <Search size={14} className="shrink-0 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sohbetlerde ara" aria-label="Sohbetlerde ara" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
        </label>
      </div>

      <label className="mx-3 mt-2 flex items-center gap-2 text-xs text-muted sm:hidden">
        İşlem profili
        <select value={profile} onChange={(e) => chooseProfile(e.target.value as Profile)} className="h-8 flex-1 rounded-lg border border-line bg-panel px-2 text-sm text-fg">
          {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>

      <nav aria-label="Sohbet geçmişi" className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        <p className="px-2 pb-1 text-xs font-medium text-muted">Sohbetler</p>
        {!local.chats.length && <p className="px-2 py-1 text-xs text-muted">Henüz sohbet yok. Sorduğunuz sorular burada saklanır.</p>}
        <ul className="flex flex-col">
          {visibleChats.map((c) => (
            <li key={c.id} className={`group flex items-center rounded-md ${c.id === chatId ? "bg-accent-soft" : "hover:bg-subtle"}`}>
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
                <button
                  onClick={() => openChat(c)}
                  disabled={streaming}
                  aria-current={c.id === chatId ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed"
                >
                  {c.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Sabitlendi" />}
                  <span className="truncate" title={c.title}>{c.title}</span>
                </button>
              )}
              <span className="flex shrink-0 pr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton label={c.pinned ? "Sabitlemeyi kaldır" : "Sabitle"} onClick={() => local.patch(c.id, { pinned: !c.pinned })}>
                  {c.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </IconButton>
                <IconButton label="Yeniden adlandır" onClick={() => setRenaming(c.id)}><Pencil size={13} /></IconButton>
                <IconButton label="Sil" danger disabled={streaming && c.id === chatId} onClick={() => deleteChat(c)}><Trash2 size={13} /></IconButton>
              </span>
            </li>
          ))}
          {query && !visibleChats.length && <li className="px-2 py-1.5 text-xs text-muted">Eşleşen sohbet yok.</li>}
        </ul>
      </nav>

      <section aria-label="Belgelerim" className="border-t border-line px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Belgelerim</span>
          <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-subtle hover:text-fg">
            <Upload size={13} /> Ekle
          </button>
        </div>
        {!files.length ? (
          <button
            onClick={() => fileInput.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted transition-colors hover:border-accent hover:text-fg"
          >
            <Upload size={16} />
            <span>Dosya seçin ya da sürükleyin</span>
            <span>PDF, DOCX, XLSX, CSV, TXT · en fazla 25 MB</span>
          </button>
        ) : (
          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {files.map((f) => <DocCard key={f.id} f={f} active={!!f.serverId && source?.serverId === f.serverId} onOpen={() => f.serverId && setSource({ serverId: f.serverId })} onRemove={() => remove(f)} />)}
          </ul>
        )}
      </section>

      <details className="group border-t border-line px-3 py-2 text-xs text-muted">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 hover:text-fg">
          <HardDrive size={13} className="shrink-0" />
          <span className="flex-1">Yerel veri ve yedek</span>
          {local.storage?.usage !== undefined && <span>{fmtSize(local.storage.usage)}</span>}
          <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-1.5 pb-1 pt-1.5">
          <p>
            Sohbetler yalnızca bu tarayıcıda saklanır; cihazlar arası eşitleme yok.
            {local.storage && !local.storage.persisted && " Tarayıcı yer açmak için silebilir; düzenli yedek alın."}
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
          <p>Bağlam penceresi: {fmtNum(numCtx)} token</p>
        </div>
      </details>

      <div className="flex items-center gap-1 border-t border-line px-3 py-2.5 text-sm">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold uppercase text-accent" aria-hidden>{username.slice(0, 1)}</span>
        <span className="min-w-0 flex-1 truncate pl-1" title={username}>{username}</span>
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
      {drawer && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setDrawer(false)} />}
      {/* Closed drawer: invisible, so its controls leave the tab order. An open layer makes what's behind it inert. */}
      <aside
        inert={mobile && !!source}
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-line bg-side transition-transform md:static md:visible md:translate-x-0 ${drawer ? "translate-x-0" : "invisible -translate-x-full"}`}
      >
        {sidebar}
      </aside>

      <main inert={mobile && (drawer || !!source)} className="relative flex min-w-0 flex-1 flex-col bg-bg">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel/80 px-3 backdrop-blur md:px-4">
          <button className="rounded-md p-1.5 text-muted hover:bg-subtle md:hidden" onClick={() => setDrawer(true)} aria-label="Menüyü aç">
            <Menu size={18} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{current?.title ?? "Yeni sohbet"}</h1>
          <div role="radiogroup" aria-label="İşlem profili" className="hidden rounded-lg border border-line bg-subtle p-0.5 sm:flex">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={profile === p.id}
                title={p.hint}
                onClick={() => chooseProfile(p.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${profile === p.id ? "bg-panel text-fg shadow-card" : "text-muted hover:text-fg"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!models.length}
            className="h-8 max-w-40 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-accent disabled:opacity-60"
          >
            {!models.length && <option>{model || "Model yok"}</option>}
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
          <ThemeToggle />
        </header>

        {local.error && <Banner>{local.error}</Banner>}
        {!modelOk && <Banner>Model sunucusuna ulaşılamıyor. Yöneticinize bildirin.</Banner>}
        {ratio < 1 && (
          <Banner>
            Belgeler tek seferde bağlama sığmıyor. Belirli bir bilgiyi soran sorularda en ilgili bölümler aranıyor; özet gibi bütünü gerektiren sorularda (ya da Derin analiz profilinde) belge bölüm bölüm taranıyor.
          </Banner>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
            <div className="flex w-full max-w-2xl flex-col items-center gap-6">
              <div className="text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-brand">{greeting()}, {username}</h2>
                <p className="mt-2 text-sm text-muted">
                  {ready.length ? "Belgeleriniz hazır. Bir soru sorun ya da hazır işlerden birini seçin." : "Bir belge ekleyin; cevaplar yalnızca belgelerinize dayanır."}
                </p>
              </div>
              {composer}
              {ready.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map(([s, prompt]) => (
                    <button key={s} onClick={() => send(prompt, "all")} disabled={streaming} className="rounded-full border border-line bg-panel px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-fg">
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 rounded-xl border border-dashed border-line px-5 py-4 text-sm text-muted transition-colors hover:border-accent hover:text-fg">
                  <Upload size={18} /> Dosya seçin ya da buraya sürükleyin
                </button>
              )}
              <p className="max-w-md text-center text-xs text-muted">
                Kalıcı çalışma alanınız bu cihazda; AI işlemesi kurum sunucusunda yapılır. Belgeler harici bulut AI servisine gönderilmez.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
                {messages.map((m, i) => (
                  <Bubble key={i} m={m} live={streaming && i === messages.length - 1} onSource={openSource} />
                ))}
                <div ref={bottomRef} />
              </div>
            </div>
            <div className="mx-auto w-full max-w-3xl px-4 pb-3">
              {composer}
              <p className="mt-2 text-center text-xs text-muted">Enter gönder · Shift+Enter yeni satır · Esc durdur</p>
            </div>
          </>
        )}

        {local.pendingDelete && (
          <div role="status" className="absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-fg px-4 py-2 text-sm text-bg shadow-card">
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

      {source && <SourcePanel key={`${source.serverId}:${source.label ?? ""}`} serverId={source.serverId} label={source.label} onClose={() => setSource(null)} />}
    </div>
  );
}

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function IconButton({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`rounded p-1 text-muted disabled:opacity-40 ${danger ? "hover:text-danger" : "hover:text-fg"}`} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function FileChip({ f, onOpen, onRemove }: { f: Card; onOpen: () => void; onRemove: () => void }) {
  const Icon = ICONS[f.kind];
  return (
    <span className={`flex max-w-56 items-center gap-1.5 rounded-lg border py-1 pl-2 pr-1 text-xs ${f.status === "error" ? "border-danger/40 text-danger" : "border-line bg-subtle"}`}>
      {f.status === "uploading" ? <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Okunuyor" /> : <Icon size={13} className="shrink-0 text-accent" />}
      <button onClick={onOpen} disabled={f.status !== "ready"} className="truncate disabled:cursor-default" title={f.status === "ready" ? `${f.name} — kaynak panelinde aç` : f.error ?? f.name}>
        {f.name}
      </button>
      <button onClick={onRemove} className="rounded p-0.5 text-muted hover:text-fg" aria-label={`${f.name} kaldır`}>
        <X size={12} />
      </button>
    </span>
  );
}

function DocCard({ f, active, onOpen, onRemove }: { f: Card; active: boolean; onOpen: () => void; onRemove: () => void }) {
  const Icon = ICONS[f.kind];
  const details = [
    fmtSize(f.size),
    f.pages && `${fmtNum(f.pages)} sayfa`,
    f.sheets && `${f.sheets} sheet`,
    f.rows && f.kind !== "pdf" && `${fmtNum(f.rows)} satır`,
    f.verify && `${f.verify.tables} tablo çift okundu`,
  ].filter(Boolean);
  const pct = f.progress ? Math.round((f.progress.done / f.progress.total) * 100) : 0;
  return (
    <li className={`relative overflow-hidden rounded-lg border bg-panel p-2.5 ${active ? "border-accent" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <Icon size={16} className={f.status === "error" ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-accent"} />
        <button onClick={onOpen} disabled={f.status !== "ready"} className="min-w-0 flex-1 text-left disabled:cursor-default">
          <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
          <p className="mt-0.5 text-xs text-muted">{f.status === "uploading" ? (f.progress ? `${f.progress.stage} · ${f.progress.done}/${f.progress.total}` : "Okunuyor…") : details.join(" · ")}</p>
        </button>
        <button onClick={onRemove} className="shrink-0 rounded p-0.5 text-muted hover:bg-subtle hover:text-fg" aria-label={`${f.name} kaldır`}>
          <X size={14} />
        </button>
      </div>
      {f.error && <p className="mt-1 text-xs text-danger">{f.error}</p>}
      {f.verify && f.verify.uncertain > 0 && (
        <p className="mt-1 text-xs text-warn-fg">{fmtNum(f.verify.uncertain)} / {fmtNum(f.verify.numbers)} tablo sayısında iki okuma uyuşmadı; bunlar (?) ile işaretli.</p>
      )}
      {f.warning && <p className="mt-1 text-xs text-warn-fg">{f.warning}</p>}
      {f.status === "uploading" && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-subtle">
          {f.progress ? <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} /> : <div className="progress-bar h-full w-2/5 bg-accent" />}
        </div>
      )}
    </li>
  );
}

// Answers and document text both render model/document content: no images, no outbound links (audit N1).
const mdComponents: Components = {
  table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
  // Never load images a model answer points to: a URL can carry document text off-site (audit N1). CSP blocks them too.
  img: ({ alt }) => <span className="text-muted">[görsel: {alt || "adsız"}]</span>,
  // External links aren't clickable either: a click would hand the URL (and anything the model put in it) to that site.
  a: ({ href, children }) =>
    // Only in-page anchors stay links. Paths don't: a backslash path like /\host resolves to another site in browsers.
    href && /^#[^\\]*$/.test(href) ? (
      <a href={href}>{children}</a>
    ) : (
      <span title={href}>{children} <span className="text-xs text-muted">(dış bağlantı devre dışı)</span></span>
    ),
};

/** Right panel (plan §3.1): the extracted text of one document, by page/sheet, scrolled to the cited section. */
function SourcePanel({ serverId, label, onClose }: { serverId: string; label?: string; onClose: () => void }) {
  const [doc, setDoc] = useState<{ name: string; sections: DocSection[] } | "error" | null>(null);
  const target = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // Full-screen on phones: focus moves into the panel (and Esc / the close button bring it back out).
  useEffect(() => {
    // Focus goes back to whatever opened the panel (a source chip, a document card) when it closes.
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    api(`/api/upload?id=${serverId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setDoc, () => setDoc("error"));
  }, [serverId]);
  useEffect(() => {
    target.current?.scrollIntoView({ block: "start" });
  }, [doc]);

  return (
    <aside aria-label="Kaynak" className="fixed inset-0 z-50 flex flex-col bg-panel md:static md:z-auto md:w-[28rem] md:border-l md:border-line">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <BookOpen size={16} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc && doc !== "error" ? doc.name : "Kaynak"}</p>
          {label && <p className="text-xs text-muted">{label}</p>}
        </div>
        <button ref={close} onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Kaynak panelini kapat (Esc)" title="Kapat (Esc)">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {doc === null && (
          <div className="flex flex-col gap-2" aria-label="Yükleniyor">
            {[80, 95, 60, 90].map((w) => <div key={w} className="h-3 animate-pulse rounded bg-subtle" style={{ width: `${w}%` }} />)}
          </div>
        )}
        {doc === "error" && <p className="text-sm text-danger">Belge açılamadı. Silinmiş olabilir.</p>}
        {doc && doc !== "error" && (
          <div className="flex flex-col gap-5">
            <p className="text-xs text-muted">Belgeden çıkarılan metin. Tablolar ve taranmış sayfalar orijinalinden farklı görünebilir; kesin değer için asıl belgeye bakın.</p>
            {doc.sections.map((s, i) => {
              const hit = !!label && s.label === label;
              return (
                <section key={i} ref={hit ? target : undefined} className={`scroll-mt-4 rounded-lg ${hit ? "bg-accent-soft p-3 ring-1 ring-accent" : ""}`}>
                  {s.label && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</h3>}
                  {/* pre-line: plain-text documents keep their line breaks */}
                  <div className="md whitespace-pre-line text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{s.text}</ReactMarkdown>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function Bubble({ m, live, onSource }: { m: Message; live: boolean; onSource: (chip: string) => void }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-fg">{m.content}</div>;
  }
  if (m.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-panel px-4 py-3 text-sm text-danger">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{m.content}</span>
      </div>
    );
  }
  return (
    <div className="group">
      {live && !m.content && (
        <p className="mb-2 flex items-center gap-2 text-sm text-muted" role="status">
          <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
          {m.status ?? "Cevap hazırlanıyor…"}
        </p>
      )}
      <div className={`md ${live ? "streaming" : ""}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content}</ReactMarkdown>
      </div>
      {!live && m.meta && <MetaNotes meta={m.meta} onSource={onSource} />}
      {!live && m.content && (
        <button
          onClick={() => navigator.clipboard.writeText(m.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted opacity-70 hover:bg-subtle hover:text-fg group-hover:opacity-100"
        >
          {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />} {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      )}
    </div>
  );
}

function MetaNotes({ meta, onSource }: { meta: ChatMeta; onSource: (chip: string) => void }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 text-muted">
        <span>{meta.mode === "rag" ? "Kullanılan bölümler:" : meta.mode === "scan" ? "Taranan bölümler:" : "Kaynak:"}</span>
        {meta.sources.map((s) => (
          <button key={s} onClick={() => onSource(s)} className="rounded-md border border-line bg-panel px-1.5 py-0.5 hover:border-accent hover:text-fg" title="Kaynak panelinde aç">
            {s}
          </button>
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
