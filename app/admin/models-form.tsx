"use client";

import { useActionState } from "react";
import { modelsAction, type ModelsState } from "./actions";
import type { ModelConfig, ProviderKind } from "@/lib/models";

const input = "h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const KINDS: [ProviderKind, string][] = [["openai", "vLLM / OpenAI uyumlu"], ["ollama", "Ollama"]];

function Server({ id, label, hint, value, model, v }: { id: string; label: string; hint: string; value: { kind: ProviderKind; url: string }; model?: string; v?: Record<string, string> }) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted">{hint}</p>
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
        <select name={`${id}_kind`} defaultValue={v?.[`${id}_kind`] ?? value.kind} aria-label={`${label} sunucu türü`} className={input}>
          {KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <input name={`${id}_url`} defaultValue={v?.[`${id}_url`] ?? value.url} required aria-label={`${label} adresi`} placeholder="http://vllm:8000/v1" spellCheck={false} className={input} />
      </div>
      {model !== undefined && (
        <input name={`${id}_model`} defaultValue={v?.[`${id}_model`] ?? model} required aria-label={`${label} modeli`} placeholder="Model adı" spellCheck={false} className={input} />
      )}
    </fieldset>
  );
}

/** Admin page → Ayarlar → model servers. Saved in the database; env stays the default ("Varsayılana dön"). */
export function ModelsForm({ cfg, saved }: { cfg: ModelConfig; saved: boolean }) {
  const [state, action, pending] = useActionState<ModelsState, FormData>(modelsAction, undefined);
  const v = state?.values;
  const btn = "rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-subtle disabled:opacity-50";
  return (
    <form key={state?.at ?? 0} action={action} className="flex flex-col gap-3 rounded-xl border border-line bg-panel px-4 py-4 text-sm">
      <div>
        <p className="font-medium">Model sunucuları ve modeller</p>
        <p className="mt-1 text-xs text-muted">
          {saved ? "Bu sayfada kaydedilmiş ayarlar kullanılıyor." : "Kurulumdaki varsayılanlar (ortam değişkenleri) kullanılıyor."} vLLM için adres /v1 ile biter (ör. http://vllm:8000/v1), Ollama için bitmez (ör. http://host.docker.internal:11434). API anahtarı burada değil, kurulumda (MODEL_API_KEY) tutulur ve yalnızca kurulumda tanımlı sunuculara (ya da MODEL_KEY_HOSTS) gönderilir; anahtar isteyen yeni bir sunucu için kurulumdaki MODEL_KEY_HOSTS listesine ekleyin.
        </p>
      </div>
      <Server id="chat" label="Sohbet" hint="Soruları cevaplayan model sunucusu." value={cfg.chat} v={v} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Sohbet modelleri (virgülle; kullanıcılar bunlar arasından seçer)
          <input name="models" defaultValue={v?.models ?? cfg.models.join(", ")} required spellCheck={false} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Varsayılan model
          <input name="default_model" defaultValue={v?.default_model ?? cfg.defaultModel} required spellCheck={false} className={input} />
        </label>
      </div>
      <Server id="embed" label="Embedding" hint="Büyük belgelerde ilgili bölümleri bulmak için kullanılan model." value={cfg.embed} model={cfg.embed.model} v={v} />
      <Server id="vision" label="Tablo okuma" hint="Belge yüklenirken tablo görüntülerinin ikinci okuması (görsel destekli model)." value={cfg.vision} model={cfg.vision.model} v={v} />
      <div className="flex flex-wrap gap-2">
        <button name="intent" value="test" disabled={pending} className={btn}>Bağlantıyı test et</button>
        <button name="intent" value="save" disabled={pending} className={`${btn} border-accent text-accent`}>Kaydet</button>
        {saved && <button name="intent" value="reset" disabled={pending} formNoValidate className={btn}>Varsayılana dön</button>}
      </div>
      {state && (
        <ul role="status" className={`flex flex-col gap-1 text-xs ${state.ok ? "text-ok" : "text-danger"}`}>
          {state.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </form>
  );
}
