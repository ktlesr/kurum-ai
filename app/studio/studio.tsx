"use client";

// Görsel Stüdyo (plan §6.1). A template lays out the first design; then every element can be selected, moved,
// resized and restyled on the canvas. Photos, the logo and the brand kit stay in this browser; only the brief goes
// to the server (POST /api/studio) for a text suggestion. The SVG from lib/studio is the canvas and every export.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowLeft, ArrowUpToLine, Copy, Download, FolderOpen, Image as ImageIcon,
  ChevronDown, ChevronUp, Clapperboard, Film, ImagePlus, Layers, Loader2, Lock, LockOpen, Redo2, Save, Shapes, Sparkles, Square, Stamp, Trash2, Type, Undo2, X,
} from "lucide-react";
import { ThemeToggle } from "../theme-toggle";
import Editor from "./editor";
import type { Claim } from "@/lib/trace";
import { recorderType, renderVideo, type Scene, type Transition } from "./video";
import { EXPORTS, SAMPLE, brandKey, download, imageOf, loadBrand, readPicture, thumbOf, useStudioFont } from "./media";
import {
  DEFAULT_BRAND, FORMATS, LIMITS, TEMPLATES, cleanEls, fromTemplate, hug, newId, svgOf, toSvg,
  type Brand, type Content, type El, type FormatId, type ImageEl, type Picture, type Role, type ShapeEl, type TemplateId, type TextEl,
} from "@/lib/studio";

/** Colour pairs to start a brand kit from (ana renk, vurgu). */
const THEMES = [
  { name: "Lacivert", primary: "#14263d", accent: "#2e5e8c" },
  { name: "Bordo", primary: "#4a1424", accent: "#c8102e" },
  { name: "Orman", primary: "#0f3d2e", accent: "#1f8a5b" },
  { name: "Turuncu", primary: "#3a2410", accent: "#e07a1f" },
  { name: "Mor", primary: "#2a1a4a", accent: "#7c3aed" },
  { name: "Antrasit", primary: "#1f2937", accent: "#0ea5e9" },
];
const WEIGHTS = [
  { v: 400, label: "Normal" },
  { v: 600, label: "Yarı kalın" },
  { v: 700, label: "Kalın" },
  { v: 800, label: "Çok kalın" },
];
const HISTORY = 100;
type Snap = { els: El[]; format: FormatId };
type Field = Exclude<Role, "deco">;

const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent";
const small = "h-8 w-full rounded-md border border-line bg-panel px-2 text-sm tabular-nums outline-none focus:border-accent";
const section = "space-y-3 border-b border-line px-4 py-4";
const heading = "text-[11px] font-semibold uppercase tracking-wider text-muted";
const iconBtn = "grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";
const chip = (on: boolean) => `rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? "bg-panel text-fg shadow-card" : "text-muted hover:text-fg"}`;

/** Every colour in the design that was the old brand colour becomes the new one. */
function recolor(els: El[], from: string, to: string): El[] {
  const c = (x: string) => (x.toLowerCase() === from.toLowerCase() ? to : x);
  return els.map((e) => {
    if (e.kind === "text") return { ...e, color: c(e.color), ...(e.bg ? { bg: { ...e.bg, fill: c(e.bg.fill) } } : {}) };
    if (e.kind === "shape") return { ...e, fill: e.fill.kind === "solid" ? { kind: "solid", color: c(e.fill.color) } : { ...e.fill, stops: [{ ...e.fill.stops[0], color: c(e.fill.stops[0].color) }, { ...e.fill.stops[1], color: c(e.fill.stops[1].color) }] } };
    return e;
  });
}

