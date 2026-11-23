import * as THREE from "three";
import { heightAt, pedestalSide, type CityMap, type MonumentDef } from "@afterfall/world";

/** Christ the Redeemer's soapstone, and the weathered bronze of a city's statues. */
const SOAPSTONE = new THREE.Color(0xd9d5c9);
const BRONZE = new THREE.Color(0x6f7a6c);
const PEDESTAL = new THREE.Color(0x9a958a);
/** The Christ's pedestal: dark stone under a pale band. */
const CHAPEL = new THREE.Color(0x5f5850);
/** The chapel door under Christ the Redeemer. */
const DOOR = new THREE.Color(0x3a3530);

interface Sink {
  pos: number[];
  nrm: number[];
  col: number[];
}

function quad(out: Sink, pts: number[][], n: number[], c: THREE.Color): void {
  const [a, b, d] = pts;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const order = f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const k of order) {
    out.pos.push(pts[k][0], pts[k][1], pts[k][2]);
    out.nrm.push(n[0], n[1], n[2]);
    out.col.push(c.r, c.g, c.b);
  }
}

/** An axis-aligned box in the monument's frame, turned by `yaw` round its centre. */
function box(
  out: Sink,
  cx: number,
  cz: number,
  yaw: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  c: THREE.Color,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const P = (x: number, y: number, z: number) => [cx + x * cos - z * sin, y, cz + x * sin + z * cos];
  const N = (x: number, y: number, z: number) => [x * cos - z * sin, y, x * sin + z * cos];
  quad(out, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], N(0, 0, 1), c);
  quad(out, [P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], N(0, 0, -1), c);
  quad(out, [P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], N(1, 0, 0), c);
  quad(out, [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], N(-1, 0, 0), c);
  quad(out, [P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], N(0, 1, 0), c);
  quad(out, [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], N(0, -1, 0), c);
}

/** A profile of (radius, height) turned round a vertical axis. */
function lathe(out: Sink, cx: number, cz: number, profile: [number, number][], segments: number, c: THREE.Color): void {
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, y0] = profile[k];
    const [r1, y1] = profile[k + 1];
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const n = [Math.cos(am) * (y1 - y0), r0 - r1, Math.sin(am) * (y1 - y0)];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      const p = (r: number, a: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      quad(out, [p(r0, a0, y0), p(r0, a1, y0), p(r1, a1, y1), p(r1, a0, y1)], [n[0] / l, n[1] / l, n[2] / l], c);
    }
  }
}

type V3 = [number, number, number];

/**
 * Joins rings of points, each the same length, into a closed tube: a robe, an arm, a head.
 * Flat-shaded, each quad's normal its own, turned away from the axis the rings run along.
 */
function tube(out: Sink, rings: V3[][], c: THREE.Color): void {
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    const centre = [a, b].map((r) =>
      r.reduce((m, p) => [m[0] + p[0] / r.length, m[1] + p[1] / r.length, m[2] + p[2] / r.length], [0, 0, 0]),
    );
    const axis = [(centre[0][0] + centre[1][0]) / 2, (centre[0][1] + centre[1][1]) / 2, (centre[0][2] + centre[1][2]) / 2];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      const pts = [a[i], a[j], b[j], b[i]];
      const e1 = sub(pts[2], pts[0]);
      const e2 = sub(pts[3], pts[1]);
      let n = cross(e1, e2);
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) continue;
      n = [n[0] / l, n[1] / l, n[2] / l];
      const mid = [(pts[0][0] + pts[2][0]) / 2 - axis[0], (pts[0][1] + pts[2][1]) / 2 - axis[1], (pts[0][2] + pts[2][2]) / 2 - axis[2]];
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) n = [-n[0], -n[1], -n[2]];
      quad(out, pts, n, c);
    }
  }
}

function sub(a: V3 | number[], b: V3 | number[]): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A flat panel with thickness: a polygon in the x–y plane, from z0 to z1, in the frame `P`. */
function slab(
  out: Sink,
  P: (x: number, y: number, z: number) => V3,
  poly: [number, number][],
  z0: number,
  z1: number,
  c: THREE.Color,
): void {
  const front = poly.map(([x, y]) => P(x, y, z1));
  const back = poly.map(([x, y]) => P(x, y, z0));
  const nz = sub(P(0, 0, 1), P(0, 0, 0));
  const fan = (ring: V3[], n: V3) => {
    for (let i = 1; i < ring.length - 1; i++) quad(out, [ring[0], ring[i], ring[i + 1], ring[i + 1]], n, c);
  };
  fan(front, nz);
  fan(back, [-nz[0], -nz[1], -nz[2]]);
  tube(out, [front, back], c);
}

