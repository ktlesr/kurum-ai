"use client";

// Görsel Stüdyo (plan §6.1). Photos, the logo and the brand kit stay in this browser; only the brief goes to the
// server (POST /api/studio) for a text suggestion. The SVG from lib/studio is the preview and every export.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, ImagePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { ThemeToggle } from "../theme-toggle";
import {
  DEFAULT_BRAND, FONT_FAMILY, FORMATS, LIMITS, TEMPLATES, rasterSize, safeColor, safePicture, toSvg,
  type Brand, type Content, type FormatId, type Measure, type Picture, type TemplateId,
} from "@/lib/studio";

const SAMPLE: Record<TemplateId, Content> = {
  duyuru: { tag: "Duyuru", title: "Yeni hizmet binamız hizmetinizde", subtitle: "Tüm birimlerimiz 1 Kasım itibarıyla tek adreste hizmet veriyor.", detail: "1 Kasım 2026 · Merkez Bina" },
  etkinlik: { tag: "Etkinlik", title: "Bölgesel Kalkınma Buluşması", subtitle: "Yerel yatırımcılar ve kamu kurumları bir araya geliyor.", detail: "12 Kasım 2026 · 10.00 · Kongre Salonu" },
  bilgi: { tag: "Bilgi", title: "%42", subtitle: "Destek başvurularında geçen yıla göre artış.", detail: "Kaynak: 2026 faaliyet raporu" },
  alinti: { tag: "", title: "Kalkınma, bölgenin bütün paydaşlarıyla birlikte yürüttüğümüz ortak bir yolculuktur.", subtitle: "Ad Soyad", detail: "Genel Sekreter" },
};
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_MAX_SIDE = 2400; // larger photos are scaled down once, so exports stay fast and the page light
const MAX_PIXELS = 50_000_000; // a small file can still decode to gigabytes; refuse before drawing it
const THUMB_SIDE = 320; // template cards use small copies, not the full photo and logo four times over
const EXPORTS = [
  { label: "PNG", mime: "image/png", ext: "png" },
  { label: "JPEG", mime: "image/jpeg", ext: "jpg" },
  { label: "WebP", mime: "image/webp", ext: "webp" },
  { label: "SVG", mime: "image/svg+xml", ext: "svg" },
] as const;

const brandKey = (u: string) => `kai-studio-brand:${u}`;
function loadBrand(username: string): Brand {
  try {
    const b = JSON.parse(localStorage.getItem(brandKey(username)) ?? "null") as Partial<Brand> | null;
    if (b) return { primary: safeColor(b.primary, DEFAULT_BRAND.primary), accent: safeColor(b.accent, DEFAULT_BRAND.accent), logo: safePicture(b.logo) };
  } catch {}
  return DEFAULT_BRAND;
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
async function imageOf(src: string, decode = true) {
  const img = new Image();
  await new Promise((ok, no) => {
    img.onload = ok;
    img.onerror = no;
    img.src = src;
  });
  if (decode) await img.decode();
  return img;
}

/** A small raster copy for the template cards only (exports always use the original). */
async function thumbOf(p: Picture): Promise<Picture> {
  const s = THUMB_SIDE / Math.max(p.w, p.h);
  if (s >= 1) return p;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(p.w * s));
  c.height = Math.max(1, Math.round(p.h * s));
  c.getContext("2d")!.drawImage(await imageOf(p.src), 0, 0, c.width, c.height);
  return { src: c.toDataURL("image/png"), w: c.width, h: c.height };
}
/** Size of an SVG logo without width/height attributes, from its viewBox. */
function svgSize(dataUrl: string) {
  try {
    const m = atob(dataUrl.split(",")[1]).match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
  } catch {}
  return { w: 0, h: 0 };
}

