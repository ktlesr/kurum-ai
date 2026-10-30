"use client";

// The studio canvas: the same primitives the export draws (lib/studio draw), as React SVG, plus selection, move,
// resize handles, snapping guides and in-place text editing. Coordinates are design pixels (the SVG viewBox).
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { FONT_FAMILY, FORMATS, aabb, dashOf, draw, tfAttr, type El, type FormatId, type Measure, type Prim, type TextEl } from "@/lib/studio";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Box = { x: number; y: number; w: number; h: number };
type Drag = {
  mode: "move" | "resize" | "rotate" | "marquee"; id: string; handle?: Handle; px: number; py: number; box: Box; ratio: number; rot: number; moved: boolean;
  /** move: every chosen unlocked element's starting place (they move together); marquee: Shift adds to the choice. */
  group?: { id: string; x: number; y: number }[]; add?: boolean;
  /** marquee started on a locked element (the background): a click without dragging chooses that element. */
  under?: string;
};
/** (x, y) turned by `deg` around (cx, cy). */
const turn = (x: number, y: number, cx: number, cy: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return { x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c };
};
const rotOf = (el: El) => (Number.isFinite(el.rotation) ? (el.rotation as number) % 360 : 0);
const rotAttr = (el: El) => (rotOf(el) ? `rotate(${rotOf(el)} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined);
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const MIN = 12;

/** One primitive as React SVG: the same markup svgOf writes for the export (lib/studio). */
export function PrimView({ p, k, uid }: { p: Prim; k: number; uid: string }) {
  const common = {
    opacity: p.opacity < 1 ? p.opacity : undefined,
    transform: tfAttr(p.tf),
    filter: p.shadow ? `url(#${uid}f${k})` : undefined,
  };
  const shadow = p.shadow && (
    <filter id={`${uid}f${k}`} filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx={p.shadow.x} dy={p.shadow.y} stdDeviation={p.shadow.blur / 2} floodColor={p.shadow.color} floodOpacity={Math.min(1, Math.max(0, p.shadow.opacity))} />
    </filter>
  );
  if (p.kind === "rect" || p.kind === "ellipse" || p.kind === "poly") {
    const gid = `${uid}g${k}`;
    const grad = p.fill?.kind === "linear" && (
      <linearGradient id={gid} x1="0" y1="0" x2={p.fill.dir === "diag" ? 1 : 0} y2="1">
        <stop offset="0" stopColor={p.fill.stops[0].color} stopOpacity={p.fill.stops[0].opacity} />
        <stop offset="1" stopColor={p.fill.stops[1].color} stopOpacity={p.fill.stops[1].opacity} />
      </linearGradient>
    );
    const paint = {
      fill: !p.fill ? "none" : p.fill.kind === "solid" ? p.fill.color : `url(#${gid})`,
      ...(p.stroke
        ? { stroke: p.stroke.color, strokeWidth: p.stroke.width, strokeLinejoin: "round" as const, strokeDasharray: dashOf(p.stroke), strokeLinecap: p.stroke.dash === "dot" ? ("round" as const) : undefined }
        : {}),
      ...common,
    };
    return (
      <>
        {(grad || shadow) && <defs>{grad}{shadow}</defs>}
        {p.kind === "rect" ? (
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.radius || undefined} {...paint} />
        ) : p.kind === "ellipse" ? (
          <ellipse cx={p.x + p.w / 2} cy={p.y + p.h / 2} rx={p.w / 2} ry={p.h / 2} {...paint} />
        ) : p.closed ? (
          <polygon points={p.pts.map(([x, y]) => `${x},${y}`).join(" ")} {...paint} />
        ) : (
          <polyline points={p.pts.map(([x, y]) => `${x},${y}`).join(" ")} {...paint} />
        )}
      </>
    );
  }
  if (p.kind === "image") {
    const id = `${uid}c${k}`;
    return (
      <>
        {(p.clip || shadow) && (
          <defs>
            {p.clip && (
              <clipPath id={id}>
                <rect x={p.clip.x} y={p.clip.y} width={p.clip.w} height={p.clip.h} rx={p.clip.radius || undefined} />
              </clipPath>
            )}
            {shadow}
          </defs>
        )}
        <g {...common}>
          <image href={p.pic.src} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="xMidYMid meet" clipPath={p.clip ? `url(#${id})` : undefined} />
        </g>
      </>
    );
  }
  return (
    <>
      {shadow && <defs>{shadow}</defs>}
      <text
        fontSize={p.size} fontWeight={p.weight} fill={p.color} textAnchor={p.anchor === "start" ? undefined : p.anchor} letterSpacing={p.tracking || undefined}
        fontStyle={p.italic ? "italic" : undefined} textDecoration={p.underline ? "underline" : undefined} {...common} style={{ fontFamily: `${FONT_FAMILY}, Arial, sans-serif` }}
      >
        {p.lines.map((line, i) => (
          <tspan key={i} x={p.x} y={p.y + p.size * (0.9 + i * p.leading)}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

interface Props {
  format: FormatId;
  els: El[];
  measure: Measure;
  /** The chosen elements (several: Shift/Ctrl+click or a box dragged on the empty canvas). */
  selected: string[];
  onSelect: (ids: string[]) => void;
  /** commit: the end of a gesture (one undo step); otherwise a live update while dragging or typing. */
  onChange: (els: El[], commit: boolean) => void;
  editing: string | null;
  onEditing: (id: string | null) => void;
  /** Right click: the element under the pointer (null: the empty canvas) and the screen point for the menu. */
  onMenu?: (id: string | null, x: number, y: number) => void;
}

export default function Editor({ format, els, measure, selected, onSelect, onChange, editing, onEditing, onMenu }: Props) {
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
    // Shift/Ctrl+click adds or removes it; a click on one of several chosen keeps them all (to drag them together).
    // A locked element (the background) can't move: dragging on it chooses with a box, a click chooses it.
    if (mode === "move" && el.locked) return startMarquee(e, el.id);
    if (mode === "move" && (e.shiftKey || e.ctrlKey || e.metaKey)) return onSelect(selected.includes(el.id) ? selected.filter((x) => x !== el.id) : [...selected, el.id]);
    const ids = mode === "move" && selected.includes(el.id) ? selected : [el.id];
    if (ids !== selected) onSelect(ids);
    if (el.locked || editing === el.id) return;
    const p = point(e);
    const group = mode === "move" ? live.current.filter((x) => ids.includes(x.id) && !x.locked).map((x) => ({ id: x.id, x: x.x, y: x.y })) : undefined;
    drag.current = { mode, id: el.id, handle, px: p.x, py: p.y, box: { x: el.x, y: el.y, w: el.w, h: el.h }, ratio: el.w / el.h, rot: rotOf(el), moved: false, group };
  };
  /** On the empty canvas: a box that chooses what it fully covers. */
  const startMarquee = (e: RPointerEvent, under?: string) => {
    if (e.button !== 0) return;
    if (editing) onEditing(null);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!add) onSelect([]);
    const p = point(e);
    drag.current = { mode: "marquee", id: "", px: p.x, py: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 }, ratio: 1, rot: 0, moved: false, add, under };
  };
  const [marquee, setMarquee] = useState<Box | null>(null);

  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    let dx = p.x - d.px;
    let dy = p.y - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 2 * scale) return;
    // Captured only once it is a drag: a plain click (and a double click to edit) stays on the element.
    if (!d.moved) svg.current?.setPointerCapture(e.pointerId);
    d.moved = true;
    if (d.mode === "marquee") {
      setMarquee({ x: Math.min(p.x, d.px), y: Math.min(p.y, d.py), w: Math.abs(dx), h: Math.abs(dy) });
      return;
    }
    const el = live.current.find((x) => x.id === d.id);
    if (!el) return;
    const thr = 8 * scale;
    const moving = new Set(d.group?.map((g) => g.id) ?? [d.id]);
    const others = live.current.filter((x) => !moving.has(x.id) && !x.locked);
    const vLines = [0, W / 2, W, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const hLines = [0, H / 2, H, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const snap = (vals: number[], lines: number[]) => {
      let best: { delta: number; line: number } | null = null;
      for (const v of vals) for (const l of lines) if (Math.abs(l - v) <= thr && (!best || Math.abs(l - v) < Math.abs(best.delta))) best = { delta: l - v, line: l };
      return best;
    };
    let b: Box = { ...d.box };
    const g = { v: [] as number[], h: [] as number[] };
    if (d.mode === "rotate") {
      // The angle of the pointer around the centre; the handle sits above it (0°). Shift: 15° steps, else 0/90/180/270 catch.
      const cx = d.box.x + d.box.w / 2;
      const cy = d.box.y + d.box.h / 2;
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else for (const q of [0, 90, 180, 270, 360]) if (Math.abs(deg - q) < 3) deg = q;
      deg %= 360;
      onChange(live.current.map((x) => (x.id === d.id ? ({ ...x, rotation: deg ? Math.round(deg * 10) / 10 : undefined } as El) : x)), false);
      return;
    }
    if (d.mode === "move" && d.group && d.group.length > 1) {
      // Together: the box around all of them snaps, and every one moves by the same amount.
      const from = d.group.map((g) => {
        const x = live.current.find((q) => q.id === g.id)!;
        return aabb({ ...x, x: g.x, y: g.y });
      });
      const gx = Math.min(...from.map((q) => q.x)) + dx;
      const gy = Math.min(...from.map((q) => q.y)) + dy;
      const gw = Math.max(...from.map((q) => q.x + q.w)) + dx - gx;
      const gh = Math.max(...from.map((q) => q.y + q.h)) + dy - gy;
      if (!e.altKey) {
        const sx = snap([gx, gx + gw / 2, gx + gw], vLines);
        const sy = snap([gy, gy + gh / 2, gy + gh], hLines);
        if (sx) {
          dx += sx.delta;
          g.v.push(sx.line);
        }
        if (sy) {
          dy += sy.delta;
          g.h.push(sy.line);
        }
      }
      setGuides(g);
      const at = new Map(d.group.map((q) => [q.id, q]));
      onChange(live.current.map((x) => (at.has(x.id) ? ({ ...x, x: at.get(x.id)!.x + dx, y: at.get(x.id)!.y + dy } as El) : x)), false);
      return;
    }
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
      // A turned element resizes along its own axes: the pointer's movement turned back by its angle.
      ({ x: dx, y: dy } = turn(dx, dy, 0, 0, -d.rot));
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
      if (d.rot) {
        // The opposite handle stays where it is on screen (the centre, and so the turning point, moved).
        const ax = (bx: Box) => bx.x + (hd.includes("w") ? bx.w : hd.includes("e") ? 0 : bx.w / 2);
        const ay = (bx: Box) => bx.y + (hd.includes("n") ? bx.h : hd.includes("s") ? 0 : bx.h / 2);
        const was = turn(ax(d.box), ay(d.box), d.box.x + d.box.w / 2, d.box.y + d.box.h / 2, d.rot);
        const now = turn(ax(b), ay(b), b.x + b.w / 2, b.y + b.h / 2, d.rot);
        b = { ...b, x: b.x + was.x - now.x, y: b.y + was.y - now.y };
      }
    }
    setGuides(g);
    onChange(live.current.map((x) => (x.id === d.id ? ({ ...x, ...b } as El) : x)), false);
  };

  const end = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    setGuides({ v: [], h: [] });
    if (d?.mode === "marquee") {
      setMarquee(null);
      if (!d.moved) {
        if (d.under) onSelect(!d.add ? [d.under] : selected.includes(d.under) ? selected.filter((x) => x !== d.under) : [...selected, d.under]);
        return;
      }
      const p = point(e);
      const box = { x: Math.min(p.x, d.px), y: Math.min(p.y, d.py), x2: Math.max(p.x, d.px), y2: Math.max(p.y, d.py) };
      const inside = live.current.filter((x) => {
        const b = aabb(x);
        return !x.locked && b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x2 && b.y + b.h <= box.y2;
      }).map((x) => x.id);
      onSelect(d.add ? [...new Set([...selected, ...inside])] : inside);
      return;
    }
    if (d?.moved) onChange(live.current, true);
  };

  const chosen = els.filter((e) => selected.includes(e.id));
  const sel = chosen.length === 1 ? chosen[0] : undefined;
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
      onPointerDown={(e) => startMarquee(e)}
      onPointerMove={move}
      onContextMenu={(e) => {
        if ((e.target as Element).closest("textarea")) return; // the text being edited keeps the browser's menu
        e.preventDefault();
        onSelect([]);
        onMenu?.(null, e.clientX, e.clientY);
      }}
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
          transform={rotAttr(el)}
          fill="transparent"
          className={el.locked ? "" : "cursor-move hover:stroke-[#3b82f6]"}
          strokeWidth={stroke}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(e) => start(e, el, "move")}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // On one of several chosen: the menu for all of them.
            if (!selected.includes(el.id)) onSelect([el.id]);
            onMenu?.(el.id, e.clientX, e.clientY);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (el.kind === "text" && !el.locked) onEditing(el.id);
          }}
        />
      ))}

      {guides.v.map((x, i) => <line key={`v${i}`} x1={x} x2={x} y1={0} y2={H} stroke="#e11d48" strokeWidth={stroke} strokeDasharray={`${6 * scale} ${4 * scale}`} pointerEvents="none" />)}
      {guides.h.map((y, i) => <line key={`h${i}`} y1={y} y2={y} x1={0} x2={W} stroke="#e11d48" strokeWidth={stroke} strokeDasharray={`${6 * scale} ${4 * scale}`} pointerEvents="none" />)}

      {chosen.length > 1 && (
        <g pointerEvents="none">
          {chosen.map((c) => (
            <rect key={c.id} x={c.x} y={c.y} width={c.w} height={c.h} transform={rotAttr(c)} fill="none" stroke="#3b82f6" strokeWidth={stroke} strokeDasharray={c.locked ? `${4 * scale} ${4 * scale}` : undefined} />
          ))}
          {(() => {
            const bs = chosen.map(aabb);
            const x = Math.min(...bs.map((b) => b.x));
            const y = Math.min(...bs.map((b) => b.y));
            return <rect x={x} y={y} width={Math.max(...bs.map((b) => b.x + b.w)) - x} height={Math.max(...bs.map((b) => b.y + b.h)) - y} fill="none" stroke="#3b82f6" strokeWidth={stroke * 1.4} strokeDasharray={`${6 * scale} ${4 * scale}`} />;
          })()}
        </g>
      )}
      {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgb(59 130 246 / 0.08)" stroke="#3b82f6" strokeWidth={stroke} pointerEvents="none" />}

      {sel && (
        <g
          pointerEvents={sel.locked ? "none" : undefined}
          transform={rotAttr(sel)}
          onContextMenu={(e) => {
            // A resize handle belongs to the selected element: its menu, not the empty canvas's.
            e.preventDefault();
            e.stopPropagation();
            onMenu?.(sel.id, e.clientX, e.clientY);
          }}
        >
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
          {!sel.locked && editing !== sel.id && (
            <g style={{ cursor: "grab" }} onPointerDown={(e) => start(e, sel, "rotate")}>
              <title>Döndür (Shift: 15° adım)</title>
              <line x1={sel.x + sel.w / 2} x2={sel.x + sel.w / 2} y1={sel.y} y2={sel.y - 26 * scale} stroke="#3b82f6" strokeWidth={stroke} pointerEvents="none" />
              <circle cx={sel.x + sel.w / 2} cy={sel.y - 30 * scale} r={hs * 0.6} fill="#ffffff" stroke="#3b82f6" strokeWidth={stroke} />
            </g>
          )}
        </g>
      )}

      {editEl && (
        <foreignObject x={editEl.x} y={editEl.y} width={Math.max(editEl.w, 40)} height={Math.max(editEl.h, editEl.size * editEl.leading)} transform={rotAttr(editEl)}>
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
