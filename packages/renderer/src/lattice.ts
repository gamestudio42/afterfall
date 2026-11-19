import { framePoint, latticeFrame, LEG_SHARE, type BuildingDef, type LatticeFrame } from "@afterfall/world";

/** Where the vertices go: the building batch's builder, or a test's arrays. */
export interface Sink {
  pos: number[];
  nrm: number[];
  uv: number[];
}

type P3 = [number, number, number];

/**
 * The outer half width of the tower, as a share of the base, at a share of its height.
 * Read off the Eiffel Tower's elevation: the first platform (57 m of 330) is a little over
 * half the base, the second (115 m) a third, the third (276 m) under a tenth.
 */
const OUTER: [number, number][] = [
  [0, 1],
  [0.06, 0.86],
  [0.12, 0.71],
  [0.175, 0.59],
  [0.26, 0.45],
  [0.35, 0.34],
  [0.45, 0.26],
  [0.55, 0.2],
  [0.65, 0.15],
  [0.75, 0.11],
  [0.84, 0.08],
  [0.9, 0.05],
];

/** The inner edge of the four legs, which lean in until they join at the second platform. */
const INNER: [number, number][] = [
  [0, 1 - 2 * LEG_SHARE],
  [0.06, 0.52],
  [0.12, 0.44],
  [0.175, 0.37],
  [0.26, 0.2],
  [0.35, 0],
];

const FIRST = 0.175;
const SECOND = 0.35;
const THIRD = 0.84;
const SHAFT_TOP = 0.9;

function profile(table: [number, number][], at: number): number {
  if (at <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (at <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/**
 * An iron lattice tower: four legs that lean in from piers at the corners of the base,
 * arches between them, the first and second platforms, a single shaft to the third and a
 * mast. Every member is a thin beam, so the tower is a frame the camera, the light and
 * the player can see through, not a wall the size of a city block.
 */
export function latticeTower(b: BuildingDef, out: Sink): void {
  const f = latticeFrame(b.footprint ?? rectOf(b));
  const h = b.height;
  // Local frame: s and t across the base (-1..1), y in metres.
  const at = (s: number, t: number, y: number): P3 => {
    const p = framePoint(f, s, t);
    return [p.x, y, p.y];
  };
  const side = 2 * Math.min(f.a, f.b);
  const square = (half: number, y: number, s0 = -half, t0 = -half, s1 = half, t1 = half): P3[] => [
    at(s0, t0, y),
    at(s1, t0, y),
    at(s1, t1, y),
    at(s0, t1, y),
  ];

  // The legs, from the piers to the second platform, where they join.
  const legLevels = subdivide([0, 0.06, 0.12, FIRST, 0.26, SECOND], 2);
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const ring = (k: number): P3[] => {
      const o = profile(OUTER, k);
      const i = profile(INNER, k);
      return [at(sx * i, sy * i, k * h), at(sx * o, sy * i, k * h), at(sx * o, sy * o, k * h), at(sx * i, sy * o, k * h)];
    };
    truss(legLevels.map(ring), side, out);
  }

  // The shaft, one square from the second platform to the top.
  const shaftLevels = [...subdivide([SECOND, 0.45, 0.55, 0.65, 0.75, THIRD], 3), SHAFT_TOP];
  truss(
    shaftLevels.map((k) => square(profile(OUTER, k), k * h)),
    side,
    out,
  );

  // The four arches, one on each face, springing from the legs under the first platform.
  for (let face = 0; face < 4; face++) arch(f, h, face, side, out);

  // Platforms: the first is a ring around an open centre, the second a deck, the third a
  // small closed cabin, then a mast.
  const deck1 = profile(OUTER, FIRST) * 1.06;
  const hole1 = profile(INNER, FIRST) * 0.82;
  const t1 = 0.014 * h;
  for (const [s0, t0, s1, t1_] of [
    [-deck1, -deck1, deck1, -hole1],
    [-deck1, hole1, deck1, deck1],
    [-deck1, -hole1, -hole1, hole1],
    [hole1, -hole1, deck1, hole1],
  ])
    box([...square(0, FIRST * h - t1, s0, t0, s1, t1_), ...square(0, FIRST * h, s0, t0, s1, t1_)], out);
  const deck2 = profile(OUTER, SECOND) * 1.08;
  box([...square(deck2, SECOND * h - 0.011 * h), ...square(deck2, SECOND * h)], out);
  const cabin = profile(OUTER, THIRD) * 1.25;
  box([...square(cabin, THIRD * h), ...square(cabin, (THIRD + 0.03) * h)], out);
  const mast = Math.max(0.5, side * 0.012);
  beam(at(0, 0, SHAFT_TOP * h), at(0, 0, h), mast, out);
}

/** Splits every step of a list of levels into `n` equal steps. */
function subdivide(levels: number[], n: number): number[] {
  const outLevels: number[] = [];
  for (let i = 0; i < levels.length - 1; i++) for (let k = 0; k < n; k++) outLevels.push(levels[i] + ((levels[i + 1] - levels[i]) * k) / n);
  outLevels.push(levels[levels.length - 1]);
  return outLevels;
}

/**
 * A braced column through a stack of square sections: four chords up the corners, and on
 * each face a horizontal at every level and a cross of diagonals between levels.
 */
function truss(rings: P3[][], side: number, out: Sink): void {
  for (let r = 0; r < rings.length - 1; r++) {
    const lo = rings[r];
    const hi = rings[r + 1];
    const width = Math.min(dist(lo[0], lo[1]), dist(lo[1], lo[2]));
    const chord = clamp(width * 0.075, 0.35, side * 0.02);
    const brace = chord * 0.55;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      beam(lo[i], hi[i], chord, out);
      beam(lo[i], lo[j], brace, out);
      beam(lo[i], hi[j], brace * 0.75, out);
      beam(lo[j], hi[i], brace * 0.75, out);
      if (r === rings.length - 2) beam(hi[i], hi[j], brace, out);
    }
  }
}

/** The arch on one face of the base, from the inner edge of one leg to the next. */
function arch(f: LatticeFrame, h: number, face: number, side: number, out: Sink): void {
  const spring = 0.03;
  const apex = 0.125;
  const span = profile(INNER, spring);
  const segments = 12;
  const pts: P3[] = [];
  for (let k = 0; k <= segments; k++) {
    const theta = (Math.PI * k) / segments;
    const y = spring + (apex - spring) * Math.sin(theta);
    const along = Math.cos(theta) * span;
    const across = profile(OUTER, y) * 0.97;
    // Faces in order: +s, +t, -s, -t.
    const [s, t] = [
      [across, along],
      [along, across],
      [-across, along],
      [along, -across],
    ][face];
    const p = framePoint(f, s, t);
    pts.push([p.x, y * h, p.y]);
  }
  const thick = clamp(side * 0.018, 0.4, 2.2);
  for (let k = 0; k < segments; k++) beam(pts[k], pts[k + 1], thick, out);
}

/** A square beam from p to q, its four long sides only (the ends hide in the joints). */
export function beam(p: P3, q: P3, w: number, out: Sink): void {
  const d = sub(q, p);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const dir: P3 = [d[0] / len, d[1] / len, d[2] / len];
  // A horizontal side axis keeps the faces square to the ground; a vertical beam takes x.
  let a = cross(dir, [0, 1, 0]);
  if (Math.hypot(a[0], a[1], a[2]) < 1e-3) a = [1, 0, 0];
  a = norm(a);
  const b = cross(a, dir);
  const hw = w / 2;
  const off = (sa: number, sb: number): P3 => [
    a[0] * sa * hw + b[0] * sb * hw,
    a[1] * sa * hw + b[1] * sb * hw,
    a[2] * sa * hw + b[2] * sb * hw,
  ];
  const corners = [off(1, 1), off(-1, 1), off(-1, -1), off(1, -1)];
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % 4];
    const n = norm([c0[0] + c1[0], c0[1] + c1[1], c0[2] + c1[2]]);
    quad(add(p, c0), add(p, c1), add(q, c1), add(q, c0), n, out);
  }
}

