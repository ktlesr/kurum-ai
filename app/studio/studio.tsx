"use client";

// Görsel Stüdyo (plan §6.1). A template lays out the first design; then every element can be selected, moved,
// resized and restyled on the canvas. Photos, the logo and the brand kit stay in this browser; only the brief goes
// to the server (POST /api/studio) for a text suggestion. The SVG from lib/studio is the canvas and every export.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowLeft, ArrowUpToLine, Check, ClipboardPaste, Copy, Download, FolderOpen, Image as ImageIcon, LayoutTemplate, Minus, Plus, SlidersHorizontal,
  Presentation, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, BoxSelect, FlipHorizontal2, FlipVertical2, Palette, Italic, MoveDown, MoveUp, Paintbrush, Pencil, RotateCcw, Scissors, Underline,
  ChevronDown, ChevronUp, Clapperboard, Film, ImagePlus, Layers, Library, Loader2, Lock, LockOpen, Redo2, Save, Shapes, Sparkles, Stamp, Trash2, Type, Undo2, X,
} from "lucide-react";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import { trackUsage } from "../presence";
import Home, { type Mode } from "./home";
import Toolbar, { keepSelection } from "./toolbar";
import { LogoPicker } from "./logo-picker";
import { LayerList } from "./layer-list";
import { STORY_RANGE, albumTemplate, reelsScene, reelsTransition, type StoryPage } from "@/lib/studio-story";
import { ShapeChooser, ShapeGrid, ShapeStyleTabs, shapeIdOf } from "./shape-palette";
import Editor from "./editor";
import ContextMenu, { type MenuItem } from "./context-menu";
import ArtPicker from "./art-picker";
import { DeckPanel, DesignList, SourcePicker, DesignPreview, LayoutPicker, SlideStrip, loadDesign, loadTemplate, type DeckContent } from "./deck-panel";
import { MasterPanel } from "./master-panel";
import { composeDeck } from "@/lib/deck-compose";
import { DESIGNS, type DeckDesign } from "@/lib/deck-design";
import { DEFAULT_MASTER, applyMaster, masterOn, setPick, splitMaster, withoutMaster, type DeckMaster } from "@/lib/deck-master";
import { downloadPptx } from "./pptx";
import { MAX_SLIDES, rethemeSlides, slideFrom, type DeckTemplate, type Layout } from "@/lib/deck";
import FontPicker from "./font-picker";
import { THEMES, type Theme } from "@/lib/themes";
import { OPEN_COLOR } from "@/lib/studio-assets";
import { familyNames, ensureFont } from "./fonts";
import type { Claim } from "@/lib/trace";
import { recorderType, renderVideo, type Scene } from "./video";
import { MAX_LOGOS, listLogos, putLogo, removeLogo, type SavedLogo } from "./logos";
import { tintSvg } from "@/lib/studio-assets";
import { BACKDROPS, ENTRANCES, MAX_SCENES, REELS_PACKS, SCENE_SECONDS, TRANSITIONS, cleanVideo, type Backdrop, type Entrance, type ReelsPack, type SavedVideo, type Transition } from "@/lib/studio-video";
import { cleanDeck, listWorks, removeWork, saveWork, thumbnail, type SavedDeck, type Work, patchVideo } from "./works";
import { cuesOf, toSrt, toVtt } from "@/lib/subtitles";
import { EXPORTS, SAMPLE, brandKey, download, imageOf, loadBrand, readPicture, thumbOf, useStudioFont, whiteLogo } from "./media";
import {
  DEFAULT_BRAND, FORMATS, LIMITS, GRADIENT_DIRS, MAX_PIC_ZOOM, SHAPES, TEMPLATES, templatesOf, aabb, alignEls, fitPill, inkOn, shade, cleanEls, distributeEls, type AlignTo, fromTemplate, hug, newId, refit, shapeFrom, shapeStyleOf, changeShape, svgOf, toSvg, isHolder, TEXT_WEIGHTS, editedText, fontsOfText, setTextStyle, textStyleAt, type TextStyle, type GradientDir, type ShapeId, type ShapeStyle,
  type Brand, type Content, type El, type FormatId, type ImageEl, type Picture, type Role, type ShapeEl, type TemplateId, type TextEl,
} from "@/lib/studio";

/** Colour pairs to start a brand kit from (ana renk, vurgu). */
const HISTORY = 100;
const AUTOSAVE_MS = 1500;
const TOOLS = {
  deck: { label: "Sunum", Icon: Presentation },
  master: { label: "Asıl slayt", Icon: LayoutTemplate },
  scenes: { label: "Sahneler", Icon: Clapperboard },
  templates: { label: "Şablon", Icon: LayoutTemplate },
  ai: { label: "Yapay zekâ", Icon: Sparkles },
  text: { label: "Metin", Icon: Type },
  elements: { label: "Öğeler", Icon: Shapes },
  images: { label: "Görsel", Icon: ImageIcon },
  brand: { label: "Marka", Icon: Palette },
  layers: { label: "Katmanlar", Icon: Layers },
  edit: { label: "Ayarlar", Icon: SlidersHorizontal },
};
type Tool = keyof typeof TOOLS;
const RAIL: Record<Mode, Tool[]> = {
  gorsel: ["templates", "ai", "text", "elements", "images", "brand", "layers", "edit"],
  sunum: ["deck", "master", "text", "elements", "images", "brand", "layers", "edit"],
  video: ["scenes", "templates", "ai", "text", "elements", "images", "brand", "layers", "edit"],
};
type Snap = { els: El[]; format: FormatId; primary: string; accent: string; deck?: { slides: El[][]; at: number; theme?: Theme; primary: string } };
type Field = Exclude<Role, "deco">;

const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent";
const small = "h-8 w-full rounded-md border border-line bg-panel px-2 text-sm tabular-nums outline-none focus:border-accent";
const section = "space-y-3 border-b border-line px-4 py-4";
const heading = "text-[11px] font-semibold uppercase tracking-wider text-muted";
const iconBtn = "grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";
const chip = (on: boolean) => `rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? "bg-panel text-fg shadow-card" : "text-muted hover:text-fg"}`;

/** Scenes each carry their pictures; past this a project file couldn't be opened again (openProject reads up to 60 MB). */
const MAX_PROJECT_BYTES = 60 * 1024 * 1024;
const MAX_SCENE_CHARS = 50 * 1024 * 1024;
const scenesTooBig = (lists: unknown[]) => lists.reduce<number>((n, l) => n + JSON.stringify(l).length, 0) > MAX_SCENE_CHARS;
const SCENES_TOO_BIG = "Sahnelerdeki görseller çok büyük (toplam 50 MB sınırı). Daha küçük görsel kullanın ya da sahne sayısını azaltın.";
/** What a post of several images keeps in the deck's place: it has no slide layouts. */
const ALBUM_TEMPLATE: DeckTemplate = { id: "album", name: "Çoklu görsel", desc: "", layouts: [] };
/** A deck's colours by role: the theme on it, or the ones its template states; none: lib/deck goes by how much each is used. */
const deckRoles = (d: { theme?: Theme; template: DeckTemplate }) =>
  d.theme ? [d.theme.primary, d.theme.accent] : d.template.roles ? [d.template.roles.primary, d.template.roles.accent] : [];
/** Every colour in the design that was the old brand colour becomes the new one. */
const stamp = () => Date.now();
/** Brand colours changed: everything drawn in them follows (and the shades the templates derive from them). */
function recolor(els: El[], a: Brand, b: Brand): El[] {
  const map = new Map<string, string>([
    [shade(a.primary, -0.25), shade(b.primary, -0.25)],
    [shade(a.primary, -0.6), shade(b.primary, -0.6)],
    [shade(a.accent, -0.2), shade(b.accent, -0.2)],
    [shade(a.accent, 0.75), shade(b.accent, 0.75)],
    [a.primary, b.primary],
    [a.accent, b.accent],
  ]);
  const c = (x: string) => map.get(x.toLowerCase()) ?? x;
  return els.map((e) => {
    if (e.kind === "text") {
      if (!e.bg) return { ...e, color: c(e.color) };
      // A pill's letters stay readable on its new colour.
      const fill = c(e.bg.fill);
      return { ...e, color: e.color === inkOn(e.bg.fill) ? inkOn(fill) : c(e.color), bg: { ...e.bg, fill } };
    }
    if (e.kind === "shape")
      return {
        ...e,
        fill: e.fill.kind === "solid" ? { kind: "solid", color: c(e.fill.color) } : { ...e.fill, stops: [{ ...e.fill.stops[0], color: c(e.fill.stops[0].color) }, { ...e.fill.stops[1], color: c(e.fill.stops[1].color) }] },
        ...(e.stroke ? { stroke: { ...e.stroke, color: c(e.stroke.color) } } : {}),
      };
    return e;
  });
}

