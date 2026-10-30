"use client";

// A deck as an editable PowerPoint file, built in the browser (pptxgenjs, MIT): text stays text, shapes stay shapes.
// Pictures are drawn to PNG at their box first (PowerPoint needs a raster next to SVG, and "cover" crops are exact).
// Fonts aren't embedded: PowerPoint uses the same family if it is installed, otherwise its own substitute.
import { LIBRARY_FONTS } from "@/lib/font-list";
import { FORMATS, draw, type El, type Measure, type Prim } from "@/lib/studio";

const PX = 13.333 / FORMATS.yatay.w; // inches per design pixel
const hex = (c: string) => c.replace("#", "").toUpperCase();
const pct = (o: number) => Math.round((1 - Math.min(1, Math.max(0, o))) * 100);

async function pictureBox(e: Extract<El, { kind: "image" }>): Promise<string> {
  const img = new Image();
  img.src = e.pic.src;
  await img.decode();
  const scale = Math.min(2, 3000 / Math.max(e.w, e.h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(e.w * scale));
  c.height = Math.max(1, Math.round(e.h * scale));
  const ctx = c.getContext("2d")!;
  const s = e.fit === "cover" ? Math.max(c.width / e.pic.w, c.height / e.pic.h) : Math.min(c.width / e.pic.w, c.height / e.pic.h);
  const [w, h] = [e.pic.w * s, e.pic.h * s];
  if (e.radius) {
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, Math.min(e.radius * scale, c.width / 2, c.height / 2));
    ctx.clip();
  }
  ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return c.toDataURL("image/png");
}

const family = (font?: string) => LIBRARY_FONTS.find((f) => f.id === font)?.label ?? "Calibri";
const solid = (f: Extract<Prim, { kind: "rect" }>["fill"]) => (!f ? undefined : f.kind === "solid" ? f.color : f.stops[0].color);

export async function downloadPptx(slides: El[][], measure: Measure, name: string) {
  const { default: PptxGen } = await import("pptxgenjs");
  const pptx = new PptxGen();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  for (const els of slides) {
    const slide = pptx.addSlide();
    for (const e of els) {
      const box = { x: e.x * PX, y: e.y * PX, w: e.w * PX, h: e.h * PX, rotate: e.rotation ?? 0 };
      const shadow = e.shadow ? { type: "outer" as const, color: hex(e.shadow.color), blur: e.shadow.blur / 2, offset: Math.hypot(e.shadow.x, e.shadow.y) / 2, angle: Math.round(((Math.atan2(e.shadow.y, e.shadow.x) * 180) / Math.PI + 360) % 360), opacity: e.shadow.opacity } : undefined;
      const transparency = pct(e.opacity ?? 1);
      if (e.kind === "image") {
        slide.addImage({ data: await pictureBox(e), ...box, flipH: !!e.flipX, flipV: !!e.flipY, transparency });
      } else if (e.kind === "text") {
        // The size the canvas really draws at (fit to box), in points: the canvas is 960 pt wide.
        const p = draw([e], measure).find((x) => x.kind === "text");
        if (!p || p.kind !== "text") continue;
        // Text the canvas had to cut goes as drawn, or it would overflow here. Other text stays whole, so PowerPoint can
        // wrap it for the font it really has.
        const cut = p.lines.at(-1)?.endsWith("…") && !e.text.trimEnd().endsWith("…");
        const text = cut ? p.lines.join("\n") : e.text;
        slide.addText(e.upper ? text.toLocaleUpperCase("tr") : text, {
          // pptxgenjs order: left, right, bottom, top (points).
          ...box, margin: e.bg ? [p.size * 0.2, p.size * 0.2, 0, 0] : 0, fontFace: family(e.font), fontSize: Math.max(1, Math.round(p.size * 0.5 * 10) / 10), color: hex(e.color), bold: e.weight >= 600, italic: !!e.italic, underline: e.underline ? { style: "sng" } : undefined,
          align: e.align === "middle" ? "center" : e.align === "end" ? "right" : "left", valign: e.bg ? "middle" : "top", lineSpacingMultiple: e.leading, charSpacing: e.tracking * 0.5 || undefined, transparency,
          ...(e.bg ? { fill: { color: hex(e.bg.fill), transparency }, shape: pptx.ShapeType.roundRect, rectRadius: Math.min(e.bg.radius, e.h / 2) * PX } : {}), shadow,
        });
      } else {
        const fillC = e.noFill || e.shape === "line" ? undefined : solid(e.fill);
        const opts = {
          ...box, flipH: !!e.flipX, flipV: !!e.flipY, shadow,
          ...(fillC ? { fill: { color: hex(fillC), transparency } } : {}),
          ...(e.stroke ? { line: { color: hex(e.stroke.color), width: e.stroke.width * 0.5, ...(e.stroke.dash ? { dashType: e.stroke.dash === "dot" ? ("sysDot" as const) : ("dash" as const) } : {}) } } : {}),
        };
        const shape = e.shape ?? "rect";
        if (shape === "ellipse") slide.addShape(pptx.ShapeType.ellipse, opts);
        else if (shape === "line") {
          const y = (e.y + e.h / 2) * PX;
          slide.addShape(pptx.ShapeType.line, { ...opts, y, h: 0, line: { ...opts.line, ...(e.arrow ? { endArrowType: "triangle" as const } : {}), ...(e.arrow === "both" ? { beginArrowType: "triangle" as const } : {}) } });
        } else if (shape === "poly") {
          const pts = (e.points ?? []).map(([x, y], i) => ({ x: x * box.w, y: y * box.h, ...(i ? {} : { moveTo: true }) }));
          slide.addShape("custGeom" as never, { ...opts, points: [...pts, { close: true }] } as never);
        } else if (e.radius) slide.addShape(pptx.ShapeType.roundRect, { ...opts, rectRadius: Math.min(e.radius, e.w / 2, e.h / 2) * PX });
        else slide.addShape(pptx.ShapeType.rect, opts);
      }
    }
  }
  await pptx.writeFile({ fileName: name });
}
