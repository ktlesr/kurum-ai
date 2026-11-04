"use client";

import { ProfilePicker, type Profile } from "./profile-picker";
import { TopLinks } from "./top-links";
import { Fragment, isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle, ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, Copy, Download, File as FileIcon, FileInput, FileSpreadsheet, FileText,
  FileType, HardDrive, Image as ImageIcon, KeyRound, LogOut, Menu, Paperclip, Pencil, Pin, PinOff, Plus, Search, Square, Trash2, Upload, X,
} from "lucide-react";
import { InstallApp } from "./install-app";
import { ThemeToggle } from "./theme-toggle";
import { logout } from "./login/actions";
import { useChats } from "./use-chats";
import { contextRatio, ERROR_SEP, linkPages, META_SEP, parseSource, plainNumbering, STATUS_SEP, type ChatMeta, type DocSection } from "@/lib/context";
import { keepMessages, searchChats, titleFrom, type GalleryPhoto, type Message, type StoredChat } from "@/lib/local-store";
import { asksMorePhotos, asksPhotos, clarifies, namesPhotos } from "@/lib/gallery-intent";
import { countOf } from "@/lib/gallery-search";
import { GalleryGrid } from "./gallery-view";
import { FILE_FORMATS, exportDoc, turnOf, type ExportDoc } from "@/lib/export-doc";
import { exportRequest } from "@/lib/export-intent";
import { asksTemplateFill } from "@/lib/template-intent";
import { TemplatePanel } from "./template-panel";
import { DownloadMenu, FileCards } from "./export-ui";
import type { DocKind, DocMeta } from "@/lib/server";
import { LibraryPanel, type LibItem } from "./library";
import { BetaBadge, Logo } from "./logo";


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
 * No reasoning in any of them: Gemma 4 on vLLM with thinking on and a document gave repeating, garbled text (2026-10-30).
 * auto = the server decides between whole-doc and search; fast = a too-large document is always searched (no classifier
 * call) except for quick tasks, which always need it whole; deep = always the whole document.
 */

const MAX_CHAT_DOCS = 20; // LIMITS.files in lib/validate
const ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.html,.htm,.png,.jpg,.jpeg,.webp";
const MAX_BYTES = 25 * 1024 * 1024;
const ICONS = { pdf: FileText, docx: FileType, sheet: FileSpreadsheet, text: FileIcon, image: ImageIcon } as const;
// A screenshot or photo is stored as text (what the vision model read), but its card still shows it's an image.
const iconKey = (f: { name: string; kind: DocKind }) => (/\.(png|jpe?g|webp)$/i.test(f.name) ? "image" : f.kind);

const kindOf = (name: string): DocKind => {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "sheet";
  return "text";
};
const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
// The server keeps as much of these as fits beside the documents (lib/context fitHistory, at most 40); the request
// takes up to 200 messages.
const HISTORY = 40;
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

