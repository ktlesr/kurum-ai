// A PowerPoint file's words: each slide in the deck's own order with its title, text boxes (groups too), tables and
// speaker notes. Written as "--- Sayfa N ---" parts, the marker every later step reads (search sections, page checks),
// each opening with "Slayt N" so an answer says slide. Images and charts are not read: said so. Pure: tests drive it.
import JSZip from "jszip";
import path from "node:path";
import { all, kid, kids, parseXml, type El } from "./template-xml.ts";

export class SlidesError extends Error {}

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const unreadable = "Sunum dosyası okunamadı: bozuk ya da desteklenmeyen bir yapı. Dosyayı PowerPoint'te açıp .pptx olarak yeniden kaydedin.";

async function xmlOf(zip: JSZip, name: string): Promise<Document | null> {
  const f = zip.file(name);
  if (!f) return null;
  try {
    return parseXml(await f.async("string"));
  } catch {
    throw new SlidesError(unreadable);
  }
}

/** A part's relationships: id → the target's path inside the zip. */
async function relsOf(zip: JSZip, part: string): Promise<Map<string, { target: string; type: string }>> {
  const dir = path.posix.dirname(part);
  const doc = await xmlOf(zip, path.posix.join(dir, "_rels", `${path.posix.basename(part)}.rels`));
  const out = new Map<string, { target: string; type: string }>();
  for (const r of doc ? all(doc.documentElement, "Relationship") : []) {
    const target = r.getAttribute("Target") ?? "";
    if (r.getAttribute("TargetMode") === "External" || !target) continue;
    // "/ppt/slides/slide1.xml" is from the package's root; "slides/slide1.xml" from the part's own folder.
    const at = target.startsWith("/") ? target.slice(1) : path.posix.join(dir, target);
    out.set(r.getAttribute("Id") ?? "", { target: path.posix.normalize(at), type: r.getAttribute("Type") ?? "" });
  }
  return out;
}

const clean = (s: string) => s.replace(/\s+/gu, " ").trim();
/** A paragraph's text: its runs and fields in order, a line break inside it (a:br) a space. */
function para(p: El): string {
  const out: string[] = [];
  const walk = (el: El) => {
    for (const k of kids(el)) {
      if (k.localName === "t") out.push(k.textContent ?? "");
      else if (k.localName === "br") out.push(" ");
      else walk(k);
    }
  };
  walk(p);
  return clean(out.join(""));
}
const cell = (s: string) => s.replace(/\|/gu, "\\|");

/** A placeholder's kind ("title", "ctrTitle", "body", "sldNum"…), "" for a plain text box. */
const placeholder = (sp: El) => {
  const nv = kid(sp, "nvSpPr");
  const ph = nv && kid(nv, "nvPr") && kid(kid(nv, "nvPr")!, "ph");
  return ph ? (ph.getAttribute("type") ?? "body") : "";
};

interface Shape { title?: string; lines: string[] }

/** The shapes of a tree in their order: text boxes, tables as Markdown, groups opened; pictures and charts counted. */
function shapes(tree: El, out: Shape[], skipped: { media: number }) {
  for (const k of kids(tree)) {
    const name = k.localName;
    if (name === "sp") {
      const type = placeholder(k);
      if (["sldNum", "dt", "ftr", "hdr", "sldImg"].includes(type)) continue; // slide number, date, footer: not content
      const body = kid(k, "txBody");
      const lines = body ? kids(body, "p").map(para).filter(Boolean) : [];
      if (!lines.length) continue;
      out.push(type === "title" || type === "ctrTitle" ? { title: lines.join(" "), lines: [] } : { lines });
    } else if (name === "grpSp") shapes(k, out, skipped);
    // PowerPoint 2010+ wraps some shapes (equations, ink, zoom) in a choice of forms: the fallback is the plain one.
    else if (name === "AlternateContent") {
      const form = kid(k, "Fallback") ?? kid(k, "Choice");
      if (form) shapes(form, out, skipped);
    }
    else if (name === "graphicFrame") {
      const tbl = all(k, "tbl")[0];
      if (!tbl) {
        skipped.media++; // a chart, a diagram, an embedded object
        continue;
      }
      const rows = kids(tbl, "tr").map((tr) => kids(tr, "tc").map((tc) => cell(kids(kid(tc, "txBody") ?? tc, "p").map(para).filter(Boolean).join(" "))));
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (!width) continue;
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      out.push({ lines: ["", line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line), ""] });
    } else if (name === "pic") skipped.media++;
  }
}

