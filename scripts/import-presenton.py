# Converts presenton's slide templates (Apache-2.0, https://github.com/presenton/presenton, templates/*/template.json)
# into the studio's elements: public/slides/<template>.json. Changes made: flattened to absolute boxes on a 1920x1080
# canvas, fonts mapped to the app's library, layouts with charts/tables/infographics left out, raster artwork and
# Proxima Nova not taken. Usage: python scripts/import-presenton.py <presenton clone>
import base64, json, os, re, sys

SRC = sys.argv[1] + "/templates"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "slides")
K = 1.5  # 1280x720 -> 1920x1080
SKIP = {"chart", "table", "infographic", "text-list"}
FONTS = [("montserrat", "montserrat"), ("poppins", "poppins"), ("dm sans", "dm-sans"), ("inter", "inter"), ("lato", "lato"), ("playfair", "playfair-display"), ("anton", "anton"),
         ("archivo", "archivo-black"), ("arimo", "roboto"), ("tinos", "pt-serif"), ("albert", "dm-sans"), ("proxima", "montserrat")]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
color = lambda c, d="#14263d": c.lower() if isinstance(c, str) and HEX.match(c) else d
r = lambda v: round(float(v) * K, 1)


def radius(v):
    """A corner radius given as a number, a list or per corner: the largest."""
    if isinstance(v, dict): v = list(v.values())
    if isinstance(v, list): v = max([float(x) for x in v if isinstance(x, (int, float))] or [0])
    return r(v or 0)


def font_of(f):
    fam = str(f.get("family", "")).lower()
    fid = next((v for k, v in FONTS if k in fam), "inter")
    w = 700 if f.get("bold") or "bold" in fam else 600 if "semi" in fam else 500 if "medium" in fam else 300 if "light" in fam else 400
    if "black" in fam or "extra" in fam: w = 800
    return fid, w


