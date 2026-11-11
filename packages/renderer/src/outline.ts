import * as THREE from "three";

type Pt = { x: number; y: number };

/**
 * The yellow cage drawn around a selected building: its bottom ring, its top ring, and
 * uprights at the corners.
 *
 * The first version put an upright on every vertex of the footprint, which is right for a
 * four-sided block and wrong for anything with a curved outline — the Eiffel Tower's
 * footprint has dozens of points, and selecting it drew a forest of 330 m lines. The
 * uprights are now the corners only, and there are never more than sixteen of them.
 */
export function selectionLines(poly: Pt[], height: number, grow = 0.3, maxUprights = 16): number[] {
  const c = poly.reduce((acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }), { x: 0, y: 0 });
  const pts = poly.map((p) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
    return { x: p.x + ((p.x - c.x) / d) * grow, y: p.y + ((p.y - c.y) / d) * grow };
  });
  const top = height + 0.4;
  const v: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % pts.length];
    v.push(p.x, 0.05, p.y, q.x, 0.05, q.y);
    v.push(p.x, top, p.y, q.x, top, q.y);
  }
  for (const p of corners(pts, maxUprights)) v.push(p.x, 0.05, p.y, p.x, top, p.y);
  return v;
}

function evenSample(pts: Pt[], n: number): Pt[] {
  const step = pts.length / n;
  return Array.from({ length: n }, (_, i) => pts[Math.floor(i * step)]);
}

/** The vertices where the outline actually turns, thinned to at most `max`. */
function corners(pts: Pt[], max: number): Pt[] {
  // A footprint with many points is a shape, not a box: four uprights at its extremes read
  // as a selection, while a dozen and a half read as a grid of poles across the building.
  if (pts.length > 12) {
    const extreme = (key: (p: Pt) => number) => pts.reduce((a, b) => (key(b) > key(a) ? b : a));
    const picks = [extreme((p) => -p.x), extreme((p) => p.x), extreme((p) => -p.y), extreme((p) => p.y)];
    return picks.filter((p, i) => picks.findIndex((q) => q.x === p.x && q.y === p.y) === i);
  }
  const turned: Pt[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[(k + pts.length - 1) % pts.length];
    const b = pts[k];
    const c = pts[(k + 1) % pts.length];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    if (Math.acos(cos) > 0.55) turned.push(b);
  }
  // A smooth outline has no corners at all, and two rings with nothing between them read
  // as two outlines: fall back to an even sample so the cage still closes.
  const picked = turned.length >= 4 ? turned : evenSample(pts, Math.min(8, pts.length));
  if (picked.length <= max) return picked;
  const step = picked.length / max;
  return Array.from({ length: max }, (_, i) => picked[Math.floor(i * step)]);
}

/** The same lines as a geometry, ready for the selection material. */
export function selectionGeometry(poly: Pt[], height: number): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(selectionLines(poly, height), 3));
}
