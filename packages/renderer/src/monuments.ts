import * as THREE from "three";
import { heightAt, pedestalSide, type CityMap, type MonumentDef } from "@afterfall/world";

/** Christ the Redeemer's soapstone, and the weathered bronze of a city's statues. */
const SOAPSTONE = new THREE.Color(0xa9a897);
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

function sub(a: V3 | number[], b: V3 | number[]): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** How strongly a crease darkens a surface, and the most it may. */
const CREASE = 2.2;
const CREASE_MAX = 0.45;

/**
 * A smooth surface from a grid of points: rows along one direction, columns round the
 * other, closed round when `wrap`. Each vertex gets the normal of the surface there (from
 * its neighbours on either side), turned away from its own row's middle, so a robe or an
 * arm shades as cloth and stone rather than as facets. A row that has shrunk to a point (a
 * crown, a fingertip) takes its normal from `centre`. An open surface that curves round an
 * axis (hair round a face) passes a point on that axis for each row in `refs`; `crease` is
 * how strongly its hollows darken.
 */
function surface(out: Sink, rows: V3[][], wrap: boolean, c: THREE.Color, centre: V3, refs?: V3[], crease = CREASE): void {
  const R = rows.length;
  const C = rows[0].length;
  const mids = refs ?? rows.map((r) => r.reduce((m, p) => [m[0] + p[0] / C, m[1] + p[1] / C, m[2] + p[2] / C], [0, 0, 0] as V3));
  const normals = rows.map((row, i) =>
    row.map((p, j) => {
      const jl = wrap ? (j - 1 + C) % C : Math.max(0, j - 1);
      const jr = wrap ? (j + 1) % C : Math.min(C - 1, j + 1);
      const along = sub(row[jr], row[jl]);
      const across = sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]);
      let n = cross(along, across);
      let l = Math.hypot(n[0], n[1], n[2]);
      const away = sub(p, mids[i]);
      const al = Math.hypot(away[0], away[1], away[2]);
      const out = al > 1e-6 ? away : sub(p, centre);
      if (l < 1e-9) {
        n = sub(p, centre);
        l = Math.hypot(n[0], n[1], n[2]) || 1;
      }
      n = [n[0] / l, n[1] / l, n[2] / l];
      return n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? ([-n[0], -n[1], -n[2]] as V3) : n;
    }),
  );
  // Creases darken: how far a vertex sits below the mean of its neighbours, along its
  // normal, measured against the spacing there. The game's sky light is strong and even, and
  // without this the folds of a robe vanish into one pale shape.
  const shade = rows.map((row, i) =>
    row.map((p, j) => {
      if (i === 0 || i === R - 1 || (!wrap && (j === 0 || j === C - 1))) return 1;
      const q = [row[(j - 1 + C) % C], row[(j + 1) % C], rows[i - 1][j], rows[i + 1][j]];
      const mean = q.reduce((m, v) => [m[0] + v[0] / 4, m[1] + v[1] / 4, m[2] + v[2] / 4], [0, 0, 0] as V3);
      const spacing = q.reduce((m, v) => m + Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]), 0) / 4;
      const n = normals[i][j];
      const into = sub(mean, p);
      const cavity = (into[0] * n[0] + into[1] * n[1] + into[2] * n[2]) / Math.max(1e-9, spacing);
      return 1 - Math.min(CREASE_MAX, Math.max(0, cavity * crease));
    }),
  );
  const push = (i: number, j: number) => {
    const p = rows[i][j];
    const n = normals[i][j];
    const k = shade[i][j];
    out.pos.push(p[0], p[1], p[2]);
    out.nrm.push(n[0], n[1], n[2]);
    out.col.push(c.r * k, c.g * k, c.b * k);
  };
  const tri = (a: [number, number], b: [number, number], d: [number, number]) => {
    const pa = rows[a[0]][a[1]];
    const f = cross(sub(rows[b[0]][b[1]], pa), sub(rows[d[0]][d[1]], pa));
    if (Math.hypot(f[0], f[1], f[2]) < 1e-12) return;
    const n = normals[a[0]][a[1]];
    const [x, y] = f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0 ? [b, d] : [d, b];
    push(...a);
    push(...x);
    push(...y);
  };
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < (wrap ? C : C - 1); j++) {
      const k = (j + 1) % C;
      tri([i, j], [i, k], [i + 1, k]);
      tri([i, j], [i + 1, k], [i + 1, j]);
    }
}

