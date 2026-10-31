import type { Rect, Vec2 } from "./math";

/** Signed area of a polygon (positive when counter-clockwise in a y-up frame). */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return a / 2;
}

export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedArea(poly));
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    x += (poly[j].x + poly[i].x) * f;
    y += (poly[j].y + poly[i].y) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: x / (3 * a), y: y / (3 * a) };
}

export function polygonBounds(poly: Vec2[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Even-odd point in polygon test. */
export function pointInPolygon(x: number, y: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point to (x, y) on segment a-b. */
export function closestOnSegment(x: number, y: number, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Closest point to (x, y) on a closed polygon's outline. */
export function closestOnPolygon(x: number, y: number, poly: Vec2[]): Vec2 {
  let best = poly[0];
  let bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = closestOnSegment(x, y, poly[j], poly[i]);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Distance from (x, y) to an open polyline. */
export function distToPolyline(x: number, y: number, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const p = closestOnSegment(x, y, line[i - 1], line[i]);
    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  }
  return best;
}

/** Clips a polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
export function clipPolygonToRect(poly: Vec2[], r: Rect): Vec2[] {
  const edges: [(p: Vec2) => boolean, (a: Vec2, b: Vec2) => Vec2][] = [
    [(p) => p.x >= r.x, (a, b) => lerpAt(a, b, (r.x - a.x) / (b.x - a.x))],
    [(p) => p.x <= r.x + r.w, (a, b) => lerpAt(a, b, (r.x + r.w - a.x) / (b.x - a.x))],
    [(p) => p.y >= r.y, (a, b) => lerpAt(a, b, (r.y - a.y) / (b.y - a.y))],
    [(p) => p.y <= r.y + r.h, (a, b) => lerpAt(a, b, (r.y + r.h - a.y) / (b.y - a.y))],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (out.length === 0) break;
  }
  return out;
}

/**
 * Clips a polyline to an axis-aligned rectangle (Liang–Barsky per segment).
 * Returns the pieces inside, each with at least two points.
 */
export function clipPolylineToRect(line: Vec2[], r: Rect): Vec2[][] {
  const pieces: Vec2[][] = [];
  let cur: Vec2[] = [];
  for (let i = 1; i < line.length; i++) {
    const seg = clipSegment(line[i - 1], line[i], r);
    if (!seg) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    const [a, b] = seg;
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last.x - a.x, last.y - a.y) > 1e-6) {
      if (cur.length > 1) pieces.push(cur);
      cur = [a];
    }
    cur.push(b);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

function clipSegment(a: Vec2, b: Vec2, r: Rect): [Vec2, Vec2] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [lerpAt(a, b, t0), lerpAt(a, b, t1)];
}

function lerpAt(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Drops points closer than minDist to the previous one and nearly collinear points. */
export function simplifyPolygon(poly: Vec2[], minDist = 0.4): Vec2[] {
  const pts = poly.filter((p, i) => i === 0 || Math.hypot(p.x - poly[i - 1].x, p.y - poly[i - 1].y) >= minDist);
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < minDist) pts.pop();
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
    if (len > 0 && Math.abs(cross) / len < 0.02) continue;
    out.push(b);
  }
  return out.length >= 3 ? out : pts;
}
