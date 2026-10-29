"use client";

// The studio canvas: the same primitives the export draws (lib/studio draw), as React SVG, plus selection, move,
// resize handles, snapping guides and in-place text editing. Coordinates are design pixels (the SVG viewBox).
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { FONT_FAMILY, FORMATS, draw, type El, type FormatId, type Measure, type Prim, type TextEl } from "@/lib/studio";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Box = { x: number; y: number; w: number; h: number };
type Drag = { mode: "move" | "resize"; id: string; handle?: Handle; px: number; py: number; box: Box; ratio: number; moved: boolean };
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const MIN = 12;

export function PrimView({ p, k, uid }: { p: Prim; k: number; uid: string }) {
  const o = p.opacity < 1 ? p.opacity : undefined;
  if (p.kind === "rect") {
    if (p.fill.kind === "solid") return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.radius || undefined} fill={p.fill.color} opacity={o} />;
    const id = `${uid}g${k}`;
    const [a, b] = p.fill.stops;
    return (
      <>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2={p.fill.dir === "diag" ? 1 : 0} y2="1">
            <stop offset="0" stopColor={a.color} stopOpacity={a.opacity} />
            <stop offset="1" stopColor={b.color} stopOpacity={b.opacity} />
          </linearGradient>
        </defs>
        <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.radius || undefined} fill={`url(#${id})`} opacity={o} />
      </>
    );
  }
  if (p.kind === "image") {
    const id = `${uid}c${k}`;
    return (
      <>
        {p.clip && (
          <defs>
            <clipPath id={id}>
              <rect x={p.clip.x} y={p.clip.y} width={p.clip.w} height={p.clip.h} rx={p.clip.radius || undefined} />
            </clipPath>
          </defs>
        )}
        <image href={p.pic.src} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="xMidYMid meet" clipPath={p.clip ? `url(#${id})` : undefined} opacity={o} />
      </>
    );
  }
  return (
    <text fontSize={p.size} fontWeight={p.weight} fill={p.color} textAnchor={p.anchor === "start" ? undefined : p.anchor} letterSpacing={p.tracking || undefined} opacity={o} style={{ fontFamily: `${FONT_FAMILY}, Arial, sans-serif` }}>
      {p.lines.map((line, i) => (
        <tspan key={i} x={p.x} y={p.y + p.size * (0.9 + i * p.leading)}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

interface Props {
  format: FormatId;
  els: El[];
  measure: Measure;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** commit: the end of a gesture (one undo step); otherwise a live update while dragging or typing. */
  onChange: (els: El[], commit: boolean) => void;
  editing: string | null;
  onEditing: (id: string | null) => void;
}

export default function Editor({ format, els, measure, selected, onSelect, onChange, editing, onEditing }: Props) {
  const { w: W, h: H } = FORMATS[format];
  const uid = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef(els);
  useLayoutEffect(() => {
    live.current = els;
  });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [scale, setScale] = useState(1); // design pixels per screen pixel

  useEffect(() => {
    const s = svg.current;
    if (!s) return;
    const ro = new ResizeObserver(() => setScale(W / Math.max(1, s.clientWidth)));
    ro.observe(s);
    return () => ro.disconnect();
  }, [W]);

  const point = (e: { clientX: number; clientY: number }) => {
    const s = svg.current!;
    const m = s.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const start = (e: RPointerEvent, el: El, mode: Drag["mode"], handle?: Handle) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onSelect(el.id);
    if (el.locked || editing === el.id) return;
    const p = point(e);
    drag.current = { mode, id: el.id, handle, px: p.x, py: p.y, box: { x: el.x, y: el.y, w: el.w, h: el.h }, ratio: el.w / el.h, moved: false };
  };

  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    const dx = p.x - d.px;
    const dy = p.y - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 2 * scale) return;
    // Captured only once it is a drag: a plain click (and a double click to edit) stays on the element.
    if (!d.moved) svg.current?.setPointerCapture(e.pointerId);
    d.moved = true;
    const el = live.current.find((x) => x.id === d.id);
    if (!el) return;
    const thr = 8 * scale;
    const others = live.current.filter((x) => x.id !== d.id && !x.locked);
    const vLines = [0, W / 2, W, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const hLines = [0, H / 2, H, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const snap = (vals: number[], lines: number[]) => {
      let best: { delta: number; line: number } | null = null;
      for (const v of vals) for (const l of lines) if (Math.abs(l - v) <= thr && (!best || Math.abs(l - v) < Math.abs(best.delta))) best = { delta: l - v, line: l };
      return best;
    };
    let b: Box = { ...d.box };
    const g = { v: [] as number[], h: [] as number[] };
    if (d.mode === "move") {
      b.x += dx;
      b.y += dy;
      if (!e.altKey) {
        const sx = snap([b.x, b.x + b.w / 2, b.x + b.w], vLines);
        const sy = snap([b.y, b.y + b.h / 2, b.y + b.h], hLines);
        if (sx) {
          b.x += sx.delta;
          g.v.push(sx.line);
        }
        if (sy) {
          b.y += sy.delta;
          g.h.push(sy.line);
        }
      }
    } else {
      const hd = d.handle!;
      // Pictures keep their ratio (a logo is never stretched); text and shapes resize freely, Shift keeps it.
      const keep = el.kind === "image" || e.shiftKey;
      let { x, y, w, h } = d.box;
      if (hd.includes("e")) w = d.box.w + dx;
      if (hd.includes("w")) {
        w = d.box.w - dx;
        x = d.box.x + dx;
      }
      if (hd.includes("s")) h = d.box.h + dy;
      if (hd.includes("n")) {
        h = d.box.h - dy;
        y = d.box.y + dy;
      }
      if (keep) {
        if (hd === "n" || hd === "s") w = h * d.ratio;
        else h = w / d.ratio;
        if (hd.includes("n")) y = d.box.y + d.box.h - h;
        if (hd.includes("w")) x = d.box.x + d.box.w - w;
        if (hd === "n" || hd === "s") x = d.box.x + (d.box.w - w) / 2;
        if (hd === "e" || hd === "w") y = d.box.y + (d.box.h - h) / 2;
      }
      if (w < MIN || h < MIN) return;
      b = { x, y, w, h };
    }
    setGuides(g);
    onChange(live.current.map((x) => (x.id === d.id ? ({ ...x, ...b } as El) : x)), false);
  };

  const end = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    setGuides({ v: [], h: [] });
    if (d?.moved) onChange(live.current, true);
  };

  const sel = els.find((e) => e.id === selected);
  const editEl = els.find((e) => e.id === editing && e.kind === "text") as TextEl | undefined;
  const prims = draw(editEl ? els.map((e) => (e.id === editEl.id ? { ...e, text: "" } : e)) : els, measure);
  const hs = 11 * scale; // handle size on screen ≈ 11 px
  const stroke = 1.5 * scale;

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className="block max-h-full max-w-full touch-none select-none rounded-lg bg-white shadow-[0_8px_40px_rgb(20_38_61/0.18)]"
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={() => {
        onSelect(null);
        if (editing) onEditing(null);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      role="application"
      aria-label="Tasarım tuvali. Öğeyi seçmek için tıklayın, taşımak için sürükleyin; seçili öğe ok tuşlarıyla kaydırılır, Delete ile silinir."
    >
      {prims.map((p, i) => (
        <PrimView key={i} p={p} k={i} uid={uid} />
      ))}

      {/* Hit areas: top-most last, so it wins the click. */}
      {els.map((el) => (
        <rect
          key={el.id}
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          fill="transparent"
          className={el.locked ? "" : "cursor-move hover:stroke-[#3b82f6]"}
          strokeWidth={stroke}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(e) => start(e, el, "move")}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (el.kind === "text" && !el.locked) onEditing(el.id);
          }}
        />
      ))}

      {guides.v.map((x, i) => <line key={`v${i}`} x1={x} x2={x} y1={0} y2={H} stroke="#e11d48" strokeWidth={stroke} strokeDasharray={`${6 * scale} ${4 * scale}`} pointerEvents="none" />)}
      {guides.h.map((y, i) => <line key={`h${i}`} y1={y} y2={y} x1={0} x2={W} stroke="#e11d48" strokeWidth={stroke} strokeDasharray={`${6 * scale} ${4 * scale}`} pointerEvents="none" />)}

      {sel && (
        <g pointerEvents={sel.locked ? "none" : undefined}>
          <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="none" stroke="#3b82f6" strokeWidth={stroke * 1.4} strokeDasharray={sel.locked ? `${4 * scale} ${4 * scale}` : undefined} pointerEvents="none" />
          {!sel.locked &&
            editing !== sel.id &&
            HANDLES.map((hd) => {
              const cx = sel.x + (hd.includes("w") ? 0 : hd.includes("e") ? sel.w : sel.w / 2);
              const cy = sel.y + (hd.includes("n") ? 0 : hd.includes("s") ? sel.h : sel.h / 2);
              return (
                <rect
                  key={hd}
                  x={cx - hs / 2}
                  y={cy - hs / 2}
                  width={hs}
                  height={hs}
                  rx={2 * scale}
                  fill="#ffffff"
                  stroke="#3b82f6"
                  strokeWidth={stroke}
                  style={{ cursor: CURSOR[hd] }}
                  onPointerDown={(e) => start(e, sel, "resize", hd)}
                />
              );
            })}
        </g>
      )}

      {editEl && (
        <foreignObject x={editEl.x} y={editEl.y} width={Math.max(editEl.w, 40)} height={Math.max(editEl.h, editEl.size * editEl.leading)}>
          <textarea
            autoFocus
            aria-label={`${editEl.name} metni`}
            lang="tr"
            value={editEl.text}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onChange(els.map((x) => (x.id === editEl.id ? { ...x, text: e.target.value } : x)), false)}
            onBlur={() => {
              onChange(live.current, true);
              onEditing(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
            }}
            style={{
              width: "100%", height: "100%", resize: "none", border: "none", outline: `${2 * scale}px solid #3b82f6`, background: "rgba(255,255,255,0.12)",
              color: editEl.color, fontFamily: `${FONT_FAMILY}, Arial, sans-serif`, fontSize: editEl.size, fontWeight: editEl.weight, lineHeight: editEl.leading,
              letterSpacing: editEl.tracking || undefined, textAlign: editEl.align === "middle" ? "center" : editEl.align === "end" ? "right" : "left",
              padding: editEl.bg ? `0 ${editEl.size * 0.8}px` : 0, overflow: "hidden", textTransform: editEl.upper ? "uppercase" : undefined,
            }}
          />
        </foreignObject>
      )}
    </svg>
  );
}