/** Smooth steps and keyframed curves, for shaping the figure. */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function curve(keys: number[][], x: number, k: number): number {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0][k];
  if (x >= keys[n - 1][0]) return keys[n - 1][k];
  // A monotone cubic through the keys (Fritsch-Carlson): smooth through each key, where
  // easing in and out of every one would leave a terrace there, and never overshooting.
  const slope = (i: number) => (keys[i + 1][k] - keys[i][k]) / (keys[i + 1][0] - keys[i][0]);
  const tangent = (i: number) => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const a = slope(i - 1);
    const b = slope(i);
    return a * b <= 0
      ? 0
      : (3 * (keys[i + 1][0] - keys[i - 1][0])) /
          ((2 * keys[i + 1][0] - keys[i][0] - keys[i - 1][0]) / a + (keys[i + 1][0] + keys[i][0] - 2 * keys[i - 1][0]) / b);
  };
  let i = 0;
  while (x > keys[i + 1][0]) i++;
  const h = keys[i + 1][0] - keys[i][0];
  const t = (x - keys[i][0]) / h;
  const d = slope(i);
  let m0 = tangent(i);
  let m1 = tangent(i + 1);
  if (d === 0) m0 = m1 = 0;
  else {
    m0 = Math.max(0, Math.min(3, m0 / d)) * d;
    m1 = Math.max(0, Math.min(3, m1 / d)) * d;
  }
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * keys[i][k] + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * keys[i + 1][k] + (t3 - t2) * h * m1;
}

/** An ellipsoid about `o` with radii `r`, turned by `tilt` round z, as a smooth surface. */
function ellipsoid(out: Sink, P: (x: number, y: number, z: number) => V3, o: V3, r: V3, tilt: number, c: THREE.Color): void {
  const rows: V3[][] = [];
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  for (let i = 0; i <= 10; i++) {
    const v = -Math.PI / 2 + (Math.PI * i) / 10;
    const row: V3[] = [];
    for (let j = 0; j < 14; j++) {
      const u = (j / 14) * Math.PI * 2;
      const x = Math.cos(v) * Math.cos(u) * r[0];
      const y = Math.sin(v) * r[1];
      const z = Math.cos(v) * Math.sin(u) * r[2];
      row.push(P(o[0] + x * cos - y * sin, o[1] + x * sin + y * cos, o[2] + z));
    }
    rows.push(row);
  }
  surface(out, rows, true, c, P(o[0], o[1], o[2]));
}

/** Half width and half depth of the figure's body at a height, as shares of its height. */
const BODY = [
  [0, 0.106, 0.066],
  [0.06, 0.108, 0.068],
  [0.26, 0.111, 0.071],
  [0.45, 0.117, 0.074],
  [0.5, 0.122, 0.076],
  [0.58, 0.134, 0.079],
  [0.67, 0.15, 0.083],
  [0.74, 0.158, 0.084],
  [0.775, 0.158, 0.081],
  [0.8, 0.138, 0.072],
  [0.818, 0.1, 0.06],
  [0.834, 0.062, 0.052],
  [0.85, 0.047, 0.045],
  [0.862, 0.041, 0.04],
  [0.872, 0.038, 0.038],
];
const NECK = 0.872;
const WAIST = 0.48;

/** Where the head starts (the base of the neck) and how tall it is to the crown. */
const HEAD_Y = 0.83;
const HEAD_H = 0.17;

