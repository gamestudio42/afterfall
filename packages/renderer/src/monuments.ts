import * as THREE from "three";
import { heightAt, pedestalSide, type CityMap, type MonumentDef } from "@afterfall/world";

/** Christ the Redeemer's soapstone, and the weathered bronze of a city's statues. */
const SOAPSTONE = new THREE.Color(0xd9d5c9);
const BRONZE = new THREE.Color(0x6f7a6c);
const PEDESTAL = new THREE.Color(0x9a958a);

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

/**
 * One monument on the ground under it: a stepped pedestal and the figure on it. A figure is
 * a robed body and a head; Christ the Redeemer's spreads its arms, sleeves hanging, almost
 * as wide as it is tall (28 m across for 30 m high). A column is a shaft with a capital.
 */
function monument(out: Sink, m: MonumentDef, ground: number): void {
  const side = pedestalSide(m);
  const yaw = 0;
  const base = ground + m.pedestal;
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
  const c = m.kind === "open-arms" ? SOAPSTONE : BRONZE;
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
    c,
  );
  if (m.kind === "open-arms") {
    const span = H * 0.47;
    const arm = H * 0.06;
    const y = base + H * 0.76;
    // Arms straight out, and the sleeves hanging under them nearer the body.
    box(out, m.x, m.y, yaw, -span, span, y - arm / 2, y + arm / 2, -arm / 2, arm / 2, c);
    for (const s of [-1, 1])
      box(out, m.x, m.y, yaw, s > 0 ? H * 0.1 : -H * 0.3, s > 0 ? H * 0.3 : -H * 0.1, y - H * 0.13, y, -arm * 0.6, arm * 0.6, c);
  }
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