/** The deck's text and its number of slides; at most `maxSlides` (else SlidesError). */
export async function pptxText(buf: Uint8Array, maxSlides: number): Promise<{ text: string; pages: number; warning?: string }> {
  try {
    return await read(buf, maxSlides);
  } catch (e) {
    // Shapes nested thousands deep run out of stack: a broken file, said as one.
    if (e instanceof RangeError) throw new SlidesError(unreadable);
    throw e;
  }
}

async function read(buf: Uint8Array, maxSlides: number): Promise<{ text: string; pages: number; warning?: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new SlidesError(unreadable);
  }
  const pres = await xmlOf(zip, "ppt/presentation.xml");
  if (!pres) throw new SlidesError(unreadable);
  const rels = await relsOf(zip, "ppt/presentation.xml");
  const list = kid(pres.documentElement, "sldIdLst");
  // By its namespace, whatever prefix the file gives it ("r:id", "q:id").
  const relId = (s: El) => s.getAttributeNS(REL_NS, "id") || s.getAttribute("r:id") || "";
  const order = (list ? kids(list, "sldId") : []).map((s) => rels.get(relId(s))?.target).filter((t): t is string => !!t);
  if (order.length > maxSlides) throw new SlidesError(`Sunumda çok fazla slayt var (en fazla ${maxSlides}). Dosyayı bölerek yükleyin.`);
  const parts: string[] = [];
  const skipped = { media: 0 };
  let hidden = 0;
  for (const [i, slidePath] of order.entries()) {
    const slide = await xmlOf(zip, slidePath);
    if (!slide) continue;
    const root = slide.documentElement;
    const isHidden = ["0", "false"].includes(root.getAttribute("show") ?? "");
    if (isHidden) hidden++;
    const tree = all(root, "spTree")[0];
    const found: Shape[] = [];
    if (tree) shapes(tree, found, skipped);
    const title = found.find((s) => s.title)?.title;
    const body = found.flatMap((s) => s.lines);
    // Speaker notes: the notes page's body placeholder (its slide image and number left out).
    const notesPath = [...(await relsOf(zip, slidePath)).values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notesDoc = notesPath ? await xmlOf(zip, notesPath) : null;
    const notes: Shape[] = [];
    const notesTree = notesDoc && all(notesDoc.documentElement, "spTree")[0];
    if (notesTree) shapes(notesTree, notes, { media: 0 });
    // The slide number placeholder is left out by its kind (shapes()); a note that is a number ("2026") is a note.
    const noteLines = notes.filter((s) => !s.title).flatMap((s) => s.lines).filter(Boolean);
    parts.push([
      `--- Sayfa ${i + 1} ---`,
      `Slayt ${i + 1}${title ? `: ${title}` : ""}${isHidden ? " (gizli slayt)" : ""}`,
      ...body,
      ...(noteLines.length ? ["", "Konuşmacı notları:", ...noteLines] : []),
    ].join("\n").replace(/\n{3,}/gu, "\n\n"));
  }
  const warning = [
    skipped.media ? `Sunumdaki ${skipped.media} görsel, grafik ya da diyagramın içi okunmadı; yalnızca metinler okundu.` : "",
    hidden ? `${hidden} slayt sunumda gizli; okundu ve "(gizli slayt)" diye işaretlendi.` : "",
  ].filter(Boolean).join(" ") || undefined;
  return { text: parts.join("\n\n"), pages: order.length, ...(warning ? { warning } : {}) };
}