/**
 * The head under its hair: half width, and depth in front and behind, from the base of the
 * neck (0) to the crown (1). The chin, under its beard, is at about 0.27, the nose's tip at
 * 0.47, the eyes at 0.6 and the hairline at 0.82: a face in thirds.
 */
const SKULL = [
  [0, 0.036, 0.036, 0.036],
  [0.17, 0.036, 0.038, 0.036],
  [0.25, 0.034, 0.044, 0.034],
  [0.33, 0.039, 0.049, 0.04],
  [0.46, 0.042, 0.047, 0.045],
  [0.6, 0.043, 0.045, 0.047],
  [0.74, 0.042, 0.042, 0.047],
  [0.86, 0.035, 0.034, 0.04],
  [0.93, 0.026, 0.025, 0.03],
  [0.97, 0.017, 0.016, 0.019],
  [0.99, 0.009, 0.009, 0.01],
  [1, 0, 0, 0],
];

/** Half the angle the hair leaves open round the face, from below the neck to the crown. */
const OPENING = [
  [-0.12, 1.75],
  [0.0, 1.6],
  [0.12, 1.35],
  [0.27, 1.05],
  [0.36, 0.95],
  [0.6, 0.95],
  [0.7, 0.8],
  [0.78, 0.5],
  [0.85, 0.18],
  [0.92, 0.015],
];

/** How thick the hair lies on the head, from below the neck to the crown. */
const HAIR = [
  [-0.12, 0.004],
  [0, 0.012],
  [0.3, 0.013],
  [0.5, 0.011],
  [0.8, 0.007],
  [1, 0.004],
];

/** Where the arm's axis runs, how thick it is, and how low its sleeve hangs, at a reach. */
const armY = (x: number) => 0.768 + (x - 0.1) * 0.03;
const armR = (x: number) =>
  curve(
    [
      [0.1, 0.05],
      [0.2, 0.045],
      [0.32, 0.037],
      [0.425, 0.029],
    ],
    x,
    1,
  );
const SLEEVE = [
  [0.1, 0.56],
  [0.2, 0.59],
  [0.3, 0.625],
  [0.39, 0.66],
  [0.425, 0.72],
];

/** A bell round `c0`, `w` wide. */
const bell = (v: number, c0: number, w: number) => Math.exp(-(((v - c0) / w) ** 2));

/**
 * A point of the head at a height `t` (0 at the base of the neck, 1 at the crown) and an
 * angle `u` round it (π/2 straight ahead), before it is bowed. The face is carved into the
 * front: the nose's ridge widening to its tip, the eyes deep under the brow, the
 * cheekbones, the moustache over the mouth, and the beard over the chin and jaw.
 */
function skull(t: number, u: number): V3 {
  const rx = curve(SKULL, t, 1);
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const x = cu * rx;
  let z = su * curve(SKULL, t, su > 0 ? 2 : 3);
  if (su > 0) {
    const s = cu;
    const as = Math.abs(s);
    let d = 0;
    const nose = smooth(0.62, 0.47, t) * smooth(0.44, 0.47, t);
    d += 0.011 * nose * bell(s, 0, 0.08 + 0.1 * smooth(0.62, 0.47, t));
    d -= 0.006 * bell(as, 0.37, 0.17) * bell(t, 0.595, 0.038);
    d += 0.0016 * bell(t, 0.637, 0.02) * smooth(0.05, 0.25, as) * (1 - smooth(0.5, 0.8, as));
    d += 0.002 * bell(as, 0.55, 0.15) * bell(t, 0.54, 0.04);
    d += 0.002 * bell(t, 0.425 - 0.07 * as, 0.018) * bell(s, 0, 0.45);
    d -= 0.0015 * bell(t, 0.402, 0.009) * bell(s, 0, 0.18);
    const cheek = 0.12 * smooth(0.3, 0.6, as);
    const beard = smooth(0.2, 0.27, t) * (1 - smooth(0.37 + cheek, 0.43 + cheek, t)) * (1 - 0.6 * bell(t, 0.4, 0.02) * bell(s, 0, 0.2));
    d += beard * (0.0028 * bell(s, 0, 0.6) + 0.0012 * Math.abs(Math.cos(s * 16)) * (1 - smooth(0.33, 0.37, t) * bell(s, 0, 0.45)));
    d += 0.0012 * bell(t, 0.385, 0.012) * bell(s, 0, 0.2);
    z += d * su * su;
  }
  return [x, HEAD_Y + t * HEAD_H, z];
}

