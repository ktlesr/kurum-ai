"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle, ArrowUp, Check, Copy, File as FileIcon, FileSpreadsheet, FileText, FileType,
  Menu, Moon, Square, Sun, Upload, X,
} from "lucide-react";
import { contextRatio, META_SEP, STATUS_SEP, type ChatMeta } from "@/lib/context";
import type { DocKind, DocMeta } from "@/lib/server";

type Card = Partial<DocMeta> & {
  id: string; name: string; size: number; kind: DocKind; status: "uploading" | "ready" | "error"; error?: string;
  serverId?: string;
  progress?: { stage: string; done: number; total: number };
};
interface Message { role: "user" | "assistant"; content: string; error?: boolean; meta?: ChatMeta; status?: string }
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
const fmtNum = (n: number) => n.toLocaleString("tr-TR");

export default function Home() {
  const [files, setFiles] = useState<Card[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [think, setThink] = useState(true);
  const [numCtx, setNumCtx] = useState(16384);
  const [cpt, setCpt] = useState<Record<string, number>>({});
  const [ollamaOk, setOllamaOk] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());

  const checkOllama = useCallback(async () => {
    const r = (await fetch("/api/models").then((res) => res.json())) as {
      ok: boolean; models: string[]; defaultModel: string; numCtx: number; charsPerToken: Record<string, number>;
    };
    setOllamaOk(r.ok);
    setModels(r.models);
    setNumCtx(r.numCtx);
    setCpt(r.charsPerToken);
    setModel((cur) => cur || (r.models.includes(r.defaultModel) ? r.defaultModel : (r.models[0] ?? r.defaultModel)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch, then poll
    checkOllama();
    const t = setInterval(checkOllama, 15000);
    return () => clearInterval(t);
  }, [checkOllama]);

  // Files uploaded earlier are kept on the server; bring their cards back.
  useEffect(() => {
    fetch("/api/upload")
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
        const res = await fetch("/api/upload", { method: "POST", body, signal: ac.signal });
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
    if (c.serverId) fetch(`/api/upload?id=${c.serverId}`, { method: "DELETE" });
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
    const setLast = (fn: (m: Message) => Message) => setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, think, scope, fileIds: ready.map((f) => f.serverId), messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 503) setOllamaOk(false);
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
        const body = raw.split(META_SEP)[0];
        const statuses = body.match(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"));
        const content = body.replace(new RegExp(`${STATUS_SEP}[^${STATUS_SEP}]*${STATUS_SEP}`, "g"), "");
        const status = statuses ? statuses[statuses.length - 1].slice(1, -1) : undefined;
        setLast((m) => ({ ...m, content, status }));
      }
      const [, metaJson] = raw.split(META_SEP);
      if (metaJson) setLast((m) => ({ ...m, meta: JSON.parse(metaJson) as ChatMeta }));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setLast(() => ({ role: "assistant", content: "Bağlantı koptu. Ollama çalışıyor mu?", error: true }));
        checkOllama();
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

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
          <p className="text-xs text-muted">Yerel · veriler cihazdan çıkmaz</p>
        </div>
        <button className="rounded-md p-1.5 text-muted hover:bg-subtle md:hidden" onClick={() => setDrawer(false)} aria-label="Paneli kapat">
          <X size={18} />
        </button>
      </div>

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

      <p className="text-xs text-muted">Bağlam: {fmtNum(numCtx)} token</p>
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

        {!ollamaOk && (
          <div role="alert" className="flex items-center gap-2 border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
            <AlertTriangle size={16} className="shrink-0" />
            <span>Ollama çalışmıyor — <code className="font-mono">ollama serve</code> komutunu çalıştırın.</span>
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
                Cevaplar yalnızca yüklediğiniz dosyalara dayanır. Her şey bu bilgisayarda, Ollama üzerinde çalışır.
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
          components={{ table: ({ children }) => <div className="table-wrap"><table>{children}</table></div> }}
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

function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Temayı değiştir">
      <Sun size={17} className="hidden dark:block" />
      <Moon size={17} className="dark:hidden" />
    </button>
  );
}