class Conv:
    def __init__(self, tdir):
        self.tdir, self.els, self.slots, self.n = tdir, [], [], 0

    def nid(self):
        self.n += 1
        return f"e{self.n}"

    def vector(self, e, ox, oy):
        pts = e.get("points") or []
        if len(pts) < 2: return
        xs, ys = [float(p["x"]) for p in pts], [float(p["y"]) for p in pts]
        x0, y0, w, h = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
        fill, st = e.get("fill") or {}, e.get("stroke") or {}
        stroke = {"color": color(st.get("color")), "width": max(1, r(st.get("width", 1)))} if st.get("color") and float(st.get("width", 1) or 0) > 0 else None
        if stroke and st.get("dash"): stroke["dash"] = "dash"
        base = {"id": self.nid(), "kind": "shape", "name": "Şekil", "x": r(ox + x0), "y": r(oy + y0), "w": max(1, r(w)), "h": max(1, r(h)), "fill": {"kind": "solid", "color": color(fill.get("color"), "#ffffff")}}
        if fill.get("opacity") is not None and float(fill["opacity"]) < 1 and fill.get("color"): base["opacity"] = round(float(fill["opacity"]), 2)
        if e.get("rotation"): base["rotation"] = round(float(e["rotation"]) % 360, 1)
        if stroke: base["stroke"] = stroke
        if not fill.get("color"): base["noFill"] = True
        if not e.get("closed", False) or len(pts) == 2:
            if len(pts) != 2 or not stroke: return  # open curves aren't in the model
            import math
            ax, ay, bx, by = xs[0], ys[0], xs[1], ys[1]
            ln, cx, cy = math.hypot(bx - ax, by - ay), (ax + bx) / 2, (ay + by) / 2
            hh = max(8, stroke["width"] * 3) / K
            base.update({"shape": "line", "noFill": True, "x": r(ox + cx - ln / 2), "y": r(oy + cy - hh / 2), "w": max(1, r(ln)), "h": r(hh)})
            ang = math.degrees(math.atan2(by - ay, bx - ax)) % 360
            if ang: base["rotation"] = round(ang, 1)
        elif e.get("shape") == "ellipse": base["shape"] = "ellipse"
        elif not (len(pts) in (4, 5) and all(p["x"] in (min(xs), max(xs)) and p["y"] in (min(ys), max(ys)) for p in pts)):
            if w <= 0 or h <= 0: return
            base.update({"shape": "poly", "points": [[round((x - x0) / w, 4), round((y - y0) / h, 4)] for x, y in zip(xs, ys)][:64]})
        else:
            cr = e.get("corner_radii") or []
            if cr and radius(cr) > 0: base["radius"] = radius(cr)
        self.els.append(base)

    def text(self, e, ox, oy, slot):
        pos, size = e.get("position") or {}, e.get("size") or {}
        font = e.get("font") or {}
        runs = e.get("runs") or []
        if runs and not font: font = runs[0].get("font") or {}
        fid, w = font_of(font)
        px = r(font.get("size", 20))
        al = (e.get("alignment") or {}).get("horizontal", "left")
        el = {
            "id": self.nid(), "kind": "text", "name": slot or "Metin", "x": r(ox + float(pos.get("x", 0))), "y": r(oy + float(pos.get("y", 0))), "w": max(4, r(size.get("width", 200))), "h": max(4, r(size.get("height", 40))),
            "text": "".join(str(x.get("text", "")) for x in runs) or str(e.get("text", "")), "size": max(6, px), "weight": w, "color": color(font.get("color")), "align": {"center": "middle", "right": "end"}.get(al, "start"),
            "leading": round(min(3, max(0.8, float(font.get("line_height") or 1.2))), 2), "tracking": round(float(font.get("letter_spacing") or 0) * K, 2), "auto": True, "font": fid,
        }
        if font.get("italic"): el["italic"] = True
        if font.get("underline"): el["underline"] = True
        if e.get("rotation"): el["rotation"] = round(float(e["rotation"]) % 360, 1)
        if slot:
            el["slot"] = slot
            self.slots.append({"key": slot, "max": int(e.get("max_length") or 80)})
        self.els.append(el)

    def image(self, e, ox, oy, slot):
        pos, size = e.get("position") or {}, e.get("size") or {}
        box = {"x": r(ox + float(pos.get("x", 0))), "y": r(oy + float(pos.get("y", 0))), "w": max(1, r(size.get("width", 100))), "h": max(1, r(size.get("height", 100)))}
        data = str(e.get("data", ""))
        if e.get("is_icon"):  # the model can't choose icons: a small mark in the text colour's place
            d = min(box["w"], box["h"]) * 0.5
            self.els.append({"id": self.nid(), "kind": "shape", "name": "İşaret", "shape": "ellipse", "x": box["x"] + (box["w"] - d) / 2, "y": box["y"] + (box["h"] - d) / 2, "w": d, "h": d, "fill": {"kind": "solid", "color": "#2e5e8c"}, "accentMark": True})
            return
        if "replaceable_template_image" in data or not e.get("decorative", True):
            el = {"id": self.nid(), "kind": "image", "name": "Görsel", **box, "pic": {"placeholder": True}, "fit": "cover"}
            if e.get("border_radius"): el["radius"] = radius(e["border_radius"])
            self.els.append(el)
            return
        if data.endswith(".svg") and data.startswith("static/"):
            p = os.path.join(self.tdir, data)
            if os.path.exists(p) and os.path.getsize(p) <= 30_000:
                svg = open(p, encoding="utf-8", errors="ignore").read()
                if not re.search(r"<script|<image|href|https?://(?!www\.w3\.org)|\son\w+=|<style|url\((?!#)", svg, re.I):
                    m = re.search(r'viewBox="[\d.\s-]+?\s([\d.]+)\s([\d.]+)"', svg)
                    if m and float(m.group(1)) > 0 and float(m.group(2)) > 0:
                        src = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
                        self.els.append({"id": self.nid(), "kind": "image", "name": "Süs", **box, "pic": {"src": src, "w": float(m.group(1)), "h": float(m.group(2))}, "fit": "contain", "locked": True})
        # raster artwork isn't taken

    def walk(self, e, ox, oy, prefix=""):
        t = e.get("type")
        pos = e.get("position") or {}
        x, y = ox + float(pos.get("x", 0)), oy + float(pos.get("y", 0))
        name = e.get("name")
        key = prefix + name if name and not e.get("decorative", False) else None
        if t == "vector": self.vector(e, ox, oy) if not pos else self.vector(e, x, y)
        elif t == "text": self.text(e, ox, oy, key)
        elif t == "image": self.image(e, ox, oy, key)
        elif t == "group":
            for c in e.get("children") or []: self.walk(c, x, y, prefix)
        elif t == "container":
            size = e.get("size") or {}
            if (e.get("fill") or {}).get("color") and size:
                self.els.append({"id": self.nid(), "kind": "shape", "name": "Kutu", "x": r(x), "y": r(y), "w": r(size.get("width", 1)), "h": r(size.get("height", 1)), "fill": {"kind": "solid", "color": color(e["fill"]["color"])}, **({"radius": radius(e["border_radius"])} if e.get("border_radius") else {})})
            pad = e.get("padding") or {}
            pl, pt = (pad, pad) if isinstance(pad, (int, float)) else (float(pad.get("left", 0)), float(pad.get("top", 0)))
            if e.get("child"): self.walk(e["child"], x + pl, y + pt, prefix)
        elif t in ("flex", "grid"):
            kids = e.get("children") or []
            gapx = float(e.get("column_gap", e.get("gap", 0)) or 0)
            gapy = float(e.get("row_gap", e.get("gap", 0)) or 0)
            cols = int(e.get("columns") or 1) if t == "grid" else (len(kids) if e.get("direction") == "row" else 1)
            cols = max(1, cols)
            sizes = [c.get("size") or {} for c in kids]
            cw = max([float(s.get("width", 0)) for s in sizes] or [0])
            cx, cy, rowh = x, y, 0
            for i, c in enumerate(kids):
                s = sizes[i]
                if i and i % cols == 0:
                    cx, cy, rowh = x, cy + rowh + gapy, 0
                start = len(self.els)
                self.walk({**c, "position": {"x": 0, "y": 0}}, cx, cy, f"{prefix}{name or 'liste'}.{i}.")
                for el in self.els[start:]: el.setdefault("grp", f"{prefix}{name or 'liste'}.{i}")
                rowh = max(rowh, float(s.get("height", 0)))
                cx += (float(s.get("width", cw)) if e.get("direction") == "row" else cw) + gapx