/**
 * A point of the hair at a height `t` and an angle `u`, before it is bowed: a shell over the
 * skull, in wavy locks from the crown, that falls straight from the jaw behind the neck to
 * the shoulders. `edge` runs from 0 at the rim round the face to 1 a little inside it; at
 * the rim the hair turns in to the head, so it has thickness, and where the rims meet over
 * the forehead they leave the parting.
 */
function hair(t: number, u: number, edge: number): V3 {
  const tt = Math.max(t, 0.34);
  const narrow = 1 - 0.12 * smooth(0.34, -0.12, t);
  const rx = curve(SKULL, tt, 1) * narrow;
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const deep = curve(SKULL, tt, su > 0 ? 2 : 3);
  // Locks, smoother where the hair is swept back from the forehead.
  const swept = 1 - 0.55 * smooth(0.3, 0.9, Math.sin(u)) * smooth(0.55, 0.75, t);
  const lock = 0.003 * Math.abs(Math.sin(u * 10 + 0.8 * Math.sin(t * 8))) ** 0.5 * (1 - smooth(0.82, 0.98, t)) * swept;
  let out = curve(HAIR, t, 1) + lock;
  out *= smooth(0, 1, edge);
  // Its end tucks under the mantle on the shoulders.
  const tuck = 1 - 0.25 * smooth(-0.04, -0.12, t);
  return [cu * (rx + out) * tuck, HEAD_Y + t * HEAD_H, su * (deep + out) * tuck];
}

/** The head bows forward from the neck, more the higher up it is. */
function bow(p: V3, t: number): V3 {
  const a = 0.17 * smooth(0, 0.35, t);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const dy = p[1] - HEAD_Y;
  return [p[0], HEAD_Y + dy * ca - p[2] * sa, p[2] * ca + dy * sa + 0.006];
}

/**
 * A heart in low relief at `o`, facing +z, `k` the size of one unit of the classic heart
 * curve (16 wide): domed, its edge sunk a little into what it stands on.
 */
function heart(out: Sink, P: (x: number, y: number, z: number) => V3, o: V3, k: number, c: THREE.Color): void {
  const rows: V3[][] = [];
  const AROUND = 48;
  for (let i = 0; i <= 8; i++) {
    const r = i / 8;
    const lift = 0.004 * Math.sqrt(Math.max(0, 1 - r * r)) - 0.0015 * r ** 6;
    const row: V3[] = [];
    for (let j = 0; j < AROUND; j++) {
      const q = (j / AROUND) * Math.PI * 2;
      const hx = 16 * Math.sin(q) ** 3;
      const hy = 13 * Math.cos(q) - 5 * Math.cos(2 * q) - 2 * Math.cos(3 * q) - Math.cos(4 * q);
      row.push(P(o[0] + hx * k * r, o[1] + (hy + 2) * k * r, o[2] + lift));
    }
    rows.push(row);
  }
  const behind = P(o[0], o[1] + 2 * k, o[2] - 0.02);
  surface(
    out,
    rows,
    true,
    c,
    behind,
    rows.map(() => behind),
  );
}

