import type { Vec2 } from "@afterfall/shared";
import type { BuildingDef } from "./city";

/**
 * The square a lattice tower stands on: its centre, two unit axes along its sides, and the
 * half length of each side. Found as the smallest rectangle around the footprint, so the
 * Eiffel Tower's outline (four legs joined by arches, turned 45° from north) gives the
 * square through the tips of its legs.
 */
export interface LatticeFrame {
  centre: Vec2;
  u: Vec2;
  v: Vec2;
  /** Half side along `u`. */
  a: number;
  /** Half side along `v`. */
  b: number;
}

/** A leg's side, as a share of the base side. The Eiffel Tower's piers are 25 m of 125. */
export const LEG_SHARE = 0.2;

export function latticeFrame(poly: Vec2[]): LatticeFrame {
  const hull = convexHull(poly);
  let best: LatticeFrame | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-9) continue;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const v = { x: -u.y, y: u.x };
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const h of hull) {
      const du = h.x * u.x + h.y * u.y;
      const dv = h.x * v.x + h.y * v.y;
      u0 = Math.min(u0, du);
      u1 = Math.max(u1, du);
      v0 = Math.min(v0, dv);
      v1 = Math.max(v1, dv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea - 1e-6) {
      bestArea = area;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      best = { centre: { x: u.x * cu + v.x * cv, y: u.y * cu + v.y * cv }, u, v, a: (u1 - u0) / 2, b: (v1 - v0) / 2 };
    }
  }
  if (best) return best;
  const c = poly[0] ?? { x: 0, y: 0 };
  return { centre: c, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, a: 0.5, b: 0.5 };
}

/** A point of the frame: `s` and `t` run from -1 to 1 across the base. */
export function framePoint(f: LatticeFrame, s: number, t: number): Vec2 {
  return {
    x: f.centre.x + f.u.x * s * f.a + f.v.x * t * f.b,
    y: f.centre.y + f.u.y * s * f.a + f.v.y * t * f.b,
  };
}

/**
 * The ground a lattice tower actually stands on: four square piers at the corners of its
 * base. Everything between them is open, as under the real one.
 */
export function latticeLegs(b: BuildingDef): Vec2[][] {
  const f = latticeFrame(b.footprint ?? rectPoly(b));
  const inner = 1 - 2 * LEG_SHARE;
  const legs: Vec2[][] = [];
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    legs.push([framePoint(f, sx * inner, sy * inner), framePoint(f, sx, sy * inner), framePoint(f, sx, sy), framePoint(f, sx * inner, sy)]);
  }
  return legs;
}

function rectPoly(b: BuildingDef): Vec2[] {
  const r = b.rect;
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Andrew's monotone chain. */
function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