/**
 * Christ the Redeemer, 30 m of soapstone over a chapel pedestal, at its own proportions:
 * a robe that narrows to the feet and broadens to the shoulders, wider than it is deep,
 * folds falling from a cord at the waist; arms out almost level, 28 m from hand to hand,
 * the sleeves hanging from the forearms back to the body; a head bowed a little forward.
 *
 * It faces the camera's default view (+z) rather than Guanabara Bay, so the cross it makes
 * reads from the start; the arms run along x.
 */
function christ(out: Sink, m: MonumentDef, base: number, yaw: number, c: THREE.Color): void {
  const H = m.height;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [m.x + x * cos - z * sin, base + y, m.y + x * sin + z * cos];
  const SEG = 28;
  // Height, half width, half depth (shares of H), folds, forward shift.
  const robe: [number, number, number, number, number][] = [
    [0, 0.112, 0.07, 0.12, 0],
    [0.04, 0.113, 0.071, 0.12, 0],
    [0.2, 0.114, 0.072, 0.12, 0],
    [0.38, 0.117, 0.073, 0.1, 0],
    [0.47, 0.12, 0.074, 0.05, 0],
    // The cord at the waist.
    [0.475, 0.125, 0.079, 0, 0],
    [0.495, 0.125, 0.079, 0, 0],
    [0.5, 0.12, 0.074, 0.03, 0],
    [0.62, 0.145, 0.08, 0.03, 0.003],
    [0.72, 0.158, 0.082, 0.01, 0.004],
    [0.775, 0.16, 0.08, 0, 0.004],
    // The shoulders round in to the neck.
    [0.805, 0.13, 0.07, 0, 0.004],
    [0.825, 0.07, 0.05, 0, 0.006],
    [0.84, 0.035, 0.034, 0, 0.01],
  ];
  const ringAt = ([y, hw, hd, folds, fwd]: [number, number, number, number, number]): V3[] =>
    Array.from({ length: SEG }, (_, i) => {
      const a = (i / SEG) * Math.PI * 2;
      // Folds hang down the front and back of the robe, not round its sides.
      const fold = 1 + folds * 0.5 * Math.cos(a * 14) * Math.abs(Math.sin(a));
      return P(Math.cos(a) * hw * H * fold, y * H, (Math.sin(a) * hd * fold + fwd) * H);
    });
  tube(out, robe.map(ringAt), c);
  // The hem's underside, on the pedestal.
  const hem = ringAt(robe[0]);
  for (let i = 1; i < SEG - 1; i++) quad(out, [hem[0], hem[i], hem[i + 1], hem[i + 1]], [0, -1, 0], c);

  // The head, bowed: each ring a little further forward than the one under it.
  const head: [number, number, number][] = [
    [0.835, 0.035, 0.01],
    [0.865, 0.04, 0.014],
    // Hair to the jaw, then the crown.
    [0.88, 0.052, 0.018],
    [0.915, 0.057, 0.024],
    [0.95, 0.055, 0.028],
    [0.975, 0.045, 0.03],
    [0.993, 0.025, 0.03],
    [1, 0, 0.03],
  ];
  tube(
    out,
    head.map(([y, r, fwd]) =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return P(Math.cos(a) * r * H, y * H, (Math.sin(a) * r * 0.92 + fwd) * H);
      }),
    ),
    c,
  );

  // Arms: from inside the shoulder to the wrist, rising a touch, thinning to the wrist.
  const ARM = 10;
  for (const s of [-1, 1]) {
    const arm: [number, number][] = [
      [0.12, 0.046],
      [0.2, 0.043],
      [0.28, 0.039],
      [0.36, 0.034],
      [0.43, 0.028],
    ];
    tube(
      out,
      arm.map(([x, r]) => {
        const y = 0.768 + (x - 0.12) * 0.03;
        return Array.from({ length: ARM }, (_, i) => {
          const a = (i / ARM) * Math.PI * 2;
          return P(s * x * H, (y + Math.cos(a) * r) * H, Math.sin(a) * r * 0.85 * H);
        });
      }),
      c,
    );
    // The open hand, palm forward, its fingers together.
    const hy = 0.778;
    slab(
      out,
      P,
      [
        [s * 0.425 * H, (hy - 0.02) * H],
        [s * 0.452 * H, (hy - 0.024) * H],
        [s * 0.472 * H, (hy - 0.012) * H],
        [s * 0.472 * H, (hy + 0.014) * H],
        [s * 0.45 * H, (hy + 0.022) * H],
        [s * 0.425 * H, (hy + 0.02) * H],
      ],
      -0.009 * H,
      0.009 * H,
      c,
    );
    // The wide sleeve hangs from the whole arm, lowest at the wrist, and meets the body at the waist.
    slab(
      out,
      P,
      [
        [s * 0.415 * H, 0.778 * H],
        [s * 0.4 * H, 0.665 * H],
        [s * 0.3 * H, 0.635 * H],
        [s * 0.15 * H, 0.56 * H],
        [s * 0.13 * H, 0.58 * H],
        [s * 0.13 * H, 0.77 * H],
      ],
      -0.028 * H,
      0.028 * H,
      c,
    );
  }
}