async function readPicture(file: File, kind: "photo" | "logo"): Promise<Picture> {
  const types = kind === "logo" ? ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] : ["image/png", "image/jpeg", "image/webp"];
  if (!types.includes(file.type)) throw new Error(kind === "logo" ? "Logo PNG, JPG, WEBP ya da SVG olmalı." : "Fotoğraf PNG, JPG ya da WEBP olmalı.");
  const max = kind === "logo" ? LOGO_MAX_BYTES : PHOTO_MAX_BYTES;
  if (file.size > max) throw new Error(`${kind === "logo" ? "Logo" : "Fotoğraf"} en fazla ${max / 1024 / 1024} MB olabilir.`);
  // Raster size from the file header, before the browser sees the pixels (a small file can decode to gigabytes).
  if (file.type !== "image/svg+xml") {
    const size = rasterSize(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
    if (!size || !size.w || !size.h) throw new Error("Görsel okunamadı. Dosya bozuk ya da desteklenmeyen biçimde olabilir.");
    if (size.w * size.h > MAX_PIXELS) throw new Error("Görsel çok büyük (en fazla 50 megapiksel).");
  }
  const src = await readAsDataUrl(file);
  const img = await imageOf(src, false).catch(() => {
    throw new Error("Görsel açılamadı.");
  });
  let { naturalWidth: w, naturalHeight: h } = img;
  if (file.type === "image/svg+xml" && (!w || !h)) ({ w, h } = svgSize(src));
  if (!w || !h) throw new Error("Görselin boyutu okunamadı.");
  // The logo is kept byte for byte (plan §6: never altered); a large photo is scaled down once.
  if (kind === "photo" && Math.max(w, h) > PHOTO_MAX_SIDE) {
    const s = PHOTO_MAX_SIDE / Math.max(w, h);
    const c = document.createElement("canvas");
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height };
  }
  return { src, w, h };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The embedded font, once: as a FontFace for measuring and as a data: URL for the SVG (an image can't fetch). */
function useStudioFont() {
  const [font, setFont] = useState<{ css: string; measure: Measure } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      const buf = await (await fetch("/fonts/Geist-Variable.woff2")).arrayBuffer();
      const face = new FontFace(FONT_FAMILY, buf, { weight: "100 900" });
      document.fonts.add(await face.load());
      const b64 = await readAsDataUrl(new Blob([buf], { type: "font/woff2" }));
      const ctx = document.createElement("canvas").getContext("2d")!;
      const measure: Measure = (t, size, weight) => {
        ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
        return ctx.measureText(t).width;
      };
      if (live) setFont({ css: `@font-face{font-family:${FONT_FAMILY};src:url(${b64}) format("woff2");font-weight:100 900}`, measure });
    })().catch(() => live && setError("Yazı tipi yüklenemedi. Sayfayı yenileyin."));
    return () => {
      live = false;
    };
  }, []);
  return { font, error };
}

const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent";
const section = "space-y-3 border-b border-line px-5 py-5";
const heading = "text-xs font-semibold uppercase tracking-wider text-muted";

