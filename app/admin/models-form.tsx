"use client";

import { useEffect, useState, useTransition } from "react";
import { listModels, resetModels, saveModels, type Result } from "./actions";
import type { ModelConfig, Server } from "@/lib/models";

const select = "h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const btn = "rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-subtle disabled:opacity-50";

type List = { ok: boolean; models: string[] } | null; // null: loading

/** Embedding-only models can't chat: kept out of the chat list (by name; all common ones say "embed"). */
const chatty = (m: string) => !/embed/i.test(m);

/** Ollama lists "x:latest" for a model pulled as "x". */
const has = (list: string[], m: string) => list.includes(m) || list.includes(`${m}:latest`);

/** "embeddinggemma" saved, "embeddinggemma:latest" listed: the same model; use the listed name. */
const latest = (list: string[]) => (m: string) => (!list.includes(m) && list.includes(`${m}:latest`) ? `${m}:latest` : m);

/** Options for a select: the server's list, plus the current value if the server doesn't (yet) list it. */
const withCurrent = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list);

/**
 * Admin page → Ayarlar → model server. The admin picks vLLM or Ollama and ticks models from what that server
 * serves; addresses come from the deployment (lib/models presets). Table reading follows the default chat model
 * and embeddings stay on Ollama unless changed under "Gelişmiş".
 */
