"use client";

// "Şablon doldur": a blank form of the user's, plus the documents of this chat. The values are shown for checking first: what the
// documents really say comes filled in with where it stands; what the model said but the documents don't, only as an offer.
import { AlertTriangle, Check, Download, FileInput, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Layout, Values } from "@/lib/template";
import type { Extraction, FoundValue } from "@/lib/template-extract";

export interface PanelDoc { id: string; name: string; file?: File }
type Stage = { step: "setup" } | { step: "reading"; text: string; done?: number; total?: number } | { step: "review" };

export const TEMPLATE_ACCEPT = ".xlsx,.docx,.pdf,.json";
const TEMPLATE_NAME = /(?:şablon|sablon|template|form|boş|bos)/iu;
const isTemplateFile = (n: string) => /\.(xlsx|docx|pdf|json)$/i.test(n);
const fieldCls = "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";

/** The file of this chat that looks like the blank one: named so, else none (the user picks). */
export const guessTemplate = (docs: PanelDoc[]) => docs.find((d) => d.file && isTemplateFile(d.name) && TEMPLATE_NAME.test(d.name));

function Offer({ f, onUse }: { f: FoundValue; onUse: (v: string) => void }) {
  if (!f.suggestion || f.value) return null;
  return (
    <button type="button" onClick={() => onUse(f.suggestion!)} title="Belgelerde aynen bulunamadı. Doğruysa yazmak için basın." className="mt-1 flex max-w-full items-center gap-1 rounded-md bg-warn-bg px-1.5 py-0.5 text-left text-xs text-warn-fg">
      <AlertTriangle size={12} className="shrink-0" /> <span className="truncate">Doğrulanamadı: {f.suggestion}</span>
    </button>
  );
}