/** The chapel the Christ stands on: steps up to it, its walls, and a cornice under the feet. */
function chapel(out: Sink, m: MonumentDef, ground: number, side: number, yaw: number): void {
  const base = ground + m.pedestal;
  const half = side / 2;
  // Three steps round it.
  for (const [k, y] of [
    [1.2, 0.35],
    [0.8, 0.7],
    [0.4, 1.05],
  ])
    box(out, m.x, m.y, yaw, -half - k, half + k, ground - 0.5, ground + y, -half - k, half + k, PEDESTAL);
  // The walls, a band at the chapel's roof, and the cornice the figure stands on.
  box(out, m.x, m.y, yaw, -half, half, ground, base - 1.6, -half, half, CHAPEL);
  box(out, m.x, m.y, yaw, -half - 0.25, half + 0.25, base - 1.6, base - 1.1, -half - 0.25, half + 0.25, SOAPSTONE);
  box(out, m.x, m.y, yaw, -half * 0.9, half * 0.9, base - 1.1, base - 0.5, -half * 0.9, half * 0.9, CHAPEL);
  box(out, m.x, m.y, yaw, -half * 0.95, half * 0.95, base - 0.5, base, -half * 0.95, half * 0.95, SOAPSTONE);
  // The chapel's door, at the back.
  const dw = Math.min(1.1, half * 0.3);
  box(out, m.x, m.y, yaw, -dw, dw, ground + 1.05, ground + Math.min(3.6, m.pedestal * 0.45), -half - 0.04, -half + 0.02, DOOR);
}

/**
 * One monument on the ground under it: a stepped pedestal and the figure on it. A figure is
 * a robed body and a head; Christ the Redeemer has a figure and a chapel of its own. A
 * column is a shaft with a capital.
 */
function monument(out: Sink, m: MonumentDef, ground: number): void {
  const side = pedestalSide(m);
  const yaw = 0;
  const base = ground + m.pedestal;
  if (m.kind === "open-arms") {
    chapel(out, m, ground, side, yaw);
    christ(out, m, base, yaw, SOAPSTONE);
    return;
  }
  box(
    out,
    m.x,
    m.y,
    yaw,
    -side / 2 - 0.4,
    side / 2 + 0.4,
    ground - 0.5,
    ground + Math.min(1, m.pedestal * 0.2),
    -side / 2 - 0.4,
    side / 2 + 0.4,
    PEDESTAL,
  );
  box(out, m.x, m.y, yaw, -side / 2, side / 2, ground, base, -side / 2, side / 2, PEDESTAL);
  const H = m.height;
  if (m.kind === "column") {
    lathe(
      out,
      m.x,
      m.y,
      [
        [H * 0.09, base],
        [H * 0.07, base + H * 0.04],
        [H * 0.06, base + H * 0.88],
        [H * 0.1, base + H * 0.92],
        [H * 0.1, base + H * 0.95],
        [H * 0.04, base + H],
        [0, base + H],
      ],
      14,
      BRONZE,
    );
    return;
  }
  // The robe falls straight from the shoulders and flares a little at the feet.
  lathe(
    out,
    m.x,
    m.y,
    [
      [H * 0.15, base],
      [H * 0.13, base + H * 0.25],
      [H * 0.115, base + H * 0.6],
      [H * 0.12, base + H * 0.76],
      [H * 0.07, base + H * 0.82],
      [H * 0.035, base + H * 0.84],
      [H * 0.055, base + H * 0.88],
      [H * 0.055, base + H * 0.95],
      [H * 0.03, base + H * 0.99],
      [0, base + H],
    ],
    16,
    BRONZE,
  );
}

/** Every monument of the map, in one mesh. Built at the ground's height, not draped. */
export function buildMonuments(city: CityMap): THREE.Mesh | null {
  if (!city.monuments?.length) return null;
  const out: Sink = { pos: [], nrm: [], col: [] };
  for (const m of city.monuments) monument(out, m, heightAt(city.terrain, m.x, m.y));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(out.col, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = "monuments";
  return mesh;
}