// A shared document's name on the server is its path (lib/library): source links match cards by name.
const cardOf = (it: Pick<LibItem, "id" | "name" | "size" | "kind"> & Partial<LibItem>): Card => ({ id: it.id, serverId: it.id, name: it.path && it.id.startsWith("s-") ? it.path.replace(/["<>]/g, "") : it.name, size: it.size, kind: it.kind as DocKind, status: "ready", warning: it.warning, verify: it.verify });
/** The documents a saved chat used, those still in the library. */
const cardsOf = (docIds: string[] | undefined, lib: LibItem[]) =>
  (docIds ?? []).flatMap((id) => {
    const it = lib.find((x) => x.id === id);
    return it ? [cardOf(it)] : [];
  });

export default function Chat({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const [files, setFiles] = useState<Card[]>([]);
  const [shared, setShared] = useState<LibItem[]>([]);
  const [personal, setPersonal] = useState<LibItem[]>([]);
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
  const uploadedFiles = useRef(new Map<string, File>());
  const [templateOpen, setTemplateOpen] = useState<{ instruction: string } | null>(null);
  const [sharedDown, setSharedDown] = useState(false);
  const streamingRef = useRef(false);
  const chatIdRef = useRef<string | null>(null);
  const libRef = useRef<LibItem[]>([]);
  const [pendingDocs, setPendingDocs] = useState<string[]>([]); // a saved chat's documents the library hasn't listed
  const [libOk, setLibOk] = useState(false); // the library was listed once
  const docsWait = pendingDocs.length > 0 && !libOk; // sending now would lose that chat's documents
  useEffect(() => { streamingRef.current = streaming; chatIdRef.current = chatId; libRef.current = [...shared, ...personal]; });
  const local = useChats(username, async (id) => {
    // Another tab changed the open chat: show its version unless this tab is mid-answer.
    if (id !== chatIdRef.current || streamingRef.current) return;
    const c = await local.get(id);
    if (c) {
      setMessages(c.messages);
      setFiles((fs) => [...fs.filter((f) => !f.serverId), ...cardsOf(c.docIds, libRef.current)]);
      setPendingDocs((c.docIds ?? []).filter((d) => !libRef.current.some((x) => x.id === d)));
    } else { setChatId(null); setMessages([]); }
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

  // The library (side menu): listed only. `files` holds what this chat uses; a chat starts with nothing.
  useEffect(() => {
    const lib = [...shared, ...personal];
    const found = cardsOf(pendingDocs, lib);
    if (!found.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the library arrived after the chat was opened
    setPendingDocs((p) => p.filter((d) => !lib.some((x) => x.id === d)));
    setFiles((fs) => [...fs, ...found.filter((c) => !fs.some((f) => f.serverId === c.serverId))].slice(0, MAX_CHAT_DOCS));
  }, [shared, personal, pendingDocs]);
  const libText = useRef({ shared: "", personal: "" });
  const refreshLibrary = useCallback(() => {
    // A failed request keeps the list as it is; the next round tries again.
    const a = api("/api/library").then(async (r) => {
      if (r.ok) setSharedDown(r.headers.get("X-Library-Status") === "down");
      if (!r.ok) return false;
      // The same list every 15 s: not set again, so the panel and its tree aren't rebuilt for nothing.
      const text = await r.text();
      if (text !== libText.current.shared) {
        libText.current.shared = text;
        setShared(JSON.parse(text));
      }
      return true;
    }).catch(() => false);
    const b = api("/api/upload")
      .then(async (r) => {
        if (!r.ok) return false;
        const text = await r.text();
        if (text !== libText.current.personal) {
          libText.current.personal = text;
          setPersonal((JSON.parse(text) as DocMeta[]).map((d) => ({ id: d.id, name: d.name, size: d.size, kind: d.kind, path: `${d.folder ? `${d.folder}/` : ""}${d.name}`, warning: d.warning, verify: d.verify })));
        }
        return true;
      })
      .catch(() => false);
    Promise.all([a, b]).then(([x, y]) => { if (x && y) setLibOk(true); });
  }, []);
  useEffect(() => {
    refreshLibrary();
    const t = setInterval(() => { if (!document.hidden) refreshLibrary(); }, 15_000);
    return () => clearInterval(t);
  }, [refreshLibrary]);

  // Follow the conversation down only while the reader is at its end: someone who scrolled up to read stays there.
  const stick = useRef(true);
  useEffect(() => {
    stick.current = true; // another chat opened: start at its end
  }, [chatId]);
  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: "end" });
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
    let room = MAX_CHAT_DOCS - files.filter((c) => c.status !== "error").length;
    for (const f of Array.from(list)) {
      const tmp: Card = { id: crypto.randomUUID(), name: f.name, size: f.size, kind: kindOf(f.name), status: "uploading" };
      const patch = (p: Partial<Card>) => setFiles((fs) => fs.map((x) => (x.id === tmp.id ? { ...x, ...p } : x)));
      setFiles((fs) => [...fs, tmp]);
      if (f.size > MAX_BYTES) {
        patch({ status: "error", error: "Dosya 25 MB sınırını aşıyor." });
        continue;
      }
      if (room-- <= 0) {
        patch({ status: "error", error: `Bir sohbette en fazla ${MAX_CHAT_DOCS} belge kullanılabilir.` });
        continue;
      }
      const body = new FormData();
      body.append("file", f);
      uploadedFiles.current.set(tmp.id, f); // this page's copy: a blank form is filled from its own bytes, which the server doesn't keep
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
            else if (ev.type === "done") {
              patch({ ...ev.doc, id: tmp.id, serverId: ev.doc.id, status: "ready", progress: undefined });
              refreshLibrary();
            }
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

  /** Out of this chat; the document stays in the library. An upload still running is cancelled. */
  const remove = (c: Card) => {
    setFiles((fs) => fs.filter((x) => x.id !== c.id));
    uploads.current.get(c.id)?.abort();
  };
  const attachedIds = useMemo(() => new Set(files.flatMap((f) => (f.serverId ? [f.serverId] : []))), [files]);
  const toggleDocs = (items: LibItem[], on: boolean) =>
    setFiles((fs) => {
      if (!on) {
        const out = new Set(items.map((i) => i.id));
        return fs.filter((f) => !f.serverId || !out.has(f.serverId));
      }
      const have = new Set(fs.map((f) => f.serverId));
      return [...fs, ...items.filter((i) => !have.has(i.id)).map(cardOf)].slice(0, MAX_CHAT_DOCS);
    });
  const deleteDoc = (id: string) => {
    setFiles((fs) => fs.filter((f) => f.serverId !== id));
    if (source?.serverId === id) setSource(null);
    api(`/api/upload?id=${id}`, { method: "DELETE" }).finally(refreshLibrary);
  };
  const moveDoc = (id: string, folder: string) => {
    api(`/api/upload?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) }).finally(refreshLibrary);
  };

  const ready = files.filter((f) => f.status === "ready");
  const ratio = contextRatio(ready.reduce((n, f) => n + (f.chars ?? 0), 0), numCtx, cpt[model]);
  const hasSheet = ready.some((f) => f.kind === "sheet");
  const hasReport = ready.some((f) => f.kind === "pdf" || f.kind === "docx");

  /** scope "all": the question needs the whole document (summaries etc.), so a too-large doc is scanned, not searched. */
  const send = async (text: string, scope?: "all", editOf?: number) => {
    const q = text.trim();
    if (!q || streaming || docsWait) return;
    // One's own request, whatever it turns into (an answer, a gallery, a file): what comes back is followed.
    stick.current = true;
    // Filling a form needs the form's own file, not an answer: the panel takes over, with the words as the request.
    if (editOf === undefined && asksTemplateFill(q)) {
      setTemplateOpen({ instruction: q });
      setInput("");
      return;
    }
    // An edited question replaces itself and everything after it.
    const earlier = keepMessages(messages.slice(0, editOf), (m) => !m.error);
    const history: Message[] = [...earlier, { role: "user", content: q, at: Date.now() }];
    // Photos from the archive: found by the server from names and what it saw, so no model is needed and nothing can be made up.
    const lastPhotos = earlier.findLast((m) => m.gallery)?.gallery;
    const morePhotos = !!lastPhotos && asksMorePhotos(q);
    // Photos only named ("… fotoğrafları") count too while no document is in the chat to be asked about instead.
    if (editOf === undefined && (morePhotos || asksPhotos(q) || (!ready.length && namesPhotos(q)))) {
      // "Galeride demek istedim": this says where to look; what to look for is the question before it.
      const before = earlier.findLast((m) => m.role === "user")?.content;
      const query = morePhotos ? lastPhotos.query : clarifies(q) && before ? before : q;
      const n = countOf(q);
      const offset = morePhotos ? lastPhotos.shown : 0;
      const id = chatId ?? crypto.randomUUID();
      const asked: Message = { ...history[history.length - 1], local: true };
      const save = (all: Message[]) => {
        setMessages(all);
        local.upsert(id, (cur) => ({
          ...(cur ?? { id, createdAt: Date.now(), title: titleFrom(q) }),
          updatedAt: Date.now(), model, docIds: ready.map((f) => f.serverId!).filter(Boolean),
          messages: all.map(stored),
        }));
      };
      setChatId(id);
      setInput("");
      setMessages([...earlier, asked, { role: "assistant", content: "", status: "Galeride aranıyor…", startedAt: Date.now(), local: true }]);
      // Like any answer: nothing else starts meanwhile, and leaving the chat or pressing stop ends it.
      setStreaming(true);
      const ac = new AbortController();
      abortRef.current = ac;
      let reply: Message;
      try {
        const r = await api(`/api/gallery?${new URLSearchParams({ q: query, n: String(n), offset: String(offset) })}`, { signal: ac.signal });
        if (!r.ok) throw new Error();
        const j = (await r.json()) as { total: number; folder?: string; items: GalleryPhoto[]; near?: string[]; down?: boolean };
        const shown = offset + j.items.length;
        const away = j.down ? "\n\nGaleri klasörüne şu an ulaşılamıyor, son bilinen liste kullanıldı." : "";
        reply = j.items.length
          ? {
              role: "assistant",
              local: true,
              content: `${j.folder ? `**${j.folder}** klasörü ve eşleşen diğer yerlerde` : "Galeride"} ${fmtNum(j.total)} sonuç bulundu, ${offset ? `${offset + 1}-${shown} arası` : `${fmtNum(j.items.length)} tanesi`} gösteriliyor.${shown < j.total ? ` Devamı için "${Math.min(n, j.total - shown)} tane daha" yazın.` : ""}${away}`,
              gallery: { query, shown, total: j.total, items: j.items },
            }
          : {
              role: "assistant",
              local: true,
              content: `${morePhotos ? "Gösterilecek başka sonuç kalmadı." : "Galeride bu istekle eşleşen fotoğraf ya da video bulunamadı."}${j.near?.length ? `\n\nBenzer klasörler:\n${j.near.map((d) => `- ${d}`).join("\n")}` : ""}${away}`,
            };
      } catch {
        reply = { role: "assistant", content: "Galeriye ulaşılamadı. Biraz sonra tekrar deneyin.", local: true };
      }
      setStreaming(false);
      abortRef.current = null;
      save(ac.signal.aborted ? [...earlier, asked] : [...earlier, asked, reply]);
      return;
    }
    const wish = exportRequest(q);
    // Only a file of the answer before it: no model has anything to do here, so it works when the model is busy or down too.
    if (wish && !wish.rest) {
      const of = earlier.findLastIndex((m) => m.role === "assistant" && !m.local && m.content.trim());
      const names = wish.formats.map((f) => FILE_FORMATS[f].label).join(", ");
      const reply: Message = of < 0
        ? { role: "assistant", content: `${names} dosyası hazırlamak için önce bir cevap gerekiyor. Sorunuzu yazın, sonuna da "${FILE_FORMATS[wish.formats[0]].label} olarak ver" ekleyin.`, local: true }
        : { role: "assistant", content: `Son cevabınız ${names} dosyası olarak hazır:`, files: wish.formats, fileOf: of, local: true };
      const asked: Message = { ...history[history.length - 1], local: true };
      const id = chatId ?? crypto.randomUUID();
      const all = [...earlier, asked, reply];
      setChatId(id);
      setInput("");
      setMessages(all);
      local.upsert(id, (cur) => ({
        ...(cur ?? { id, createdAt: Date.now(), title: titleFrom(q) }),
        updatedAt: Date.now(), model, docIds: ready.map((f) => f.serverId!).filter(Boolean),
        messages: all.map(stored),
      }));
      return;
    }
    const t0 = Date.now();
    const secs = () => Math.round((Date.now() - t0) / 1000);
    let first: number | undefined;
    setMessages([...history, { role: "assistant", content: "", startedAt: t0 }]);
    setInput("");
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let last: Message = { role: "assistant", content: "", startedAt: t0 };
    const setLast = (fn: (m: Message) => Message) => {
      last = fn(last);
      const m = last;
      setMessages((ms) => [...ms.slice(0, -1), m]);
    };
    // Saved before the answer starts (a closed tab keeps the question) and again when it ends.
    // Read-modify-write: a rename or pin made while the answer streams (or in another tab) is kept.
    const id = chatId ?? crypto.randomUUID();
    let docIds = ready.map((f) => f.serverId!).filter(Boolean);
    const persist = (msgs: Message[]) =>
      local.upsert(id, (cur) => ({
        ...(cur ?? { id, createdAt: Date.now(), title: titleFrom(q) }),
        updatedAt: Date.now(), model, docIds,
        messages: keepMessages(msgs, (m) => !!(m.content || m.error)).map(stored),
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
          think: false,
          scope: scope ?? (profile === "deep" ? "all" : profile === "fast" ? "part" : undefined),
          fileIds: ready.map((f) => f.serverId),
          // Without the words about the file (the search and the documents go by the question), and without turns that were only that.
          messages: history.filter((m) => !m.local).slice(-HISTORY).map(({ role, content }, i, all) => ({ role, content: wish && i === all.length - 1 ? wish.rest : content })),
          ...(wish ? { fileFormats: wish.formats } : {}),
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
      // The screen follows the stream once per frame, not once per network piece: each update re-reads the whole answer
      // and re-renders its Markdown, and done per piece it made long answers crawl and the page stutter (seen live).
      // A long answer's Markdown takes longer to draw than a frame: it is drawn less often as it grows (at most every
      // 400 ms past 16k characters), so the page and the text box stay responsive while it streams.
      let frame = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let shownAt = 0;
      const schedule = () => {
        if (frame || timer !== undefined) return;
        const wait = Math.max(0, shownAt + Math.min(400, raw.length / 40) - Date.now());
        timer = setTimeout(() => {
          timer = undefined;
          frame = requestAnimationFrame(show);
        }, wait);
      };
      const show = () => {
        frame = 0;
        shownAt = Date.now();
        // Progress lines (STATUS_SEP…STATUS_SEP) are shown while waiting and never become part of the answer.
        const body = raw.split(META_SEP)[0].split(ERROR_SEP)[0];
        const statuses = body.match(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"));
        // The split: a status line cut in two by the network, its other half not here yet.
        const content = body.replace(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"), "").split(STATUS_SEP)[0];
        const status = statuses ? statuses[statuses.length - 1].slice(1, -1) : undefined;
        // After text has begun, a status counts only while nothing has followed it: work between two parts of the answer.
        setLast((m) => ({ ...m, content, status, waiting: body.endsWith(STATUS_SEP) }));
      };
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += value;
          if (first === undefined && /[^\s]/u.test(raw.split(META_SEP)[0].split(ERROR_SEP)[0].replace(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"), "").split(STATUS_SEP)[0])) first = secs();
          schedule();
        }
      } finally {
        // The last pieces are on screen before the answer is closed (and a stopped one shows what had come).
        // Nothing pending is left to write into this turn (or, after a stop, into another chat).
        clearTimeout(timer);
        if (frame) cancelAnimationFrame(frame);
        show();
      }
      // A failure mid-answer: show it as an error turn, which also keeps it out of the next request's history.
      const failure = raw.split(ERROR_SEP)[1];
      if (failure !== undefined) return setLast(() => ({ role: "assistant", content: failure, error: true }));
      const [, metaJson] = raw.split(META_SEP);
      if (metaJson) {
        const parsedMeta = JSON.parse(metaJson) as ChatMeta;
        setLast((m) => ({ ...m, meta: parsedMeta }));
        // Documents the message asked for stay with this chat for the follow-up questions.
        if (parsedMeta.used?.length) {
          docIds = parsedMeta.used.map((u) => u.id);
          setFiles((fs) => [...fs, ...parsedMeta.used!.filter((u) => !fs.some((f) => f.serverId === u.id)).map(cardOf)].slice(0, MAX_CHAT_DOCS));
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setLast(() => ({ role: "assistant", content: "Bağlantı koptu. Lütfen tekrar deneyin.", error: true }));
        checkModels();
      }
    } finally {
      if (!last.error) setLast((m) => ({ ...m, startedAt: undefined, timing: { first, total: secs() }, ...(wish && m.content.trim() ? { files: wish.formats } : {}) }));
      setStreaming(false);
      abortRef.current = null;
      persist([...history, last]);
    }
  };

  const openChat = (c: StoredChat) => {
    if (streaming) return;
    setChatId(c.id);
    setMessages(c.messages);
    setFiles(cardsOf(c.docIds, [...shared, ...personal]));
    setPendingDocs((c.docIds ?? []).filter((d) => !shared.some((x) => x.id === d) && !personal.some((x) => x.id === d)));
    setDrawer(false);
  };
  const newChat = () => {
    if (streaming) return;
    setChatId(null);
    setMessages([]);
    setFiles([]);
    setPendingDocs([]);
    setDrawer(false);
  };
  const deleteChat = (c: StoredChat) => {
    if (c.id === chatId) newChat();
    local.remove(c);
  };
  // Every message of every chat is searched: only when the chats or the search change, not on each key in the box.
  const visibleChats = useMemo(() => searchChats(local.chats, query), [local.chats, query]);
  const current = chatId ? local.chats.find((c) => c.id === chatId) : undefined;

  /** A source chip from an answer → open that doc at that page/sheet in the side panel. */
  const openSource = (chip: string, docName?: string) => {
    const hit = parseSource(chip, ready.map((f) => f.name), docName);
    const doc = hit && ready.find((f) => f.name === hit.doc);
    if (hit && doc?.serverId) setSource({ serverId: doc.serverId, label: hit.label });
  };

  // Typing re-renders this component on every key. The answers (Markdown, tables) and the document panel are memo()ed
  // so they don't re-render with it (seen live: the box lagged as answers piled up); for that their handlers must keep
  // their identity across renders. They call the latest closures through this ref, set before paint (a click right after
  // an update sees it), and only ever from events: what a bubble shows comes from its props, never from here.
  const latest = useRef({ send, openSource, toggleDocs, deleteDoc, moveDoc });
  useLayoutEffect(() => {
    latest.current = { send, openSource, toggleDocs, deleteDoc, moveDoc };
  });
  const editAt = useCallback((i: number, text: string) => void latest.current.send(text, undefined, i), []);
  const sourceOf = useCallback((chip: string, docName?: string) => latest.current.openSource(chip, docName), []);
  const toggleStable = useCallback((items: LibItem[], on: boolean) => latest.current.toggleDocs(items, on), []);
  const deleteStable = useCallback((id: string) => latest.current.deleteDoc(id), []);
  const moveStable = useCallback((id: string, folder: string) => latest.current.moveDoc(id, folder), []);
  const openDoc = useCallback((id: string) => setSource({ serverId: id }), []);
  const closeSource = useCallback(() => setSource(null), []);
  // For each position, the question asked last before it: one pass per message list, not one search per bubble per key.
  const askedAt = useMemo(() => {
    let lastAsked: Message | undefined;
    return messages.map((m) => {
      const before = lastAsked;
      if (m.role === "user" && !m.local) lastAsked = m;
      return before;
    });
  }, [messages]);
  // A page's own copy of an uploaded file is kept for filling a form from it, while the file is in this chat only.
  useEffect(() => {
    for (const id of uploadedFiles.current.keys()) if (!files.some((f) => f.id === id)) uploadedFiles.current.delete(id);
  }, [files]);
  const pickFiles = useCallback(() => fileInput.current?.click(), []);

  // Column headers are the file names as they are: lib/checks checkColumns matches figures to documents by them.
  const compare = (names: string[]) =>
    `Dokümanları madde/kalem bazında karşılaştır (ör. tutarlar, oranlar, süreler, şartlar, yükümlülükler). Sonucu tek bir Markdown tablosu olarak ver; sütunlar tam olarak şunlar olsun: | Konu | ${names.join(" | ")} | Fark |. Her hücrede değeri dokümanda yazdığı gibi ve sayfa numarasıyla ver, ör. "1.500.000 TL (Sayfa 3)"; bir dokümanda o konu yoksa "yok" yaz. Tablodan sonra birbiriyle çelişen bilgileri ayrıca madde madde belirt.`;
  const CONSISTENCY =
    "Dokümanı tutarlılık açısından incele: tablolardaki değerler, [Kod kontrolü] sonuçları ve sonuç/değerlendirme bölümü birbiriyle uyumlu mu? Bulguları sayfa numarasıyla madde madde listele; uyumsuzluk yoksa bunu açıkça söyle.";
  // Quick tasks (plan §3.2). All of them need the whole document.
  const suggestions: [label: string, prompt: string][] = [
    ["Özetle", "Dokümanın tamamını özetle: amacı ve kapsamı, ana bölümleri, temel bulguları ve sonuçları."],
    ...(ready.length > 1 ? [["Karşılaştır", compare(ready.map((f) => f.name))] as [string, string]] : []),
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
            {files.map((f) => (
              <Fragment key={f.id}>
                {f.verify && f.verify.uncertain > 0 && <p className="w-full text-xs text-warn-fg">{f.name}: {fmtNum(f.verify.uncertain)} / {fmtNum(f.verify.numbers)} tablo sayısında iki okuma uyuşmadı; bunlar (?) ile işaretli.</p>}
                {f.warning && <p className="w-full text-xs text-warn-fg">{f.name}: {f.warning}</p>}
              </Fragment>
            ))}
          </div>
        )}
        <div className="p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              // A pasted screenshot is attached like an uploaded file (read by the local vision model); text pastes as usual.
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (!imgs.length) return;
              e.preventDefault();
              const stamp = new Date().toLocaleString("tr-TR").replace(/[^\d]+/g, "-");
              upload(imgs.map((f, i) => new File([f], `ekran-goruntusu-${stamp}${imgs.length > 1 ? `-${i + 1}` : ""}.${f.type === "image/jpeg" ? "jpg" : f.type === "image/webp" ? "webp" : "png"}`, { type: f.type })));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            aria-label="Soru"
            placeholder={ready.length ? "Belgeleriniz hakkında soru sorun, karşılaştırma ya da yorum isteyin…" : "Bir soru sorun ya da belge ekleyin…"}
            className="composer-input field-sizing-content max-h-48 min-h-9 w-full resize-none bg-transparent px-1.5 py-1.5 text-[15px] outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
          <div className="mt-1 flex items-center gap-1">
          <button
            onClick={() => fileInput.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
            aria-label="Belge ekle"
            title="Belge ya da görsel ekle (PDF, DOCX, XLSX, CSV, TXT, PNG, JPG · en fazla 25 MB) · ekran görüntüsü yapıştırılabilir"
          >
            <Paperclip size={18} />
          </button>
          <button
            onClick={() => setTemplateOpen({ instruction: "" })}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
            aria-label="Şablon doldur"
            title="Şablon doldur: boş Excel, Word, PDF ya da JSON şablonunuza belgelerdeki bilgileri aktarır"
          >
            <FileInput size={18} />
          </button>
            <span className="flex-1" />
            <ProfilePicker value={profile} onChange={chooseProfile} />
          {streaming ? (
            <button onClick={() => abortRef.current?.abort()} className="grid size-9 shrink-0 place-items-center rounded-lg bg-fg text-bg" aria-label="Durdur (Esc)" title="Durdur (Esc)">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || docsWait}
              title={docsWait ? "Sohbetin belgeleri yükleniyor…" : undefined}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg transition-opacity disabled:opacity-40"
              aria-label="Gönder"
            >
              <ArrowUp size={17} />
            </button>
          )}
          </div>
        </div>
      </div>
      <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
    </div>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Logo />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-tight">Zafer AI <BetaBadge /></p>
          <p className="text-xs text-muted">Kurum asistanı</p>
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

      <LibraryPanel shared={shared} sharedDown={sharedDown} personal={personal} attached={attachedIds} onToggle={toggleStable} onOpen={openDoc} onDelete={deleteStable} onMove={moveStable} onUpload={pickFiles} />

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

      <InstallApp />
      <div className="flex items-center gap-1 border-t border-line px-3 py-2.5 text-sm">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold uppercase text-accent" aria-hidden>{username.slice(0, 1)}</span>
        <span className="min-w-0 flex-1 truncate pl-1" title={username}>{username}</span>
        <Link href="/rehber" className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Kullanım rehberi" title="Kullanım rehberi">
          <CircleHelp size={16} />
        </Link>
        <Link href="/hesap" className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Parolayı değiştir" title="Parolayı değiştir">
          <KeyRound size={16} />
        </Link>
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
      {templateOpen && (
        <TemplatePanel
          docs={ready.flatMap((f) => (f.serverId ? [{ id: f.serverId, name: f.name, file: uploadedFiles.current.get(f.id) }] : []))}
          model={model}
          initialInstruction={templateOpen.instruction}
          api={api}
          onClose={() => setTemplateOpen(null)}
        />
      )}
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
          <TopLinks studio isAdmin={isAdmin} />
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
          {messages.some((m) => m.role === "assistant" && !m.local && !m.error && m.content.trim()) && !streaming && <DownloadMenu compact title="Tüm sohbeti dosya olarak indir" doc={() => chatDoc(messages, current?.title)} />}
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
                  {ready.length ? "Seçtiğiniz belgeler hazır. Bir soru sorun ya da hazır işlerden birini seçin." : "Bir soru sorun; gerektiğinde belgeleri inceleyip karşılaştırma ve değerlendirme yapabilirim."}
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
                <p className="max-w-md text-center text-sm text-muted">Belgelerden yararlanmak için yazmanız yeterli: “mevzuat klasöründeki kaynakları kullanarak özet hazırla”. Yan menüden de seçebilirsiniz.</p>
              )}
              <p className="max-w-md text-center text-xs text-muted">
                Kalıcı çalışma alanınız bu cihazda; AI işlemesi kurum sunucusunda yapılır. Belgeler harici bulut AI servisine gönderilmez.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto" onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}>
              <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
                {messages.map((m, i) => (
                  <Bubble key={i} index={i} m={m} fileReady={m.fileOf === undefined || messages[m.fileOf]?.role === "assistant"} live={streaming && i === messages.length - 1} busy={streaming || docsWait} onEditAt={editAt} onSource={sourceOf}
                    // What its file is made of, as props (the messages keep their identity, so memo still holds).
                    answer={messages[m.fileOf ?? i]} asked={askedAt[m.fileOf ?? i]} title={current?.title} />
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

      {source && <SourcePanel key={`${source.serverId}:${source.label ?? ""}`} serverId={source.serverId} label={source.label} onClose={closeSource} />}
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
  const Icon = ICONS[iconKey(f)];
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

// Answers and document text both render model/document content: no images, no outbound links (audit N1).
const mdComponents: Components = {
  table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
  // Never load images a model answer points to: a URL can carry document text off-site (audit N1). CSP blocks them too.
  img: ({ alt }) => <span className="text-muted">[görsel: {alt || "adsız"}]</span>,
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

/** A code block with its language and its own copy button; the bar stays in sight while a long block is scrolled. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const language = isValidElement<{ className?: string }>(children) ? children.props.className?.match(/language-(\S+)/)?.[1] : undefined;
  return (
    <div className="code-block">
      <div className="code-bar">
        <span className="min-w-0 truncate">{language ?? "Kod"}</span>
        {/* Markdown ends every block with a line break that isn't part of the code. */}
        <CopyButton text={() => (pre.current?.textContent ?? "").replace(/\n$/, "")} title="Kodu kopyala" className="shrink-0 hover:bg-line/60" />
      </div>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}

// External links aren't clickable either: a click would hand the URL (and anything the model put in it) to that site.
function SafeLink({ href, children }: { href?: string; children?: ReactNode }) {
  // Only in-page anchors stay links. Paths don't: a backslash path like /\host resolves to another site in browsers.
  return href && /^#[^\\]*$/.test(href) ? (
    <a href={href}>{children}</a>
  ) : (
    <span title={href}>{children} <span className="text-xs text-muted">(dış bağlantı devre dışı)</span></span>
  );
}

/** Right panel (plan §3.1): the extracted text of one document, by page/sheet, scrolled to the cited section. */
/** Beyond this many characters a section shows its start and a button for the rest (a workbook sheet can be thousands of rows). */
const SECTION_PREVIEW = 12_000;
const GFM = [remarkGfm];

/**
 * One section of the source panel, its Markdown rendered once (memo) and, when long, only its start until asked: a whole
 * workbook drawn as tables at once froze the page, and drawn again on every key typed in the chat box (seen live).
 */
const SourceSection = memo(function SourceSection({ s, hit, target }: { s: DocSection; hit: boolean; target?: React.Ref<HTMLElement> }) {
  const [all, setAll] = useState(hit);
  const content = useRef<HTMLDivElement>(null);
  const text = useMemo(() => plainNumbering(s.text), [s.text]);
  let cut = !all && text.length > SECTION_PREVIEW ? text.lastIndexOf("\n", SECTION_PREVIEW) : -1;
  // Not between a table's header row and its |---| row: the preview's table keeps its header.
  if (cut > 0 && /^\s*\|?\s*:?-{3,}/u.test(text.slice(cut + 1, text.indexOf("\n", cut + 1) >>> 0))) cut = text.lastIndexOf("\n", cut - 1);
  const shown = cut > 0 ? text.slice(0, cut) : text;
  const more = () => {
    setAll(true);
    // The button goes away: keyboard focus stays in this section rather than falling to the page's start.
    requestAnimationFrame(() => content.current?.focus({ preventScroll: true }));
  };
  return (
    <section ref={target} className={`scroll-mt-4 rounded-lg ${hit ? "bg-accent-soft p-3 ring-1 ring-accent" : ""}`}>
      {s.label && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</h3>}
      {/* pre-line: plain-text documents keep their line breaks */}
      <div ref={content} tabIndex={-1} className="md whitespace-pre-line text-sm outline-none">
        <ReactMarkdown remarkPlugins={GFM} components={mdComponents}>{shown}</ReactMarkdown>
      </div>
      {cut > 0 && (
        <button type="button" onClick={more} className="mt-2 text-xs text-accent underline underline-offset-2">
          Devamını göster ({text.slice(cut + 1).split("\n").length} satır daha)
        </button>
      )}
    </section>
  );
});

/** memo: the panel isn't drawn again on every key typed in the chat box. */
const SourcePanel = memo(function SourcePanel({ serverId, label, onClose }: { serverId: string; label?: string; onClose: () => void }) {
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
              return <SourceSection key={i} s={s} hit={hit} target={hit ? target : undefined} />;
            })}
          </div>
        )}
      </div>
    </aside>
  );
});

/** Seconds since `since`, ticking while shown (the wait before the first word). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{Math.max(0, Math.round((now - since) / 1000))} sn</span>;
}

const timeOf = (at: number) => {
  const d = new Date(at);
  const today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("tr-TR", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Also where the browser has no clipboard API (a page not on https) or refuses it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const focused = document.activeElement as HTMLElement | null;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
      focused?.focus();
    }
  }
}

function CopyButton({ text, title, className = "opacity-70 group-hover:opacity-100" }: { text: string | (() => string); title?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      title={title}
      onClick={async () => {
        const done = await copyText(typeof text === "string" ? text : text());
        setState(done ? "copied" : "failed");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), done ? 1500 : 3000);
      }}
      className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-subtle hover:text-fg ${className}`}
    >
      {state === "copied" ? <Check size={13} className="text-ok" /> : state === "failed" ? <AlertTriangle size={13} className="text-danger" /> : <Copy size={13} />}
      <span aria-live="polite">{state === "copied" ? "Kopyalandı" : state === "failed" ? "Kopyalanamadı" : "Kopyala"}</span>
    </button>
  );
}

function Question({ m, busy, onEdit }: { m: Message; busy: boolean; onEdit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (!draft?.trim() || busy) return;
    setDraft(null);
    onEdit(draft);
  };
  if (draft !== null) {
    return (
      <div className="ml-auto w-full max-w-[85%] rounded-2xl border border-line bg-panel p-3">
        <textarea
          autoFocus
          rows={Math.min(8, draft.split("\n").length + 1)}
          value={draft}
          aria-label="Soruyu düzenle"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
          }}
          className="w-full resize-y bg-transparent text-sm outline-none"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted">Bu sorudan sonraki mesajlar yeni cevapla değişir.</span>
          <button onClick={() => setDraft(null)} className="h-8 rounded-lg border border-line px-3 text-sm hover:bg-subtle">Vazgeç</button>
          <button onClick={save} disabled={!draft.trim() || busy} className="h-8 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">Gönder</button>
        </div>
      </div>
    );
  }
  return (
    <div className="group ml-auto flex max-w-[85%] flex-col items-end">
      <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-fg">{m.content}</div>
      <div className="mt-1 flex items-center gap-1">
        {m.at && <time dateTime={new Date(m.at).toISOString()} className="mr-1 text-xs tabular-nums text-muted">{timeOf(m.at)}</time>}
        <CopyButton text={m.content} />
        <button
          onClick={() => setDraft(m.content)}
          disabled={busy}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted opacity-70 hover:bg-subtle hover:text-fg disabled:opacity-40 group-hover:opacity-100"
        >
          <Pencil size={13} /> Düzenle
        </button>
      </div>
    </div>
  );
}

/** What a stored message keeps. */
const stored = ({ role, content, at, error, meta, timing, files, fileOf, local, gallery }: Message): Message => ({ role, content, ...(gallery ? { gallery } : {}), ...(at ? { at } : {}), ...(error ? { error } : {}), ...(meta ? { meta } : {}), ...(timing ? { timing } : {}), ...(files ? { files } : {}), ...(fileOf !== undefined ? { fileOf } : {}), ...(local ? { local } : {}) });
/** The question an answer at `i` replies to: the last one asked before it (not a local note). */
const askedBefore = (messages: Message[], i: number) => messages.slice(0, i).findLast((x) => x.role === "user" && !x.local);
const turnForAnswer = (m: Message | undefined, question: Message | undefined) =>
  // What was asked, without the words about the file.
  turnOf({ question: question && (exportRequest(question.content)?.rest || question.content), answer: m?.content ?? "", sources: m?.meta?.sources, web: m?.meta?.web, at: question?.at });
const turnFrom = (messages: Message[], i: number) => turnForAnswer(messages[i], askedBefore(messages, i));
/** The whole chat as a document: only what was asked and answered. */
const chatDoc = (messages: Message[], title?: string): ExportDoc =>
  exportDoc(
    messages.flatMap((m, i) => (m.role === "assistant" && !m.local && !m.error && m.content.trim() ? [turnFrom(messages, i)] : [])),
    // A chat begun with a request for a file is named after that; the document after what it is about.
    messages.find((m) => m.role === "user")?.local ? titleFrom(messages.find((m) => m.role === "user" && !m.local)?.content ?? "Sohbet") : (title ?? "Sohbet"),
  );

/** memo: re-rendered only when its own message or state changes, not on every key typed in the box. */
const Bubble = memo(function Bubble({ m, index, fileReady, live, busy, onEditAt, onSource, answer, asked, title }: { m: Message; index: number; fileReady: boolean; live: boolean; busy: boolean; onEditAt: (i: number, text: string) => void; onSource: (chip: string, doc?: string) => void; answer?: Message; asked?: Message; title?: string }) {
  const onEdit = useCallback((text: string) => onEditAt(index, text), [onEditAt, index]);
  // One answer as a document, from this render's props (the file card's name is made from it while rendering).
  const doc = useCallback((): ExportDoc => exportDoc([turnForAnswer(answer, asked)], title), [answer, asked, title]);
  // Only links made by linkPages (they carry this nonce) open the source panel.
  const [nonce] = useState(() => crypto.randomUUID().slice(0, 8));
  const pagePlugins = useMemo(() => [remarkGfm, linkPages(m.meta, nonce)], [m.meta, nonce]);
  const components = useMemo<Components>(() => ({
    ...mdComponents,
    a: (props) => {
      const page = props.href?.startsWith(`#sayfa-${nonce}-`) ? props.href.slice(`#sayfa-${nonce}-`.length) : undefined;
      // A page this answer read (listed under it) opens like the list's own links; any other address stays text.
      if (!page && props.href && m.meta?.web?.some((w) => w.url === props.href))
        return <a href={props.href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{props.children}</a>;
      if (!page) return <SafeLink href={props.href}>{props.children}</SafeLink>;
      return (
        <button type="button" onClick={() => onSource(`Sayfa ${page}`, m.meta?.doc)} className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid" title="Kaynak panelinde aç">
          {props.children}
        </button>
      );
    },
  }), [onSource, nonce, m.meta]);
  if (m.role === "user") {
    return <Question m={m} busy={busy} onEdit={onEdit} />;
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
      {live && !m.content.trim() && (
        <p className="mb-2 flex items-center gap-2 text-sm text-muted" role="status">
          <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
          {m.status ?? "Cevap hazırlanıyor…"}
          {m.startedAt && <Elapsed since={m.startedAt} />}
        </p>
      )}
      <div className={`md ${live ? "streaming" : ""}`}>
        <ReactMarkdown remarkPlugins={live ? [remarkGfm] : pagePlugins} components={live ? mdComponents : components}>{m.content}</ReactMarkdown>
      </div>
      {live && m.content.trim() && m.waiting && m.status && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted" role="status">
          <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
          {m.status}
        </p>
      )}
      {!live && m.meta && <MetaNotes meta={m.meta} onSource={onSource} />}
      {!live && !!m.files?.length && fileReady && <FileCards doc={doc} formats={m.files} />}
      {!!m.gallery?.items.length && <GalleryGrid items={m.gallery.items} />}
      {!live && m.content && !m.local && (
        <div className="mt-2 flex items-center gap-3">
          <CopyButton text={m.content} />
          <DownloadMenu doc={doc} />
          {m.timing && (
            <span className="text-xs tabular-nums text-muted" title="Soru gönderildikten sonra ilk kelimenin geldiği ve cevabın bittiği süre">
              {m.timing.first !== undefined && `İlk kelime ${m.timing.first} sn · `}Toplam {m.timing.total} sn
            </span>
          )}
        </div>
      )}
    </div>
  );
});

function MetaNotes({ meta, onSource }: { meta: ChatMeta; onSource: (chip: string, doc?: string) => void }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs">
      {meta.web && meta.web.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-muted">
          <span>Okunan sayfalar:</span>
          {meta.web.map((w) => (
            // The user's own links (http/https checked on the server and on restore), opened outside the app.
            <a key={w.url} href={w.url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line bg-panel px-1.5 py-0.5 hover:border-accent hover:text-fg" title={w.url}>
              {w.title || new URL(w.url).host}
            </a>
          ))}
        </div>
      )}
      {meta.sources.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-muted">
        <span>{meta.mode === "rag" ? "Kullanılan bölümler:" : meta.mode === "scan" ? "Taranan bölümler:" : "Kaynak:"}</span>
        {meta.sources.map((s) => (
          <button key={s} onClick={() => onSource(s, meta.doc)} className="rounded-md border border-line bg-panel px-1.5 py-0.5 hover:border-accent hover:text-fg" title="Kaynak panelinde aç">
            {s}
          </button>
        ))}
      </div>}
      {meta.note && <p className="text-warn-fg">{meta.note}</p>}
      {meta.unverified.length > 0 && (
        <p className="flex items-start gap-1.5 text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Belgelerde geçmeyen sayılar: {meta.unverified.join(", ")}. Genel bilgiden ya da hesaplamadan gelmiş olabilir; belgeye dayandırılıyorsa kontrol edin.</span>
        </p>
      )}
      {meta.calcWrong && meta.calcWrong.length > 0 && (
        <p className="flex items-start gap-1.5 text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Tutmayan hesap: {meta.calcWrong.join("; ")}. Yazılım işlemi yeniden yaptı.</span>
        </p>
      )}
      {!!meta.calcOk && !meta.calcWrong?.length && <p className="text-muted">Cevaptaki {meta.calcOk} hesap yazılımla yeniden yapıldı ve tuttu; girdi sayıları ayrıca belgede arandı.</p>}
      {meta.misplaced && meta.misplaced.length > 0 && (
        <p className="flex items-start gap-1.5 text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Yanlış belgeye yazılmış olabilecek değerler: {meta.misplaced.join("; ")}. Kontrol edin.</span>
        </p>
      )}
      {meta.badPages && meta.badPages.length > 0 && (
        <p className="flex items-start gap-1.5 text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Belgede olmayan sayfa referansı: {meta.badPages.join(", ")}. Model sayfa numarasını yanlış vermiş olabilir; kontrol edin.</span>
        </p>
      )}
      {meta.uncertain.length > 0 && (
        <p className="flex items-start gap-1.5 text-warn-fg">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Belirsiz okunan sayılar: {meta.uncertain.join(", ")}. İki okuma uyuşmadı; orijinal sayfadan doğrulayın.</span>
        </p>
      )}
      {meta.claims && meta.claims.length > 0 && <Claims claims={meta.claims} doc={meta.doc} onSource={onSource} />}
    </div>
  );
}

const CLAIM = {
  ok: { label: "Belgede eşleşen yer bulundu", cls: "text-ok", Icon: Check },
  weak: { label: "Kısmen eşleşti", cls: "text-warn-fg", Icon: AlertTriangle },
  none: { label: "Eşleşen yer bulunamadı", cls: "text-danger", Icon: AlertTriangle },
} as const;

/** Sentence by sentence: the page that says it (opens the source panel) and the quote, or that no page does. */
function Claims({ claims, doc, onSource }: { claims: NonNullable<ChatMeta["claims"]>; doc?: string; onSource: (chip: string, doc?: string) => void }) {
  const n = (st: keyof typeof CLAIM) => claims.filter((c) => c.status === st).length;
  const none = n("none");
  return (
    <details className="group rounded-lg border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-muted hover:text-fg">
        <ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" />
        <span className="font-medium text-fg">Cümle kaynakları</span>
        <span className="text-ok">{n("ok")} eşleşti</span>
        {n("weak") > 0 && <span className="text-warn-fg">· {n("weak")} kısmen</span>}
        {none > 0 && <span className="text-danger">· {none} eşleşmedi</span>}
      </summary>
      <ul className="space-y-1.5 border-t border-line px-2.5 py-2">
        {claims.map((c, i) => {
          const k = CLAIM[c.status];
          return (
            <li key={i} className="flex items-start gap-1.5">
              <k.Icon size={13} className={`mt-0.5 shrink-0 ${k.cls}`} aria-label={k.label} />
              <span className="min-w-0 flex-1">
                <span className={c.status === "none" ? "text-danger" : "text-fg"}>{c.text}</span>
                {c.source && (
                  <button onClick={() => onSource(c.source!, doc)} className="ml-1.5 rounded border border-line px-1 py-px text-[11px] text-muted hover:border-accent hover:text-fg" title="Kaynak panelinde aç">
                    {c.source}
                  </button>
                )}
                {c.quote && <span className="mt-0.5 block border-l-2 border-line pl-2 italic text-muted">“{c.quote}”</span>}
                {c.status === "none" && <span className="mt-0.5 block text-muted">Seçili belgelerde bu cümleyle eşleşen bir yer bulunamadı; genel bilgiden, hesaplamadan ya da yanlış okumadan gelmiş olabilir.</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-2.5 py-1.5 text-muted">Eşleştirme kelime ve sayı benzerliğine göre kodla yapılır; anlamı doğrulamaz. Önemli bilgileri gösterilen sayfadan kontrol edin.</p>
    </details>
  );
}
