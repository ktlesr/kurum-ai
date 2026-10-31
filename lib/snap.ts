// Equal-spacing snap: dragged next to a row of elements, a box catches the gap the row already has, or the middle between
// two of them. Our own, in the spirit of design tools' "smart guides". Pure: the editor draws what it returns.

export interface Rect { x: number; y: number; w: number; h: number }
/** A gap to mark: `from`-`to` on the snapping axis, at cross-axis position `at`. */
export interface GapMark { axis: "x" | "y"; from: number; to: number; at: number }

export function spacingSnap(box: Rect, others: Rect[], axis: "x" | "y", threshold: number): { delta: number; marks: GapMark[] } | null {
  const s = (r: Rect) => (axis === "x" ? r.x : r.y);
  const z = (r: Rect) => (axis === "x" ? r.w : r.h);
  const cs = (r: Rect) => (axis === "x" ? r.y : r.x);
  const cz = (r: Rect) => (axis === "x" ? r.h : r.w);
  // Its row: what shares some of its height (or width, on the other axis), left to right.
  const row = others.filter((o) => cs(o) < cs(box) + cz(box) && cs(box) < cs(o) + cz(o)).sort((a, b) => s(a) - s(b));
  const at = cs(box) + cz(box) / 2;
  const size = z(box), start = s(box);
  let best: { delta: number; marks: GapMark[] } | null = null;
  const consider = (target: number, spans: [number, number][]) => {
    if (row.some((o) => s(o) < target + size && target < s(o) + z(o))) return; // on top of another: no spacing at all
    const delta = target - start;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, marks: spans.map(([from, to]) => ({ axis, from, to, at })) };
  };
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i], b = row[i + 1];
    const ae = s(a) + z(a), be = s(b) + z(b);
    const gap = s(b) - ae;
    if (gap <= 0) continue;
    // After the pair, and before it, with the pair's own gap.
    consider(be + gap, [[ae, s(b)], [be, be + gap]]);
    consider(s(a) - gap - size, [[s(a) - gap, s(a)], [ae, s(b)]]);
    // Between them, the same distance from both.
    const side = (gap - size) / 2;
    if (side > 0) consider(ae + side, [[ae, ae + side], [ae + side + size, s(b)]]);
  }
  return best;
}