def has_skip(e):
    if not isinstance(e, dict): return False
    if e.get("type") in SKIP: return True
    return any(has_skip(c) for c in (e.get("children") or [])) or has_skip(e.get("child")) or any(has_skip(c) for c in (e.get("elements") or []))


os.makedirs(OUT, exist_ok=True)
index = []
for t in sorted(os.listdir(SRC)):
    p = os.path.join(SRC, t, "template.json")
    if not os.path.exists(p): continue
    j = json.load(open(p, encoding="utf-8"))
    out = []
    for l in j["layouts"]:
        comps = l.get("components", [])
        if any(has_skip(c) for c in comps) or any(has_skip(c) for c in l.get("elements", [])): continue
        c = Conv(os.path.join(SRC, t))
        for comp in comps:
            ox, oy = float(comp["position"]["x"]), float(comp["position"]["y"])
            for e in comp.get("elements", []): c.walk(e, ox, oy)
        keys = {s["key"]: s for s in c.slots}
        if not keys or not c.els: continue
        out.append({"id": l["id"], "desc": str(l.get("description", ""))[:240], "els": c.els, "slots": list(keys.values())})
    if not out: continue
    colors = j["theme"]["colors"]
    json.dump({"id": t, "name": j["name"], "desc": str(j.get("description", ""))[:200], "layouts": out}, open(os.path.join(OUT, f"{t}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    index.append({"id": t, "name": j["name"], "desc": str(j.get("description", ""))[:200], "layouts": len(out), "primary": color(colors.get("primary")), "background": color(colors.get("background"), "#ffffff")})
    print(t, len(j["layouts"]), "->", len(out), round(os.path.getsize(os.path.join(OUT, f"{t}.json")) / 1024), "KB")
json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