export default function Studio({ username }: { username: string }) {
  const { font, error: fontError } = useStudioFont();
  const [template, setTemplate] = useState<TemplateId>("duyuru");
  const [format, setFormat] = useState<FormatId>("kare");
  const [content, setContent] = useState<Content>(SAMPLE.duyuru);
  const [ownText, setOwnText] = useState(false); // samples follow the template until the user writes
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  const [photo, setPhoto] = useState<Picture | undefined>();
  const [small, setSmall] = useState<{ photo?: Picture; logo?: Picture }>({});
  // null: the design is the template's (it follows template, texts, colours); set once anything is edited by hand.
  const [els, setEls] = useState<El[] | null>(null);
  // Undo history: the elements with the canvas format they were laid out for.
  const [hist, setHist] = useState<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  // The user's own uploaded documents (TASK-025): a poster can be written from one; each field shows its page.
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [docId, setDocId] = useState("");
  // Each field's source with the exact text it was found for: shown only while the field still says that, so a
  // canvas edit, an undo or a new template never keeps a page that belongs to other words.
  const [sources, setSources] = useState<Partial<Record<Field, { claim: Claim; text: string }>>>({});
  const [busy, setBusy] = useState<"" | "fill" | "export">("");
  const [note, setNote] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Video (TASK-026): scenes are snapshots of designs in one format, recorded in the browser.
  const [scenes, setScenes] = useState<(Scene & { format: FormatId; thumb: string })[]>([]);
  const [transition, setTransition] = useState<Transition>("fade");
  const [motion, setMotion] = useState(true);
  const [music, setMusic] = useState<File | undefined>();
  const [video, setVideo] = useState<{ progress: number; url?: string; ext?: string; error?: string } | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  const videoUrl = useRef<string | undefined>(undefined);
  // Leaving the page stops a recording and frees the last video.
  useEffect(
    () => () => {
      videoAbort.current?.abort();
      if (videoUrl.current) URL.revokeObjectURL(videoUrl.current);
    },
    [],
  );
  const gesture = useRef<Snap | null>(null); // the design when a drag or typing started (its undo point)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
  useEffect(() => setBrand(loadBrand(username)), [username]);
  useEffect(() => {
    let live = true;
    fetch("/api/upload")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id?: unknown; name?: unknown }[]) => live && Array.isArray(list) && setDocs(list.filter((d) => typeof d.id === "string" && typeof d.name === "string") as { id: string; name: string }[]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([photo && thumbOf(photo), brand.logo && thumbOf(brand.logo)])
      .then(([p, l]) => live && setSmall({ photo: p || undefined, logo: l || undefined }))
      .catch(() => live && setSmall({}));
    return () => {
      live = false;
    };
  }, [photo, brand.logo]);

  const generated = useMemo(() => (font ? fromTemplate({ template, format, content, brand, photo }, font.measure) : []), [font, template, format, content, brand, photo]);
  const view = els ?? generated;
  // The latest committed state for callbacks that run later (a suggestion arriving, undo from the keyboard).
  const now = useRef({ view, els, format, hist });
  useLayoutEffect(() => {
    now.current = { view, els, format, hist };
  });
  const snap = (): Snap => ({ els: now.current.view, format: now.current.format });
  const push = (s: Snap) => setHist((h) => ({ past: [...h.past.slice(-HISTORY + 1), s], future: [] }));

  /** A new design state; `commit` makes it one undo step (from where the current gesture started). */
  const change = (raw: El[], commit = true) => {
    const next = font ? hug(raw, font.measure) : raw;
    if (!commit) {
      gesture.current ??= snap();
      setEls(next);
      return;
    }
    const before = gesture.current ?? snap();
    gesture.current = null;
    if (before.els !== next) push(before);
    setEls(next);
  };
  const restore = (s: Snap) => {
    setFormat(s.format);
    setEls(s.els);
    setSelected((id) => (s.els.some((e) => e.id === id) ? id : null)); // still there: stays selected
    setEditing(null);
  };
  const undo = () => {
    const h = now.current.hist;
    if (!h.past.length) return;
    setHist({ past: h.past.slice(0, -1), future: [snap(), ...h.future] });
    restore(h.past[h.past.length - 1]);
  };
  const redo = () => {
    const h = now.current.hist;
    if (!h.future.length) return;
    setHist({ past: [...h.past, snap()], future: h.future.slice(1) });
    restore(h.future[0]);
  };
  /** Back to the template (undoable, format included): template and format changes do this. */
  const reset = () => {
    if (now.current.view.length) push(snap());
    setEls(null);
    setSelected(null);
    setEditing(null);
  };

  const patch = (id: string, p: Partial<El>, commit = true) => change(view.map((e) => (e.id === id ? ({ ...e, ...p } as El) : e)), commit);
  const sel = view.find((e) => e.id === selected) ?? null;

  const saveBrand = (b: Brand) => {
    setBrand(b);
    try {
      localStorage.setItem(brandKey(username), JSON.stringify(b));
    } catch {
      setNote({ kind: "error", text: "Marka kiti bu tarayıcıya kaydedilemedi (depolama dolu). Daha küçük bir logo deneyin." });
    }
  };
  const setColors = (primary: string, accent: string) => {
    if (els) change(recolor(recolor(els, brand.primary, primary), brand.accent, accent));
    saveBrand({ ...brand, primary, accent });
  };

  /** Text fields on the left: in an edited design they change the element with that role. */
  const editField = (k: Field, v: string) => {
    cancelSuggest();
    setOwnText(true);
    setContent((c) => ({ ...c, [k]: v }));
    if (els) change(els.map((e) => (e.kind === "text" && e.role === k ? { ...e, text: v } : e)), false);
  };
  const applyContent = (c: Content) => {
    setOwnText(true);
    setContent(c);
    // The design as it is now: the user may have moved or added things while the suggestion was coming.
    const cur = now.current.els;
    if (cur) change(cur.map((e) => (e.kind === "text" && e.role && e.role !== "deco" ? { ...e, text: c[e.role] } : e)));
  };

  const chooseTemplate = (t: TemplateId) => {
    cancelSuggest();
    setTemplate(t);
    if (!ownText) setContent(SAMPLE[t]);
    reset();
  };
  const chooseFormat = (f: FormatId) => {
    setFormat(f);
    reset();
  };

  function cancelSuggest() {
    abort.current?.abort();
    abort.current = null;
    setBusy((b) => (b === "fill" ? "" : b));
  }
  async function suggest() {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setBusy("fill");
    setNote(null);
    try {
      const r = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template, brief, ...(docId ? { docId } : {}) }), signal: ac.signal });
      const j = (await r.json().catch(() => ({}))) as { content?: Content; error?: string; sources?: Partial<Record<Field, Claim>> };
      if (ac.signal.aborted) return; // edited or switched meanwhile: keep the user's version
      if (!r.ok || !j.content) throw new Error(j.error ?? "Öneri alınamadı.");
      applyContent(j.content);
      const got = j.sources ?? {};
      setSources(Object.fromEntries((Object.keys(got) as Field[]).filter((k) => got[k]).map((k) => [k, { claim: got[k]!, text: j.content![k].trim() }])));
      const missing = Object.values(got).filter((c) => c?.status === "none").length;
      setNote(
        missing
          ? { kind: "error", text: `Metinler yazıldı; ${missing} alan belgede eşleşmedi (kırmızı). Kontrol edin.` }
          : { kind: "ok", text: docId ? "Metinler belgeden yazıldı; her alanın sayfası yanında. Tuvalde ya da soldan düzenleyebilirsiniz." : "Metinler yazıldı. Tuvalde çift tıklayarak ya da soldan düzenleyebilirsiniz." },
      );
    } catch (e) {
      if (!ac.signal.aborted) setNote({ kind: "error", text: (e as Error).message });
    } finally {
      if (abort.current === ac) setBusy("");
    }
  }

  const { w: W, h: H } = FORMATS[format];
  const u = Math.min(W, H) / 1080;
  /** A picture's box: `size` on its longer side, its own ratio. */
  const boxOf = (p: Picture, size: number) => (p.w >= p.h ? { w: size, h: (size * p.h) / p.w } : { w: (size * p.w) / p.h, h: size });
  const add = (e: El) => {
    change([...view, e]);
    setSelected(e.id);
  };
  const addText = () =>
    add({ id: newId(), kind: "text", name: "Metin", x: W * 0.1, y: H * 0.42, w: W * 0.8, h: 90 * u, text: "Yeni metin", size: 64 * u, weight: 700, color: brand.primary, align: "start", leading: 1.15, tracking: 0, auto: true } satisfies TextEl);
  const addShape = () =>
    add({ id: newId(), kind: "shape", name: "Şekil", x: W / 2 - 160 * u, y: H / 2 - 60 * u, w: 320 * u, h: 120 * u, fill: { kind: "solid", color: brand.accent }, radius: 16 * u } satisfies ShapeEl);
  const addLogo = () => {
    if (!brand.logo) return setNote({ kind: "error", text: "Önce marka kitine logo ekleyin." });
    const b = boxOf(brand.logo, 220 * u);
    add({ id: newId(), kind: "image", name: "Logo", x: 72 * u, y: 72 * u, ...b, pic: brand.logo, fit: "contain", logo: true } satisfies ImageEl);
  };

  async function pick(kind: "photo" | "logo" | "image", file: File | undefined) {
    if (!file) return;
    setNote(null);
    try {
      const p = await readPicture(file, kind === "logo" ? "logo" : "photo");
      if (kind === "image") {
        const b = boxOf(p, Math.min(W, H) * 0.5);
        return add({ id: newId(), kind: "image", name: "Görsel", x: (W - b.w) / 2, y: (H - b.h) / 2, ...b, pic: p, fit: "contain" } satisfies ImageEl);
      }
      if (kind === "photo") {
        setPhoto(p);
        // An edited design keeps its layout: the photo element gets the new picture.
        if (els) change(els.map((e) => (e.kind === "image" && !e.logo && e.name === "Fotoğraf" ? { ...e, pic: p } : e)));
      } else {
        saveBrand({ ...brand, logo: p });
        // The logo keeps its width; the height follows its own ratio (never stretched).
        if (els) change(els.map((e) => (e.kind === "image" && e.logo ? { ...e, pic: p, h: (e.w * p.h) / p.w } : e)));
      }
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message });
    }
  }
  const replacePicture = async (id: string, file: File | undefined) => {
    if (!file) return;
    try {
      const target = view.find((e) => e.id === id) as ImageEl | undefined;
      const p = await readPicture(file, target?.logo ? "logo" : "photo");
      if (target) patch(id, target.fit === "contain" ? { pic: p, h: (target.w * p.h) / p.w } : { pic: p });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message });
    }
  };

  const remove = (id: string) => {
    change(view.filter((e) => e.id !== id));
    setSelected(null);
  };
  const duplicate = (id: string) => {
    const e = view.find((x) => x.id === id);
    if (!e) return;
    const copy = { ...e, id: newId(), x: e.x + 24 * u, y: e.y + 24 * u, locked: false } as El;
    const i = view.indexOf(e);
    change([...view.slice(0, i + 1), copy, ...view.slice(i + 1)]);
    setSelected(copy.id);
  };
  const reorder = (id: string, to: "front" | "back" | "up" | "down") => {
    const i = view.findIndex((e) => e.id === id);
    if (i < 0) return;
    const rest = view.filter((e) => e.id !== id);
    // Locked backgrounds stay at the bottom: "back" means just above them.
    const floor = rest.findIndex((e) => !e.locked);
    const j = to === "front" ? rest.length : to === "back" ? Math.max(0, floor) : to === "up" ? Math.min(rest.length, i + 1) : Math.max(0, i - 1);
    change([...rest.slice(0, j), view[i], ...rest.slice(j)]);
  };

  // Keyboard: arrows nudge (Shift: 10 px), Delete, Ctrl+Z / Ctrl+Y, Ctrl+D, Escape.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") return e.preventDefault(), e.shiftKey ? redo() : undo();
    if (mod && e.key.toLowerCase() === "y") return e.preventDefault(), redo();
    if (!sel) return;
    if (e.key === "Escape") return setSelected(null);
    if (sel.locked) return;
    if (mod && e.key.toLowerCase() === "d") return e.preventDefault(), duplicate(sel.id);
    if (e.key === "Delete" || e.key === "Backspace") return e.preventDefault(), remove(sel.id);
    if (e.key === "Enter" && sel.kind === "text") return e.preventDefault(), setEditing(sel.id);
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      patch(sel.id, { x: sel.x + d[0], y: sel.y + d[1] });
    }
  }
  useLayoutEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const thumbs = useMemo(
    () =>
      font
        ? Object.fromEntries(
            (Object.keys(TEMPLATES) as TemplateId[]).map((t) => [
              t,
              `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg({ template: t, format: "kare", content: ownText ? content : SAMPLE[t], brand: { ...brand, logo: small.logo }, photo: small.photo }, font.measure, font.css))}`,
            ]),
          )
        : {},
    [font, content, ownText, brand, small],
  );

  async function exportAs(e: (typeof EXPORTS)[number]) {
    if (!font) return;
    setEditing(null);
    const svg = svgOf(format, view, font.measure, font.css);
    const name = `kurum-gorsel-${template}-${format}.${e.ext}`;
    if (e.ext === "svg") return download(new Blob([svg], { type: e.mime }), name);
    setBusy("export");
    try {
      const img = await imageOf(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; // JPEG has no transparency
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, e.mime, 0.92));
      if (!blob || blob.type !== e.mime) throw new Error(`Bu tarayıcı ${e.label} kaydedemiyor. PNG deneyin.`);
      download(blob, name);
    } catch (err) {
      setNote({ kind: "error", text: (err as Error).message || "Görsel kaydedilemedi." });
    } finally {
      setBusy("");
    }
  }
  const sceneFormat = scenes[0]?.format;
  const addScene = () => {
    if (!font) return;
    if (sceneFormat && sceneFormat !== format) return setNote({ kind: "error", text: `Sahneler ${FORMATS[sceneFormat].label} formatında; aynı formatta ekleyin ya da sahneleri temizleyin.` });
    if (scenes.length >= 20) return setNote({ kind: "error", text: "En fazla 20 sahne eklenebilir." });
    const thumb = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(format, view, font.measure, font.css))}`;
    setScenes((s) => [...s, { id: newId(), els: view, seconds: 4, format, thumb }]);
    setNote({ kind: "ok", text: `Sahne ${scenes.length + 1} eklendi. Tasarımı değiştirip bir sonraki sahneyi ekleyebilirsiniz.` });
  };
  const moveScene = (i: number, d: -1 | 1) =>
    setScenes((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  async function makeVideo() {
    if (!font || !scenes.length) return;
    videoAbort.current?.abort();
    const ac = (videoAbort.current = new AbortController());
    if (videoUrl.current) URL.revokeObjectURL(videoUrl.current);
    videoUrl.current = undefined;
    setVideo({ progress: 0 });
    try {
      const { blob, ext } = await renderVideo(scenes, { format: sceneFormat!, transition, motion, music }, font.measure, font.css, (p) => setVideo((v) => (v && !v.url ? { ...v, progress: p } : v)), ac.signal);
      if (ac.signal.aborted) return; // cancelled or left at the very end: no URL nobody will free
      videoUrl.current = URL.createObjectURL(blob);
      setVideo({ progress: 1, url: videoUrl.current, ext });
    } catch (e) {
      setVideo(ac.signal.aborted ? null : { progress: 0, error: (e as Error).message || "Video oluşturulamadı." });
    }
  }
  const videoSeconds = scenes.reduce((s, x) => s + x.seconds, 0);

  const saveProject = () => download(new Blob([JSON.stringify({ kind: "kurum-ai-gorsel", version: 1, template, format, els: view })], { type: "application/json" }), `kurum-gorsel-${template}-${format}.json`);
  const openProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error("Proje dosyası çok büyük.");
      const j = JSON.parse(await file.text()) as { kind?: unknown; format?: unknown; els?: unknown };
      if (j.kind !== "kurum-ai-gorsel" || typeof j.format !== "string" || !Object.hasOwn(FORMATS, j.format)) throw new Error("Bu bir Görsel Stüdyo proje dosyası değil.");
      const next = cleanEls(j.els);
      if (!next.length) throw new Error("Proje dosyasında öğe yok.");
      setFormat(j.format as FormatId);
      change(next);
      setSelected(null);
      setNote({ kind: "ok", text: "Proje açıldı." });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message || "Proje açılamadı." });
    }
  };

  /** What the field says now: its element on an edited canvas, else the text fields. */
  const fieldText = (k: Field) => (els ? ((view.find((e) => e.kind === "text" && e.role === k) as TextEl | undefined)?.text ?? "") : content[k]).trim();
  const fields: [Field, string][] =
    template === "alinti" ? [["title", "Söz"], ["subtitle", "Söyleyen"], ["detail", "Unvan / kurum"]] : [["tag", "Etiket"], ["title", "Başlık"], ["subtitle", "Açıklama"], ["detail", "Tarih, yer ya da adres"]];

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-panel/80 px-3 backdrop-blur md:px-4">
        <Link href="/" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">
          <ArrowLeft size={16} /> Asistan
        </Link>
        <span className="h-5 w-px bg-line" aria-hidden />
        <h1 className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold">Görsel Stüdyo</h1>
        <button className={iconBtn} onClick={undo} disabled={!hist.past.length} aria-label="Geri al" title="Geri al (Ctrl+Z)">
          <Undo2 size={16} />
        </button>
        <button className={iconBtn} onClick={redo} disabled={!hist.future.length} aria-label="Yinele" title="Yinele (Ctrl+Y)">
          <Redo2 size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button className={iconBtn} onClick={saveProject} aria-label="Projeyi kaydet" title="Projeyi dosya olarak kaydet (düzenlemeye sonra devam etmek için)">
          <Save size={16} />
        </button>
        <label className={`${iconBtn} cursor-pointer`} title="Proje dosyası aç">
          <FolderOpen size={16} />
          <span className="sr-only">Proje aç</span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { openProject(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <ThemeToggle />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: start from a template, texts, brand */}
        <aside className="order-2 min-h-0 overflow-y-auto border-line bg-panel lg:order-1 lg:w-[320px] lg:shrink-0 lg:border-r">
          <section className={section} aria-labelledby="t-template">
            <h2 id="t-template" className={heading}>Şablon</h2>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TEMPLATES) as TemplateId[]).map((t) => (
                <button key={t} onClick={() => chooseTemplate(t)} aria-pressed={template === t} className={`overflow-hidden rounded-xl border text-left transition-all ${template === t ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent/60"}`}>
                  <span className="block aspect-square bg-subtle">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data: SVG thumbnail */}
                    {thumbs[t] && <img src={thumbs[t]} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="block px-2 py-1.5 text-xs font-medium">{TEMPLATES[t].label}</span>
                </button>
              ))}
            </div>
            <div role="group" aria-label="Format" className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-subtle p-1">
              {(Object.keys(FORMATS) as FormatId[]).map((f) => (
                <button key={f} aria-pressed={format === f} title={`${FORMATS[f].hint} · ${FORMATS[f].w}×${FORMATS[f].h}`} onClick={() => chooseFormat(f)} className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors ${format === f ? "bg-panel text-fg shadow-card" : "text-muted hover:text-fg"}`}>
                  <span className="grid h-6 place-items-center" aria-hidden>
                    <span className="block rounded-[3px] border-2 border-current" style={{ width: FORMATS[f].w > FORMATS[f].h ? 22 : (22 * FORMATS[f].w) / FORMATS[f].h, height: FORMATS[f].w > FORMATS[f].h ? (22 * FORMATS[f].h) / FORMATS[f].w : 22 }} />
                  </span>
                  {FORMATS[f].label}
                </button>
              ))}
            </div>
            {els && <p className="text-xs text-muted">Şablon ya da format değiştirmek düzenlemeleri sıfırlar; Ctrl+Z ile geri alabilirsiniz.</p>}
          </section>

          <section className={section} aria-labelledby="t-ai">
            <h2 id="t-ai" className={heading}>Yapay zekâ ile yaz</h2>
            {docs.length > 0 && (
              <label className="block space-y-1">
                <span className="text-xs font-medium">Belgeden yaz <span className="font-normal text-muted">(isteğe bağlı)</span></span>
                <select value={docId} onChange={(e) => setDocId(e.target.value)} className={field}>
                  <option value="">Belge kullanma</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            )}
            <textarea aria-labelledby="t-ai" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} rows={3} placeholder="Konuyu anlatın: ör. 12 Kasım'da kongre salonunda yatırımcı buluşması, saat 10.00" className={`${field} resize-none`} />
            <div className="flex items-center gap-2">
              <button onClick={suggest} disabled={(!brief.trim() && !docId) || busy === "fill"} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40">
                {busy === "fill" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy === "fill" ? "Yazılıyor…" : "Metinleri öner"}
              </button>
              {busy === "fill" && (
                <button onClick={cancelSuggest} className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-fg" aria-label="İptal">
                  <X size={16} />
                </button>
              )}
            </div>
            <p className="text-xs text-muted">{docId ? "Metinler yalnızca seçilen belgedeki bilgilerle yazılır; belge zaten kurum sunucusunda. " : "Yalnızca bu açıklama kurum sunucusundaki modele gider. "}Görselleriniz tarayıcınızda kalır.</p>
          </section>

          <section className={section} aria-labelledby="t-text">
            <h2 id="t-text" className={heading}>Metinler</h2>
            {fields.map(([k, label]) => (
              <label key={k} className="block space-y-1">
                <span className="flex justify-between gap-2 text-xs font-medium">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {label}
                    {(() => {
                      const s = sources[k];
                      if (!s || s.text !== fieldText(k)) return null;
                      return (
                        <span
                          className={`truncate font-normal ${s.claim.status === "ok" ? "text-ok" : s.claim.status === "weak" ? "text-warn-fg" : "text-danger"}`}
                          title={s.claim.quote ? `“${s.claim.quote}”` : "Belgede eşleşen yer bulunamadı"}
                        >
                          · {s.claim.source ?? "belgede eşleşmedi"}
                        </span>
                      );
                    })()}
                  </span>
                  <span className="shrink-0 font-normal tabular-nums text-muted">{content[k].length}/{LIMITS[k]}</span>
                </span>
                {k === "subtitle" || (k === "title" && template === "alinti") ? (
                  <textarea value={content[k]} onChange={(e) => editField(k, e.target.value)} onBlur={() => els && change(els)} maxLength={LIMITS[k]} rows={2} className={`${field} resize-none`} />
                ) : (
                  <input value={content[k]} onChange={(e) => editField(k, e.target.value)} onBlur={() => els && change(els)} maxLength={LIMITS[k]} className={field} />
                )}
              </label>
            ))}
          </section>

          <section className={section} aria-labelledby="t-video">
            <h2 id="t-video" className={heading}>Video (Reels)</h2>
            <p className="text-xs text-muted">Her sahne bir tasarımdır: tasarlayın, sahne olarak ekleyin, sonrakini tasarlayın. Video bu tarayıcıda oluşturulur; hiçbir şey sunucuya gitmez.</p>
            <button onClick={addScene} disabled={!font} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-40">
              <Clapperboard size={15} /> Bu tasarımı sahne olarak ekle
            </button>
            {scenes.length > 0 && (
              <>
                <ol className="space-y-1.5">
                  {scenes.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line p-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local data: SVG of the scene */}
                      <img src={s.thumb} alt={`Sahne ${i + 1}`} className="h-12 w-auto shrink-0 rounded border border-line" style={{ aspectRatio: `${FORMATS[s.format].w} / ${FORMATS[s.format].h}` }} />
                      <span className="text-xs font-medium tabular-nums">{i + 1}.</span>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <select aria-label={`Sahne ${i + 1} süresi`} value={s.seconds} onChange={(e) => setScenes((x) => x.map((y) => (y.id === s.id ? { ...y, seconds: +e.target.value } : y)))} className="h-7 rounded-md border border-line bg-panel px-1 text-xs text-fg">
                          {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} sn</option>)}
                        </select>
                      </label>
                      <span className="ml-auto flex">
                        <button className={iconBtn} onClick={() => moveScene(i, -1)} disabled={i === 0} aria-label={`Sahne ${i + 1} yukarı`}><ChevronUp size={14} /></button>
                        <button className={iconBtn} onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1} aria-label={`Sahne ${i + 1} aşağı`}><ChevronDown size={14} /></button>
                        <button className={`${iconBtn} hover:text-danger`} onClick={() => setScenes((x) => x.filter((y) => y.id !== s.id))} aria-label={`Sahne ${i + 1} sil`}><Trash2 size={14} /></button>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-muted">Geçiş</span>
                    <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)} className="h-8 w-full rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent">
                      <option value="fade">Yumuşak geçiş</option>
                      <option value="slide">Kaydırma</option>
                      <option value="none">Kesme</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-1.5 pb-1.5 text-xs">
                    <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} /> Hareket (yakınlaşma, belirme)
                  </label>
                </div>
                <Picker label={music ? music.name.slice(0, 28) : "Müzik ekle (isteğe bağlı)"} accept=".mp3,.wav,.ogg,.m4a,audio/*" onPick={(f) => f && setMusic(f)} onClear={music ? () => setMusic(undefined) : undefined} />
                <p className="text-xs text-muted">{scenes.length} sahne · {videoSeconds} sn · {FORMATS[sceneFormat!].w}×{FORMATS[sceneFormat!].h} · {recorderType()?.ext.toUpperCase() ?? "desteklenmiyor"}. Kayıt gerçek sürede yapılır; bu sekme açık kalmalı.</p>
                {video && !video.url && !video.error ? (
                  <div className="space-y-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(video.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Video oluşturuluyor">
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(video.progress * 100)}%` }} />
                    </div>
                    <button onClick={() => videoAbort.current?.abort()} className="w-full rounded-lg border border-line py-1.5 text-xs text-muted hover:text-fg">İptal</button>
                  </div>
                ) : (
                  <button onClick={makeVideo} disabled={!recorderType()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                    <Film size={15} /> Videoyu oluştur
                  </button>
                )}
                {video?.error && <p role="alert" className="text-xs text-danger">{video.error}</p>}
                {video?.url && (
                  <div className="space-y-1.5">
                    <video src={video.url} controls className="w-full rounded-lg border border-line bg-black" style={{ aspectRatio: `${FORMATS[sceneFormat!].w} / ${FORMATS[sceneFormat!].h}`, maxHeight: 320 }} />
                    <a href={video.url} download={`kurum-video.${video.ext}`} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-sm hover:border-accent hover:text-accent">
                      <Download size={15} /> İndir ({video.ext?.toUpperCase()})
                    </a>
                  </div>
                )}
              </>
            )}
          </section>

          <section className={section} aria-labelledby="t-brand">
            <h2 id="t-brand" className={heading}>Marka kiti</h2>
            <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Renk temaları">
              {THEMES.map((t) => (
                <button key={t.name} title={t.name} aria-label={`${t.name} teması`} aria-pressed={brand.primary === t.primary && brand.accent === t.accent} onClick={() => setColors(t.primary, t.accent)} className={`h-8 overflow-hidden rounded-md border-2 ${brand.primary === t.primary && brand.accent === t.accent ? "border-accent" : "border-transparent"}`}>
                  <span className="flex size-full">
                    <span className="flex-1" style={{ background: t.primary }} />
                    <span className="flex-1" style={{ background: t.accent }} />
                  </span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([["primary", "Ana renk"], ["accent", "Vurgu"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
                  <input type="color" value={brand[k]} onChange={(e) => setColors(k === "primary" ? e.target.value : brand.primary, k === "accent" ? e.target.value : brand.accent)} className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{label}</span>
                    <span className="block font-mono text-[11px] uppercase text-muted">{brand[k]}</span>
                  </span>
                </label>
              ))}
            </div>
            <Picker label={brand.logo ? "Logoyu değiştir" : "Logo ekle"} accept=".png,.jpg,.jpeg,.webp,.svg" onPick={(f) => pick("logo", f)} preview={brand.logo?.src} contain onClear={brand.logo ? () => saveBrand({ ...brand, logo: undefined }) : undefined} />
            <Picker label={photo ? "Fotoğrafı değiştir" : "Şablon fotoğrafı"} accept=".png,.jpg,.jpeg,.webp" onPick={(f) => pick("photo", f)} preview={photo?.src} onClear={photo ? () => { setPhoto(undefined); if (!els) setSelected(null); } : undefined} />
            <p className="text-xs text-muted">Logo olduğu gibi kullanılır: kırpılmaz, renklendirilmez, oranı korunur. Marka kiti yalnızca bu tarayıcıda saklanır.</p>
          </section>
        </aside>

        {/* Centre: toolbar, canvas, export */}
        <main className="order-1 flex min-h-[60vh] min-w-0 flex-1 flex-col lg:order-2">
          <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel px-3 py-1.5">
            <span className="mr-1 text-xs text-muted">Ekle:</span>
            <ToolBtn onClick={addText} icon={<Type size={15} />} label="Metin" />
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg focus-within:ring-2 focus-within:ring-accent/40">
              <ImageIcon size={15} /> Görsel
              <input type="file" accept=".png,.jpg,.jpeg,.webp" className="sr-only" onChange={(e) => { pick("image", e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <ToolBtn onClick={addShape} icon={<Shapes size={15} />} label="Şekil" />
            <ToolBtn onClick={addLogo} icon={<Stamp size={15} />} label="Logo" />
            <span className="ml-auto hidden text-xs text-muted xl:block">Çift tıkla: metni düzenle · Shift: oranı koru · Alt: hizalamasız taşı</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8" style={{ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "18px 18px" }} onPointerDown={() => { setSelected(null); setEditing(null); }}>
            {font ? (
              <div className="flex max-h-full max-w-full" style={{ aspectRatio: `${W} / ${H}`, height: "100%" }} onPointerDown={(e) => e.stopPropagation()}>
                <Editor format={format} els={view} measure={font.measure} selected={selected} onSelect={setSelected} onChange={change} editing={editing} onEditing={setEditing} />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">{fontError || <><Loader2 size={16} className="animate-spin" /> Hazırlanıyor…</>}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-2.5">
            <span className="mr-auto text-xs text-muted">{W}×{H} · {FORMATS[format].label}</span>
            {note && (
              <p role={note.kind === "error" ? "alert" : "status"} className={`order-first w-full text-sm sm:order-none sm:w-auto ${note.kind === "error" ? "text-danger" : "text-ok"}`}>
                {note.text}
              </p>
            )}
            {EXPORTS.map((e) => (
              <button key={e.ext} onClick={() => exportAs(e)} disabled={!font || busy === "export"} className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-40 ${e.ext === "png" ? "bg-accent text-accent-fg hover:opacity-90" : "border border-line bg-panel hover:border-accent hover:text-accent"}`}>
                <Download size={15} /> {e.label}
              </button>
            ))}
          </div>
        </main>

        {/* Right: the selected element, then all layers */}
        <aside className="order-3 min-h-0 overflow-y-auto border-line bg-panel lg:w-[290px] lg:shrink-0 lg:border-l">
          {sel ? (
            <Inspector key={sel.id} el={sel} brand={brand} u={u} canvas={{ w: W, h: H }} onPatch={(p, commit) => patch(sel.id, p, commit)} onCommit={() => change(view)} onRemove={() => remove(sel.id)} onDuplicate={() => duplicate(sel.id)} onOrder={(to) => reorder(sel.id, to)} onReplace={(f) => replacePicture(sel.id, f)} />
          ) : (
            <section className={section}>
              <h2 className={heading}>Özellikler</h2>
              <p className="text-sm text-muted">Tuvalde bir öğeye tıklayın: konumunu, boyutunu, yazı boyutunu ve rengini buradan değiştirebilirsiniz. Logo ve görseller oranını koruyarak büyür.</p>
            </section>
          )}
          <section className={section} aria-labelledby="t-layers">
            <h2 id="t-layers" className={`${heading} flex items-center gap-1.5`}><Layers size={13} /> Katmanlar</h2>
            <ul className="space-y-0.5">
              {[...view].reverse().map((e) => (
                <li key={e.id} className={`flex items-center gap-1 rounded-md pr-1 text-sm ${e.id === selected ? "bg-accent-soft text-fg" : "hover:bg-subtle"}`}>
                  <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" onClick={() => setSelected(e.id)}>
                    {e.kind === "text" ? <Type size={14} className="shrink-0 text-muted" /> : e.kind === "image" ? <ImageIcon size={14} className="shrink-0 text-muted" /> : <Square size={14} className="shrink-0 text-muted" />}
                    <span className="truncate">{e.kind === "text" && e.text.trim() ? `${e.name}: ${e.text.trim().slice(0, 24)}` : e.name}</span>
                  </button>
                  <button className={iconBtn} onClick={() => patch(e.id, { locked: !e.locked })} aria-label={e.locked ? `${e.name} kilidini aç` : `${e.name} kilitle`} title={e.locked ? "Kilidi aç" : "Kilitle"}>
                    {e.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ToolBtn({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg">
      {icon} {label}
    </button>
  );
}

function Num({ label, value, onChange, onCommit, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; onCommit: () => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-muted">{label}</span>
      <input type="number" className={small} value={Math.round(value * 10) / 10} step={step} min={min} max={max} onChange={(e) => e.target.value !== "" && Number.isFinite(+e.target.value) && onChange(+e.target.value)} onBlur={onCommit} />
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, onCommit, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; onCommit: () => void; show: string }) {
  return (
    <label className="block">
      <span className="mb-0.5 flex justify-between text-[11px] text-muted">
        {label}
        <span className="tabular-nums">{show}</span>
      </span>
      <input type="range" className="w-full accent-[var(--accent)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} onPointerUp={onCommit} onKeyUp={onCommit} />
    </label>
  );
}

interface InspectorProps {
  el: El;
  canvas: { w: number; h: number };
  brand: Brand;
  u: number;
  onPatch: (p: Partial<El>, commit: boolean) => void;
  onCommit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onOrder: (to: "front" | "back" | "up" | "down") => void;
  onReplace: (f: File | undefined) => void;
}

function Inspector({ el, canvas, brand, u, onPatch, onCommit, onRemove, onDuplicate, onOrder, onReplace }: InspectorProps) {
  const live = (p: Partial<El>) => onPatch(p, false);
  const now = (p: Partial<El>) => onPatch(p, true);
  const swatches = [...new Set([brand.primary, brand.accent, "#ffffff", "#14263d", "#000000"])];
  const ratio = el.w / el.h;
  const keep = el.kind === "image";

  return (
    <>
      <section className={section}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={heading}>{el.name}</h2>
          <div className="flex">
            <button className={iconBtn} onClick={() => onOrder("front")} disabled={el.locked} aria-label="En öne getir" title="En öne getir"><ArrowUpToLine size={15} /></button>
            <button className={iconBtn} onClick={() => onOrder("back")} disabled={el.locked} aria-label="En arkaya gönder" title="En arkaya gönder"><ArrowDownToLine size={15} /></button>
            <button className={iconBtn} onClick={onDuplicate} aria-label="Çoğalt" title="Çoğalt (Ctrl+D)"><Copy size={15} /></button>
            <button className={`${iconBtn} hover:text-danger`} onClick={onRemove} disabled={el.locked} aria-label="Sil" title="Sil (Delete)"><Trash2 size={15} /></button>
          </div>
        </div>
        {el.locked && <p className="text-xs text-muted">Kilitli: taşınmaz ve seçimde atlanır. Katmanlar listesinden kilidi açabilirsiniz.</p>}
        <div className="grid grid-cols-4 gap-1.5">
          <Num label="X" value={el.x} onChange={(x) => live({ x })} onCommit={onCommit} />
          <Num label="Y" value={el.y} onChange={(y) => live({ y })} onCommit={onCommit} />
          <Num label="Genişlik" value={el.w} min={4} onChange={(w) => live(keep ? { w, h: w / ratio } : { w })} onCommit={onCommit} />
          <Num label="Yükseklik" value={el.h} min={4} onChange={(h) => live(keep ? { h, w: h * ratio } : { h })} onCommit={onCommit} />
        </div>
        <div role="group" aria-label="Tuvale hizala" className="flex items-center justify-between">
          <span className="text-[11px] text-muted">Tuvale hizala</span>
          <div className="flex">
            {([
              [AlignStartVertical, "Sola", { x: 0 }],
              [AlignCenterVertical, "Yatayda ortala", { x: (canvas.w - el.w) / 2 }],
              [AlignEndVertical, "Sağa", { x: canvas.w - el.w }],
              [AlignStartHorizontal, "Üste", { y: 0 }],
              [AlignCenterHorizontal, "Dikeyde ortala", { y: (canvas.h - el.h) / 2 }],
              [AlignEndHorizontal, "Alta", { y: canvas.h - el.h }],
            ] as const).map(([Icon, label, p]) => (
              <button key={label} className={iconBtn} disabled={el.locked} onClick={() => now(p)} aria-label={`Tuvale göre ${label.toLocaleLowerCase("tr")} hizala`} title={label}>
                <Icon size={15} />
              </button>
            ))}
          </div>
        </div>
        <Slider label="Saydamlık" value={el.opacity ?? 1} min={0.1} max={1} step={0.05} show={`%${Math.round((el.opacity ?? 1) * 100)}`} onChange={(opacity) => live({ opacity })} onCommit={onCommit} />
      </section>

      {el.kind === "text" && (
        <section className={section}>
          <h3 className={heading}>Yazı</h3>
          <textarea aria-label="Metin" value={el.text} onChange={(e) => live({ text: e.target.value })} onBlur={onCommit} rows={3} className={`${field} resize-y`} lang="tr" />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Yazı boyutu" value={el.size} min={6} max={600} onChange={(size) => live({ size, auto: false })} onCommit={onCommit} />
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-muted">Kalınlık</span>
              <select className={small} value={el.weight} onChange={(e) => now({ weight: +e.target.value })}>
                {WEIGHTS.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
              </select>
            </label>
          </div>
          <Slider label="Boyut" value={el.size} min={Math.round(12 * u)} max={Math.round(300 * u)} step={1} show={`${Math.round(el.size)} px`} onChange={(size) => live({ size, auto: false })} onCommit={onCommit} />
          <div className="flex items-center justify-between">
            <div role="group" aria-label="Hizalama" className="flex rounded-lg border border-line bg-subtle p-0.5">
              {([["start", AlignLeft, "Sola"], ["middle", AlignCenter, "Ortaya"], ["end", AlignRight, "Sağa"]] as const).map(([a, Icon, label]) => (
                <button key={a} className={chip(el.align === a)} aria-pressed={el.align === a} aria-label={`${label} hizala`} title={`${label} hizala`} onClick={() => now({ align: a })}>
                  <Icon size={14} />
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={!!el.upper} onChange={(e) => now({ upper: e.target.checked })} /> BÜYÜK HARF
            </label>
          </div>
          <Swatches swatches={swatches} value={el.color} set={(color) => now({ color })} />
          <Slider label="Satır aralığı" value={el.leading} min={0.8} max={2} step={0.02} show={el.leading.toFixed(2)} onChange={(leading) => live({ leading })} onCommit={onCommit} />
          <Slider label="Harf aralığı" value={el.tracking} min={-4 * u} max={30 * u} step={0.5} show={`${el.tracking.toFixed(1)} px`} onChange={(tracking) => live({ tracking })} onCommit={onCommit} />
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={el.auto} onChange={(e) => now({ auto: e.target.checked })} />
            <span>Kutuya sığdır <span className="text-muted">(metin uzarsa küçülür; kapalıyken taşan kısım … ile kesilir)</span></span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!el.bg} onChange={(e) => now({ bg: e.target.checked ? { fill: brand.accent, radius: el.h / 2 } : undefined })} /> Arka plan kutusu
          </label>
          {el.bg && (
            <>
              <Swatches swatches={swatches} value={el.bg.fill} set={(fill) => now({ bg: { ...el.bg!, fill } })} />
              <Slider label="Köşe" value={el.bg.radius} min={0} max={Math.round(el.h / 2)} step={1} show={`${Math.round(el.bg.radius)} px`} onChange={(radius) => live({ bg: { ...el.bg!, radius } })} onCommit={onCommit} />
            </>
          )}
        </section>
      )}

      {el.kind === "image" && (
        <section className={section}>
          <h3 className={heading}>{el.logo ? "Logo" : "Görsel"}</h3>
          {!el.logo && (
            <div role="group" aria-label="Yerleşim" className="flex rounded-lg border border-line bg-subtle p-0.5">
              <button className={`flex-1 ${chip(el.fit === "cover")}`} aria-pressed={el.fit === "cover"} onClick={() => now({ fit: "cover" })}>Kutuyu doldur</button>
              <button className={`flex-1 ${chip(el.fit === "contain")}`} aria-pressed={el.fit === "contain"} onClick={() => now({ fit: "contain" })}>Tamamı görünsün</button>
            </div>
          )}
          <Slider label="Köşe yuvarlaklığı" value={el.radius ?? 0} min={0} max={Math.round(Math.min(el.w, el.h) / 2)} step={1} show={`${Math.round(el.radius ?? 0)} px`} onChange={(radius) => live({ radius })} onCommit={onCommit} />
          <label className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted hover:border-accent hover:text-accent">
            <ImagePlus size={15} /> {el.logo ? "Logoyu değiştir" : "Görseli değiştir"}
            <input type="file" accept={el.logo ? ".png,.jpg,.jpeg,.webp,.svg" : ".png,.jpg,.jpeg,.webp"} className="sr-only" onChange={(e) => { onReplace(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {el.logo && <p className="text-xs text-muted">Logo yalnızca oranı korunarak büyütülüp küçültülür.</p>}
        </section>
      )}

      {el.kind === "shape" && (
        <section className={section}>
          <h3 className={heading}>Şekil</h3>
          {el.fill.kind === "solid" ? (
            <Swatches swatches={swatches} value={el.fill.color} set={(color) => now({ fill: { kind: "solid", color } })} />
          ) : (
            <div className="space-y-2">
              {el.fill.stops.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted">
                  {i ? "Bitiş" : "Başlangıç"}
                  <Swatches swatches={swatches} value={s.color} set={(color) => { if (el.fill.kind !== "linear") return; const stops = [...el.fill.stops] as typeof el.fill.stops; stops[i] = { ...stops[i], color }; now({ fill: { ...el.fill, stops } }); }} />
                </div>
              ))}
            </div>
          )}
          <Slider label="Köşe" value={el.radius ?? 0} min={0} max={Math.round(Math.min(el.w, el.h) / 2)} step={1} show={`${Math.round(el.radius ?? 0)} px`} onChange={(radius) => live({ radius })} onCommit={onCommit} />
        </section>
      )}
    </>
  );
}

function Swatches({ value, set, swatches }: { value: string; set: (c: string) => void; swatches: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="color" value={value} onChange={(e) => set(e.target.value)} className="size-7 cursor-pointer rounded border border-line bg-transparent p-0" aria-label="Renk seç" />
      {swatches.map((c) => (
        <button key={c} onClick={() => set(c)} className={`size-6 rounded-full border ${value.toLowerCase() === c ? "ring-2 ring-accent ring-offset-1" : "border-line"}`} style={{ background: c }} aria-label={`Renk ${c}`} title={c} />
      ))}
    </div>
  );
}

function Picker({ label, accept, onPick, preview, onClear, contain }: { label: string; accept: string; onPick: (f: File | undefined) => void; preview?: string; onClear?: () => void; contain?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- local data: URL
        <img src={preview} alt="" className={`size-10 shrink-0 rounded-lg border border-line bg-subtle ${contain ? "object-contain p-1" : "object-cover"}`} />
      )}
      <label className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted transition-colors hover:border-accent hover:text-accent focus-within:border-accent">
        <ImagePlus size={15} /> {label}
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