export function TemplatePanel({ docs, model, initialInstruction, api, onClose }: {
  docs: PanelDoc[];
  model: string;
  initialInstruction: string;
  api: (input: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
}) {
  const guessed = guessTemplate(docs);
  const [template, setTemplate] = useState<{ file: File; docId?: string } | null>(guessed?.file ? { file: guessed.file, docId: guessed.id } : null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState(initialInstruction);
  const [stage, setStage] = useState<Stage>({ step: "setup" });
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<Layout | null>(null);
  const [found, setFound] = useState<Extraction | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const ac = useRef<AbortController | null>(null);
  const box = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = box.current;
    if (d && !d.open) d.showModal();
    return () => ac.current?.abort();
  }, []);

  const sources = docs.filter((d) => d.id !== template?.docId && !off.has(d.id));

  const start = async () => {
    if (!template) return;
    setError("");
    setStage({ step: "reading", text: "Şablon inceleniyor" });
    const body = new FormData();
    body.append("file", template.file);
    body.append("action", "read");
    body.append("model", model);
    body.append("instruction", instruction);
    body.append("fileIds", JSON.stringify(sources.map((d) => d.id)));
    const c = new AbortController();
    ac.current = c;
    try {
      const res = await api("/api/template", { method: "POST", body, signal: c.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Şablon okunamadı (${res.status}).`);
        return setStage({ step: "setup" });
      }
      let buf = "";
      let ended = false;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines.filter(Boolean)) {
          const ev = JSON.parse(l) as { type: "progress"; stage: string; done?: number; total?: number } | { type: "done"; layout: Layout; found: Extraction } | { type: "error"; error: string };
          if (ev.type === "progress") setStage({ step: "reading", text: ev.stage, done: ev.done, total: ev.total });
          else if (ev.type === "error") {
            ended = true;
            setError(ev.error);
            setStage({ step: "setup" });
          } else {
            ended = true;
            setLayout(ev.layout);
            setFound(ev.found);
            setNotes(ev.found.notes);
            setStage({ step: "review" });
          }
        }
      }
      if (!ended) {
        setError("Bağlantı kesildi. Tekrar deneyin.");
        setStage({ step: "setup" });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError("Sunucuya ulaşılamadı.");
      setStage({ step: "setup" });
    }
  };

  const setSlot = (id: string, value: string) => setFound((f) => f && { ...f, slots: { ...f.slots, [id]: { ...(f.slots[id] ?? {}), value } } });
  const setCell = (id: string, r: number, c: number, value: string) => setFound((f) => {
    if (!f) return f;
    const rows = (f.tables[id] ?? []).map((row, i) => (i === r ? row.map((x, j) => (j === c ? { ...x, value } : x)) : row));
    return { ...f, tables: { ...f.tables, [id]: rows } };
  });
  const addRow = (id: string, n: number) => setFound((f) => f && { ...f, tables: { ...f.tables, [id]: [...(f.tables[id] ?? []), Array.from({ length: n }, () => ({ value: "" }))] } });
  const dropRow = (id: string, r: number) => setFound((f) => f && { ...f, tables: { ...f.tables, [id]: (f.tables[id] ?? []).filter((_, i) => i !== r) } });

  const save = async () => {
    if (!template || !found) return;
    setSaving(true);
    setError("");
    setSaved(false);
    const values: Values = {
      slots: Object.fromEntries(Object.entries(found.slots).map(([k, v]) => [k, v.value])),
      tables: Object.fromEntries(Object.entries(found.tables).map(([k, rows]) => [k, rows.map((row) => row.map((c) => c.value))])),
    };
    const body = new FormData();
    body.append("file", template.file);
    body.append("action", "fill");
    body.append("values", JSON.stringify(values));
    try {
      const res = await api("/api/template", { method: "POST", body });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Şablon doldurulamadı.");
        return;
      }
      const said = JSON.parse(decodeURIComponent(res.headers.get("X-Template-Notes") ?? "%5B%5D")) as string[];
      setNotes([...found.notes, ...said]);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      const dot = template.file.name.lastIndexOf(".");
      a.href = url;
      a.download = `${template.file.name.slice(0, dot)} (dolu)${template.file.name.slice(dot)}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setSaved(true);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    ac.current?.abort();
    onClose();
  };
  const filled = found ? Object.values(found.slots).filter((s) => s.value.trim()).length : 0;
  const unproved = found ? [...Object.values(found.slots), ...Object.values(found.tables).flat(2)].filter((s) => s.suggestion && !s.value).length : 0;
  const rowCount = found ? Object.values(found.tables).reduce((n, t) => n + t.length, 0) : 0;
  const missing = layout && found ? layout.slots.filter((s) => !found.slots[s.id]).length : 0;

  return (
    <dialog ref={box} onCancel={(e) => { e.preventDefault(); close(); }} aria-label="Şablon doldur" className="m-auto w-[min(860px,calc(100vw-24px))] rounded-2xl border border-line bg-panel p-0 text-fg shadow-card backdrop:bg-black/40">
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <FileInput size={17} className="text-accent" />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Şablon doldur{template ? `: ${template.file.name}` : ""}</h2>
          <button type="button" onClick={close} aria-label="Kapat" className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"><X size={16} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm">
          {stage.step === "setup" && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted">Boş şablonunuz kendi biçimiyle doldurulur. Dosya sunucuda saklanmaz, belgeler kurum dışına çıkmaz.</p>
              <div>
                <p className="mb-1.5 font-medium">1. Boş şablon</p>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 hover:bg-subtle">
                  <Upload size={15} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{template ? template.file.name : "Şablon seç (Excel, Word, PDF, JSON)"}</span>
                  <input type="file" accept={TEMPLATE_ACCEPT} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setTemplate({ file: f }); e.target.value = ""; }} />
                </label>
                {docs.some((d) => d.file && isTemplateFile(d.name)) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {docs.filter((d) => d.file && isTemplateFile(d.name)).map((d) => (
                      <button key={d.id} type="button" onClick={() => setTemplate({ file: d.file!, docId: d.id })} aria-pressed={template?.docId === d.id} className={`max-w-60 truncate rounded-md border px-2 py-1 text-xs ${template?.docId === d.id ? "border-accent bg-accent-soft" : "border-line text-muted hover:bg-subtle"}`}>{d.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 font-medium">2. Bilginin alınacağı belgeler</p>
                {docs.filter((d) => d.id !== template?.docId).length ? (
                  <ul className="flex flex-col gap-1">
                    {docs.filter((d) => d.id !== template?.docId).map((d) => (
                      <li key={d.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-subtle">
                          <input type="checkbox" checked={!off.has(d.id)} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />
                          <span className="min-w-0 flex-1 truncate">{d.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-warn-fg">Bu sohbette başka belge yok. Kapatıp belgelerinizi ekleyin ya da kütüphaneden seçin.</p>}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="font-medium">3. Varsa özel isteğiniz</span>
                <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} maxLength={2000} placeholder="Örn. yalnızca 2025 yılına ait kayıtları aktar" className={fieldCls} />
              </label>
            </div>
          )}

          {stage.step === "reading" && (
            <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p>{stage.text}{stage.total ? ` (${Math.min(stage.done ?? 0, stage.total)}/${stage.total})` : "…"}</p>
              {!!stage.total && <div className="h-1.5 w-56 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${(100 * Math.min(stage.done ?? 0, stage.total)) / stage.total}%` }} /></div>}
            </div>
          )}

          {stage.step === "review" && layout && found && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted">
                {filled} alan dolduruldu{rowCount ? `, ${rowCount} tablo satırı bulundu` : ""}{missing ? `, ${missing} alan için belgede bilgi yok` : ""}{unproved ? `, ${unproved} değer doğrulanamadığı için yazılmadı` : ""}. Kontrol edip düzeltebilirsiniz; boş kalanlar şablonda boş kalır.
              </p>
              {layout.slots.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {layout.slots.map((s) => {
                    const f = found.slots[s.id] ?? { value: "" };
                    return (
                      <li key={s.id}>
                        <label className="flex flex-col gap-1">
                          <span className="flex items-center gap-1.5 text-xs font-medium">{f.value && <Check size={12} className="text-ok" />}{s.label}</span>
                          <input value={f.value} onChange={(e) => setSlot(s.id, e.target.value)} placeholder={f.suggestion ? "" : "Belgede bulunamadı"} className={fieldCls} />
                        </label>
                        <Offer f={f} onUse={(v) => setSlot(s.id, v)} />
                        {f.source && <p className="mt-1 truncate text-xs text-muted" title={f.quote}>{f.source}{f.quote ? `: “${f.quote}”` : ""}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {layout.tables.map((t) => {
                const rows = found.tables[t.id] ?? [];
                return (
                  <section key={t.id}>
                    <h3 className="mb-1.5 text-xs font-medium">Tablo: {t.label} ({rows.length} satır{t.rows ? `, şablonda ${t.rows} boş satır` : ""})</h3>
                    <div className="overflow-x-auto rounded-lg border border-line">
                      <table className="w-full text-xs">
                        <thead className="bg-subtle text-left text-muted"><tr>{t.columns.map((c) => <th key={c.id} className="min-w-28 px-2 py-1.5 font-medium">{c.label}</th>)}<th className="w-8" /></tr></thead>
                        <tbody>
                          {rows.map((row, r) => (
                            <tr key={r} className="border-t border-line align-top">
                              {t.columns.map((c, j) => (
                                <td key={c.id} className="p-1">
                                  <input aria-label={`${r + 1}. satır, ${c.label}`} value={row[j]?.value ?? ""} onChange={(e) => setCell(t.id, r, j, e.target.value)} title={row[j]?.source ? `${row[j].source}${row[j].quote ? `: ${row[j].quote}` : ""}` : undefined} className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 outline-none hover:border-line focus:border-accent" />
                                  {row[j] && <Offer f={row[j]} onUse={(v) => setCell(t.id, r, j, v)} />}
                                </td>
                              ))}
                              <td className="p-1"><button type="button" onClick={() => dropRow(t.id, r)} aria-label={`${r + 1}. satırı sil`} className="grid size-7 place-items-center rounded text-muted hover:bg-subtle hover:text-danger"><Trash2 size={13} /></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button type="button" onClick={() => addRow(t.id, t.columns.length)} className="mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-subtle hover:text-fg"><Plus size={13} /> Satır ekle</button>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-line px-4 py-3">
          {notes.map((n, i) => <p key={i} className="flex items-start gap-1.5 text-xs text-warn-fg"><AlertTriangle size={13} className="mt-px shrink-0" /> {n}</p>)}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          {saved && <p role="status" className="text-xs text-ok">Dolu şablon indirildi.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {stage.step === "review" && <button type="button" onClick={() => { setStage({ step: "setup" }); setSaved(false); setNotes([]); }} className="h-9 rounded-lg border border-line px-3 text-sm hover:bg-subtle">Geri</button>}
            {stage.step === "reading" && <button type="button" onClick={() => ac.current?.abort()} className="h-9 rounded-lg border border-line px-3 text-sm hover:bg-subtle">Durdur</button>}
            {stage.step === "setup" && <button type="button" onClick={() => void start()} disabled={!template || !sources.length} className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">Belgelerden doldur</button>}
            {stage.step === "review" && (
              <button type="button" onClick={() => void save()} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Dolu şablonu indir
              </button>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