export function ModelsForm({ cfg, server: initial, saved, custom }: { cfg: ModelConfig; server: Server; saved: boolean; custom: string[] }) {
  const [server, setServer] = useState<Server>(initial);
  const [lists, setLists] = useState<Record<Server, List>>({ vllm: null, ollama: null });
  const [models, setModels] = useState<string[]>(cfg.models);
  const [def, setDef] = useState(cfg.defaultModel);
  const [embed, setEmbed] = useState(cfg.embed.model);
  // "": the default chat model. A vision model equal to the default shows as that.
  const [vision, setVision] = useState(cfg.vision.model === cfg.defaultModel ? "" : cfg.vision.model);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    for (const s of ["vllm", "ollama"] as const) {
      listModels(s).then((l) => {
        setLists((x) => ({ ...x, [s]: l }));
        const named = latest(l.models);
        if (s === "ollama") setEmbed(named);
        if (s === initial) {
          setModels((ms) => ms.map(named));
          setDef(named);
          setVision((v) => (v ? named(v) : v));
        }
      });
    }
  }, [initial]);

  const list = lists[server];
  const ollama = lists.ollama;
  // The server's models, plus chosen ones it doesn't list (shown, so they can be unticked).
  const offered = [...new Set([...(list?.models ?? []).filter(chatty), ...models])];

  const pick = (s: Server) => {
    setServer(s);
    setResult(null);
    // Another server serves other models: start from what it has (or keep the saved choice for the saved server).
    // Back on the saved server: its saved choice as it was, default and table model included.
    if (s === initial) {
      const named = latest(lists[s]?.models ?? []);
      setModels(cfg.models.map(named));
      setDef(named(cfg.defaultModel));
      setVision(cfg.vision.model === cfg.defaultModel ? "" : named(cfg.vision.model));
      return;
    }
    const keep = (lists[s]?.models ?? []).filter(chatty).slice(0, 1);
    setModels(keep);
    setDef(keep[0] ?? "");
    setVision("");
  };
  const toggle = (m: string) => {
    const next = models.includes(m) ? models.filter((x) => x !== m) : [...models, m];
    setModels(next);
    if (!next.includes(def)) setDef(next[0] ?? "");
  };

  const run = (f: () => Promise<Result>) => start(async () => setResult(await f()));
  const reset = () =>
    start(async () => {
      const r = await resetModels();
      setResult(r);
      if (!r.cfg || !r.server) return;
      setServer(r.server);
      setModels(r.cfg.models);
      setDef(r.cfg.defaultModel);
      setEmbed(r.cfg.embed.model);
      setVision(r.cfg.vision.model === r.cfg.defaultModel ? "" : r.cfg.vision.model);
    });
  const save = () => run(() => saveModels({ server, models, defaultModel: def, embedModel: embed, visionModel: vision }));

  const missingEmbed = ollama?.ok && !has(ollama.models, embed);
  const missingChat = list?.ok ? models.filter((m) => !has(list.models, m)) : [];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-panel px-4 py-4 text-sm">
      <div>
        <p className="font-medium">Model sunucusu</p>
        <p className="mt-1 text-xs text-muted">{saved ? "Bu sayfada kaydedilmiş ayar kullanılıyor." : "Kurulumdaki varsayılan kullanılıyor."}</p>
        {custom.length > 0 && (
          <p className="mt-1 text-xs text-warn-fg">Şu anki ayarda kurulum dışı adres var ({custom.join(", ")}). Kaydederseniz seçilen sunucunun kurulumdaki adresi kullanılır.</p>
        )}
      </div>

      <div role="radiogroup" aria-label="Model sunucusu" className="grid gap-2 sm:grid-cols-2">
        {([["vllm", "vLLM", "Çok kullanıcı için; aynı belgeye sonraki sorular hızlı."], ["ollama", "Ollama", "Cihazda kurulu modeller; tek kullanıcı ve deneme için."]] as const).map(([id, label, hint]) => (
          <label key={id} className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 ${server === id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <span className="flex items-center gap-2 font-medium">
              <input type="radio" name="server" checked={server === id} onChange={() => pick(id)} />
              {label}
              <span className={`text-xs font-normal ${lists[id] === null ? "text-muted" : lists[id]!.ok ? "text-ok" : "text-danger"}`}>
                {lists[id] === null ? "kontrol ediliyor…" : lists[id]!.ok ? "çalışıyor" : "ulaşılamıyor"}
              </span>
            </span>
            <span className="text-xs text-muted">{hint}</span>
          </label>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-muted">Kullanıcıların seçebileceği sohbet modelleri</legend>
        {list === null ? (
          <p className="text-xs text-muted">Modeller yükleniyor…</p>
        ) : (
          <>
            {!list.ok && <p className="text-xs text-danger">Bu sunucuya şu an ulaşılamıyor; kayıtlı modeller gösteriliyor.</p>}
            <div className="flex flex-wrap gap-2">
              {offered.map((m) => (
                <label key={m} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${models.includes(m) ? "border-accent text-fg" : "border-line text-muted"}`}>
                  <input type="checkbox" checked={models.includes(m)} onChange={() => toggle(m)} />
                  {m}
                </label>
              ))}
            </div>
            {missingChat.length > 0 && <p className="text-xs text-warn-fg">Sunucuda olmayan: {missingChat.join(", ")}</p>}
          </>
        )}
      </fieldset>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Varsayılan model
        <select value={def} onChange={(e) => setDef(e.target.value)} className={select}>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <details className="rounded-lg border border-line px-3 py-2">
        <summary className="text-xs font-medium">Gelişmiş</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Tablo okuma modeli (belge yüklenirken tablo görüntülerinin ikinci okuması; görsel destekli olmalı)
            <select value={vision} onChange={(e) => setVision(e.target.value)} className={select}>
              <option value="">Varsayılan sohbet modeli ({def || "—"})</option>
              {withCurrent((list?.models ?? []).filter(chatty), vision).filter((m) => m).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Embedding modeli (Ollama; büyük belgelerde ilgili bölümleri bulur)
            <select value={embed} onChange={(e) => setEmbed(e.target.value)} className={select}>
              {withCurrent(ollama?.models ?? [], embed).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </details>
      {missingEmbed && (
        <p className="text-xs text-warn-fg">
          Embedding modeli ({embed}) Ollama&apos;da yüklü değil; büyük belgelerde yalnızca anahtar kelime araması yapılır. Cihazda: <code>ollama pull {embed}</code>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={pending || !models.length} className={`${btn} border-accent text-accent`}>Kaydet</button>
        {saved && <button onClick={reset} disabled={pending} className={btn}>Kurulumdaki ayara dön</button>}
      </div>
      {result && (
        <ul role="status" className={`flex flex-col gap-1 text-xs ${result.ok ? "text-ok" : "text-danger"}`}>
          {result.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}