/** A round cord along a path, closed at both ends. */
function tube(out: Sink, P: (x: number, y: number, z: number) => V3, path: V3[], r: number, c: THREE.Color): void {
  const n = path.length;
  const rows: V3[][] = [];
  for (let k = 0; k < n; k++) {
    const t = sub(path[Math.min(n - 1, k + 1)], path[Math.max(0, k - 1)]);
    const tl = Math.hypot(t[0], t[1], t[2]) || 1;
    const along: V3 = [t[0] / tl, t[1] / tl, t[2] / tl];
    let side = cross(along, [0, 0, 1]);
    const sl = Math.hypot(side[0], side[1], side[2]);
    side = sl > 1e-6 ? [side[0] / sl, side[1] / sl, side[2] / sl] : [1, 0, 0];
    const up = cross(side, along);
    const row: V3[] = [];
    for (let j = 0; j < 10; j++) {
      const q = (j / 10) * Math.PI * 2;
      const [px, py, pz] = path[k];
      const a = Math.cos(q) * r;
      const b = Math.sin(q) * r;
      row.push(P(px + side[0] * a + up[0] * b, py + side[1] * a + up[1] * b, pz + side[2] * a + up[2] * b));
    }
    rows.push(row);
  }
  rows.unshift(rows[0].map(() => P(...path[0])));
  rows.push(rows[rows.length - 1].map(() => P(...path[n - 1])));
  surface(out, rows, true, c, P(...path[n >> 1]));
}

/**
 * Christ the Redeemer, 30 m of soapstone over its pedestal, measured off a photograph and
 * drawn as smooth surfaces. The body is a tunic falling almost straight, a little wider
 * than deep, in deep tubular pleats below a cord knotted at the waist, its ends hanging down
 * the front, the feet showing under the hem; the Sacred Heart stands out on the chest. Over
 * it the mantle, its folds hanging in curves from shoulder to shoulder across the chest, its
 * edge running down the figure's left side to the knee, and down the back almost to the hem
 * in long folds. The arms are out almost level, 28 m from hand to hand, and each is one
 * piece with its wide sleeve, which hangs lowest at the wrist and rises to meet the body at
 * the waist, folding as it hangs. The hands are open, palms forward. The head is bowed: a
 * long face with a straight nose, deep eyes and a short beard, framed by hair parted in the
 * middle that falls past the cheeks and down behind to the shoulders.
 *
 * It faces the camera's default view (+z) rather than Guanabara Bay, so the cross it makes
 * reads from the start; the arms run along x.
 */
