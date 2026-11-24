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
 * crown, a fingertip) takes its normal from `centre`.
 */
function surface(out: Sink, rows: V3[][], wrap: boolean, c: THREE.Color, centre: V3): void {
  const R = rows.length;
  const C = rows[0].length;
  const mids = rows.map((r) => r.reduce((m, p) => [m[0] + p[0] / C, m[1] + p[1] / C, m[2] + p[2] / C], [0, 0, 0] as V3));
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
      return 1 - Math.min(CREASE_MAX, Math.max(0, cavity * CREASE));
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
  if (x <= keys[0][0]) return keys[0][k];
  for (let i = 0; i < keys.length - 1; i++) {
    const [x0] = keys[i];
    const [x1] = keys[i + 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return keys[i][k] + (keys[i + 1][k] - keys[i][k]) * s;
    }
  }
  return keys[keys.length - 1][k];
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
  [0.832, 0.055, 0.046],
  [0.85, 0.036, 0.036],
];
const NECK = 0.85;
const WAIST = 0.48;

/**
 * The head's half width, and its depth in front and behind, from the base of the neck (0)
 * to the crown (1): the hair falls to the jaw, so it is widest low down, like a hood.
 */
const HEAD = [
  [0, 0.034, 0.034, 0.034],
  [0.15, 0.036, 0.036, 0.04],
  [0.32, 0.05, 0.044, 0.054],
  [0.52, 0.054, 0.048, 0.057],
  [0.72, 0.051, 0.046, 0.054],
  [0.86, 0.041, 0.037, 0.043],
  [0.95, 0.026, 0.022, 0.027],
  [1, 0, 0, 0],
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

/**
 * Christ the Redeemer, 30 m of soapstone over its pedestal, measured off a photograph and
 * drawn as smooth surfaces. The body is a tunic falling almost straight, a little wider
 * than deep, in deep tubular pleats below a cord at the waist, the feet showing under the
 * hem; over it the mantle, its folds hanging in curves from shoulder to shoulder across the
 * chest and its edge running down the figure's left side to the knee. The arms are out
 * almost level, 28 m from hand to hand, and each is one piece with its wide sleeve, which
 * hangs lowest at the wrist and rises to meet the body at the waist, its hem rippling. The
 * hands are open, palms forward. The head is bowed a little, the hair falling to the jaw.
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
  const COLS = 96;
  const rows: V3[][] = [];
  for (let i = 0; i <= 90; i++) {
    const y = (NECK * i) / 90;
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
      // Pleats: rounded ridges with sharp valleys, deeper towards the hem, mostly front and back.
      const pleat = 0.004 + 0.011 * (1 - smooth(0.05, WAIST, y));
      bulge += pleat * Math.abs(Math.cos(a * 7)) ** 0.6 * (0.35 + 0.65 * Math.abs(sa)) * (1 - smooth(WAIST - 0.03, WAIST, y));
      // The cord round the waist.
      bulge += 0.007 * Math.exp(-(((y - WAIST) / 0.006) ** 2));
      // The mantle over the shoulders and chest stands a little proud of the tunic.
      const mantle = smooth(WAIST + 0.01, WAIST + 0.04, y);
      bulge += 0.008 * mantle;
      if (sa > 0) {
        // Its folds across the chest, hanging in curves from shoulder to shoulder.
        for (const sag of [0.05, 0.1, 0.16, 0.22])
          bulge += 0.006 * mantle * sa * Math.exp(-(((y - (0.77 - sag * (1 - 0.55 * u * u))) / 0.011) ** 2));
        // Its edge down the figure's left side (the viewer's right) to the knee.
        const flap = smooth(0.1, 0.22, u) * (1 - smooth(0.62, 0.74, u)) * smooth(0.2, 0.26, y) * (1 - mantle);
        bulge += 0.011 * flap * sa;
      }
      const l = Math.hypot(ca, sa);
      x += (ca / l) * bulge;
      z += (sa / l) * bulge;
      row.push(P(x, y, z));
    }
    rows.push(row);
  }
  surface(out, rows, true, c, P(0, 0.4, 0));
  // The hem's underside.
  const hem = rows[0];
  for (let j = 1; j < COLS - 1; j++) quad(out, [hem[0], hem[j], hem[j + 1], hem[j + 1]], [0, -1, 0], c);
  // The feet under the hem.
  for (const s of [-1, 1]) ellipsoid(out, P, [s * 0.032, 0.008, 0.07], [0.022, 0.011, 0.034], 0, c);

  // The arms and their sleeves, each one surface from inside the shoulder to the cuff, drawn
  // a little shorter than their profile so the hands end 28 m apart as on the real statue.
  const RING = 32;
  const REACH = 0.88;
  const WRIST = 0.1 + (0.425 - 0.1) * REACH;
  for (const s of [-1, 1]) {
    const arm: V3[][] = [];
    const STEPS = 44;
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
          // The sleeve: the cloth hangs from the arm to its hem, thinning as it falls.
          const t = -sp;
          y = ya - t * (ya - low);
          z = cp * (r * 0.92 * (1 - t) + 0.012 * t);
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

  // The head on its neck, bowed forward from the neck, hair falling to the jaw.
  const head: V3[][] = [];
  const bow = 0.17;
  const cb = Math.cos(bow);
  const sb = Math.sin(bow);
  const pivot = [0, 0.83, 0];
  for (let i = 0; i <= 30; i++) {
    // From the base of the neck (0) to the crown (1).
    const t = i / 30;
    const y = 0.83 + t * 0.17;
    const rx = curve(HEAD, t, 1);
    const front = curve(HEAD, t, 2);
    const back = curve(HEAD, t, 3);
    const row: [number, number, number][] = [];
    for (let j = 0; j < 40; j++) {
      const u = (j / 40) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      // The face is narrower than the hair round it.
      const x = cu * rx * (1 - 0.12 * Math.max(0, su) * smooth(0.2, 0.35, t));
      const z = su * (su > 0 ? front : back);
      // Bowed: turned forward round the base of the neck.
      const dy = y - pivot[1];
      row.push([x, pivot[1] + dy * cb - z * sb, z * cb + dy * sb + 0.006]);
    }
    head.push(row);
  }
  // The crown at the figure's full height.
  let top = 0;
  for (const row of head) for (const p of row) top = Math.max(top, p[1]);
  surface(
    out,
    head.map((row) => row.map(([x, y, z]) => P(x, y + 1 - top, z))),
    true,
    c,
    P(0, 0.92, 0.01),
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
