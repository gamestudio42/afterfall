import * as THREE from "three";
import type { CityMap } from "@afterfall/world";
import { inflate } from "./buildingBatch";
import { distanceField, type ReclamationField } from "./reclamation";

/** Seconds of water motion, shared by every water material: the renderer advances it. */
export const WATER_TIME = { value: 0 };

/** How far from the bank the water reaches its full depth colour, in metres. */
export const SHORE_REACH = 24;

/**
 * Distance from each water texel to the nearest bank, 0 to 1 over `SHORE_REACH` metres, in
 * the red channel of a texture laid over the same rectangle as the reclamation field.
 *
 * The river is clipped at the map's edge, but it does not end there: past the edge the
 * field has no water, and read as it is the river would grow a bank along the border.
 * Each texel outside the map takes the water of the nearest one inside it.
 */
export function shoreDistance(f: ReclamationField, city: CityMap): Float32Array {
  const land = new Uint8Array(f.cols * f.rows);
  const maxC = Math.floor((city.width - f.x0) / f.cell) - 1;
  const maxR = Math.floor((city.height - f.z0) / f.cell) - 1;
  const minC = Math.ceil(-f.x0 / f.cell);
  const minR = Math.ceil(-f.z0 / f.cell);
  for (let r = 0; r < f.rows; r++)
    for (let c = 0; c < f.cols; c++) {
      const cc = Math.min(maxC, Math.max(minC, c));
      const rr = Math.min(maxR, Math.max(minR, r));
      // The river runs on under a bridge: its banks are where the water ends, not the deck.
      land[r * f.cols + c] = (f.wet ?? f.water)[rr * f.cols + cc] ? 0 : 1;
    }
  const d = distanceField(land, f.cols, f.rows);
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = Math.min(1, (d[i] * f.cell) / SHORE_REACH);
  return out;
}