export default function Studio({ username }: { username: string }) {
  const { font, error: fontError } = useStudioFont();
  const [template, setTemplate] = useState<TemplateId>("duyuru");
  const [format, setFormat] = useState<FormatId>("kare");
  const [content, setContent] = useState<Content>(SAMPLE.duyuru);
  const [edited, setEdited] = useState(false);
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  const [photo, setPhoto] = useState<Picture | undefined>();
  const [small, setSmall] = useState<{ photo?: Picture; logo?: Picture }>({});
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<"" | "fill" | "export">("");
  const [note, setNote] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Brand kit: per user, in this browser only.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
  useEffect(() => setBrand(loadBrand(username)), [username]);
  // Small copies for the template cards, made whenever the photo or logo changes (async, so after render).
  useEffect(() => {
    let live = true;
    Promise.all([photo && thumbOf(photo), brand.logo && thumbOf(brand.logo)])
      .then(([p, l]) => live && setSmall({ photo: p || undefined, logo: l || undefined }))
      .catch(() => live && setSmall({}));
    return () => {
      live = false;
    };
  }, [photo, brand.logo]);
  const saveBrand = (b: Brand) => {
    setBrand(b);
    try {
      localStorage.setItem(brandKey(username), JSON.stringify(b));
    } catch {
      setNote({ kind: "error", text: "Marka kiti bu tarayıcıya kaydedilemedi (depolama dolu). Daha küçük bir logo deneyin." });
    }
  };

  const svg = useMemo(() => (font ? toSvg({ template, format, content, brand, photo }, font.measure, font.css) : ""), [font, template, format, content, brand, photo]);
  const preview = useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ""), [svg]);
  const thumbs = useMemo(
    () =>
      font
        ? Object.fromEntries(
            (Object.keys(TEMPLATES) as TemplateId[]).map((t) => [
              t,
              `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg({ template: t, format: "kare", content: edited ? content : SAMPLE[t], brand: { ...brand, logo: small.logo }, photo: small.photo }, font.measure, font.css))}`,
            ]),
          )
        : {},
    [font, content, edited, brand, small],
  );

  /** A pending suggestion must not overwrite what the user changes meanwhile. */
  const cancelSuggest = () => {
    abort.current?.abort();
    abort.current = null;
    setBusy((b) => (b === "fill" ? "" : b));
  };
  const chooseTemplate = (t: TemplateId) => {
    cancelSuggest();
    setTemplate(t);
    if (!edited) setContent(SAMPLE[t]); // samples follow the template until the user writes their own
  };
  const edit = (k: keyof Content, v: string) => {
    cancelSuggest();
    setEdited(true);
    setContent((c) => ({ ...c, [k]: v }));
  };

  async function suggest() {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setBusy("fill");
    setNote(null);
    try {
      const r = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template, brief }), signal: ac.signal });
      const j = (await r.json().catch(() => ({}))) as { content?: Content; error?: string };
      if (ac.signal.aborted) return; // edited or switched meanwhile: keep the user's version
      if (!r.ok || !j.content) throw new Error(j.error ?? "Öneri alınamadı.");
      setEdited(true);
      setContent(j.content);
      setNote({ kind: "ok", text: "Metinler yazıldı. Dilediğiniz alanı düzenleyebilirsiniz." });
    } catch (e) {
      if (!ac.signal.aborted) setNote({ kind: "error", text: (e as Error).message });
    } finally {
      if (abort.current === ac) setBusy("");
    }
  }

  async function pick(kind: "photo" | "logo", file: File | undefined) {
    if (!file) return;
    setNote(null);
    try {
      const p = await readPicture(file, kind);
      if (kind === "photo") setPhoto(p);
      else saveBrand({ ...brand, logo: p });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message });
    }
  }

  async function exportAs(e: (typeof EXPORTS)[number]) {
    if (!svg) return;
    const name = `kurum-gorsel-${template}-${format}.${e.ext}`;
    if (e.ext === "svg") return download(new Blob([svg], { type: e.mime }), name);
    setBusy("export");
    try {
      const { w, h } = FORMATS[format];
      const img = await imageOf(preview);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; // JPEG has no transparency
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, e.mime, 0.92));
      if (!blob || blob.type !== e.mime) throw new Error(`Bu tarayıcı ${e.label} kaydedemiyor. PNG deneyin.`);
      download(blob, name);
    } catch (err) {
      setNote({ kind: "error", text: (err as Error).message || "Görsel kaydedilemedi." });
    } finally {
      setBusy("");
    }
  }

  const { w, h } = FORMATS[format];
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel/80 px-3 backdrop-blur md:px-4">
        <Link href="/" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">
          <ArrowLeft size={16} /> Asistan
        </Link>
        <span className="h-5 w-px bg-line" aria-hidden />
        <h1 className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold">Görsel Stüdyo</h1>
        <ThemeToggle />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 min-h-0 overflow-y-auto border-line bg-panel lg:order-1 lg:w-[400px] lg:shrink-0 lg:border-r">
          <section className={section} aria-labelledby="t-template">
            <h2 id="t-template" className={heading}>Şablon</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {(Object.keys(TEMPLATES) as TemplateId[]).map((t) => (
                <button
                  key={t}
                  onClick={() => chooseTemplate(t)}
                  aria-pressed={template === t}
                  className={`group overflow-hidden rounded-xl border text-left transition-all ${template === t ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent/60"}`}
                >
                  <span className="block aspect-square bg-subtle">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data: SVG thumbnail */}
                    {thumbs[t] && <img src={thumbs[t]} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="block px-2.5 py-2">
                    <span className="block text-sm font-medium">{TEMPLATES[t].label}</span>
                    <span className="block truncate text-xs text-muted">{TEMPLATES[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={section} aria-labelledby="t-format">
            <h2 id="t-format" className={heading}>Format</h2>
            <div role="group" aria-labelledby="t-format" className="grid grid-cols-4 gap-1.5 rounded-xl border border-line bg-subtle p-1">
              {(Object.keys(FORMATS) as FormatId[]).map((f) => (
                <button
                  key={f}
                  aria-pressed={format === f}
                  title={FORMATS[f].hint}
                  onClick={() => setFormat(f)}
                  className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-xs font-medium transition-colors ${format === f ? "bg-panel text-fg shadow-card" : "text-muted hover:text-fg"}`}
                >
                  <span className="grid h-7 place-items-center" aria-hidden>
                    <span className="block rounded-[3px] border-2 border-current" style={{ width: FORMATS[f].w > FORMATS[f].h ? 26 : (26 * FORMATS[f].w) / FORMATS[f].h, height: FORMATS[f].w > FORMATS[f].h ? (26 * FORMATS[f].h) / FORMATS[f].w : 26 }} />
                  </span>
                  {FORMATS[f].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{FORMATS[format].hint} · {w}×{h} piksel</p>
          </section>

          <section className={section} aria-labelledby="t-ai">
            <h2 id="t-ai" className={heading}>Yapay zekâ ile yaz</h2>
            <textarea
              aria-labelledby="t-ai"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Görselin konusunu anlatın: ör. 12 Kasım'da kongre salonunda yatırımcı buluşması, saat 10.00"
              className={`${field} resize-none`}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={suggest}
                disabled={!brief.trim() || busy === "fill"}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === "fill" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy === "fill" ? "Yazılıyor…" : "Metinleri öner"}
              </button>
              {busy === "fill" && (
                <button onClick={cancelSuggest} className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-fg" aria-label="İptal">
                  <X size={16} />
                </button>
              )}
            </div>
            <p className="text-xs text-muted">Yalnızca bu açıklama kurum sunucusundaki modele gider; görselleriniz tarayıcınızda kalır.</p>
          </section>

          <section className={section} aria-labelledby="t-text">
            <h2 id="t-text" className={heading}>Metinler</h2>
            {([
              ["tag", "Etiket", "DUYURU"],
              ["title", template === "alinti" ? "Söz" : "Başlık", ""],
              ["subtitle", template === "alinti" ? "Söyleyen" : "Açıklama", ""],
              ["detail", template === "alinti" ? "Unvan / kurum" : "Tarih, yer ya da adres", ""],
            ] as const).map(([k, label, ph]) =>
              k === "tag" && template === "alinti" ? null : (
                <label key={k} className="block space-y-1">
                  <span className="flex justify-between text-xs font-medium">
                    {label}
                    <span className="font-normal tabular-nums text-muted">{content[k].length}/{LIMITS[k]}</span>
                  </span>
                  {k === "subtitle" || (k === "title" && template === "alinti") ? (
                    <textarea value={content[k]} onChange={(e) => edit(k, e.target.value)} maxLength={LIMITS[k]} rows={2} placeholder={ph} className={`${field} resize-none`} />
                  ) : (
                    <input value={content[k]} onChange={(e) => edit(k, e.target.value)} maxLength={LIMITS[k]} placeholder={ph} className={field} />
                  )}
                </label>
              ),
            )}
          </section>

          <section className={section} aria-labelledby="t-media">
            <h2 id="t-media" className={heading}>Fotoğraf</h2>
            <Picker label={photo ? "Fotoğrafı değiştir" : "Fotoğraf ekle"} accept=".png,.jpg,.jpeg,.webp" onPick={(f) => pick("photo", f)} preview={photo?.src} onClear={photo ? () => setPhoto(undefined) : undefined} />
            <p className="text-xs text-muted">{template === "bilgi" || template === "alinti" ? "Bu şablon fotoğraf kullanmaz; marka renkleriyle çizilir." : "Yoksa marka renkleriyle çizilir."}</p>
          </section>

          <section className={section} aria-labelledby="t-brand">
            <h2 id="t-brand" className={heading}>Marka kiti</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {([["primary", "Ana renk"], ["accent", "Vurgu rengi"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-2.5 py-2">
                  <input type="color" value={brand[k]} onChange={(e) => saveBrand({ ...brand, [k]: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{label}</span>
                    <span className="block font-mono text-xs uppercase text-muted">{brand[k]}</span>
                  </span>
                </label>
              ))}
            </div>
            <Picker label={brand.logo ? "Logoyu değiştir" : "Logo ekle"} accept=".png,.jpg,.jpeg,.webp,.svg" onPick={(f) => pick("logo", f)} preview={brand.logo?.src} contain onClear={brand.logo ? () => saveBrand({ ...brand, logo: undefined }) : undefined} />
            <p className="text-xs text-muted">Logo olduğu gibi kullanılır: kırpılmaz, renklendirilmez, oranı korunur. Marka kiti yalnızca bu tarayıcıda saklanır.</p>
          </section>
        </aside>

        <main className="order-1 flex min-h-[55vh] flex-1 flex-col lg:order-2">
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8" style={{ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob: SVG, the exact export
              <img src={preview} alt={`${TEMPLATES[template].label} görseli önizlemesi`} className="max-h-full max-w-full rounded-lg object-contain shadow-[0_8px_40px_rgb(20_38_61/0.18)]" style={{ aspectRatio: `${w} / ${h}` }} />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                {fontError || <><Loader2 size={16} className="animate-spin" /> Hazırlanıyor…</>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-3">
            <span className="mr-auto text-xs text-muted">{w}×{h} · {FORMATS[format].label}</span>
            {note && (
              <p role={note.kind === "error" ? "alert" : "status"} className={`order-first w-full text-sm sm:order-none sm:w-auto ${note.kind === "error" ? "text-danger" : "text-ok"}`}>
                {note.text}
              </p>
            )}
            {EXPORTS.map((e) => (
              <button
                key={e.ext}
                onClick={() => exportAs(e)}
                disabled={!svg || busy === "export"}
                className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-40 ${e.ext === "png" ? "bg-accent text-accent-fg hover:opacity-90" : "border border-line bg-panel hover:border-accent hover:text-accent"}`}
              >
                <Download size={15} /> {e.label}
              </button>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function Picker({ label, accept, onPick, preview, onClear, contain }: { label: string; accept: string; onPick: (f: File | undefined) => void; preview?: string; onClear?: () => void; contain?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- local data: URL
        <img src={preview} alt="" className={`size-12 shrink-0 rounded-lg border border-line bg-subtle ${contain ? "object-contain p-1" : "object-cover"}`} />
      )}
      <label className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted transition-colors hover:border-accent hover:text-accent focus-within:border-accent">
        <ImagePlus size={16} /> {label}
        <input type="file" accept={accept} className="sr-only" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {onClear && (
        <button onClick={onClear} className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:border-danger hover:text-danger" aria-label="Kaldır" title="Kaldır">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