/** A closed box from eight corners: the bottom ring then the top ring, in the same order. */
function box(c: P3[], out: Sink): void {
  const centre = c.reduce<P3>((m, p) => [m[0] + p[0] / 8, m[1] + p[1] / 8, m[2] + p[2] / 8], [0, 0, 0]);
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  for (const [i, j, k, l] of faces) {
    const mid: P3 = [(c[i][0] + c[k][0]) / 2, (c[i][1] + c[k][1]) / 2, (c[i][2] + c[k][2]) / 2];
    const n = norm(cross(sub(c[j], c[i]), sub(c[l], c[i])));
    const outward = sub(mid, centre);
    const flip = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0;
    quad(c[i], c[j], c[k], c[l], flip ? [-n[0], -n[1], -n[2]] : n, out);
  }
}

/** Two triangles, wound so that `n` is their front. */
function quad(a: P3, b: P3, c: P3, d: P3, n: P3, out: Sink): void {
  const face = cross(sub(b, a), sub(c, a));
  const tris = face[0] * n[0] + face[1] * n[1] + face[2] * n[2] >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  for (const p of tris) {
    out.pos.push(p[0], p[1], p[2]);
    out.nrm.push(n[0], n[1], n[2]);
    out.uv.push((p[0] + p[2]) / 3, p[1] / 3);
  }
}

function rectOf(b: BuildingDef) {
  const r = b.rect;
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

const sub = (p: P3, q: P3): P3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add = (p: P3, q: P3): P3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const cross = (p: P3, q: P3): P3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p: P3): P3 => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};
const dist = (p: P3, q: P3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