export function shoreTexture(f: ReclamationField, city: CityMap): THREE.DataTexture {
  const d = shoreDistance(f, city);
  const data = new Uint8Array(d.length * 4);
  for (let i = 0; i < d.length; i++) {
    data[i * 4] = Math.round(d[i] * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, f.cols, f.rows, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A river that has not been dredged in years: dark and green in the middle, silty and
 * lighter along the banks, a lap of brighter water against the quay, and a surface that
 * moves. The ripples are a sum of a few travelling sines turned into a normal, so the sun
 * glints off them and, where the sky environment is on, the sky shows in them; there is
 * no reflection pass and no extra texture fetch beyond the shore distance.
 */
export function waterMaterial(f: ReclamationField, shore: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0 });
  const rect = new THREE.Vector4(f.x0, f.z0, 1 / (f.cols * f.cell), 1 / (f.rows * f.cell));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = WATER_TIME;
    shader.uniforms.uShore = { value: shore };
    shader.uniforms.uShoreRect = { value: rect };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWaterPos;
        uniform float uWaterTime;
        uniform sampler2D uShore;
        uniform vec4 uShoreRect;
        float shoreAt(vec2 p) { return texture2D(uShore, (p - uShoreRect.xy) * uShoreRect.zw).r; }
        // Slope of the surface: travelling sines at a few scales and headings, the long ones
        // drifting downstream, the short ones a chop that never repeats in view.
        vec2 ripple(vec2 p, float t) {
          vec2 g = vec2(0.0);
          // Headings and lengths that share no common period, so no band lines up across
          // the river; the longest swell is the weakest, which keeps it from reading as stripes.
          g += vec2(0.47, 0.29) * cos(dot(p, vec2(0.47, 0.29)) + t * 0.9) * 0.22;
          g += vec2(-0.37, 0.61) * cos(dot(p, vec2(-0.37, 0.61)) - t * 1.3) * 0.22;
          g += vec2(1.13, -0.83) * cos(dot(p, vec2(1.13, -0.83)) + t * 2.1) * 0.2;
          g += vec2(-1.57, -1.21) * cos(dot(p, vec2(-1.57, -1.21)) - t * 2.7) * 0.16;
          g += vec2(2.31, 1.93) * cos(dot(p, vec2(2.31, 1.93)) + t * 3.3) * 0.1;
          g += vec2(-3.17, 2.73) * cos(dot(p, vec2(-3.17, 2.73)) - t * 4.1) * 0.07;
          return g;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float shore = shoreAt(vWaterPos.xz);
        float deep = smoothstep(0.0, 0.5, shore);
        // Murky green by the walls, darker and colder where it is deep.
        vec3 silt = vec3(0.12, 0.15, 0.12);
        vec3 body = vec3(0.045, 0.10, 0.11);
        diffuseColor.rgb = mix(silt, body, deep);
        // The lap against the quay: a pale line that comes and goes with the swell.
        float lap = 1.0 - smoothstep(0.0, 0.02, shore);
        float swell = 0.5 + 0.5 * sin(uWaterTime * 1.7 + (vWaterPos.x + vWaterPos.z) * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.28, 0.25), lap * (0.3 + 0.3 * swell));`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Calmer near the bank, where the quay breaks the chop.
          float calm = 0.35 + 0.65 * smoothstep(0.0, 0.4, shoreAt(vWaterPos.xz));
          vec2 slope = ripple(vWaterPos.xz * 0.9, uWaterTime) * 0.06 * calm;
          vec3 world = normalize(vec3(-slope.x, 1.0, -slope.y));
          normal = normalize((viewMatrix * vec4(world, 0.0)).xyz);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "afterfall-water";
  return mat;
}

type Pt = { x: number; y: number };

/** Height of the stone coping along a bank, and how far it reaches inland. */
const QUAY_TOP = 0.16;
const QUAY_WIDTH = 1.5;

/**
 * Stone along the banks: a coping strip on the land side of each edge of a water outline,
 * and its face down to the water. Not where the edge runs along the map's border (that is
 * where the river was cut, not where it ends), not where a street or a bridge meets the
 * water, and not along an island's shore — only the outer banks are quays.
 */
export function quayGeometry(city: CityMap, f: ReclamationField): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const at = (x: number, z: number) => {
    const c = Math.floor((x - f.x0) / f.cell);
    const r = Math.floor((z - f.z0) / f.cell);
    if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return -1;
    return r * f.cols + c;
  };
  const isWater = (x: number, z: number) => {
    const i = at(x, z);
    return i >= 0 && f.water[i] === 1;
  };
  const isRoad = (x: number, z: number) => {
    const i = at(x, z);
    return i >= 0 && f.road[i] === 1;
  };
  const onBorder = (a: Pt, b: Pt) => {
    const e = 0.75;
    const edge = (v: number, max: number) => v < e || v > max - e;
    return (
      (edge(a.x, city.width) && edge(b.x, city.width) && Math.abs(a.x - b.x) < e) ||
      (edge(a.y, city.height) && edge(b.y, city.height) && Math.abs(a.y - b.y) < e)
    );
  };
  const quad = (p: number[][], n: number[]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...p[k]);
      nrm.push(...n);
    }
  };
  for (const w of city.waters ?? []) {
    if (!w.polygon) continue;
    const ring = w.polygon;
    // The outer edge of the coping is the outline grown by the quay's width, mitred at
    // every corner, so the stones of two edges meet instead of leaving a notch between them.
    const outer = inflate(ring, QUAY_WIDTH);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const A = outer[i];
      const B = outer[(i + 1) % ring.length];
      if (onBorder(a, b)) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      // Towards the land, square to this edge.
      let nx = (A.x + B.x - a.x - b.x) / 2;
      let nz = (A.y + B.y - a.y - b.y) / 2;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      // In steps of about two metres, so a street crossing the bank cuts the coping.
      const steps = Math.max(1, Math.round(len / 2));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const lerp = (p: Pt, q: Pt, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        const p0 = lerp(a, b, t0);
        const p1 = lerp(a, b, t1);
        const q0 = lerp(A, B, t0);
        const q1 = lerp(A, B, t1);
        const cx = (p0.x + p1.x + q0.x + q1.x) / 4;
        const cz = (p0.y + p1.y + q0.y + q1.y) / 4;
        if (isRoad(cx, cz) || isWater(cx + nx * QUAY_WIDTH, cz + nz * QUAY_WIDTH)) continue;
        const o0 = [q0.x, QUAY_TOP, q0.y];
        const o1 = [q1.x, QUAY_TOP, q1.y];
        const e0 = [p0.x, QUAY_TOP, p0.y];
        const e1 = [p1.x, QUAY_TOP, p1.y];
        quad(windUp([e0, e1, o1, o0]), [0, 1, 0]);
        // The face down to the water, looking out over it.
        quad(windTo([e0, e1, [p1.x, -0.05, p1.y], [p0.x, -0.05, p0.y]], [-nx, 0, -nz]), [-nx, 0, -nz]);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  worldUvOf(g);
  return g;
}

/** Deck surface height: above the water, under the road ribbons laid over it. */
const DECK_Y = 0.03;
const PARAPET_H = 1.05;
const PARAPET_T = 0.45;

/**
 * Bridge decks as their outline (`man_made=bridge`), with a parapet along every stretch of
 * the outline that stands over water. Where the deck meets the bank it stays open, so the
 * street runs on and off it.
 */
export function bridgeGeometry(
  city: CityMap,
  f: ReclamationField,
): { deck: THREE.BufferGeometry; parapet: THREE.BufferGeometry | null } | null {
  if (!city.bridges?.length) return null;
  const decks: THREE.BufferGeometry[] = [];
  const pos: number[] = [];
  const nrm: number[] = [];
  const waterAt = (x: number, z: number) => {
    const c = Math.floor((x - f.x0) / f.cell);
    const r = Math.floor((z - f.z0) / f.cell);
    return c >= 0 && r >= 0 && c < f.cols && r < f.rows && f.water[r * f.cols + c] === 1;
  };
  for (const br of city.bridges) {
    const shape = new THREE.Shape(br.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, DECK_Y, 0);
    decks.push(g.index ? g.toNonIndexed() : g);
    const ring = br.polygon;
    const ccw = signedArea(ring) > 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.3) continue;
      const dx = (b.x - a.x) / len;
      const dz = (b.y - a.y) / len;
      // Outward normal of the outline in map coordinates.
      const nx = ccw ? dz : -dz;
      const nz = ccw ? -dx : dx;
      const steps = Math.max(1, Math.round(len / 2));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
        const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
        const mx = (p0.x + p1.x) / 2;
        const mz = (p0.y + p1.y) / 2;
        if (!waterAt(mx + nx * 2, mz + nz * 2)) continue;
        const ix = -nx * PARAPET_T;
        const iz = -nz * PARAPET_T;
        const top = DECK_Y + PARAPET_H;
        const o0 = [p0.x, top, p0.y];
        const o1 = [p1.x, top, p1.y];
        const i0 = [p0.x + ix, top, p0.y + iz];
        const i1 = [p1.x + ix, top, p1.y + iz];
        const push = (quadPts: number[][], n: number[]) => {
          for (const k of [0, 1, 2, 0, 2, 3]) {
            pos.push(...quadPts[k]);
            nrm.push(...n);
          }
        };
        // Outer face reaches down to the water, so the deck has an edge seen from the side.
        push(windTo([[p0.x, -0.05, p0.y], [p1.x, -0.05, p1.y], o1, o0], [nx, 0, nz]), [nx, 0, nz]);
        push(windTo([[p0.x + ix, DECK_Y, p0.y + iz], [p1.x + ix, DECK_Y, p1.y + iz], i1, i0], [-nx, 0, -nz]), [-nx, 0, -nz]);
        push(windUp([o0, o1, i1, i0]), [0, 1, 0]);
      }
    }
  }
  const deck = mergeFlat(decks);
  worldUvOf(deck);
  let parapet: THREE.BufferGeometry | null = null;
  if (pos.length) {
    parapet = new THREE.BufferGeometry();
    parapet.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    parapet.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    worldUvOf(parapet);
  }
  return { deck, parapet };
}

function mergeFlat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let at = 0;
  for (const p of parts) {
    pos.set(p.getAttribute("position").array as Float32Array, at * 3);
    nrm.set(p.getAttribute("normal").array as Float32Array, at * 3);
    at += p.getAttribute("position").count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return g;
}

/** UVs from world x and z (or height on walls), in metres over three. */
function worldUvOf(g: THREE.BufferGeometry): void {
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const flat = Math.abs(n.getY(i)) > 0.7;
    uv[i * 2] = (flat ? p.getX(i) : p.getX(i) + p.getZ(i)) / 3;
    uv[i * 2 + 1] = (flat ? p.getZ(i) : p.getY(i)) / 3;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Orders a quad so it faces up. */
function windUp(q: number[][]): number[][] {
  return windTo(q, [0, 1, 0]);
}

/** Orders a quad (a, b, c, d) so its first triangle's normal points along `n`. */
function windTo(q: number[][], n: number[]): number[][] {
  const [a, b, c] = q;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1];
  const cy = e1[2] * e2[0] - e1[0] * e2[2];
  const cz = e1[0] * e2[1] - e1[1] * e2[0];
  return cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? q : [q[0], q[3], q[2], q[1]];
}

function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