function christ(out: Sink, m: MonumentDef, base: number, yaw: number, c: THREE.Color): void {
  const H = m.height;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // The figure is shaped in shares of its height; P turns that into the world.
  const P = (x: number, y: number, z: number): V3 => [m.x + (x * cos - z * sin) * H, base + y * H, m.y + (x * sin + z * cos) * H];

  // The body, from the hem to the neck.
  const COLS = 128;
  const ROWS = 180;
  const body: V3[][] = [];
  for (let i = 0; i <= ROWS; i++) {
    const y = (NECK * i) / ROWS;
    const W = curve(BODY, y, 1);
    const D = curve(BODY, y, 2);
    const row: V3[] = [];
    for (let j = 0; j < COLS; j++) {
      const a = (j / COLS) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // A rounded box in section, flatter front and back than an ellipse.
      let x = Math.sign(ca) * Math.abs(ca) ** 0.8 * W;
      let z = Math.sign(sa) * Math.abs(sa) ** 0.8 * D;
      const u = x / W;
      let bulge = 0;
      // The mantle over the shoulders and chest, and hanging down the back almost to the hem.
      const mantle = smooth(WAIST + 0.01, WAIST + 0.04, y);
      const cloak = Math.max(0, -sa) ** 0.6 * smooth(0.075, 0.095, y);
      bulge += Math.max(0.008 * mantle, 0.012 * cloak);
      bulge += 0.006 * cloak * Math.abs(Math.cos(a * 9 + 0.25 * Math.sin(y * 9))) ** 0.7 * (1 - 0.6 * mantle);
      // Pleats: rounded ridges with sharp valleys, deeper towards the hem, under the mantle at the back.
      const pleat = 0.004 + 0.011 * (1 - smooth(0.05, WAIST, y));
      bulge += pleat * Math.abs(Math.cos(a * 7)) ** 0.6 * (0.35 + 0.65 * Math.abs(sa)) * (1 - smooth(WAIST - 0.03, WAIST, y)) * (1 - cloak);
      // The tunic's collar, rolled round the base of the neck.
      bulge += 0.004 * Math.exp(-(((y - 0.857) / 0.005) ** 2));
      // The cord round the waist.
      bulge += 0.007 * Math.exp(-(((y - WAIST) / 0.006) ** 2)) * (1 - cloak);
      if (sa > 0) {
        // The mantle's folds across the chest, hanging in curves from shoulder to shoulder.
        for (const sag of [0.05, 0.1, 0.16, 0.22])
          bulge += 0.006 * mantle * sa * Math.exp(-(((y - (0.77 - sag * (1 - 0.55 * u * u))) / 0.011) ** 2));
        // Its edge down the figure's left side (the viewer's right) to the knee.
        const flap = smooth(0.1, 0.22, u) * (1 - smooth(0.62, 0.74, u)) * smooth(0.2, 0.26, y) * (1 - mantle);
        bulge += 0.011 * flap * sa;
      }
      const l = Math.hypot(ca, sa);
      x += (ca / l) * bulge;
      z += (sa / l) * bulge;
      row.push([x, y, z]);
    }
    body.push(row);
  }
  surface(
    out,
    body.map((row) => row.map((p) => P(...p))),
    true,
    c,
    P(0, 0.4, 0),
  );
  // The hem's underside.
  const hem = body[0].map((p) => P(...p));
  for (let j = 1; j < COLS - 1; j++) quad(out, [hem[0], hem[j], hem[j + 1], hem[j + 1]], [0, -1, 0], c);
  // The feet under the hem.
  for (const s of [-1, 1]) ellipsoid(out, P, [s * 0.032, 0.008, 0.07], [0.022, 0.011, 0.034], 0, c);

  // How far forward the robe stands at a point of its front, over the folds there.
  const front = (x: number, y: number) => {
    const row = body[Math.round((y / NECK) * ROWS)];
    let z = 0;
    for (const p of row) if (p[2] > 0 && Math.abs(p[0] - x) < 0.01) z = Math.max(z, p[2]);
    return z;
  };
  // The Sacred Heart on the chest, over the figure's heart.
  const hx = 0.03;
  const hy = 0.7;
  const hz = front(hx, hy) + 0.001;
  heart(out, P, [hx, hy, hz], 0.0013, c);
  // The cord's knot at the waist and its two ends hanging down the front, tasselled.
  ellipsoid(out, P, [0.002, WAIST, front(0.002, WAIST) + 0.003], [0.012, 0.009, 0.007], 0, c);
  for (const [x0, x1, y1] of [
    [0.006, 0.016, 0.3],
    [-0.004, -0.007, 0.335],
  ]) {
    const path: V3[] = [];
    for (let k = 0; k <= 20; k++) {
      const f = k / 20;
      const y = WAIST - 0.006 - f * (WAIST - 0.006 - y1);
      const x = x0 + (x1 - x0) * f + 0.003 * Math.sin(f * 5);
      path.push([x, y, front(x, y) + 0.004]);
    }
    tube(out, P, path, 0.0042, c);
    ellipsoid(out, P, [x1, y1 - 0.012, front(x1, y1 - 0.012) + 0.005], [0.007, 0.016, 0.006], 0, c);
  }

  // The arms and their sleeves, each one surface from inside the shoulder to the cuff, drawn
  // a little shorter than their profile so the hands end 28 m apart as on the real statue.
  const RING = 32;
  const REACH = 0.88;
  const WRIST = 0.1 + (0.425 - 0.1) * REACH;
  for (const s of [-1, 1]) {
    const arm: V3[][] = [];
    const STEPS = 72;
    for (let i = 0; i <= STEPS; i++) {
      const x = 0.1 + ((0.425 - 0.1) * i) / STEPS;
      const ya = armY(x);
      const r = armR(x);
      const low = curve(SLEEVE, x, 1);
      const row: V3[] = [];
      for (let j = 0; j < RING; j++) {
        const phi = (j / RING) * Math.PI * 2;
        const sp = Math.sin(phi);
        const cp = Math.cos(phi);
        let y: number;
        let z: number;
        if (sp >= 0) {
          y = ya + r * sp;
          z = r * cp * 0.92;
        } else {
          // The sleeve: the cloth hangs from the arm to its hem, thinning as it falls, in folds
          // that slant down from the wrist towards the body.
          const t = -sp;
          y = ya - t * (ya - low);
          z = cp * (r * 0.92 * (1 - t) + 0.012 * t);
          z += 0.0035 * t * (1 - 0.4 * t) * Math.sin(x * 75 - t * 5);
          // Its hem ripples as it hangs.
          z += 0.003 * t * t * Math.sin(x * 45);
          y += 0.002 * t * t * Math.cos(x * 38);
        }
        row.push(P(s * (0.1 + (x - 0.1) * REACH), y, z));
      }
      arm.push(row);
    }
    // Close the cuff.
    const cuff = arm[arm.length - 1];
    const mid = cuff.reduce((m, p) => [m[0] + p[0] / RING, m[1] + p[1] / RING, m[2] + p[2] / RING], [0, 0, 0] as V3);
    arm.push(cuff.map(() => mid));
    surface(out, arm, true, c, P(s * (0.1 + 0.2 * REACH), armY(0.3), 0));
    // The open hand, palm forward, about a ninth of the figure from wrist to fingertip as on
    // the real statue: a broad palm, four fingers held together and a little raised, the thumb up.
    const hy = armY(0.45);
    ellipsoid(out, P, [s * (WRIST + 0.03), hy + 0.001, 0.003], [0.036, 0.024, 0.0095], s * 0.06, c);
    for (const [dy, len] of [
      [0.0145, 0.025],
      [0.005, 0.029],
      [-0.0045, 0.028],
      [-0.0135, 0.023],
    ]) {
      const fx = WRIST + 0.043 + len * 0.95;
      ellipsoid(out, P, [s * fx, hy + dy + 0.002, 0.002], [len, 0.0062, 0.0068], s * 0.08, c);
    }
    ellipsoid(out, P, [s * (WRIST + 0.027), hy + 0.024, 0.009], [0.008, 0.017, 0.0075], s * -0.6, c);
  }

  // The head, and the hair over it, bowed together and set so the crown is the figure's top.
  const HEAD_ROWS = 72;
  const AROUND = 80;
  const head: V3[][] = [];
  for (let i = 0; i <= HEAD_ROWS; i++) {
    const t = i / HEAD_ROWS;
    const row: V3[] = [];
    for (let j = 0; j < AROUND; j++) row.push(bow(skull(t, (j / AROUND) * Math.PI * 2), t));
    head.push(row);
  }
  const HAIR_ROWS = 72;
  const locks: V3[][] = [];
  const axis: V3[] = [];
  for (let i = 0; i <= HAIR_ROWS; i++) {
    const t = 1 - (1.12 * i) / HAIR_ROWS;
    const open = curve(OPENING, t, 1);
    const row: V3[] = [];
    for (let j = 0; j < AROUND; j++) {
      const f = j / (AROUND - 1);
      const u = Math.PI / 2 + open + (Math.PI * 2 - 2 * open) * f;
      row.push(bow(hair(t, u, Math.min(f, 1 - f) / 0.06), t));
    }
    locks.push(row);
    axis.push(bow([0, HEAD_Y + t * HEAD_H, 0], t));
  }
  let top = 0;
  for (const row of locks) for (const p of row) top = Math.max(top, p[1]);
  const lift = 1 - top;
  const place = (p: V3) => P(p[0], p[1] + lift, p[2]);
  surface(
    out,
    head.map((row) => row.map(place)),
    true,
    c,
    place([0, 0.92, 0.01]),
  );
  surface(
    out,
    locks.map((row) => row.map(place)),
    false,
    c,
    place([0, 0.92, 0]),
    axis.map(place),
    CREASE * 0.7,
  );
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