export default function Studio({ username, isAdmin }: { username: string; isAdmin?: boolean }) {
  const { font, error: fontError } = useStudioFont();
  const [mode, setMode] = useState<Mode | null>(null); // null: the first screen
  const [tool, setTool] = useState<Tool | null>(null); // the panel open beside the rail
  const [zoom, setZoom] = useState(1); // 1: fits the canvas area
  const [recent, setRecent] = useState<Work[]>([]);
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "error">("");
  const [saveError, setSaveError] = useState("");
  const projectInput = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<TemplateId>("atlas");
  const [templateFonts, setTemplateFonts] = useState(0); // counts up as the gallery's fonts arrive: they change every measure
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
  // The chosen elements; one of them alone gets the inspector, several get the alignment panel.
  const [picked, setPicked] = useState<string[]>([]);
  const [activeTheme, setActiveTheme] = useState("");
  // Sunum mode: `els` is the slide on the canvas; the others wait here (slides[at] is out of date until saved back).
  const [deck, setDeck] = useState<{ album?: boolean; template: DeckTemplate; slides: El[][]; at: number; primary: string; theme?: Theme; design?: DeckDesign; master?: DeckMaster; content?: DeckContent } | null>(null);
  const [deckDesign, setDeckDesign] = useState<DeckDesign>(DESIGNS[0]); // the one chosen before a deck exists
  const [designPreview, setDesignPreview] = useState<DeckDesign | null>(null);
  const [deckBefore, setDeckBefore] = useState<NonNullable<typeof deck> | null>(null); // one step back from applying a design
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [artOpen, setArtOpen] = useState(false);
  const [alignCanvas, setAlignCanvas] = useState(false); // several chosen: to each other, or to the canvas
  const selected = picked.length === 1 ? picked[0] : null;
  const setSelected = (id: string | null) => setPicked(id ? [id] : []);
  const [editing, setEditing] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  // The user's own uploaded documents (TASK-025): a poster can be written from one; each field shows its page.
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [docIds, setDocIds] = useState<string[]>([]);
  // The AI panel: a whole work (a video's scenes, a post's images) or the texts of the design on the canvas.
  const [aiTab, setAiTab] = useState<"one" | "many" | null>(null); // null: what suits the kind of work
  const [storyCount, setStoryCount] = useState(0); // 0: the content decides
  const [storyReplace, setStoryReplace] = useState(false);
  const [scenesBefore, setScenesBefore] = useState<typeof scenes | null>(null); // one step back from replacing them, in this work only
  const [textSel, setTextSel] = useState<{ from: number; to: number } | null>(null); // the part of the text being edited that is selected
  // Each field's source with the exact text it was found for: shown only while the field still says that, so a
  // canvas edit, an undo or a new template never keeps a page that belongs to other words.
  const [sources, setSources] = useState<Partial<Record<Field, { claim: Claim; text: string }>>>({});
  const [busy, setBusy] = useState<"" | "fill" | "export">("");
  const [note, setNote] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Video (TASK-026): scenes are snapshots of designs in one format, recorded in the browser.
  const [scenes, setScenes] = useState<(Scene & { format: FormatId; thumb: string })[]>([]);
  const [transition, setTransition] = useState<Transition>("fade");
  const [editingScene, setEditingScene] = useState<string | null>(null); // the scene the canvas holds, "güncelle" puts it back
  // The work the scenes are saved with. Opening a design to add it as a scene must not write the scenes into that design.
  const sceneOwner = useRef<string | null>(null);
  const restoring = useRef(0);
  const [motion, setMotion] = useState(true);
  const [music, setMusic] = useState<File | undefined>();
  const [burnCaptions, setBurnCaptions] = useState(true);
  // "Çalışmalarım": designs kept in this browser (works.ts); workId is the one being edited, so saving updates it.
  const [library, setLibrary] = useState<Work[] | null>(null); // null: panel closed
  const [workId, setWorkId] = useState<string | null>(null);
  const [workName, setWorkName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [libError, setLibError] = useState("");
  const libOpener = useRef<HTMLElement | null>(null); // focus goes back here when the dialog closes
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
  // Right-click menu, its items built when it opens (from an event, with the design as it is then); the element and style clipboards live only in this page.
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number; view: El[] } | null>(null);
  const [clip, setClip] = useState<El[] | null>(null);
  const [styleClip, setStyleClip] = useState<El | null>(null);
  const replaceTarget = useRef<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
  useEffect(() => setBrand(loadBrand(username)), [username]);
  const [logos, setLogos] = useState<SavedLogo[]>([]);
  const brandNow = useRef(brand); // for what finishes after an await: the brand as it is by then
  useLayoutEffect(() => {
    brandNow.current = brand;
  });
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await listLogos(username);
      // The logo kept before there was a library comes in as its first one.
      const old = loadBrand(username).logo;
      if (old && !list.some((l) => l.pic.src === old.src)) {
        const logo = { id: newId(), name: "Logo", pic: old, addedAt: 0 };
        await putLogo(username, logo);
        list.unshift(logo);
      }
      if (live) setLogos(list);
    })().catch(() => {}); // no storage: the panel still takes one logo through the brand kit
    return () => {
      live = false;
    };
  }, [username]);
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

  // Fonts the design uses: loaded on demand, then drawn again (until then: the default font).
  const [, setFontTick] = useState(0);
  const usedFonts = (list: El[]) => [...new Set(list.flatMap((e) => (e.kind === "text" ? fontsOfText(e) : [])))];
  const fontKey = usedFonts(els ?? []).join(",");
  useEffect(() => {
    let live = true;
    for (const id of fontKey ? fontKey.split(",") : [])
      ensureFont(id, username).then(
        () => {
          if (!live) return;
          setFontTick((t) => t + 1);
          // Heights measured with the fallback font: again with the real one (not an undo step).
          if (font) setEls((c) => c && hug(c, font.measure));
        },
        () => live && setNote({ kind: "error", text: "Tasarımdaki bir yazı tipi bu bilgisayarda bulunamadı; varsayılan yazı tipiyle gösteriliyor." }),
      );
    return () => {
      live = false;
    };
  }, [fontKey, username, font]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- templateFonts: the same text measures differently once its font is here
  const generated = useMemo(() => (font ? fromTemplate({ template, format, content, brand, photo }, font.measure) : []), [font, template, format, content, brand, photo, templateFonts]);
  const view = els ?? generated;
  // The latest committed state for callbacks that run later (a suggestion arriving, undo from the keyboard).
  const now = useRef({ view, els, format, hist, brand, clip: null as El[] | null, deck });
  useLayoutEffect(() => {
    now.current = { view, els, format, hist, brand, clip, deck };
  });
  const snap = (): Snap => {
    const { view: v, deck: d } = now.current;
    return { els: v, format: now.current.format, primary: now.current.brand.primary, accent: now.current.brand.accent, ...(d ? { deck: { slides: d.slides.map((x, i) => (i === d.at ? v : x)), at: d.at, theme: d.theme, primary: d.primary } } : {}) };
  };
  const push = (s: Snap) => setHist((h) => ({ past: [...h.past.slice(-HISTORY + 1), s], future: [] }));

  /** A new design state; `commit` makes it one undo step (from where the current gesture started). */
  /** A slide after any change to it: which logo version reads depends on what is on it now. */
  const remaster = (list: El[]) => {
    if (!deck?.master || !list.some((e) => e.master)) return list;
    const total = deck.slides.length;
    const covered = !deck.master.onCovers && total > 1 && (deck.at === 0 || deck.at === total - 1);
    return masterOn(list, deck.master, deck.at + 1, covered, (deck.theme?.body ?? deck.design?.bodyFont));
  };
  const change = (raw: El[], commit = true) => {
    setMenu(null); // its actions belong to the design before this change
    const measured = font ? hug(raw, font.measure) : raw;
    const next = commit ? remaster(measured) : measured;
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
    setMenu(null);
    gesture.current = null; // an unfinished live change belongs to the design that is going away
    // The brand colours go back with the design: later recolouring looks for the colours it is really drawn in.
    if (s.primary !== brand.primary || s.accent !== brand.accent) saveBrand({ ...brand, primary: s.primary, accent: s.accent });
    setActiveTheme("");
    setFormat(s.format);
    setEls(s.els);
    if (s.deck) setDeck((d) => d && { ...d, slides: s.deck!.slides, at: s.deck!.at, theme: s.deck!.theme, primary: s.deck!.primary }); // the order of the slides goes back too
    setPicked((ids) => ids.filter((id) => s.els.some((e) => e.id === id))); // still there: stays chosen
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
    setMenu(null);
    if (now.current.view.length) push(snap());
    setEls(null);
    setSelected(null);
    setEditing(null);
  };

  const patch = (id: string, p: Partial<El>, commit = true) => change(view.map((e) => (e.id === id ? ({ ...e, ...p } as El) : e)), commit);
  const sel = view.find((e) => e.id === selected && !e.master) ?? null; // the master is changed in its own panel
  // While part of a text is selected, the controls show and change that part.
  const textRange = sel?.kind === "text" && editing === sel.id && !sel.bg && textSel && textSel.to > textSel.from ? textSel : null;
  const shownSel: El | null = sel?.kind === "text" && textRange ? { ...sel, ...textStyleAt(sel, textRange.from) } : sel;
  const patchSel = (p: Partial<El>, commit = true) => {
    if (sel?.kind !== "text") return sel && patch(sel.id, p, commit);
    const entries = Object.entries(p);
    const isStyle = ([k]: [string, unknown]) => ["size", "weight", "italic", "underline", "font", "color"].includes(k);
    const style: TextStyle = Object.fromEntries(entries.filter(isStyle));
    const rest = Object.fromEntries(entries.filter((x) => !isStyle(x)));
    change(view.map((e) => (e.id === sel.id ? ({ ...(Object.keys(style).length ? setTextStyle(sel, style, textRange) : sel), ...rest } as El) : e)), commit);
  };

  const saveBrand = (b: Brand) => {
    setBrand(b);
    try {
      localStorage.setItem(brandKey(username), JSON.stringify(b));
    } catch {
      setNote({ kind: "error", text: "Marka kiti bu tarayıcıya kaydedilemedi (depolama dolu). Daha küçük bir logo deneyin." });
    }
  };
  const setColors = (primary: string, accent: string) => {
    if (deck?.album) {
      slideStep(slidesNow().map((page) => recolor(page, brand, { ...brand, primary, accent })), deck.at);
      // Pages made from now on wear these colours in the theme's fonts; it is no longer the named theme.
      setDeck((d) => d && { ...d, primary, ...(d.theme ? { theme: { ...d.theme, name: "", primary, accent } } : {}) });
    }
    else if (els) change(recolor(els, brand, { ...brand, primary, accent }));
    saveBrand({ ...brand, primary, accent });
  };
  /** A theme: its colours, its heading font on titles and tags, its body font on the rest (one undo step). */
  const applyTheme = async (t: Theme) => {
    if (!font) return;
    // The fonts first: no flash of the old ones, and the tag's pill is measured in its new font.
    const start = now.current.view;
    await Promise.allSettled([t.head, t.body].map((id) => ensureFont(id, username)));
    if (now.current.view !== start) return; // edited or switched meanwhile: the user's newer step wins
    const next = { ...brand, primary: t.primary, accent: t.accent };
    if (deck) {
      // Every slide (lib/deck rethemeSlides); fonts were loaded above.
      const recoloured = rethemeSlides(slidesNow(), t, deckRoles(deck));
      // The ground may have gone from dark to light: each slide's logo version is chosen again.
      const all = deck.master ? applyMaster(recoloured, deck.master, t.body) : recoloured;
      setDeck({ ...deck, slides: all, primary: t.primary, theme: t });
      setEls(all[deck.at]);
      setHist({ past: [], future: [] });
      saveBrand(next);
      setActiveTheme(t.name);
      return;
    }
    const cur = now.current.els;
    const base = cur ? recolor(cur, brand, next) : fromTemplate({ template, format, content, brand: next, photo }, font.measure);
    change(base.map((e) => (e.kind === "text" && e.role !== "deco" ? fitPill({ ...e, font: e.role === "title" || e.role === "tag" ? t.head : t.body }, font.measure) : e)));
    saveBrand(next);
    setActiveTheme(t.name);
  };

  /** Text fields on the left: in an edited design they change the element with that role. */
  const editField = (k: Field, v: string) => {
    cancelSuggest();
    setOwnText(true);
    setContent((c) => ({ ...c, [k]: v }));
    if (els) change(els.map((e) => (e.kind === "text" && e.role === k ? { ...e, ...editedText(e, v) } : e)), false);
  };
  const applyContent = (c: Content) => {
    setOwnText(true);
    setContent(c);
    // The design as it is now: the user may have moved or added things while the suggestion was coming.
    const cur = now.current.els;
    if (cur) change(cur.map((e) => (e.kind === "text" && e.role && e.role !== "deco" ? { ...e, text: c[e.role], runs: undefined } : e)));
  };

  const chooseTemplate = (t: TemplateId) => {
    if (deck?.album) {
      cancelSuggest(); // a generation still on its way would bring the old template back
      return void restyleAlbum(t);
    }
    if (deck) return setNote({ kind: "error", text: "Sunumdayken sayfa düzenini alttaki + ile seçin." });
    cancelSuggest();
    setTemplate(t);
    if (!ownText) setContent(SAMPLE[t]);
    reset();
  };
  const chooseFormat = (f: FormatId) => {
    if (f === format) return;
    if (deck?.album) {
      // All the images move together, each with its edits.
      slideStep(slidesNow().map((page) => refit(page, format, f)), deck.at);
      return setFormat(f);
    }
    if (deck) return setNote({ kind: "error", text: "Sunumlar 16:9 yatay formattadır." });
    // An edited design (or an opened work) moves to the new format with its edits; a template one is laid out anew.
    if (els) change(refit(els, format, f));
    else reset();
    setFormat(f);
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
      const r = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template, brief, docIds }), signal: ac.signal });
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
          : { kind: "ok", text: docIds.length ? "Metinler belgeden yazıldı; her alanın sayfası yanında. Tuvalde ya da soldan düzenleyebilirsiniz." : "Metinler yazıldı. Tuvalde çift tıklayarak ya da soldan düzenleyebilirsiniz." },
      );
    } catch (e) {
      if (!ac.signal.aborted) setNote({ kind: "error", text: (e as Error).message });
    } finally {
      if (abort.current === ac) setBusy("");
    }
  }

  const aiMany = aiTab ? aiTab === "many" : mode === "video";
  const storyRange = STORY_RANGE[mode === "video" ? "reels" : "album"];
  /** A design made from a page of text: its fonts loaded, measured in them. */
  const pageFrom = async (t: TemplateId, f: FormatId, c: Content) => {
    await Promise.allSettled((TEMPLATES[t].fonts as readonly string[]).map((id) => ensureFont(id, username)));
    return fontsReady(fromTemplate({ template: t, format: f, content: c, brand, photo }, font!.measure));
  };
  /** The whole work from the text: a video's scenes, or the images of a post. */
  async function writeStory() {
    if (!font) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    const kind = mode === "video" ? "reels" : "album";
    // Another work opened, or the format changed, by the time the answer comes: it no longer belongs on the canvas.
    const turn = restoring.current;
    const stale = () => ac.signal.aborted || turn !== restoring.current || now.current.format !== format;
    setBusy("fill");
    setNote(null);
    try {
      const r = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template, brief, docIds, story: kind, count: storyCount }), signal: ac.signal });
      const j = (await r.json().catch(() => ({}))) as { pages?: StoryPage[]; cut?: boolean; unverified?: number[]; error?: string };
      if (stale()) return;
      if (!r.ok || !j.pages?.length) throw new Error(j.error ?? "İçerik hazırlanamadı.");
      const noun = kind === "reels" ? "sahne" : "görsel";
      const warnings = [
        j.unverified?.length ? `${j.unverified.map((i) => i + 1).join(", ")}. ${noun}teki rakamlar verdiğiniz metinde yok; kontrol edin.` : "",
        j.cut ? "Model sınırına takıldı, son bölüm eksik kalmış olabilir." : "",
        storyCount && j.pages.length < storyCount ? `İstenen ${storyCount} yerine ${j.pages.length} ${noun} çıktı: metindeki bilgi bu kadarına yetti.` : "",
      ].filter(Boolean).join(" ");
      if (kind === "reels") await putScenes(j.pages, stale, warnings);
      else await putImages(j.pages, stale, warnings);
    } catch (e) {
      if (!ac.signal.aborted) setNote({ kind: "error", text: (e as Error).message });
    } finally {
      if (abort.current === ac) setBusy("");
    }
  }
  async function putScenes(pages: StoryPage[], stale: () => boolean, warnings: string) {
    const replace = storyReplace && scenes.length > 0;
    const f = sceneFormat ?? "hikaye";
    const room = MAX_SCENES - (replace ? 0 : scenes.length);
    if (room <= 0) return setNote({ kind: "error", text: `En fazla ${MAX_SCENES} sahne eklenebilir. Yerine koymayı seçin ya da sahne silin.` });
    const fresh = await Promise.all(pages.slice(0, room).map(async (p) => {
      const { template: t, caption, ...plan } = reelsScene(p);
      const made = await pageFrom(t, f, p);
      return { id: newId(), els: made, caption, format: f, thumb: sceneThumb(made, f), ...plan };
    }));
    if (stale()) return;
    if (scenesTooBig([...(replace ? [] : scenes.map((s) => s.els)), ...fresh.map((s) => s.els)])) return setNote({ kind: "error", text: SCENES_TOO_BIG });
    setScenesBefore(replace ? scenes : null);
    setScenes((s) => (replace ? fresh : [...s, ...fresh]).slice(0, MAX_SCENES));
    if (replace) setEditingScene(null);
    setTransition(reelsTransition(pages));
    setTool("scenes");
    // An empty canvas shows the first scene; one the person is working on stays.
    if (!now.current.els) void editScene(fresh[0]);
    else chooseFormat(f);
    const total = fresh.reduce((n, s) => n + s.seconds, 0);
    setNote(warnings ? { kind: "error", text: `${fresh.length} sahne hazır (${total} sn). ${warnings}` } : { kind: "ok", text: `${fresh.length} sahne hazır (${total} sn). Metinler verdiğiniz bilgilerden yazıldı; kullanmadan önce kontrol edin.` });
  }
  /** A page made for this post wears the theme the post has. */
  const wearing = (page: El[]) => (deck?.theme ? rethemeSlides([page], deck.theme, deckRoles(deck))[0] : page);
  async function putImages(pages: StoryPage[], stale: () => boolean, warnings: string) {
    const classic = (TEMPLATES[template].kind as string) === "klasik";
    const slides = (await Promise.all(pages.map((p) => pageFrom(albumTemplate(p, template, classic), format, p)))).map(wearing);
    if (stale()) return;
    if (deck?.album) slideStep(slides, 0);
    else {
      if (!(await flushSave()) || stale()) return; // what was on the canvas stays in Çalışmalarım
      startAlbum(slides, format, brand.primary);
    }
    setNote(warnings ? { kind: "error", text: `${slides.length} görsel hazır. ${warnings}` } : { kind: "ok", text: `${slides.length} görsel hazır. Metinler verdiğiniz bilgilerden yazıldı; kullanmadan önce kontrol edin.` });
  }
  /** Another image in the post, after this one: the chosen template, ready to be written. */
  const addAlbumPage = async () => {
    if (!deck?.album || !font || !slideRoom()) return;
    const s = slidesNow();
    const was = now.current.deck, wasView = now.current.view;
    const made = wearing(await pageFrom(template, format, SAMPLE[template]));
    if (now.current.deck !== was || now.current.view !== wasView) return; // changed while its fonts loaded: that comes first
    slideStep([...s.slice(0, deck.at + 1), made, ...s.slice(deck.at + 1)], deck.at + 1);
  };
  /** Another template for the whole post: each image laid out anew with its own text (one undo step). */
  const restyleAlbum = async (t: TemplateId) => {
    if (!deck?.album || !font) return;
    const textOf = (page: El[], r: Field) => (page.find((e) => e.kind === "text" && e.role === r) as TextEl | undefined)?.text ?? "";
    const was = now.current.deck, wasView = now.current.view;
    const pages = (await Promise.all(slidesNow().map((page) => pageFrom(t, format, { tag: textOf(page, "tag"), title: textOf(page, "title"), subtitle: textOf(page, "subtitle"), detail: textOf(page, "detail") })))).map(wearing);
    if (now.current.deck !== was || now.current.view !== wasView) return; // changed while the fonts loaded: that comes first
    setTemplate(t);
    slideStep(pages, deck.at);
    setNote({ kind: "ok", text: "Şablon tüm görsellere uygulandı. Görsellere elle eklediklerinizi geri getirmek için Ctrl+Z." });
  };

  const { w: W, h: H } = FORMATS[format];
  const u = Math.min(W, H) / 1080;
  /** A picture's box: `size` on its longer side, its own ratio. */
  const boxOf = (p: Picture, size: number) => (p.w >= p.h ? { w: size, h: (size * p.h) / p.w } : { w: (size * p.w) / p.h, h: size });
  const add = (e: El) => {
    change([...view, e]);
    setSelected(e.id);
  };
  const addText = (size = 64, weight = 700, name = "Metin") =>
    add({ id: newId(), kind: "text", name, x: W * 0.1, y: H * 0.42, w: W * 0.8, h: size * 1.4 * u, text: name === "Metin" ? "Yeni metin" : name, size: size * u, weight, color: brand.primary, align: "start", leading: 1.15, tracking: 0, auto: true } satisfies TextEl);
  const [shapeStyle, setShapeStyle] = useState<ShapeStyle>("fill");
  const addShape = (id: ShapeId = "rounded", style: ShapeStyle = "fill") => add(shapeFrom(id, W / 2, H / 2, 360 * u, brand.accent, style));
  /** Every way out of the design, in one menu under the button. */
  const downloadMenu = (at: HTMLElement) => {
    const r = at.getBoundingClientRect();
    setMenu({
      x: r.right - 220, y: r.bottom + 4, view,
      items: [
        ...(deck && !deck.album ? [{ label: "PowerPoint (PPTX)", icon: <Presentation size={14} />, run: exportDeck } as MenuItem, "-" as const] : []),
        ...(deck?.album ? [...EXPORTS.map((e): MenuItem => ({ label: `Tüm görseller: ${e.label} (ZIP)`, icon: <Download size={14} />, run: () => void exportAlbum(e) })), "-" as const] : []),
        ...(mode === "video"
          ? [{ label: "Video oluştur", icon: <Film size={14} />, run: () => setTool("scenes") } as MenuItem, "-" as const]
          : [{ label: deck ? (deck.album ? "Bu görseli video sahnesi yap" : "Bu slaydı video sahnesi yap") : "Video sahnesi olarak ekle", icon: <Clapperboard size={14} />, run: addScene } as MenuItem, "-" as const]),
        ...EXPORTS.map((e): MenuItem => ({ label: deck ? `${e.label} (${deck.album ? "bu görsel" : "bu slayt"})` : e.label, icon: <Download size={14} />, run: () => exportAs(e) })),
        "-",
        { label: "Proje dosyası olarak kaydet", icon: <Save size={14} />, run: saveProject },
        { label: "Proje dosyası aç…", icon: <FolderOpen size={14} />, run: () => projectInput.current?.click() },
      ],
    });
  };
  /** A gallery shape as a picture (a data: URL like every picture: the design stays one file). */
  const addArt = async (name: string, tinted = false) => {
    setArtOpen(false);
    try {
      const r = await fetch(`/shapes/${name}.svg`);
      if (!r.ok) throw new Error();
      const file = await r.text();
      const src = `data:image/svg+xml;base64,${btoa(tinted ? tintSvg(file, brand.primary, brand.accent) : file)}`; // the files are ASCII
      // Onto the design as it is now (and its format): it may have changed while the file loaded.
      const { w: cw, h: ch } = FORMATS[now.current.format];
      const size = Math.min(cw, ch) / 3;
      const el = { id: newId(), kind: "image", name: "Hazır şekil", x: (cw - size) / 2, y: (ch - size) / 2, w: size, h: size, pic: { src, w: 200, h: 200 }, fit: "contain" } satisfies ImageEl;
      change([...now.current.view, el]);
      setSelected(el.id);
    } catch {
      setNote({ kind: "error", text: "Şekil yüklenemedi." });
    }
  };
  /** A logo onto the design, next to the others: several can stand together (a joint project's partners). */
  const addLogo = (pic = brand.logo) => {
    if (!pic) return setNote({ kind: "error", text: "Önce marka kitine logo ekleyin." });
    const b = boxOf(pic, 220 * u);
    const others = now.current.view.filter((e) => e.kind === "image" && e.logo);
    const x = Math.min(W - b.w - 24 * u, Math.max(72 * u, ...others.map((e) => e.x + e.w + 32 * u)));
    add({ id: newId(), kind: "image", name: "Logo", x, y: 72 * u, ...b, pic, fit: "contain", logo: true } satisfies ImageEl);
  };
  /** The logo the templates use; an edited design's logos follow, keeping their width and the logo's own ratio. */
  const chooseLogo = (p: Picture) => {
    const was = brandNow.current;
    saveBrand({ ...was, logo: p });
    // Only the logo being replaced: a partner's logo added beside it stays.
    const cur = now.current.els;
    const swap = (page: El[]) => page.map((e) => (e.kind === "image" && e.logo && e.pic.src === was.logo?.src ? { ...e, pic: p, h: (e.w * p.h) / p.w } : e));
    if (deck?.album && was.logo) slideStep(slidesNow().map(swap), deck.at);
    else if (cur && was.logo) change(swap(cur));
  };
  const [logoFor, setLogoFor] = useState<string | null>(null); // the logo element whose replacement is being chosen
  const logoForNow = useRef(logoFor); // a file still being read when the dialog closes goes only to the library
  useLayoutEffect(() => {
    logoForNow.current = logoFor;
  });
  const openLogos = (id: string) => {
    setNote(null);
    setLogoFor(id);
  };
  /** This logo in the place of that one, on the design as it is by now (a file takes a moment to read). */
  const putLogoOn = (id: string, p: Picture) => {
    const cur = now.current.view;
    change(cur.map((e) => (e.id === id && e.kind === "image" ? (e.fit === "contain" ? { ...e, pic: p, h: (e.w * p.h) / p.w } : { ...e, pic: p }) : e)));
  };
  const addToLogos = async (files: FileList | null): Promise<Picture | undefined> => {
    if (!files?.length) return;
    setNote(null);
    let first: Picture | undefined;
    const added: SavedLogo[] = [];
    for (const file of Array.from(files)) {
      if (logos.length + added.length >= MAX_LOGOS) {
        setNote({ kind: "error", text: `Kütüphanede en fazla ${MAX_LOGOS} logo olabilir.` });
        break;
      }
      try {
        const pic = await readPicture(file, "logo");
        first ??= pic;
        if (logos.some((l) => l.pic.src === pic.src) || added.some((l) => l.pic.src === pic.src)) continue;
        const logo = { id: newId(), name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Logo", pic, addedAt: stamp() };
        await putLogo(username, logo);
        added.push(logo);
      } catch (e) {
        setNote({ kind: "error", text: `${file.name}: ${(e as Error).message}` });
      }
    }
    if (added.length) setLogos((l) => [...l, ...added]);
    if (first && !brandNow.current.logo) chooseLogo(first);
    return first;
  };
  const dropLogo = async (l: SavedLogo) => {
    try {
      await removeLogo(username, l.id);
      setLogos((x) => x.filter((y) => y.id !== l.id));
      if (brandNow.current.logo?.src === l.pic.src) saveBrand({ ...brandNow.current, logo: undefined });
    } catch {
      setNote({ kind: "error", text: "Logo silinemedi (tarayıcı depolaması)." });
    }
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
        chooseLogo(p);
      }
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message });
    }
  }
  const [placing, setPlacing] = useState<string | null>(null);
  // Only while it is the one chosen thing: choosing anything else ends it by itself.
  const placingNow = placing && picked.length === 1 && picked[0] === placing && view.some((e) => e.id === placing && e.kind === "shape" && e.picFill && !isHolder(e)) ? placing : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- choosing it again must not resume placing by itself
    if (placing && !placingNow) setPlacing(null);
  }, [placing, placingNow]);
  /** The file dialog for a shape's picture. */
  const fillPicture = (id: string) => {
    replaceTarget.current = id;
    const input = replaceInput.current;
    if (!input) return;
    input.accept = ".png,.jpg,.jpeg,.webp";
    input.click();
  };
  const replacePicture = async (id: string, file: File | undefined) => {
    if (!file) return;
    try {
      const found = view.find((e) => e.id === id);
      if (found?.kind === "shape") {
        const picFill = await readPicture(file, "photo");
        // Onto the design as it is by now: reading a large picture takes a moment, and on another slide the id isn't there.
        const cur = now.current.view;
        if (cur.some((x) => x.id === id && x.kind === "shape")) change(cur.map((x) => (x.id === id && x.kind === "shape" ? { ...x, picFill, picView: undefined, noFill: undefined } : x)));
        return;
      }
      const target = found as ImageEl | undefined;
      const p = await readPicture(file, target?.logo ? "logo" : "photo");
      if (target) patch(id, target.fit === "contain" ? { pic: p, h: (target.w * p.h) / p.w } : { pic: p });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message });
    }
  };

  /** Ids that may change: the given ones that aren't locked. */
  const free = (ids: string[]) => ids.filter((id) => view.some((e) => e.id === id && !e.locked && !e.master));
  const remove = (ids: string[]) => {
    const gone = new Set(free(ids));
    if (!gone.size) return;
    change(view.filter((e) => !gone.has(e.id)));
    setPicked([]);
  };
  const duplicate = (ids: string[]) => {
    const set = new Set(free(ids));
    const copies: string[] = [];
    // Each copy right above its original, a little lower right.
    const next = view.flatMap((e) => {
      if (!set.has(e.id)) return [e];
      const c = { ...e, id: newId(), x: e.x + 24 * u, y: e.y + 24 * u, locked: false } as El;
      copies.push(c.id);
      return [e, c];
    });
    if (!copies.length) return;
    change(next);
    setPicked(copies);
  };
  const reorder = (ids: string[], to: "front" | "back" | "up" | "down") => {
    const set = new Set(free(ids));
    if (!set.size) return;
    let next: El[];
    if (to === "up" || to === "down") {
      // One step each, keeping their order; one already at the edge stays.
      next = [...view];
      const order = to === "up" ? [...next.keys()].reverse() : [...next.keys()];
      for (const i of order) {
        const j = to === "up" ? i + 1 : i - 1;
        if (!set.has(next[i].id) || j < 0 || j >= next.length || set.has(next[j].id)) continue;
        if (to === "down" && next[j].locked) continue; // locked backgrounds stay at the bottom
        [next[i], next[j]] = [next[j], next[i]];
      }
    } else {
      const moving = view.filter((e) => set.has(e.id));
      const rest = view.filter((e) => !set.has(e.id));
      // Locked backgrounds stay at the bottom: "back" means just above them.
      const floor = rest.findIndex((e) => !e.locked);
      const j = to === "front" ? rest.length : floor < 0 ? rest.length : floor;
      next = [...rest.slice(0, j), ...moving, ...rest.slice(j)];
    }
    change(next);
  };

  const copyEl = (ids: string[]) => {
    const list = view.filter((e) => ids.includes(e.id));
    if (list.length) setClip(list.filter((e) => !e.master));
  };
  /** Cut: only what can be removed goes to the clipboard (locked ones stay, and aren't copied either). */
  const cut = (ids: string[]) => {
    const f = free(ids);
    if (!f.length) return;
    copyEl(f);
    remove(f);
  };
  /** The copies land a little lower right, inside the canvas (they may come from another format). */
  const paste = () => {
    const list = now.current.clip;
    if (!list?.length) return;
    const sized = list.map((e) => {
      // Bigger than this canvas (copied from another format): a picture or shape shrinks with its ratio; a text box
      // gets narrower and its final height comes from the wrapped lines.
      const k = e.kind === "text" ? 1 : Math.min(1, W / e.w, H / e.h);
      const c = { ...e, id: newId(), w: e.kind === "text" ? Math.min(e.w, W) : e.w * k, h: e.h * k, x: e.x + 24 * u, y: e.y + 24 * u, locked: false } as El;
      return font ? hug([c], font.measure)[0] : c;
    });
    // One shift for all of them, so they keep their arrangement: inside the canvas where they fit, else from the
    // top left (a long text taller than the canvas keeps the height it needs).
    const bs = sized.map(aabb);
    const [x0, y0] = [Math.min(...bs.map((b) => b.x)), Math.min(...bs.map((b) => b.y))];
    const [x1, y1] = [Math.max(...bs.map((b) => b.x + b.w)), Math.max(...bs.map((b) => b.y + b.h))];
    const dx = x1 - x0 > W ? -x0 : Math.min(Math.max(0, x0), W - (x1 - x0)) - x0;
    const dy = y1 - y0 > H ? -y0 : Math.min(Math.max(0, y0), H - (y1 - y0)) - y0;
    const added = sized.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }) as El);
    change([...view, ...added]);
    setPicked(added.map((e) => e.id));
  };
  /** Several chosen: to each other (or the canvas); one: to the canvas. */
  const alignMany = (ids: string[], how: AlignTo, toCanvas = ids.length < 2) => change(alignEls(view, ids, how, toCanvas ? { w: W, h: H } : undefined));
  const distribute = (ids: string[], axis: "x" | "y") => change(distributeEls(view, ids, axis));
  /** Same width or height as the first chosen (pictures keep their ratio). */
  const sameSize = (ids: string[], dim: "w" | "h") => {
    const first = view.find((e) => e.id === ids[0]);
    if (!first) return;
    const set = new Set(free(ids.slice(1)));
    change(
      view.map((e) =>
        set.has(e.id)
          ? ({
              ...e, [dim]: first[dim],
              ...(e.kind === "image" ? (dim === "w" ? { h: (first.w * e.h) / e.w } : { w: (first.h * e.w) / e.h }) : {}),
              // A text box that follows its lines would grow back: with a set height its text fits the box instead.
              ...(e.kind === "text" && dim === "h" && !e.bg ? { auto: true } : {}),
            } as El)
          : e,
      ),
    );
  };
  /** Looks without content: colours, type, corners, transparency (same kind of element only). */
  const styleOf = (e: El): Partial<El> =>
    e.kind === "text" ? { color: e.color, size: e.size, weight: e.weight, align: e.align, leading: e.leading, tracking: e.tracking, upper: e.upper, italic: e.italic, underline: e.underline, font: e.font, bg: e.bg, opacity: e.opacity, auto: e.auto, shadow: e.shadow, runs: undefined }
    : e.kind === "shape" ? { fill: e.fill, radius: e.radius, opacity: e.opacity, stroke: e.stroke, noFill: e.noFill, shadow: e.shadow }
    : { radius: e.radius, opacity: e.opacity, shadow: e.shadow };
  const pasteStyle = (id: string) => {
    const src = styleClip;
    const e = view.find((x) => x.id === id);
    if (!src || !e || src.kind !== e.kind) return;
    const st = styleOf(src);
    // A line is only its outline: from a filled shape it takes the fill colour as its line colour, keeps its width.
    if (e.kind === "shape" && e.shape === "line") {
      const s = st as Partial<ShapeEl>;
      const color = s.stroke?.color ?? (s.fill?.kind === "solid" ? s.fill.color : s.fill?.stops[0].color) ?? e.stroke?.color ?? "#14263d";
      return patch(id, { ...s, noFill: true, stroke: { ...(e.stroke ?? { width: 4 * u }), ...s.stroke, color } });
    }
    patch(id, st);
  };

  const openMenuFor = (id: string) => {
    const e = view.find((x) => x.id === id);
    const m = document.querySelector<SVGSVGElement>('svg[role="application"]')?.getScreenCTM();
    if (!e || !m) return;
    const pt = new DOMPoint(e.x + e.w / 2, e.y + e.h / 2).matrixTransform(m);
    setMenu({ items: menuItems(id), x: pt.x, y: pt.y, view });
  };
  const ALIGNS: [AlignTo, string, ReactNode][] = [
    ["left", "Sola hizala", <AlignStartVertical key="l" size={14} />],
    ["hcenter", "Yatayda ortala", <AlignCenterVertical key="h" size={14} />],
    ["right", "Sağa hizala", <AlignEndVertical key="r" size={14} />],
    ["top", "Üste hizala", <AlignStartHorizontal key="t" size={14} />],
    ["vcenter", "Dikeyde ortala", <AlignCenterHorizontal key="v" size={14} />],
    ["bottom", "Alta hizala", <AlignEndHorizontal key="b" size={14} />],
  ];
  const menuItems = (id: string | null): MenuItem[] => {
    const e = id ? view.find((x) => x.id === id && !x.master) : undefined;
    if (!e)
      return [
        { label: "Yapıştır", icon: <ClipboardPaste size={14} />, keys: "Ctrl+V", run: paste, disabled: !clip },
        { label: "Tümünü seç", icon: <BoxSelect size={14} />, keys: "Ctrl+A", run: () => setPicked(view.filter((x) => !x.locked).map((x) => x.id)) },
        "-",
        { label: "Metin ekle", icon: <Type size={14} />, run: () => addText() },
        { label: "Şekil ekle", icon: <Shapes size={14} />, run: () => addShape() },
        { label: "Logo ekle", icon: <Stamp size={14} />, run: () => addLogo(), disabled: !brand.logo },
        "-",
        { label: "Geri al", icon: <Undo2 size={14} />, keys: "Ctrl+Z", run: undo, disabled: !hist.past.length },
        { label: "Yinele", icon: <Redo2 size={14} />, keys: "Ctrl+Y", run: redo, disabled: !hist.future.length },
      ];
    // On one of several chosen: actions for all of them.
    const ids = picked.length > 1 && picked.includes(e.id) ? picked : [e.id];
    if (ids.length > 1) {
      const none = !free(ids).length;
      return [
        { label: "Kes", icon: <Scissors size={14} />, keys: "Ctrl+X", run: () => cut(ids), disabled: none },
        { label: "Kopyala", icon: <Copy size={14} />, keys: "Ctrl+C", run: () => copyEl(ids) },
        { label: "Çoğalt", icon: <Copy size={14} />, keys: "Ctrl+D", run: () => duplicate(ids), disabled: none },
        "-",
        ...ALIGNS.map(([how, label, icon]): MenuItem => ({ label: `${label} (birbirine göre)`, icon, run: () => alignMany(ids, how), disabled: none })),
        { label: "Yatayda eşit aralık", icon: <AlignHorizontalSpaceAround size={14} />, run: () => distribute(ids, "x"), disabled: none || ids.length < 3 },
        { label: "Dikeyde eşit aralık", icon: <AlignVerticalSpaceAround size={14} />, run: () => distribute(ids, "y"), disabled: none || ids.length < 3 },
        "-",
        { label: "En öne getir", icon: <ArrowUpToLine size={14} />, run: () => reorder(ids, "front"), disabled: none },
        { label: "En arkaya gönder", icon: <ArrowDownToLine size={14} />, run: () => reorder(ids, "back"), disabled: none },
        "-",
        { label: "Hepsini kilitle", icon: <Lock size={14} />, run: () => change(view.map((x) => (ids.includes(x.id) ? { ...x, locked: true } : x))) },
        { label: "Sil", icon: <Trash2 size={14} />, keys: "Delete", run: () => remove(ids), disabled: none, danger: true },
      ];
    }
    const L = e.locked;
    const same = styleClip?.kind === e.kind;
    return [
      ...(e.kind === "text" ? [{ label: "Metni düzenle", icon: <Pencil size={14} />, keys: "Enter", run: () => setEditing(e.id), disabled: L } as MenuItem, "-" as const] : []),
      { label: "Kes", icon: <Scissors size={14} />, keys: "Ctrl+X", run: () => cut(ids), disabled: L },
      { label: "Kopyala", icon: <Copy size={14} />, keys: "Ctrl+C", run: () => copyEl(ids) },
      { label: "Yapıştır", icon: <ClipboardPaste size={14} />, keys: "Ctrl+V", run: paste, disabled: !clip },
      { label: "Çoğalt", icon: <Copy size={14} />, keys: "Ctrl+D", run: () => duplicate(ids), disabled: L },
      "-",
      { label: "Stili kopyala", icon: <Paintbrush size={14} />, run: () => setStyleClip(e) },
      { label: "Stili yapıştır", icon: <Paintbrush size={14} />, run: () => pasteStyle(e.id), disabled: L || !same },
      "-",
      { label: "En öne getir", icon: <ArrowUpToLine size={14} />, run: () => reorder(ids, "front"), disabled: L },
      { label: "Bir öne", icon: <MoveUp size={14} />, run: () => reorder(ids, "up"), disabled: L },
      { label: "Bir geri", icon: <MoveDown size={14} />, run: () => reorder(ids, "down"), disabled: L },
      { label: "En arkaya gönder", icon: <ArrowDownToLine size={14} />, run: () => reorder(ids, "back"), disabled: L },
      "-",
      ...ALIGNS.map(([how, label, icon]): MenuItem => ({ label: `${label} (tuvale göre)`, icon, run: () => alignMany(ids, how), disabled: L })),
      ...(e.kind === "image"
        ? (["-",
            { label: e.logo ? "Logoyu değiştir…" : "Görseli değiştir…", icon: <ImagePlus size={14} />, run: () => {
                if (e.logo) return openLogos(e.id);
                replaceTarget.current = e.id;
                const input = replaceInput.current;
                if (!input) return;
                input.accept = ".png,.jpg,.jpeg,.webp"; // the same choices as the inspector
                input.click();
              }, disabled: L },
            ...(e.logo ? [] : [{ label: e.fit === "cover" ? "Tamamını göster (sığdır)" : "Kutuyu doldur (kırp)", icon: <ImageIcon size={14} />, run: () => patch(e.id, { fit: e.fit === "cover" ? "contain" : "cover" }), disabled: L } as MenuItem]),
          ] as MenuItem[])
        : []),
      ...(e.kind === "shape"
        ? (["-", { label: "Şekli değiştir", icon: <Shapes size={14} />, run: () => {}, disabled: L, panel: (done) => <ShapeChooser el={e} onPick={(id, style) => { done(); patch(e.id, changeShape(e, id, style)); }} /> }] as MenuItem[])
        : []),
      ...(e.kind === "shape" && e.shape !== "line"
        ? (["-",
            { label: e.picFill && !isHolder(e) ? "Resmi değiştir…" : "Resimle doldur…", icon: <ImagePlus size={14} />, run: () => {
                replaceTarget.current = e.id;
                const input = replaceInput.current;
                if (!input) return;
                input.accept = ".png,.jpg,.jpeg,.webp";
                input.click();
              }, disabled: L },
            ...(e.picFill && !isHolder(e) ? [
              { label: "Resmi konumla", icon: <ImageIcon size={14} />, run: () => { setPicked([e.id]); setPlacing(e.id); }, disabled: L },
              { label: "Resmi kaldır", icon: <ImageIcon size={14} />, run: () => patch(e.id, { picFill: undefined, picView: undefined }), disabled: L },
            ] : []),
          ] as MenuItem[])
        : []),
      "-",
      { label: L ? "Kilidi aç" : "Kilitle", icon: L ? <LockOpen size={14} /> : <Lock size={14} />, run: () => patch(e.id, { locked: !L }) },
      { label: "Sil", icon: <Trash2 size={14} />, keys: "Delete", run: () => remove(ids), disabled: L, danger: true },
    ];
  };

  // Keyboard: arrows nudge (Shift: 10 px), Delete, Ctrl+Z / Ctrl+Y, Ctrl+D, Ctrl+A, Ctrl+C/X/V, Escape, menu key /
  // Shift+F10; with several chosen, they all move, copy and go together.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  function onKey(e: KeyboardEvent) {
    if (!mode || library || artOpen || layoutsOpen || logoFor) return; // the dialog has the keyboard; the canvas behind it doesn't change
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") return e.preventDefault(), e.shiftKey ? redo() : undo();
    if (mod && e.key.toLowerCase() === "y") return e.preventDefault(), redo();
    if (mod && e.key.toLowerCase() === "v") return e.preventDefault(), paste();
    if (mod && e.key.toLowerCase() === "a") return e.preventDefault(), setPicked(view.filter((x) => !x.locked).map((x) => x.id));
    const ids = picked.filter((id) => view.some((x) => x.id === id));
    // Nothing chosen on the canvas: the arrows have nothing to nudge, so they go through the slides.
    if (!ids.length && deck && !mod && !e.shiftKey) {
      const to = deck.at + ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key] ?? 0);
      if (to !== deck.at) {
        e.preventDefault();
        if (to >= 0 && to < deck.slides.length) goSlide(to);
      }
    }
    if (!ids.length) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) return e.preventDefault(), openMenuFor(ids[ids.length - 1]);
    if (mod && e.key.toLowerCase() === "c") return e.preventDefault(), copyEl(ids);
    if (e.key === "Escape" && placingNow) return setPlacing(null);
    if (e.key === "Escape") return setPicked([]);
    if (mod && e.key.toLowerCase() === "d") return e.preventDefault(), duplicate(ids);
    if (mod && e.key.toLowerCase() === "x") return e.preventDefault(), cut(ids);
    if (e.key === "Delete" || e.key === "Backspace") return e.preventDefault(), remove(ids);
    if (e.key === "Enter" && sel?.kind === "text" && !sel.locked) return e.preventDefault(), setEditing(sel.id);
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const move = new Set(free(ids));
    if (d && move.size) {
      e.preventDefault();
      change(view.map((x) => (move.has(x.id) ? ({ ...x, x: x.x + d[0], y: x.y + d[1] } as El) : x)));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- templateFonts: see `generated`
    [font, content, ownText, brand, small, templateFonts],
  );
  useEffect(() => {
    if (!font) return;
    let live = true;
    const ids = [...new Set((Object.keys(TEMPLATES) as TemplateId[]).flatMap((t) => TEMPLATES[t].fonts as readonly string[]))];
    void Promise.allSettled(ids.map((id) => ensureFont(id, username))).then(() => {
      if (live) setTemplateFonts((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [font, username]);

  /** One design as a file. */
  async function fileOf(list: El[], e: (typeof EXPORTS)[number]): Promise<Blob> {
    const svg = svgOf(format, await fontsReady(list), font!.measure, font!.css);
    if (e.ext === "svg") return new Blob([svg], { type: e.mime });
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
    return blob;
  }
  async function exportAs(e: (typeof EXPORTS)[number]) {
    if (!font) return;
    setEditing(null);
    setBusy("export");
    try {
      const name = deck?.album ? `kurum-gorsel-${String(deck.at + 1).padStart(2, "0")}.${e.ext}` : `kurum-gorsel-${template}-${format}.${e.ext}`;
      download(await fileOf(view, e), name);
      if (mode === "gorsel") trackUsage("social");
    } catch (err) {
      setNote({ kind: "error", text: (err as Error).message || "Görsel kaydedilemedi." });
    } finally {
      setBusy("");
    }
  }
  /** Every image of the post, numbered in their order, in one file. */
  async function exportAlbum(e: (typeof EXPORTS)[number]) {
    if (!font || !deck?.album) return;
    setEditing(null);
    setBusy("export");
    try {
      const pages = slidesNow();
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      // One after another: each is a full-size picture in memory.
      for (const [i, page] of pages.entries()) zip.file(`kurum-gorsel-${String(i + 1).padStart(2, "0")}.${e.ext}`, await fileOf(page, e));
      download(await zip.generateAsync({ type: "blob" }), "kurum-gorseller.zip");
      pages.forEach(() => trackUsage("social"));
      setNote({ kind: "ok", text: `${pages.length} görsel indirildi.` });
    } catch (err) {
      setNote({ kind: "error", text: (err as Error).message || "Görseller kaydedilemedi." });
    } finally {
      setBusy("");
    }
  }
  const sceneFormat = scenes[0]?.format;
  // ---- Sunum ----
  const clearEditing = () => {
    gesture.current = null; // an unfinished live change belongs to the design that is going away
    setHist({ past: [], future: [] }); // undo stays within one slide
    setPicked([]);
    setEditing(null);
  };
  const slidesNow = () => (deck ? deck.slides.map((s, i) => (i === deck.at ? view : s)) : []);
  const startDeck = (template: DeckTemplate, primary: string, slides: El[][], theme?: Theme) => {
    setDeckBefore(null);
    cancelSuggest();
    setDeck({ template, slides, at: 0, primary, theme });
    setMode("sunum");
    setFormat("yatay");
    setEls(slides[0]);
    clearEditing();
    setWorkId(null);
    // The fonts of the slides and of the layouts on offer, so previews show them.
    const fonts = new Set([...slides.flat(), ...template.layouts.flatMap((l) => l.els)].flatMap((e) => [...(typeof (e as { font?: unknown }).font === "string" ? [(e as { font: string }).font] : []), ...(((e as TextEl).runs ?? []).flatMap((r) => (r.font ? [r.font] : [])))]));
    Promise.allSettled([...fonts].map((id) => ensureFont(id, username))).then(() => setFontTick((n) => n + 1));
  };
  /** A post of several images: the deck's strip, undo and saving, in the format of the post. */
  const startAlbum = (slides: El[][], f: FormatId, primary: string, theme?: Theme) => {
    cancelSuggest(); // a suggestion still on its way must not land on this post
    setDeckBefore(null);
    setDeck({ album: true, template: ALBUM_TEMPLATE, slides, at: 0, primary, theme });
    setMode("gorsel");
    setFormat(f);
    setEls(slides[0]);
    clearEditing();
    setWorkId(null);
    Promise.allSettled([...new Set(slides.flat().flatMap((e) => (e.kind === "text" ? fontsOfText(e) : [])))].map((id) => ensureFont(id, username))).then(() => setFontTick((n) => n + 1));
  };
  const openDeck = async (d: SavedDeck, f?: FormatId) => {
    if (d.album) return startAlbum(d.slides, f ?? "kare", d.primary, THEMES.find((x) => x.name === d.theme));
    const design = d.design ? await loadDesign(d.design) : undefined;
    const t = await loadTemplate(d.template);
    // A theme chosen on top of the design is what the deck wears now.
    const theme = THEMES.find((x) => x.name === d.theme) ?? (design ? themeOf(design) : undefined);
    const slides = d.master ? applyMaster(d.slides, d.master, theme?.body) : d.slides;
    startDeck(t, d.primary, slides, theme);
    setDeck({ template: t, slides, at: 0, primary: d.primary, theme, design, master: d.master, content: d.content ? { plan: d.content.plan, sections: d.content.sections, docName: d.content.docName } : undefined });
  };
  const goSlide = (i: number) => {
    if (!deck || i === deck.at) return;
    const slides = slidesNow();
    setDeck({ ...deck, slides, at: i });
    setEls(slides[i]);
    // History stays: each step knows its slide, so undo goes back to where the change was made, as in PowerPoint.
    gesture.current = null;
    setPicked([]);
    setEditing(null);
  };
  /** Slides changed as a list: the canvas shows slide `at` of them. */
  const setSlides = (raw: El[][], at: number, keepHistory = false) => {
    if (!deck) return;
    // Numbers and which slides are covers follow the order.
    const slides = deck.master ? applyMaster(raw, deck.master, (deck.theme?.body ?? deck.design?.bodyFont)) : raw;
    setDeck({ ...deck, slides, at });
    setEls(slides[at]);
    if (keepHistory) {
      gesture.current = null;
      setPicked([]);
      setEditing(null);
    } else clearEditing();
  };
  /** The master changed: rewritten on every slide, nothing else moves. */
  const setMaster = (master: DeckMaster) => {
    if (!deck) return;
    const slides = applyMaster(slidesNow(), master, (deck.theme?.body ?? deck.design?.bodyFont));
    setDeck({ ...deck, slides, master });
    setEls(slides[deck.at]);
    setHist({ past: [], future: [] }); // undo would bring a slide back with the old master
    setPicked([]);
  };
  const setSlidePick = (pick: "auto" | "color" | "white" | "none") => {
    if (!deck?.master) return;
    const s = slidesNow();
    s[deck.at] = setPick(s[deck.at], pick);
    setSlides(s, deck.at);
  };
  const logoWhite = (l: SavedLogo, white: Picture) => {
    const next = { ...l, white };
    setLogos((x) => x.map((y) => (y.id === l.id ? next : y)));
    void putLogo(username, next).catch(() => setNote({ kind: "error", text: "Beyaz sürüm kaydedilemedi (tarayıcı depolaması)." }));
    const m = deck?.master;
    if (m?.logos.some((x) => x.color.src === l.pic.src)) setMaster({ ...m, logos: m.logos.map((x) => (x.color.src === l.pic.src ? { ...x, white } : x)) });
  };
  // For what finishes after an await (a logo being read): the deck as it is by then.
  const logoWhiteNow = useRef(logoWhite);
  useLayoutEffect(() => {
    logoWhiteNow.current = logoWhite;
  });
  const themeOf = (d: DeckDesign): Theme => ({ name: d.name, mood: d.mood, primary: d.primary, accent: d.accent, head: d.headFont, body: d.bodyFont });
  /** A made deck: its look, its master and its content go with it, so the design can be changed later. */
  const startComposed = async (d: DeckDesign, content: DeckContent, raw: El[][]) => {
    const t = await loadTemplate(d.template);
    const master = DEFAULT_MASTER;
    await Promise.allSettled([d.headFont, d.bodyFont].map((id) => ensureFont(id, username)));
    const slides = applyMaster(raw, master, d.bodyFont);
    startDeck(t, d.primary, slides, themeOf(d));
    setDeck({ template: t, slides, at: 0, primary: d.primary, theme: themeOf(d), design: d, master, content });
    setDesignPreview(null);
    setTool("deck");
  };
  const startBlank = async (d: DeckDesign) => {
    const t = await loadTemplate(d.template);
    const raw = [slideFrom(t.layouts[0], undefined, d.accent)];
    const slides = rethemeSlides(raw, themeOf(d), t.roles ? [t.roles.primary, t.roles.accent] : []);
    startDeck(t, d.primary, slides, themeOf(d));
    setDeck({ template: t, slides, at: 0, primary: d.primary, theme: themeOf(d), design: d, master: DEFAULT_MASTER });
    setDesignPreview(null);
  };
  /** The slides a design would give this deck: laid out anew from its content, or, without content, recoloured. */
  const slidesIn = (d: DeckDesign): El[][] => {
    if (!deck || !font) return [];
    if (deck.content) return composeDeck(deck.content.plan, deck.content.sections, deck.content.docName, font.measure, d).slides;
    return rethemeSlides(withoutMaster(slidesNow()), themeOf(d), deckRoles(deck));
  };
  const applyDesign = async (d: DeckDesign, thenDownload = false) => {
    if (!deck || !font) return;
    // Every open counts on this token: a work opened while the fonts load keeps its own deck.
    const turn = ++restoring.current;
    await Promise.allSettled([d.headFont, d.bodyFont].map((id) => ensureFont(id, username)));
    const t = await loadTemplate(d.template);
    if (turn !== restoring.current) return;
    setDeckBefore({ ...deck, slides: slidesNow() });
    const master = deck.master ?? DEFAULT_MASTER;
    const slides = applyMaster(slidesIn(d), master, d.bodyFont);
    setDeck({ ...deck, template: t, slides, at: Math.min(deck.at, slides.length - 1), primary: d.primary, theme: themeOf(d), design: d, master });
    setEls(slides[Math.min(deck.at, slides.length - 1)]);
    clearEditing();
    setDesignPreview(null);
    if (thenDownload) {
      setBusy("export");
      try {
        const ready = await Promise.all(slides.map(fontsReady));
        await downloadPptx(ready, font.measure, `kurum-sunum-${d.id}.pptx`, await familyNames(username));
      } catch (e) {
        console.error(e);
        setNote({ kind: "error", text: "PPTX oluşturulamadı." });
      } finally {
        setBusy("");
      }
    }
  };
  const undoDesign = () => {
    const was = deckBefore;
    if (!was) return;
    setDeckBefore(null);
    setDeck(was);
    setEls(was.slides[was.at]);
    clearEditing();
  };
  const slideRoom = () => {
    if (slidesNow().length < MAX_SLIDES) return true;
    setNote({ kind: "error", text: `Bir sunumda en fazla ${MAX_SLIDES} slayt olabilir.` });
    return false;
  };
  /** A change to the list of slides, as one undo step. */
  const slideStep = (raw: El[][], at: number) => {
    const before = snap();
    setSlides(raw, at, true);
    push(before);
  };
  const addSlide = (l: Layout) => {
    setLayoutsOpen(false);
    const s = slidesNow();
    if (!deck || !slideRoom()) return;
    // A new slide wears the theme the deck has.
    const fresh = slideFrom(l, undefined, deck.primary);
    const slide = deck.theme ? rethemeSlides([fresh], deck.theme, deck.template.roles ? [deck.template.roles.primary, deck.template.roles.accent] : [])[0] : fresh;
    slideStep([...s.slice(0, deck.at + 1), slide, ...s.slice(deck.at + 1)], deck.at + 1);
  };
  const duplicateSlide = () => {
    const s = slidesNow();
    if (deck && slideRoom()) slideStep([...s.slice(0, deck.at + 1), s[deck.at].map((e) => ({ ...e, id: newId() }) as El), ...s.slice(deck.at + 1)], deck.at + 1);
  };
  const deleteSlide = () => {
    const s = slidesNow();
    if (deck && s.length > 1) slideStep(s.filter((_, i) => i !== deck.at), Math.min(deck.at, s.length - 2));
  };
  const moveSlide = (d: -1 | 1) => {
    const s = slidesNow();
    if (!deck || !s[deck.at + d]) return;
    [s[deck.at], s[deck.at + d]] = [s[deck.at + d], s[deck.at]];
    slideStep(s, deck.at + d);
  };
  const reorderSlide = (from: number, gap: number) => {
    const s = slidesNow();
    const to = gap > from ? gap - 1 : gap;
    if (!deck || to === from || !s[from]) return;
    s.splice(to, 0, ...s.splice(from, 1));
    slideStep(s, to); // the moved slide is the one on the canvas, as in PowerPoint
  };
  const leaveDeck = async () => {
    if (!(await flushSave())) return;
    restoring.current++; // what is still on its way belonged to what is being left
    cancelSuggest();
    setDeck(null);
    setDeckBefore(null);
    setEls(null);
    clearEditing();
    setWorkId(null);
  };
  const exportDeck = async () => {
    if (!font || !deck) return;
    setBusy("export");
    try {
      const ready = await Promise.all(slidesNow().map(fontsReady));
      await downloadPptx(ready, font.measure, `kurum-sunum-${deck.template.id}.pptx`, await familyNames(username));
      trackUsage("deck");
      setNote({ kind: "ok", text: "PPTX indirildi. Yazı tipleri dosyaya gömülmez: bilgisayarda yoksa PowerPoint benzeriyle gösterir." });
    } catch (e) {
      console.error(e);
      setNote({ kind: "error", text: "PPTX oluşturulamadı." });
    } finally {
      setBusy("");
    }
  };
  const savedDeck = (): SavedDeck | undefined => (deck ? { ...(deck.album ? { album: true } : {}), template: deck.template.id, primary: deck.primary, slides: withoutMaster(slidesNow()), ...(deck.theme ? { theme: deck.theme.name } : {}), ...(deck.design ? { design: deck.design.id } : {}), ...(deck.master ? { master: deck.master } : {}), ...(deck.content ? { content: deck.content } : {}) } : undefined);

  /** A font chosen for these (arrives after loading: applied to the design as it is then). */
  const applyFont = (ids: string[], f: string | undefined) => change(now.current.view.map((e) => {
    if (e.kind !== "text" || !ids.includes(e.id) || e.locked) return e;
    const next = setTextStyle(e, { font: f }, sel?.id === e.id ? textRange : null);
    return font ? fitPill(next, font.measure) : next;
  }));
  /** Everything drawn into a picture waits for its fonts (a design just opened may still be loading them), and gets
   *  its text boxes measured with them. */
  const fontsReady = async (list: El[]) => {
    await Promise.allSettled(usedFonts(list).map((id) => ensureFont(id, username)));
    return font ? hug(list, font.measure) : list;
  };
  const addScene = async () => {
    if (!font) return;
    const ready = await fontsReady(view);
    if (sceneFormat && sceneFormat !== format) return setNote({ kind: "error", text: `Sahneler ${FORMATS[sceneFormat].label} formatında; aynı formatta ekleyin ya da sahneleri temizleyin.` });
    const thumb = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(format, ready, font.measure, font.css))}`;
    if (editingScene && scenes.some((s) => s.id === editingScene)) {
      if (scenesTooBig([...scenes.filter((s) => s.id !== editingScene).map((s) => s.els), ready])) return setNote({ kind: "error", text: SCENES_TOO_BIG });
      setScenes((s) => s.map((x) => (x.id === editingScene ? { ...x, els: ready, thumb } : x)));
      setEditingScene(null);
      return setNote({ kind: "ok", text: "Sahne güncellendi." });
    }
    if (scenes.length >= MAX_SCENES) return setNote({ kind: "error", text: `En fazla ${MAX_SCENES} sahne eklenebilir.` });
    if (scenesTooBig([...scenes.map((s) => s.els), ready])) return setNote({ kind: "error", text: SCENES_TOO_BIG });
    // Checked again here: another scene may have been added while the fonts loaded.
    setScenes((s) => (s.length >= 20 || (s[0] && s[0].format !== format) ? s : [...s, { id: newId(), els: ready, seconds: 4, format, thumb }]));
    setNote({ kind: "ok", text: mode === "video" ? `Sahne ${scenes.length + 1} eklendi. Tasarımı değiştirip bir sonraki sahneyi ekleyebilirsiniz.` : `Sahne ${scenes.length + 1} eklendi. Görsel Stüdyo ana sayfasından Video / Reels ile devam edebilirsiniz.` });
  };
  const sceneThumb = (els: El[], f: FormatId) => (font ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(f, els, font.measure, font.css))}` : "");
  /** A ready flow becomes scenes after the ones there are, in the format they have (9:16 when there are none). */
  const addPack = async (pack: ReelsPack) => {
    if (!font) return;
    const f = sceneFormat ?? "hikaye";
    const room = MAX_SCENES - scenes.length;
    if (room <= 0) return setNote({ kind: "error", text: `En fazla ${MAX_SCENES} sahne eklenebilir.` });
    const fresh = await Promise.all(pack.scenes.slice(0, room).map(async (p) => {
      await Promise.allSettled((TEMPLATES[p.template].fonts as readonly string[]).map((id) => ensureFont(id, username)));
      const made = await fontsReady(fromTemplate({ template: p.template, format: f, content: p.content, brand, photo }, font.measure));
      return { id: newId(), els: made, seconds: p.seconds, enter: p.enter, backdrop: p.backdrop, format: f, thumb: sceneThumb(made, f) };
    }));
    if (scenesTooBig([...scenes.map((s) => s.els), ...fresh.map((s) => s.els)])) return setNote({ kind: "error", text: SCENES_TOO_BIG });
    setScenes((s) => (s[0] && s[0].format !== f ? s : [...s, ...fresh].slice(0, MAX_SCENES)));
    setTransition(pack.transition);
    chooseFormat(f); // an edited canvas moves to the scenes' format with its edits
    setTool("scenes");
    setNote({ kind: "ok", text: `${pack.label}: ${fresh.length} sahne eklendi. Metinleri sahnedeki Düzenle ile değiştirin.` });
  };
  /** A scene back on the canvas, to edit like any design. */
  const editScene = async (s: Scene & { format: FormatId }) => {
    // The open design is saved first, and from here on the canvas belongs to the scenes' work, not to that design.
    if (!(await flushSave())) return;
    const turn = ++restoring.current;
    const owner = sceneOwner.current;
    const switching = owner !== workId;
    const name = switching && owner ? ((await listWorks(username).catch(() => [])).find((x) => x.id === owner)?.name ?? "") : "";
    if (turn !== restoring.current) return;
    cancelSuggest(); // a suggestion still on its way must not land on the scene
    if (switching) {
      setWorkId(owner);
      setWorkName(name);
    }
    setFormat(s.format);
    change(s.els);
    if (switching) setHist({ past: [], future: [] }); // undo must not bring the other design back under this work's name
    setSelected(null);
    setEditingScene(s.id);
  };
  const savedVideo = (): SavedVideo | undefined =>
    mode === "video" && scenes.length && sceneFormat ? { format: sceneFormat, transition, scenes: scenes.map(({ id, els: list, seconds, caption, enter, backdrop }) => ({ id, els: list, seconds, ...(caption ? { caption } : {}), ...(enter ? { enter } : {}), ...(backdrop ? { backdrop } : {}) })) } : undefined;
  /** A saved video's scenes, once the fonts they draw in are here (their previews are drawn with them). False: another open came first. */
  const restoreVideo = async (v: SavedVideo, owner: string | null, turn: number) => {
    const next = await Promise.all(v.scenes.map(async (s) => {
      const made = await fontsReady(s.els);
      return { ...s, els: made, format: v.format, thumb: sceneThumb(made, v.format) };
    }));
    if (turn !== restoring.current) return false;
    sceneOwner.current = owner;
    setScenes(next);
    setTransition(v.transition);
    setEditingScene(null);
    return true;
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
      const ready = await Promise.all(scenes.map(async (s) => ({ ...s, els: await fontsReady(s.els) })));
      const { blob, ext } = await renderVideo(ready, { format: sceneFormat!, transition, motion, music, captions: burnCaptions }, font.measure, font.css, (p) => setVideo((v) => (v && !v.url ? { ...v, progress: p } : v)), ac.signal);
      if (ac.signal.aborted) return; // cancelled or left at the very end: no URL nobody will free
      videoUrl.current = URL.createObjectURL(blob);
      setVideo({ progress: 1, url: videoUrl.current, ext });
      trackUsage("reels");
    } catch (e) {
      setVideo(ac.signal.aborted ? null : { progress: 0, error: (e as Error).message || "Video oluşturulamadı." });
    }
  }
  const videoSeconds = scenes.reduce((s, x) => s + x.seconds, 0);
  /** A scene's caption from its own texts: the title, then the description. */
  const captionFrom = (els: El[]) => {
    const t = (r: string) => (els.find((e) => e.kind === "text" && e.role === r) as TextEl | undefined)?.text.trim() ?? "";
    return [t("title"), t("subtitle")].filter(Boolean).join(" — ").slice(0, 240);
  };
  const setCaption = (id: string, caption: string) => setScenes((x) => x.map((y) => (y.id === id ? { ...y, caption } : y)));
  const cues = cuesOf(scenes);
  const saveSubs = (kind: "srt" | "vtt") => download(new Blob([kind === "srt" ? toSrt(cues) : toVtt(cues)], { type: kind === "srt" ? "application/x-subrip" : "text/vtt" }), `kurum-video.${kind}`);

  const closeLibrary = () => {
    setLibrary(null);
    refreshRecent(); // something in it may have been deleted
    // After the closing render: until then the opener is still inside the inert header and can't take focus.
    requestAnimationFrame(() => libOpener.current?.focus());
  };
  const openLibrary = async () => {
    libOpener.current = document.activeElement as HTMLElement | null;
    setConfirmDelete(null);
    setLibError("");
    const title = (view.find((e) => e.kind === "text" && e.role === "title") as TextEl | undefined)?.text.trim();
    setWorkName((n) => n || title?.slice(0, 80) || TEMPLATES[template].label);
    try {
      setLibrary(await listWorks(username));
    } catch {
      setLibrary([]);
      setNote({ kind: "error", text: "Çalışmalarım açılamadı (tarayıcı depolaması kullanılamıyor)." });
    }
  };
  const designTitle = () => (view.find((e) => e.kind === "text" && e.role === "title") as TextEl | undefined)?.text.trim().slice(0, 80) || "Adsız tasarım";
  const storeWork = async () => {
    if (!font) return;
    const id = workId ?? newId();
    setWorkId(id); // now: a save coming right after this one updates the same work
    const video = savedVideo();
    // The scenes belong to the work they were saved with; another design open on the canvas gets none of them.
    const owner = mode === "video" ? (sceneOwner.current ?? (video ? id : null)) : null;
    if (owner) sceneOwner.current = owner;
    if (owner && owner !== id) await patchVideo(username, owner, video);
    const ready = await fontsReady(view);
    const thumb = await thumbnail(svgOf(format, ready, font.measure, font.css), W, H);
    await saveWork(username, { id, name: workName.trim().slice(0, 80) || designTitle(), format, template, els: ready, thumb, updatedAt: stamp(), ...(deck ? { deck: savedDeck() } : {}), ...(video && owner === id ? { video } : {}) });
  };
  // ponytail: saves the whole design each time; a diff store if very large pictures make this slow.
  const latestStore = useRef(storeWork);
  useLayoutEffect(() => {
    latestStore.current = storeWork;
  });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  /** One save at a time, the last one with the design as it is by then: an older one can't land after a newer one. */
  const queueSave = () => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      try {
        do {
          again.current = false;
          await latestStore.current();
        } while (again.current);
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  };
  const saveFailed = useRef(false);
  const leaveWarned = useRef(false);
  const autosave = async () => {
    pending.current = null;
    setSaved("saving");
    try {
      await queueSave();
      setSaved("saved");
      saveFailed.current = false;
      return true;
    } catch (e) {
      setSaveError((e as Error).message || "Kaydedilemedi.");
      setSaved("error");
      saveFailed.current = true;
      return false;
    }
  };
  const latestAutosave = useRef(autosave);
  useLayoutEffect(() => {
    latestAutosave.current = autosave;
  });
  /** Before the design on screen is replaced: what's unsaved is saved first, as itself. If it can't be, the design stays
   *  open with a warning; asked again, it tries once more and then leaves (a full disk mustn't trap the user). */
  const flushSave = async () => {
    let ok = true;
    // Until nothing waits: the design can still be edited while a save runs.
    do {
      if (pending.current || saveFailed.current) {
        if (pending.current) clearTimeout(pending.current);
        ok = await autosave();
      } else if (running.current) {
        ok = await running.current.then(() => true, () => false);
      }
    } while (ok && (pending.current || running.current));
    if (ok || leaveWarned.current) {
      leaveWarned.current = saveFailed.current = false;
      return true;
    }
    leaveWarned.current = true;
    setNote({ kind: "error", text: "Son değişiklikler kaydedilemedi. İndir menüsünden proje dosyası olarak saklayın; yine de çıkmak için tekrar deneyin." });
    return false;
  };
  // Only what the user made or opened: an untouched template isn't a work yet (a saved work back on a template still is one).
  const hasDesign = !!font && !!mode && (!!els || ownText || !!photo || !!workId || (mode === "video" && scenes.length > 0)) && (mode !== "sunum" || !!deck);
  useEffect(() => {
    if (!hasDesign) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the status follows the timer this effect starts
    setSaved("saving"); // "Kaydedildi" would be untrue from the first change on
    pending.current = setTimeout(() => latestAutosave.current(), AUTOSAVE_MS);
    return () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [hasDesign, view, deck, workName, format, scenes, transition]);
  // A success note leaves by itself; an error stays until it's read.
  useEffect(() => {
    if (note?.kind !== "ok") return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);
  // Closing the tab within the wait: the browser's own "leave?" question (it can't be saved from here).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current || running.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const refreshRecent = () => listWorks(username).then(setRecent, () => {});
  useEffect(() => { listWorks(username).then(setRecent, () => {}); }, [username]);
  const goHome = async () => {
    if (!(await flushSave())) return;
    restoring.current++; // an open still on its way must not land after this
    setScenesBefore(null);
    cancelSuggest();
    setMode(null);
    setDeck(null);
    setDeckBefore(null);
    setEls(null); // nothing is open on the first screen: nothing can be saved over a work from there
    clearEditing();
    setWorkId(null);
    setWorkName("");
    setOwnText(false);
    setPhoto(undefined);
    setSaved("");
    refreshRecent();
  };
  /** A new design of this kind (the last one is already saved; a video's scenes wait for its next visit). */
  const begin = (m: Mode, f?: FormatId) => {
    cancelSuggest();
    setMode(m);
    setTool(RAIL[m][0]);
    setDeck(null);
    setDeckBefore(null);
    setEls(null);
    clearEditing();
    setWorkId(null);
    setWorkName("");
    setOwnText(false);
    setPhoto(undefined);
    restoring.current++; // an open still on its way must not land on the new design
    setScenesBefore(null);
    setDesignPreview(null);
    setDeckBefore(null);
    sceneOwner.current = null; // scenes waiting from the last video go with the next one saved
    const first: TemplateId = m === "video" ? "kanca" : "atlas";
    setTemplate(first);
    setContent(SAMPLE[first]);
    setEditingScene(null);
    setSources({});
    setSaved("");
    setZoom(1);
    setFormat(f ?? (m === "video" ? (sceneFormat ?? "hikaye") : "kare"));
  };
  const saveToLibrary = async () => {
    if (!font) return;
    try {
      await queueSave();
      setLibrary(await listWorks(username));
      setNote({ kind: "ok", text: "Çalışmalarım'a kaydedildi (yalnızca bu tarayıcıda)." });
    } catch (e) {
      setNote({ kind: "error", text: (e as Error).message || "Kaydedilemedi." });
    }
  };
  const openWork = async (picked: Work) => {
    if (picked.id === workId) return closeLibrary(); // already open, and newer than the list's copy
    if (!(await flushSave())) return closeLibrary();
    // Read again: that save may have just put newer scenes in this work, and the list was read before it.
    const w = (await listWorks(username).catch(() => [])).find((x) => x.id === picked.id) ?? picked;
    if (w.video && !font) return setNote({ kind: "error", text: "Yazı tipi yükleniyor; birazdan tekrar deneyin." });
    // First: until the scenes are back this work's id isn't set, so an autosave can't store it without them.
    const turn = ++restoring.current; // every open counts: a slow one coming back late must not land on a newer one
    setScenesBefore(null);
    if (w.video && !(await restoreVideo(w.video, w.id, turn))) return;
    cancelSuggest(); // a suggestion still on its way must not land on the opened work
    setTemplate(w.template);
    setZoom(1);
    setSaved("");
    if (w.deck) {
      setMode(w.deck.album ? "gorsel" : "sunum");
      setTool("text");
      openDeck(w.deck, w.format).then(() => setWorkId(w.id), () => setNote({ kind: "error", text: "Sunumun şablonu yüklenemedi." }));
    } else {
      setMode((m) => (m === "video" || w.video ? "video" : "gorsel"));
      setTool((t) => t ?? "templates");
      setDeck(null);
      setDeckBefore(null);
    setDeckBefore(null);
      setEditingScene(null);
      setFormat(w.format);
      change(w.els);
      setHist({ past: [], future: [] }); // undo must not bring another work back under this one's name
      setWorkId(w.id);
    }
    setWorkName(w.name);
    setSelected(null);
    closeLibrary();
  };
  const deleteWork = async (id: string) => {
    if (confirmDelete !== id) return setConfirmDelete(id);
    try {
      await removeWork(username, id);
    } catch {
      setLibError("Silinemedi (tarayıcı depolaması). Tekrar deneyin.");
      return;
    }
    if (workId === id) setWorkId(null);
    if (sceneOwner.current === id) sceneOwner.current = null; // the scenes on screen go with the next save
    setConfirmDelete(null);
    setLibError("");
    setLibrary(await listWorks(username).catch(() => []));
  };

  const saveProject = () => {
    const video = savedVideo();
    const file = new Blob([JSON.stringify({ kind: "kurum-ai-gorsel", version: 1, template, format, els: view, ...(deck ? { deck: savedDeck() } : {}), ...(video ? { video } : {}) })], { type: "application/json" });
    if (file.size > MAX_PROJECT_BYTES) return setNote({ kind: "error", text: SCENES_TOO_BIG });
    download(file, `kurum-gorsel-${template}-${format}.json`);
  };
  const openProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error("Proje dosyası çok büyük.");
      const j = JSON.parse(await file.text()) as { kind?: unknown; format?: unknown; els?: unknown; deck?: unknown; video?: unknown };
      if (j.kind !== "kurum-ai-gorsel" || typeof j.format !== "string" || !Object.hasOwn(FORMATS, j.format)) throw new Error("Bu bir Görsel Stüdyo proje dosyası değil.");
      if (!(await flushSave())) return;
      const turn = ++restoring.current; // every open counts, a deck too: a slow one coming back late must not land on it
      setScenesBefore(null);
      setWorkName(""); // a new work, not the one that was open
      const saved = cleanDeck(j.deck);
      if (saved) {
        await openDeck(saved, j.format as FormatId);
        setTool("text");
        return setNote({ kind: "ok", text: saved.album ? "Çoklu görsel açıldı." : "Sunum açıldı." });
      }
      const next = cleanEls(j.els);
      if (!next.length && !cleanVideo(j.video)) throw new Error("Proje dosyasında öğe yok.");
      const video = cleanVideo(j.video);
      if (video && !font) throw new Error("Yazı tipi yükleniyor; birazdan tekrar deneyin.");
      if (video && !(await restoreVideo(video, null, turn))) return;
      setMode((m) => (m === "video" || video ? "video" : "gorsel"));
      setTool((t) => t ?? "templates");
      setDeck(null);
      setDeckBefore(null);
    setDeckBefore(null);
      setEditingScene(null);
      setFormat(j.format as FormatId);
      change(next);
      setHist({ past: [], future: [] });
      setWorkId(null);
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

  const tools = RAIL[mode ?? "gorsel"].filter((t) => mode !== "sunum" || deck || t === "deck");
  const open = tool && tools.includes(tool) ? tool : null;
  const toolLabel = open ? TOOLS[open].label : "";
  /** Everything the panels show, one at a time. */
  const panel = () => {
    if (open === "deck") return deck ? <p className="px-4 py-4 text-sm text-muted">{deck.template.name} şablonu, {deck.slides.length} slayt. Alttaki şeritten slaytlara geçin ve yeni düzen ekleyin. Renk ve yazı tipi temaları Marka panelinde; tüm slaytlara uygulanır.</p> : null;
    if (open === "templates") return (
      <section className={section}>
        {mode === "video" && (
          <div>
            <h3 className={`${heading} mb-1.5`}>Hazır akışlar</h3>
            <div className="space-y-1.5">
              {REELS_PACKS.map((p) => (
                <button key={p.id} onClick={() => void addPack(p)} disabled={!font} className="flex w-full items-center gap-2 rounded-lg border border-line p-2 text-left hover:border-accent disabled:opacity-50">
                  <Clapperboard size={16} className="shrink-0 text-accent" />
                  <span className="min-w-0"><span className="block text-sm font-medium">{p.label}</span><span className="block truncate text-xs text-muted">{p.hint}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
        {(mode === "video" ? ([["reels", "Reels şablonları"]] as const) : ([["gorsel", "Özgün şablonlar"], ["klasik", "Klasik"]] as const)).map(([group, title]) => (
        <div key={group}>
        <h3 className={`${heading} mb-1.5`}>{title}</h3>
        <div className="grid grid-cols-2 gap-2">
          {templatesOf(group).map((t) => (
            <button key={t} title={TEMPLATES[t].hint} onClick={() => chooseTemplate(t)} aria-pressed={template === t} className={`overflow-hidden rounded-xl border text-left transition-all ${template === t ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent/60"}`}>
              <span className="block aspect-square bg-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data: SVG thumbnail */}
                {thumbs[t] && <img src={thumbs[t]} alt="" className="size-full object-cover" />}
              </span>
              <span className="block px-2 py-1.5 text-xs font-medium">{TEMPLATES[t].label}</span>
            </button>
          ))}
        </div>
        </div>
        ))}
        <h3 className={heading}>Boyut</h3>
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
        {els && <p className="text-xs text-muted">Şablon değiştirmek düzenlemeleri sıfırlar (Ctrl+Z ile geri alınır); format değişince düzenlemeler yeni boyuta taşınır.</p>}
      </section>
    );
    if (open === "ai") return (
      <section className={section}>
        <div role="group" aria-label="Ne oluşturulsun" className="grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1">
          {(mode === "video" ? ([["many", "Tüm sahneler"], ["one", "Bu sahnenin metni"]] as const) : ([["one", "Tek görsel"], ["many", "Çoklu görsel"]] as const)).map(([id, label]) => (
            <button key={id} onClick={() => setAiTab(id)} aria-pressed={aiMany === (id === "many")} className={`h-8 rounded-md text-xs font-medium ${aiMany === (id === "many") ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg"}`}>{label}</button>
          ))}
        </div>
        {docs.length > 0 && (
          <SourcePicker docs={docs} value={docIds} onChange={setDocIds} />
        )}
        <textarea aria-label="Konu" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} rows={aiMany ? 6 : 4} placeholder={aiMany ? "Anlatmak istediğiniz metni yazın ya da yapıştırın: konu, tarih, yer, rakamlar, çağrı…" : "Konuyu anlatın: ör. 12 Kasım'da kongre salonunda yatırımcı buluşması, saat 10.00"} className={`${field} resize-none`} />
        {aiMany && (
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            {mode === "video" ? "Sahne sayısı" : "Görsel sayısı"}
            <select value={storyCount} onChange={(e) => setStoryCount(+e.target.value)} className="h-8 rounded-md border border-line bg-panel px-2 text-sm text-fg">
              <option value={0}>Otomatik (içeriğe göre)</option>
              {Array.from({ length: storyRange.max - storyRange.min + 1 }, (_, i) => storyRange.min + i).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {aiMany && mode === "video" && scenes.length > 0 && (
          <div role="group" aria-label="Var olan sahneler" className="grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1">
            {([[false, "Sonuna ekle"], [true, "Yerine koy"]] as const).map(([v, label]) => (
              <button key={label} onClick={() => setStoryReplace(v)} aria-pressed={storyReplace === v} className={`h-7 rounded-md text-xs font-medium ${storyReplace === v ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg"}`}>{label}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={aiMany ? writeStory : suggest} disabled={(!brief.trim() && !docIds.length) || busy === "fill" || !font} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40">
            {busy === "fill" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy === "fill" ? "Yazılıyor…" : !aiMany ? "Metinleri öner" : mode === "video" ? "Sahneleri oluştur" : deck?.album ? "Görselleri yeniden oluştur" : "Görselleri oluştur"}
          </button>
          {busy === "fill" && (
            <button onClick={cancelSuggest} className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-fg" aria-label="İptal">
              <X size={16} />
            </button>
          )}
        </div>
        {scenesBefore && aiMany && mode === "video" && <button onClick={() => { setScenes(scenesBefore); setScenesBefore(null); setEditingScene(null); setTool("scenes"); }} className="text-xs text-accent hover:underline">Önceki sahnelere dön</button>}
        {aiMany && <p className="text-xs text-muted">{mode === "video" ? "Her sahnenin metni, şablonu, süresi ve hareketi metne göre belirlenir; sonra Sahneler panelinden düzenleyebilirsiniz." : "Görseller seçili şablonla, aynı marka renkleriyle hazırlanır; alttaki şeritten gezip tek tek düzenleyebilir, hepsini ZIP olarak indirebilirsiniz. Yeniden oluşturmak Ctrl+Z ile geri alınır."}</p>}
        <p className="text-xs text-muted">{docIds.length ? "Metinler yalnızca seçilen kaynaklardaki bilgilerle yazılır; kaynaklar zaten kurum sunucusunda. " : "Yalnızca bu açıklama kurum sunucusundaki modele gider. "}Görselleriniz tarayıcınızda kalır.</p>
      </section>
    );
    if (open === "text") return (
      <>
        <section className={section}>
          <button onClick={() => addText(72, 800, "Başlık")} className="block h-16 w-full rounded-xl border border-line px-4 text-left text-xl font-bold hover:border-accent">Başlık ekle</button>
          <button onClick={() => addText(44, 600, "Alt başlık")} className="block h-14 w-full rounded-xl border border-line px-4 text-left text-base font-semibold hover:border-accent">Alt başlık ekle</button>
          <button onClick={() => addText(30, 400, "Metin")} className="block h-12 w-full rounded-xl border border-line px-4 text-left text-sm hover:border-accent">Gövde metni ekle</button>
        </section>
        {!deck && (
          <section className={section} aria-labelledby="t-text">
            <h3 id="t-text" className={heading}>Şablonun metinleri</h3>
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
        )}
      </>
    );
    if (open === "elements") return (
      <section className={section}>
        <h3 className={heading}>Şekiller</h3>
        <ShapeStyleTabs style={shapeStyle} onStyle={setShapeStyle} />
        {shapeStyle === "holder" && <p className="text-xs text-muted">Resim tutucu ekler: resmi çift tıklayarak seçin, resim şeklin biçimine göre kırpılır. Çizgiler resim tutamaz.</p>}
        <ShapeGrid style={shapeStyle} onPick={(id) => addShape(id, shapeStyle)} verb="ekle" />
        <button onClick={() => setArtOpen(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm font-medium hover:border-accent hover:text-accent">
          <Sparkles size={15} /> Hazır şekil galerisi
        </button>
      </section>
    );
    if (open === "images") return (
      <section className={section}>
        <Picker label="Görsel yükle" accept=".png,.jpg,.jpeg,.webp" onPick={(f) => pick("image", f)} />
        <button onClick={() => addLogo()} disabled={!brand.logo} title={brand.logo ? undefined : "Önce Marka panelinden logo ekleyin"} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm hover:border-accent hover:text-accent disabled:opacity-40">
          <Stamp size={15} /> Logoyu tasarıma ekle
        </button>
        {(!deck || deck.album) && (
          <>
            <h3 className={heading}>Şablonun fotoğrafı</h3>
            <Picker label={photo ? "Fotoğrafı değiştir" : "Fotoğraf seç"} accept=".png,.jpg,.jpeg,.webp" onPick={(f) => pick("photo", f)} preview={photo?.src} onClear={photo ? () => { setPhoto(undefined); if (!els) setSelected(null); } : undefined} />
          </>
        )}
        <p className="text-xs text-muted">Görselleriniz yalnızca bu tarayıcıda kalır.</p>
      </section>
    );
    if (open === "brand") return (
      <section className={section}>
        <h3 className={heading}>Temalar</h3>
        <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Renk temaları">
          {THEMES.map((t) => (
            <button key={t.name} title={`${t.name} · ${t.mood}`} aria-label={`${t.name} teması`} aria-pressed={activeTheme === t.name} onClick={() => applyTheme(t)} className={`h-8 overflow-hidden rounded-md border-2 ${brand.primary === t.primary && brand.accent === t.accent ? "border-accent" : "border-transparent"}`}>
              <span className="flex size-full">
                <span className="flex-1" style={{ background: t.primary }} />
                <span className="flex-1" style={{ background: t.accent }} />
              </span>
            </button>
          ))}
        </div>
        <h3 className={heading}>Renkler</h3>
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
        <h3 className={heading}>Logo</h3>
        <h3 className={heading}>Logo kütüphanesi</h3>
        {logos.length > 0 && (
          <ul className="grid grid-cols-2 gap-2">
            {logos.map((l) => {
              const active = brand.logo?.src === l.pic.src;
              return (
                <li key={l.id} className={`overflow-hidden rounded-lg border ${active ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
                  <button onClick={() => chooseLogo(l.pic)} aria-pressed={active} title={`${l.name}: şablonlarda bunu kullan`} aria-label={`${l.name}: şablonlarda bunu kullan`} className="block h-16 w-full bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the user's own logo, a local data: URL */}
                    <img src={l.pic.src} alt="" className="size-full object-contain" />
                  </button>
                  <span className="flex items-center gap-1 border-t border-line px-1 py-0.5">
                    <span className="min-w-0 flex-1 truncate px-1 text-[11px] text-muted">{active ? "Kullanımda" : l.name}</span>
                    <button className={iconBtn} onClick={() => addLogo(l.pic)} aria-label={`${l.name}: tasarıma ekle`} title="Tasarıma ekle"><Plus size={14} /></button>
                    <button className={`${iconBtn} hover:text-danger`} onClick={() => void dropLogo(l)} aria-label={`${l.name}: kütüphaneden sil`} title="Kütüphaneden sil"><Trash2 size={14} /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <label className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm font-medium hover:border-accent hover:text-accent focus-within:ring-2 focus-within:ring-accent/40">
          <Plus size={15} /> Logo ekle
          <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.svg" className="sr-only" onChange={(e) => { void addToLogos(e.target.files); e.target.value = ""; }} />
        </label>
        <p className="text-xs text-muted">Seçili logoyu şablonlar kullanır; + ile tasarıma birden çok logo ekleyebilirsiniz. Logolar olduğu gibi kullanılır ve yalnızca bu tarayıcıda saklanır.</p>
      </section>
    );
    if (open === "layers") return (
      <section className={section}>
        <LayerList
          els={view}
          picked={picked}
          onSelect={setSelected}
          onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
          onLock={(id, locked) => patch(id, { locked })}
          onOrder={(next) => change(next)}
        />
      </section>
    );
    if (open === "edit") return picked.length > 1 ? (
      <section className={section} aria-labelledby="t-multi">
        <div className="flex items-center justify-between gap-2">
          <h3 id="t-multi" className={heading}>{picked.length} öğe seçili</h3>
          <div className="flex">
            <button className={iconBtn} onClick={() => duplicate(picked)} aria-label="Hepsini çoğalt" title="Çoğalt (Ctrl+D)"><Copy size={15} /></button>
            <button className={`${iconBtn} hover:text-danger`} onClick={() => remove(picked)} aria-label="Hepsini sil" title="Sil (Delete)"><Trash2 size={15} /></button>
          </div>
        </div>
        <div role="group" aria-label="Hizalama referansı" className="flex rounded-lg border border-line bg-subtle p-0.5">
          <button className={`flex-1 ${chip(!alignCanvas)}`} aria-pressed={!alignCanvas} onClick={() => setAlignCanvas(false)}>Birbirine göre</button>
          <button className={`flex-1 ${chip(alignCanvas)}`} aria-pressed={alignCanvas} onClick={() => setAlignCanvas(true)}>Tuvale göre</button>
        </div>
        <div role="group" aria-label="Hizala" className="grid grid-cols-6 gap-0.5">
          {ALIGNS.map(([how, label, icon]) => (
            <button key={how} className={iconBtn} onClick={() => alignMany(picked, how, alignCanvas)} aria-label={label} title={label}>{icon}</button>
          ))}
        </div>
        <div role="group" aria-label="Dağıt" className="grid grid-cols-2 gap-1.5">
          <button className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-line text-xs hover:border-accent hover:text-accent disabled:opacity-40" disabled={picked.length < 3} onClick={() => distribute(picked, "x")} title="En az 3 öğe">
            <AlignHorizontalSpaceAround size={14} /> Yatay eşit aralık
          </button>
          <button className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-line text-xs hover:border-accent hover:text-accent disabled:opacity-40" disabled={picked.length < 3} onClick={() => distribute(picked, "y")} title="En az 3 öğe">
            <AlignVerticalSpaceAround size={14} /> Dikey eşit aralık
          </button>
          <button className="h-8 rounded-md border border-line text-xs hover:border-accent hover:text-accent" onClick={() => sameSize(picked, "w")}>Aynı genişlik</button>
          <button className="h-8 rounded-md border border-line text-xs hover:border-accent hover:text-accent" onClick={() => sameSize(picked, "h")}>Aynı yükseklik</button>
        </div>
        <div role="group" aria-label="Katman sırası" className="flex gap-1.5">
          <button className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-line text-xs hover:border-accent hover:text-accent" onClick={() => reorder(picked, "front")}><ArrowUpToLine size={13} /> En öne</button>
          <button className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-line text-xs hover:border-accent hover:text-accent" onClick={() => reorder(picked, "back")}><ArrowDownToLine size={13} /> En arkaya</button>
        </div>
        {view.some((e) => e.kind === "text" && picked.includes(e.id)) && (
          <FontPicker value={undefined} username={username} onPick={(f) => applyFont(picked, f)} />
        )}
        <p className="text-xs text-muted">Shift ya da Ctrl ile tıklayarak seçime ekleyip çıkarın; boş alanda sürükleyerek kutu içindekileri seçin. Aynı boyut ilk seçilene göre yapılır.</p>
      </section>
    ) : sel ? (
      <Inspector key={sel.id} placing={placingNow === sel.id} onPlace={setPlacing} el={shownSel!} username={username} onFont={(f) => applyFont([sel.id], f)} brand={brand} u={u} canvas={{ w: W, h: H }} onPatch={patchSel} onCommit={() => change(view)} onRemove={() => remove([sel.id])} onDuplicate={() => duplicate([sel.id])} onOrder={(to) => reorder([sel.id], to)} onReplace={(f) => replacePicture(sel.id, f)} onLogo={() => openLogos(sel.id)} onAlign={(how) => alignMany([sel.id], how, true)} />
    ) : (
      <section className={section}>
        <p className="text-sm text-muted">Tuvalde bir öğeye tıklayın: konumunu, boyutunu, gölgesini ve diğer ayarlarını buradan değiştirebilirsiniz.</p>
      </section>
    );
    if (open === "scenes") return (
      <section className={section}>
        <p className="text-xs text-muted">Her sahne bir tasarımdır: tasarlayın, sahne olarak ekleyin, sonrakini tasarlayın. Video bu tarayıcıda oluşturulur; hiçbir şey sunucuya gitmez. Kodlayıcı: <a className="underline" href="https://github.com/Vanilagy/mediabunny" target="_blank" rel="noreferrer">mediabunny</a> (MPL-2.0).</p>
        <button onClick={addScene} disabled={!font} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-40">
          <Clapperboard size={15} /> {editingScene ? "Sahneyi güncelle" : "Bu tasarımı sahne olarak ekle"}
        </button>
        {editingScene && <button onClick={() => setEditingScene(null)} className="text-xs text-accent hover:underline">Güncellemeden yeni sahne olarak ekle</button>}
        {!scenes.length && <button onClick={() => setTool("templates")} className="text-xs text-accent hover:underline">Hazır akışlardan başlayın</button>}
        {scenes.length > 0 && (
          <>
            <ol className="space-y-1.5">
              {scenes.map((s, i) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data: SVG of the scene */}
                  <img src={s.thumb} alt={`Sahne ${i + 1}`} className="h-12 w-auto shrink-0 rounded border border-line" style={{ aspectRatio: `${FORMATS[s.format].w} / ${FORMATS[s.format].h}` }} />
                  <span className="text-xs font-medium tabular-nums">{i + 1}.</span>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <select aria-label={`Sahne ${i + 1} süresi`} value={s.seconds} onChange={(e) => setScenes((x) => x.map((y) => (y.id === s.id ? { ...y, seconds: +e.target.value } : y)))} className="h-7 rounded-md border border-line bg-panel px-1 text-xs text-fg">
                      {SCENE_SECONDS.map((n) => <option key={n} value={n}>{n} sn</option>)}
                    </select>
                  </label>
                  <span className="ml-auto flex">
                    <button className={iconBtn} onClick={() => void editScene(s)} aria-pressed={editingScene === s.id} aria-label={`Sahne ${i + 1} düzenle`} title="Düzenle"><Pencil size={14} /></button>
                    <button className={iconBtn} onClick={() => moveScene(i, -1)} disabled={i === 0} aria-label={`Sahne ${i + 1} yukarı`}><ChevronUp size={14} /></button>
                    <button className={iconBtn} onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1} aria-label={`Sahne ${i + 1} aşağı`}><ChevronDown size={14} /></button>
                    <button className={`${iconBtn} hover:text-danger`} onClick={() => setScenes((x) => x.filter((y) => y.id !== s.id))} aria-label={`Sahne ${i + 1} sil`}><Trash2 size={14} /></button>
                  </span>
                  <span className="grid w-full grid-cols-2 gap-1.5">
                    <select aria-label={`Sahne ${i + 1} metin hareketi`} value={s.enter ?? "yuksel"} onChange={(e) => setScenes((x) => x.map((y) => (y.id === s.id ? { ...y, enter: e.target.value as Entrance } : y)))} className="h-7 min-w-0 rounded-md border border-line bg-panel px-1 text-xs">
                      {(Object.keys(ENTRANCES) as Entrance[]).map((k) => <option key={k} value={k}>{ENTRANCES[k]}</option>)}
                    </select>
                    <select aria-label={`Sahne ${i + 1} arka plan hareketi`} value={s.backdrop ?? "yaklas"} onChange={(e) => setScenes((x) => x.map((y) => (y.id === s.id ? { ...y, backdrop: e.target.value as Backdrop } : y)))} className="h-7 min-w-0 rounded-md border border-line bg-panel px-1 text-xs">
                      {(Object.keys(BACKDROPS) as Backdrop[]).map((k) => <option key={k} value={k}>{BACKDROPS[k]}</option>)}
                    </select>
                  </span>
                  <input value={s.caption ?? ""} onChange={(e) => setCaption(s.id, e.target.value)} maxLength={240} placeholder="Altyazı (isteğe bağlı)" aria-label={`Sahne ${i + 1} altyazısı`} className="h-7 w-full rounded-md border border-line bg-panel px-2 text-xs outline-none focus:border-accent" />
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-muted">Geçiş</span>
                <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)} className="h-8 w-full rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent">
                  {(Object.keys(TRANSITIONS) as Transition[]).map((k) => <option key={k} value={k}>{TRANSITIONS[k]}</option>)}
                </select>
              </label>
              <label className="flex items-end gap-1.5 pb-1.5 text-xs">
                <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} /> Hareket (yakınlaşma, belirme)
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <button onClick={() => setScenes((x) => x.map((y) => ({ ...y, caption: captionFrom(y.els) })))} className="text-accent hover:underline">Altyazıları sahne metinlerinden doldur</button>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} /> Altyazıyı videoya yaz
              </label>
              {cues.length > 0 && (
                <span className="flex gap-2">
                  <button onClick={() => saveSubs("srt")} className="text-accent hover:underline">SRT indir</button>
                  <button onClick={() => saveSubs("vtt")} className="text-accent hover:underline">VTT indir</button>
                </span>
              )}
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
    );
    return null;
  };

  const blocked = !!library || artOpen || layoutsOpen || !!logoFor;
  const showCanvas = mode !== "sunum" || !!deck;
  return (
    <div className="flex h-dvh flex-col bg-bg">
      {mode === null ? (
        <div inert={blocked} className="flex min-h-0 flex-1 flex-col">
          <Home isAdmin={isAdmin} recent={recent} onStart={begin} onOpen={openWork} onLibrary={openLibrary} onProject={openProject} />
        </div>
      ) : (
      <>
      <header inert={blocked} className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-3 md:px-4">
        <button onClick={goHome} className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg" title="Görsel Stüdyo ana sayfası">
          <ArrowLeft size={16} /> <Logo size={24} />
        </button>
        <span className="h-5 w-px bg-line" aria-hidden />
        <input value={workName} onChange={(e) => setWorkName(e.target.value)} maxLength={80} placeholder={designTitle()} aria-label="Tasarım adı" className="h-8 w-32 min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-line focus:border-accent sm:w-72" />
        <span className={`hidden items-center gap-1 text-xs sm:flex ${saved === "error" ? "text-danger" : "text-muted"}`} role="status" title={saved === "error" ? saveError : "Çalışmalar yalnızca bu tarayıcıda saklanır"}>
          {saved === "saving" ? <><Loader2 size={13} className="animate-spin" /> Kaydediliyor</> : saved === "saved" ? <><Check size={13} className="text-ok" /> Kaydedildi</> : saved === "error" ? "Kaydedilemedi" : null}
        </span>
        <span className="flex-1" />
        <button className={iconBtn} onClick={undo} disabled={!hist.past.length} aria-label="Geri al" title="Geri al (Ctrl+Z)">
          <Undo2 size={16} />
        </button>
        <button className={iconBtn} onClick={redo} disabled={!hist.future.length} aria-label="Yinele" title="Yinele (Ctrl+Y)">
          <Redo2 size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg" onClick={openLibrary} aria-haspopup="dialog">
          <Library size={16} /> <span className="hidden md:inline">Çalışmalarım</span>
        </button>
        <ThemeToggle />
        <button onClick={(e) => downloadMenu(e.currentTarget)} disabled={!showCanvas || !font || busy === "export"} aria-haspopup="menu" className="ml-1 flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
          {busy === "export" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} İndir <ChevronDown size={14} />
        </button>
        <input ref={projectInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { openProject(e.target.files?.[0]); e.target.value = ""; }} />
      </header>

      <div inert={blocked} className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* The rail: one tool at a time opens beside it; along the bottom on small screens */}
        <nav aria-label="Araçlar" className="order-3 flex shrink-0 gap-0.5 overflow-x-auto border-t border-line bg-panel p-1.5 lg:order-1 lg:w-[76px] lg:flex-col lg:overflow-y-auto lg:border-r lg:border-t-0">
          {tools.map((t) => {
            const { label, Icon } = TOOLS[t];
            return (
              <button key={t} onClick={() => setTool(open === t ? null : t)} aria-pressed={open === t} className={`flex w-[62px] shrink-0 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors ${open === t ? "bg-accent-soft text-accent" : "text-muted hover:bg-subtle hover:text-fg"}`}>
                <Icon size={20} /> {label}
              </button>
            );
          })}
        </nav>

        <aside className={`order-2 max-h-[42dvh] min-h-0 shrink-0 overflow-y-auto border-line bg-panel lg:max-h-none lg:w-[320px] lg:border-r ${open ? "border-t lg:border-t-0" : "hidden"}`} aria-label={toolLabel}>
          <div className="sticky top-0 z-10 flex items-center justify-between bg-panel px-4 pb-1 pt-3">
            <h2 className="font-semibold">{toolLabel}</h2>
            <button className={iconBtn} onClick={() => setTool(null)} aria-label="Paneli kapat"><X size={16} /></button>
          </div>
          {/* Stays mounted: it works for minutes on a deck, and leaving the panel mustn't cancel that. */}
          {mode === "sunum" && !deck && (
            <section className={`${section} ${open === "deck" ? "" : "hidden"}`}>
              <DeckPanel docs={docs} measure={font?.measure} username={username} design={deckDesign} onDesign={(d) => { setDeckDesign(d); setDesignPreview(d); }} onStart={(d, c, s) => void startComposed(d, c, s)} onBlank={(d) => void startBlank(d)} onNote={(kind, text) => setNote({ kind, text })} />
            </section>
          )}
          {mode === "sunum" && deck && open === "deck" && (
            <section className={section}>
              <h3 className={heading}>Tasarım</h3>
              <p className="text-xs text-muted">Bir tasarıma tıklayın: bu sunum o tasarımla sağda önizlenir.</p>
              <DesignList current={deck.design?.id} onPick={setDesignPreview} />
              {deckBefore && <button onClick={undoDesign} className="h-8 w-full rounded-md border border-line text-xs hover:border-accent hover:text-accent">Önceki tasarıma dön</button>}
              <button onClick={() => void exportDeck()} disabled={busy === "export"} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"><Download size={15} /> PowerPoint indir</button>
            </section>
          )}
          {mode === "sunum" && open === "master" && (deck ? (
            <MasterPanel
              master={deck.master ?? DEFAULT_MASTER}
              logos={logos}
              at={deck.at}
              total={deck.slides.length}
              pick={splitMaster(view).pick}
              onChange={setMaster}
              onPick={setSlidePick}
              onWhiteFile={(l, f) => { if (f) void readPicture(f, "logo").then((p) => logoWhiteNow.current(l, p), (e) => setNote({ kind: "error", text: (e as Error).message })); }}
              onWhiteAuto={(l) => void whiteLogo(l.pic).then((p) => (p ? logoWhiteNow.current(l, p) : setNote({ kind: "error", text: "Bu logonun zemini saydam değil, otomatik beyaz sürüm beyaz kutu olurdu. Beyaz sürümü yükleyin." })), () => setNote({ kind: "error", text: "Beyaz sürüm üretilemedi." }))}
            />
          ) : <section className={section}><p className="text-xs text-muted">Önce bir sunum başlatın; asıl slayt ayarları sunumla birlikte saklanır.</p></section>)}
          {panel()}
        </aside>

        <main className="order-1 flex min-h-[50vh] min-w-0 flex-1 flex-col lg:order-3">
          {designPreview && font ? (
            <DesignPreview
              design={designPreview}
              content={deck?.content}
              slides={deck && !deck.content ? slidesIn(designPreview) : undefined}
              measure={font.measure}
              master={deck?.master ?? DEFAULT_MASTER}
              username={username}
              onApply={deck ? () => void applyDesign(designPreview) : undefined}
              onApplyDownload={deck ? () => void applyDesign(designPreview, true) : undefined}
              onClose={() => setDesignPreview(null)}
            />
          ) : showCanvas ? (
            <>
              <Toolbar
                el={shownSel}
                count={picked.length}
                username={username}
                aligns={ALIGNS}
                onPatch={(p) => patchSel(p)}
                onFont={(f) => sel && applyFont([sel.id], f)}
                onDuplicate={() => duplicate(picked)}
                onRemove={() => remove(picked)}
                onOrder={(to) => reorder(picked, to)}
                onAlign={(how) => alignMany(picked, how)}
                onReplace={(f) => sel && replacePicture(sel.id, f)}
                onLogo={() => sel && openLogos(sel.id)}
                onMore={() => setTool("edit")}
              />
              <div className="flex min-h-0 flex-1 overflow-auto p-4 md:p-8" style={{ containerType: "size", backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "18px 18px" }} onPointerDown={() => { setSelected(null); setEditing(null); }}>
                {font ? (
                  <div className="m-auto shrink-0 [&>svg]:size-full" style={{ aspectRatio: `${W} / ${H}`, width: `calc(min(100cqw, 100cqh * ${W / H}) * ${zoom})` }} onPointerDown={(e) => e.stopPropagation()}>
                    <Editor placing={placingNow} onFillPicture={(id) => { const t = view.find((e) => e.id === id); if (t && isHolder(t)) fillPicture(id); else setPlacing(id); }} format={format} els={view} measure={font.measure} selected={picked} onSelect={setPicked} onChange={change} editing={editing} onEditing={setEditing} onTextSel={setTextSel} onMenu={(id, x, y) => setMenu({ items: menuItems(id), x, y, view })} />
                  </div>
                ) : (
                  <p className="m-auto flex items-center gap-2 text-sm text-muted">{fontError || <><Loader2 size={16} className="animate-spin" /> Hazırlanıyor…</>}</p>
                )}
              </div>
              {deck && font && <SlideStrip slides={slidesNow()} at={deck.at} measure={font.measure} onGo={goSlide} onAdd={() => (deck.album ? addAlbumPage() : setLayoutsOpen(true))} {...(deck.album ? { noun: "Görsel", many: "Görseller", size: { w: W, h: H } } : {})} onDuplicate={duplicateSlide} onDelete={deleteSlide} onMove={moveSlide} onReorder={reorderSlide} onClose={leaveDeck} />}
              {mode === "video" && (
                <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2">
                  <ol className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5" aria-label="Sahneler">
                    {scenes.map((s, i) => (
                      <li key={s.id} className="shrink-0">
                        <button onClick={() => setTool("scenes")} title={`Sahne ${i + 1} · ${s.seconds} sn`} aria-label={`Sahne ${i + 1}`} className="block overflow-hidden rounded border border-line hover:border-accent">
                          {/* eslint-disable-next-line @next/next/no-img-element -- local data: SVG of the scene */}
                          <img src={s.thumb} alt="" className="h-14 w-auto" style={{ aspectRatio: `${FORMATS[s.format].w} / ${FORMATS[s.format].h}` }} />
                        </button>
                      </li>
                    ))}
                    {!scenes.length && <li className="self-center text-xs text-muted">Henüz sahne yok. Tasarımınız hazır olunca sahne olarak ekleyin.</li>}
                  </ol>
                  <button onClick={addScene} disabled={!font} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-40">
                    <Plus size={15} /> Sahne ekle
                  </button>
                </div>
              )}
              <div className="flex h-10 shrink-0 items-center gap-1 border-t border-line bg-panel px-3 text-xs text-muted">
                <span className="mr-auto tabular-nums">{W}×{H} · {FORMATS[format].label}</span>
                <button className={iconBtn} onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} disabled={zoom <= 0.25} aria-label="Uzaklaştır" title="Uzaklaştır"><Minus size={14} /></button>
                <button className="h-7 w-14 rounded-md tabular-nums hover:bg-subtle" onClick={() => setZoom(1)} title="Ekrana sığdır">%{Math.round(zoom * 100)}</button>
                <button className={iconBtn} onClick={() => setZoom((z) => Math.min(3, z + 0.25))} disabled={zoom >= 3} aria-label="Yakınlaştır" title="Yakınlaştır"><Plus size={14} /></button>
              </div>
            </>
          ) : (
            <div className="m-auto max-w-sm p-6 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><Presentation size={26} /></span>
              <h2 className="mt-4 font-semibold">Sunumunuzu başlatın</h2>
              <p className="mt-1 text-sm text-muted">Sol panelden bir tema seçin; konunuzu yazıp sunumu oluşturun ya da boş sunumla başlayın.</p>
              {open !== "deck" && <button onClick={() => setTool("deck")} className="mt-4 h-9 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90">Paneli aç</button>}
            </div>
          )}
        </main>
      </div>
      </>
      )}

      {note && (
        <div role={note.kind === "error" ? "alert" : "status"} className={`fixed left-1/2 top-16 z-40 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm shadow-card ${note.kind === "error" ? "text-danger" : "text-ok"}`}>
          {note.text}
          <button className="-mr-1 rounded p-0.5 text-muted hover:text-fg" onClick={() => setNote(null)} aria-label="Bildirimi kapat"><X size={14} /></button>
        </div>
      )}

      {/* Its actions were made for the design it opened on: any other change (a suggestion arriving) closes it. */}
      {menu?.view === view && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <input
        ref={replaceInput}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (replaceTarget.current) replacePicture(replaceTarget.current, e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {layoutsOpen && deck && font && <LayoutPicker template={deck.template} accent={deck.primary} measure={font.measure} onPick={addSlide} onClose={() => setLayoutsOpen(false)} />}
      {artOpen && <ArtPicker colors={brand} onPick={addArt} onClose={() => setArtOpen(false)} />}
      {logoFor && (() => {
        const target = view.find((e) => e.id === logoFor);
        return (
          <LogoPicker
            logos={logos}
            current={target?.kind === "image" ? target.pic.src : undefined}
            error={note?.kind === "error" ? note.text : undefined}
            onPick={(l) => { putLogoOn(logoFor, l.pic); setLogoFor(null); }}
            onAdd={(files) => void addToLogos(files).then((p) => { if (p && logoForNow.current === logoFor) { putLogoOn(logoFor, p); setLogoFor(null); } })}
            onDrop={(l) => void dropLogo(l)}
            onClose={() => setLogoFor(null)}
          />
        );
      })()}
      {library && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onPointerDown={closeLibrary}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="t-library"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && closeLibrary()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 id="t-library" className="flex-1 text-sm font-semibold">Çalışmalarım</h2>
              <button className={iconBtn} onClick={closeLibrary} aria-label="Kapat" autoFocus><X size={16} /></button>
            </div>
            {mode && <div className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
              <label className="min-w-0 flex-1">
                <span className="mb-0.5 block text-[11px] text-muted">{workId ? "Bu çalışmanın adı" : "Yeni çalışmanın adı"}</span>
                <input value={workName} onChange={(e) => setWorkName(e.target.value)} maxLength={80} className={field} />
              </label>
              <button onClick={saveToLibrary} className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90">
                <Save size={15} /> {workId ? "Güncelle" : "Kaydet"}
              </button>
              {workId && (
                <button onClick={() => { setWorkId(null); setWorkName((n) => `${n} (kopya)`.slice(0, 80)); }} className="h-9 rounded-lg border border-line px-3 text-sm hover:border-accent hover:text-accent">
                  Yeni çalışma olarak
                </button>
              )}
            </div>}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {libError && <p role="alert" className="mb-3 text-sm text-danger">{libError}</p>}
              {library.length === 0 ? (
                <p className="text-sm text-muted">Henüz kayıtlı çalışma yok. Tasarımlar yalnızca bu tarayıcıda saklanır; başka bir bilgisayara taşımak için İndir menüsünden proje dosyası olarak kaydedin.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {library.map((w) => (
                    <li key={w.id} className={`overflow-hidden rounded-xl border ${w.id === workId ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
                      <button onClick={() => openWork(w)} className="block w-full bg-subtle" title="Aç">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local thumbnail */}
                        {w.thumb ? <img src={w.thumb} alt="" className="mx-auto max-h-40 object-contain" /> : <span className="block h-32" />}
                      </button>
                      <div className="flex items-center gap-1 px-2 py-1.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium" title={w.name}>{w.name}</span>
                          <span className="block text-[11px] text-muted">{FORMATS[w.format].label} · {new Date(w.updatedAt).toLocaleDateString("tr-TR")}</span>
                        </span>
                        <button onClick={() => deleteWork(w.id)} className={`rounded-md px-1.5 py-1 text-[11px] ${confirmDelete === w.id ? "bg-danger text-white" : "text-muted hover:text-danger"}`} aria-label={confirmDelete === w.id ? `${w.name}: silmeyi onayla` : `${w.name} sil`}>
                          {confirmDelete === w.id ? "Sil?" : <Trash2 size={13} />}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
  username: string;
  onFont: (font: string | undefined) => void;
  canvas: { w: number; h: number };
  brand: Brand;
  u: number;
  onPatch: (p: Partial<El>, commit: boolean) => void;
  onCommit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onOrder: (to: "front" | "back" | "up" | "down") => void;
  onReplace: (f: File | undefined) => void; onLogo: () => void;
  placing: boolean;
  onPlace: (id: string | null) => void;
  /** To the canvas, by what is drawn (a turned element's outer box). */
  onAlign: (how: AlignTo) => void;
}

function Inspector({ el, username, onFont, brand, u, onPatch, onCommit, onRemove, onDuplicate, onOrder, onReplace, onLogo, placing, onPlace, onAlign }: InspectorProps) {
  const live = (p: Partial<El>) => onPatch(p, false);
  const now = (p: Partial<El>) => onPatch(p, true);
  const swatches = [...new Set([brand.primary, brand.accent, "#ffffff", "#14263d", "#000000"])];
  const ratio = el.w / el.h;
  const keep = el.kind === "image";
  const rot = Number.isFinite(el.rotation) ? ((el.rotation as number) % 360 + 360) % 360 : 0;

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
              [AlignStartVertical, "Sola", "left"],
              [AlignCenterVertical, "Yatayda ortala", "hcenter"],
              [AlignEndVertical, "Sağa", "right"],
              [AlignStartHorizontal, "Üste", "top"],
              [AlignCenterHorizontal, "Dikeyde ortala", "vcenter"],
              [AlignEndHorizontal, "Alta", "bottom"],
            ] as const).map(([Icon, label, how]) => (
              <button key={label} className={iconBtn} disabled={el.locked} onClick={() => onAlign(how)} aria-label={`Tuvale göre ${label.toLocaleLowerCase("tr")} hizala`} title={label}>
                <Icon size={15} />
              </button>
            ))}
          </div>
        </div>
        <Slider label="Saydamlık" value={el.opacity ?? 1} min={0.1} max={1} step={0.05} show={`%${Math.round((el.opacity ?? 1) * 100)}`} onChange={(opacity) => live({ opacity })} onCommit={onCommit} />
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <Slider label="Döndür" value={rot > 180 ? rot - 360 : rot} min={-180} max={180} step={1} show={`${Math.round(rot > 180 ? rot - 360 : rot)}°`} onChange={(r) => live({ rotation: r ? (r + 360) % 360 : undefined })} onCommit={onCommit} />
          </div>
          <button className={iconBtn} disabled={el.locked || !rot} onClick={() => now({ rotation: undefined })} aria-label="Döndürmeyi sıfırla" title="Sıfırla"><RotateCcw size={14} /></button>
          {el.kind !== "text" && (
            <>
              <button className={`${iconBtn} ${el.flipX ? "bg-accent-soft text-accent" : ""}`} disabled={el.locked} aria-pressed={!!el.flipX} onClick={() => now({ flipX: !el.flipX || undefined })} aria-label="Yatay çevir" title="Yatay çevir"><FlipHorizontal2 size={15} /></button>
              <button className={`${iconBtn} ${el.flipY ? "bg-accent-soft text-accent" : ""}`} disabled={el.locked} aria-pressed={!!el.flipY} onClick={() => now({ flipY: !el.flipY || undefined })} aria-label="Dikey çevir" title="Dikey çevir"><FlipVertical2 size={15} /></button>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={!!el.shadow} disabled={el.locked} onChange={(e) => now({ shadow: e.target.checked ? { color: "#000000", blur: 24 * u, x: 0, y: 10 * u, opacity: 0.3 } : undefined })} /> Gölge
        </label>
        {el.shadow && (
          <div className="space-y-2 rounded-lg bg-subtle p-2">
            <Swatches swatches={swatches} value={el.shadow.color} set={(color) => now({ shadow: { ...el.shadow!, color } })} />
            <Slider label="Yumuşaklık" value={el.shadow.blur} min={0} max={Math.round(120 * u)} step={1} show={`${Math.round(el.shadow.blur)} px`} onChange={(blur) => live({ shadow: { ...el.shadow!, blur } })} onCommit={onCommit} />
            <Slider label="Yatay kayma" value={el.shadow.x} min={Math.round(-60 * u)} max={Math.round(60 * u)} step={1} show={`${Math.round(el.shadow.x)} px`} onChange={(x) => live({ shadow: { ...el.shadow!, x } })} onCommit={onCommit} />
            <Slider label="Dikey kayma" value={el.shadow.y} min={Math.round(-60 * u)} max={Math.round(60 * u)} step={1} show={`${Math.round(el.shadow.y)} px`} onChange={(y) => live({ shadow: { ...el.shadow!, y } })} onCommit={onCommit} />
            <Slider label="Koyuluk" value={el.shadow.opacity} min={0.05} max={1} step={0.05} show={`%${Math.round(el.shadow.opacity * 100)}`} onChange={(opacity) => live({ shadow: { ...el.shadow!, opacity } })} onCommit={onCommit} />
          </div>
        )}
      </section>

      {el.kind === "text" && (
        <section className={section} data-text-tools onMouseDown={keepSelection}>
          <h3 className={heading}>Yazı</h3>
          <FontPicker value={el.font} username={username} onPick={onFont} />
          <textarea aria-label="Metin" value={el.text} onChange={(e) => live(editedText(el, e.target.value))} onBlur={onCommit} rows={3} className={`${field} resize-y`} lang="tr" />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Yazı boyutu" value={el.size} min={6} max={600} onChange={(size) => live({ size, auto: false })} onCommit={onCommit} />
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-muted">Kalınlık</span>
              <select className={small} value={el.weight} onChange={(e) => now({ weight: +e.target.value })}>
                {TEXT_WEIGHTS.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
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
            <div className="flex items-center gap-1">
              <button className={`${iconBtn} ${el.italic ? "bg-accent-soft text-accent" : ""}`} aria-pressed={!!el.italic} onClick={() => now({ italic: !el.italic || undefined })} aria-label="Eğik" title="Eğik"><Italic size={15} /></button>
              <button className={`${iconBtn} ${el.underline ? "bg-accent-soft text-accent" : ""}`} aria-pressed={!!el.underline} onClick={() => now({ underline: !el.underline || undefined })} aria-label="Altı çizili" title="Altı çizili"><Underline size={15} /></button>
              <label className="ml-1 flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!el.upper} onChange={(e) => now({ upper: e.target.checked })} /> BÜYÜK HARF
              </label>
            </div>
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
          {el.logo ? (
            <button disabled={el.locked} onClick={onLogo} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-40">
              <ImagePlus size={15} /> Logoyu değiştir
            </button>
          ) : (
            <label className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted hover:border-accent hover:text-accent">
              <ImagePlus size={15} /> Görseli değiştir
              <input type="file" accept=".png,.jpg,.jpeg,.webp" className="sr-only" onChange={(e) => { onReplace(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          {el.logo && <p className="text-xs text-muted">Logo yalnızca oranı korunarak büyütülüp küçültülür.</p>}
        </section>
      )}

      {el.kind === "shape" && (
        <section className={section}>
          <h3 className={heading}>Şekil</h3>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-muted">Biçim</span>
            <select className={small} value={shapeIdOf(el)} onChange={(e) => now(changeShape(el, e.target.value as ShapeId, shapeStyleOf(el)))}>
              {shapeIdOf(el) === "custom" && <option value="custom">Özel</option>}
              {(Object.keys(SHAPES) as ShapeId[]).map((id) => <option key={id} value={id}>{SHAPES[id].label}</option>)}
            </select>
          </label>
          {el.shape !== "line" && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!el.noFill} onChange={(e) => now({ noFill: !e.target.checked || undefined, ...(!e.target.checked && !el.stroke ? { stroke: { color: swatches[0], width: Math.max(2, 4 * u) } } : {}) })} /> Dolgu
            </label>
          )}
          {el.shape !== "line" && (
            <div className="flex gap-1.5">
              <label className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-sm text-muted hover:border-accent hover:text-accent focus-within:ring-2 focus-within:ring-accent/40">
                <ImagePlus size={15} /> {el.picFill && !isHolder(el) ? "Resmi değiştir" : "Resimle doldur"}
                <input type="file" accept=".png,.jpg,.jpeg,.webp" className="sr-only" onChange={(e) => { onReplace(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {el.picFill && <button className="h-9 rounded-lg border border-line px-2 text-sm text-muted hover:border-accent hover:text-accent" onClick={() => now({ picFill: undefined, picView: undefined })}>Kaldır</button>}
            </div>
          )}
          {el.shape !== "line" && el.picFill && !isHolder(el) && (() => {
            const v = el.picView ?? { x: 0.5, y: 0.5, zoom: 1 };
            return (
              <div className="space-y-2 rounded-lg border border-line p-2">
                <button onClick={() => onPlace(placing ? null : el.id)} aria-pressed={placing} className={`h-8 w-full rounded-md text-xs font-medium ${placing ? "bg-accent text-white" : "border border-line hover:border-accent hover:text-accent"}`}>{placing ? "Bitti" : "Tuvalde konumla"}</button>
                {placing && <p className="text-xs text-muted">Sürükleyerek kaydırın, tekerlekle yakınlaştırın. Esc ile çıkın.</p>}
                <Slider label="Yakınlaştırma" value={v.zoom} min={1} max={MAX_PIC_ZOOM} step={0.01} show={`%${Math.round(v.zoom * 100)}`} onChange={(zoom) => live({ picView: { ...v, zoom } })} onCommit={onCommit} />
                <Slider label="Yatay konum" value={v.x} min={0} max={1} step={0.01} show={`%${Math.round(v.x * 100)}`} onChange={(x) => live({ picView: { ...v, x } })} onCommit={onCommit} />
                <Slider label="Dikey konum" value={v.y} min={0} max={1} step={0.01} show={`%${Math.round(v.y * 100)}`} onChange={(y) => live({ picView: { ...v, y } })} onCommit={onCommit} />
                {el.picView && <button onClick={() => now({ picView: undefined })} className="text-xs text-accent hover:underline">Ortala</button>}
              </div>
            );
          })()}
          {el.shape === "line" || el.noFill || el.picFill ? null : el.fill.kind === "solid" ? (
            <Swatches swatches={swatches} value={el.fill.color} set={(color) => now({ fill: { kind: "solid", color } })} />
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Yön
                <select value={el.fill.dir} onChange={(e) => { if (el.fill.kind === "linear") now({ fill: { ...el.fill, dir: e.target.value as GradientDir } }); }} className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-1 text-xs text-fg">
                  {(Object.keys(GRADIENT_DIRS) as GradientDir[]).map((k) => <option key={k} value={k}>{GRADIENT_DIRS[k]}</option>)}
                </select>
              </label>
              {el.fill.stops.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted">
                  {i ? "Bitiş" : "Başlangıç"}
                  <Swatches swatches={swatches} value={s.color} set={(color) => { if (el.fill.kind !== "linear") return; const stops = [...el.fill.stops] as typeof el.fill.stops; stops[i] = { ...stops[i], color }; now({ fill: { ...el.fill, stops } }); }} />
                </div>
              ))}
            </div>
          )}
          {(el.shape ?? "rect") === "rect" && (
            <Slider label="Köşe" value={el.radius ?? 0} min={0} max={Math.round(Math.min(el.w, el.h) / 2)} step={1} show={`${Math.round(el.radius ?? 0)} px`} onChange={(radius) => live({ radius })} onCommit={onCommit} />
          )}
          {el.shape !== "line" && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!el.stroke} onChange={(e) => now(e.target.checked ? { stroke: { color: swatches[0], width: Math.max(2, 4 * u) } } : { stroke: undefined, noFill: undefined })} /> Kenarlık
            </label>
          )}
          {el.stroke && (
            <div className="space-y-2 rounded-lg bg-subtle p-2">
              <Swatches swatches={swatches} value={el.stroke.color} set={(color) => now({ stroke: { ...el.stroke!, color } })} />
              <Slider label="Kalınlık" value={el.stroke.width} min={1} max={Math.round(40 * u) + 1} step={1} show={`${Math.round(el.stroke.width)} px`} onChange={(width) => live({ stroke: { ...el.stroke!, width } })} onCommit={onCommit} />
              <div role="group" aria-label="Çizgi türü" className="flex rounded-lg border border-line bg-panel p-0.5">
                {([[undefined, "Düz"], ["dash", "Kesikli"], ["dot", "Noktalı"]] as const).map(([d, label]) => (
                  <button key={label} className={`flex-1 ${chip(el.stroke!.dash === d)}`} aria-pressed={el.stroke!.dash === d} onClick={() => now({ stroke: { ...el.stroke!, dash: d } })}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {el.shape === "line" && (
            <div role="group" aria-label="Ok başı" className="flex rounded-lg border border-line bg-subtle p-0.5">
              {([[undefined, "Oksuz"], ["end", "Sonda ok"], ["both", "İki uçta"]] as const).map(([a, label]) => (
                <button key={label} className={`flex-1 ${chip(el.arrow === a)}`} aria-pressed={el.arrow === a} onClick={() => now({ arrow: a })}>{label}</button>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Swatches({ value, set, swatches }: { value: string; set: (c: string) => void; swatches: string[] }) {
  const [more, setMore] = useState(false);
  return (
    <div>
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="Renk paleti" title="Renk paleti (Open Color)" className="grid size-7 place-items-center rounded border border-line text-muted hover:border-accent hover:text-accent"><Palette size={14} /></button>
      <input type="color" value={value} onChange={(e) => set(e.target.value)} className="size-7 cursor-pointer rounded border border-line bg-transparent p-0" aria-label="Renk seç" />
      {swatches.map((c) => (
        <button key={c} onClick={() => set(c)} className={`size-6 rounded-full border ${value.toLowerCase() === c ? "ring-2 ring-accent ring-offset-1" : "border-line"}`} style={{ background: c }} aria-label={`Renk ${c}`} title={c} />
      ))}
    </div>
    {more && (
      <div className="mt-1.5 grid gap-px" style={{ gridTemplateColumns: "repeat(10, 1fr)" }} role="group" aria-label="Renk paleti">
        {Object.entries(OPEN_COLOR).flatMap(([hue, shades]) =>
          shades.map((c, i) => <button key={c} type="button" onClick={() => set(c)} className={`aspect-square rounded-[2px] ${value.toLowerCase() === c ? "ring-2 ring-accent" : ""}`} style={{ background: c }} aria-label={`${hue} ${i}`} title={`${hue} ${i} · ${c}`} />),
        )}
      </div>
    )}
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
