import * as THREE from "three";
import type { CityMap } from "@afterfall/world";
import { FLOOR, MODULE, type FacadeArt, type FacadeStyle } from "./buildingBatch";

type RGB = [number, number, number];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

const NIGHT_ZENITH: RGB = [0.02, 0.035, 0.09];
const NIGHT_HORIZON: RGB = [0.07, 0.1, 0.19];
const DAY_ZENITH: RGB = [0.16, 0.36, 0.76];
const DAY_HORIZON: RGB = [0.5, 0.63, 0.78];
const DUSK_HORIZON: RGB = [0.86, 0.5, 0.3];
const GREY: RGB = [0.5, 0.53, 0.57];

/**
 * The sky's two colours for a moment (linear RGB). `daylight` and `dusk` come
 * from the clock, `cloud` from the weather. The horizon colour is also the
 * fog's, so the far ground dissolves into the sky instead of ending at a line.
 */
export function skyColors(daylight: number, dusk: number, cloud: number): { zenith: RGB; horizon: RGB } {
  const d = Math.max(0, Math.min(1, daylight));
  let zenith = mix3(NIGHT_ZENITH, DAY_ZENITH, d);
  let horizon = mix3(NIGHT_HORIZON, DAY_HORIZON, d);
  // Sunrise and sunset warm the horizon, strongest half way through the change.
  const warm = Math.max(0, Math.min(1, dusk)) * (d > 0.05 && d < 0.95 ? 1 - Math.abs(d - 0.5) * 1.2 : 0);
  horizon = mix3(horizon, DUSK_HORIZON, Math.max(0, warm) * 0.75);
  // Cloud takes the blue out and flattens the two toward one grey, scaled by the light left.
  const grey: RGB = [GREY[0] * (0.12 + 0.88 * d), GREY[1] * (0.12 + 0.88 * d), GREY[2] * (0.14 + 0.86 * d)];
  const c = Math.max(0, Math.min(1, cloud)) * 0.8;
  zenith = mix3(zenith, grey, c);
  horizon = mix3(horizon, grey, c * 0.85);
  return { zenith, horizon };
}

/**
 * Whether any sky is in frame: the top of the view has to clear the horizon.
 * `pitch` is the camera's angle below the horizontal and `fov` its vertical
 * field of view, both in radians. At the default pitch the camera only sees
 * ground, and the dome is not drawn at all.
 */
export function skyInView(pitch: number, fov: number): boolean {
  return pitch - fov / 2 < 0.06;
}

/**
 * A dome that follows the camera: gradient, sun or moon with a glow, drifting
 * clouds and stars. It sits on the far plane and is drawn after everything
 * opaque, so its shader only runs on the pixels the city leaves uncovered:
 * drawn first and without a depth test it shaded the whole screen, which cost
 * a software rasteriser 40 ms a frame for a sky nobody could see. It is
 * outside the fog, because it is what the fog fades into.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Vector3() },
        uHorizon: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Vector3(1, 1, 1) },
        uDay: { value: 1 },
        uCloud: { value: 0.25 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDay;
        uniform float uCloud;
        uniform float uTime;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = max(dir.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.32));

          // Sun by day, moon by night: a disc and a wide glow around it.
          float s = max(dot(dir, normalize(uSunDir)), 0.0);
          float disc = smoothstep(0.9994, 0.9998, s);
          float glow = pow(s, 48.0) * 0.5 + pow(s, 6.0) * 0.12;
          col += uSunColor * (disc * mix(1.2, 6.0, uDay) + glow * mix(0.5, 1.0, uDay)) * (1.0 - uCloud * 0.85);

          // Stars, only where the night is dark and the sky is clear.
          vec2 sp = dir.xz / (dir.y + 0.35) * 90.0;
          float star = step(0.9965, hash(floor(sp))) * smoothstep(0.05, 0.3, dir.y);
          col += vec3(0.8, 0.85, 1.0) * star * (1.0 - uDay) * (1.0 - uCloud) * 0.9;

          // Clouds on a plane overhead, drifting; thinner toward the horizon.
          vec2 cp = dir.xz / (dir.y + 0.12) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = fbm(cp);
          float cover = smoothstep(1.0 - uCloud * 0.95, 1.15 - uCloud * 0.6, n + 0.28);
          float lit = mix(0.1, 1.0, uDay);
          vec3 cloudCol = mix(vec3(0.42, 0.45, 0.5), vec3(0.96, 0.97, 1.0), n) * lit * mix(1.0, 0.62, uCloud);
          cloudCol += uSunColor * pow(s, 4.0) * 0.25 * uDay;
          col = mix(col, cloudCol, cover * smoothstep(0.0, 0.18, dir.y));

          // Below the horizon is the fog's colour, so no seam shows under the map's edge.
          col = mix(uHorizon, col, smoothstep(-0.02, 0.03, dir.y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.material);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
  }

  update(
    camera: THREE.Vector3,
    colors: { zenith: RGB; horizon: RGB },
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    daylight: number,
    cloud: number,
    time: number,
  ): void {
    this.mesh.position.copy(camera);
    const u = this.material.uniforms;
    (u.uZenith.value as THREE.Vector3).fromArray(colors.zenith);
    (u.uHorizon.value as THREE.Vector3).fromArray(colors.horizon);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Vector3).set(sunColor.r, sunColor.g, sunColor.b);
    u.uDay.value = daylight;
    u.uCloud.value = cloud;
    u.uTime.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface OutskirtBox {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  shade: number;
  /** Which facade it wears, as the buildings on the map do. */
  style: FacadeStyle;
  /**
   * What stands on its roof: a setback storey or more on a tower, a plant room on a lower
   * block. Its footprint is a share of the block's, centred on it.
   */
  top?: { w: number; d: number; h: number; plant: boolean };
  /** Ground under the box: on a hillside, the map edge's own height, held. */
  y?: number;
  /** Turn about the vertical, so the block lines up with the streets of the map. */
  yaw?: number;
}

/**
 * The way the map's streets run, folded into a quarter turn: a length-weighted mean of
 * every segment's direction (on a grid, the grid's own angle; on an imported map, its
 * main grain). The outskirts' lots are laid out along it.
 */
export function streetGrain(city: CityMap): number {
  let sx = 0;
  let sz = 0;
  for (const r of city.roads) {
    const p = r.path ?? [
      { x: r.rect.x, y: r.rect.y },
      r.horizontal ? { x: r.rect.x + r.rect.w, y: r.rect.y } : { x: r.rect.x, y: r.rect.y + r.rect.h },
    ];
    for (let i = 1; i < p.length; i++) {
      const dx = p[i].x - p[i - 1].x;
      const dz = p[i].y - p[i - 1].y;
      const len = Math.hypot(dx, dz);
      const a = Math.atan2(dz, dx) * 4;
      sx += Math.cos(a) * len;
      sz += Math.sin(a) * len;
    }
  }
  const grain = Math.atan2(sz, sx) / 4;
  // Within a twentieth of a degree of square, it is square.
  return Math.abs(grain) < 1e-3 ? 0 : grain;
}

/** A street of the map carried on past its edge, so the city does not stop at a wall. */
export interface OutskirtStreet {
  x: number;
  z: number;
  /** Unit direction out of the map. */
  dx: number;
  dz: number;
  width: number;
}

/** How far past the map's edge the outskirts start and end, in metres. */
export const OUTSKIRTS_NEAR = 26;
export const OUTSKIRTS_FAR = 340;

/**
 * Where the map's streets leave it: each end on the border, with the street's own
 * direction out of the map. A generated grid's streets are rectangles; an imported or a
 * varied city's are centre lines at any angle.
 */
export function outskirtStreets(city: CityMap): OutskirtStreet[] {
  const out: OutskirtStreet[] = [];
  const edge = 1;
  // With a ring of drawn city round the map (decor), its streets leave at the ring's edge.
  const ring = city.decor?.ring ?? 0;
  const roads = city.decor ? city.decor.roads : city.roads;
  const onBorder = (x: number, z: number) =>
    x < -ring + edge || z < -ring + edge || x > city.width + ring - edge || z > city.height + ring - edge;
  const add = (x: number, z: number, fx: number, fz: number, width: number) => {
    const len = Math.hypot(x - fx, z - fz) || 1;
    if (!onBorder(x, z) || out.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) return;
    out.push({ x, z, dx: (x - fx) / len, dz: (z - fz) / len, width });
  };
  for (const r of roads) {
    if (r.trail) continue;
    if (r.path && r.path.length > 1) {
      const p = r.path;
      const w = r.width ?? 8;
      add(p[0].x, p[0].y, p[1].x, p[1].y, w);
      add(p[p.length - 1].x, p[p.length - 1].y, p[p.length - 2].x, p[p.length - 2].y, w);
    } else if (r.horizontal) {
      const z = r.rect.y + r.rect.h / 2;
      add(r.rect.x, z, r.rect.x + 1, z, r.rect.h);
      add(r.rect.x + r.rect.w, z, r.rect.x + r.rect.w - 1, z, r.rect.h);
    } else {
      const x = r.rect.x + r.rect.w / 2;
      add(x, r.rect.y, x, r.rect.y + 1, r.rect.w);
      add(x, r.rect.y + r.rect.h, x, r.rect.y + r.rect.h - 1, r.rect.w);
    }
  }
  return out;
}

/**
 * The city beyond the playable map: blocks on a loose grid, denser and taller near the
 * edge and thinning out, so the map sits in a city instead of on a lawn. Each wears one of
 * the map's facades in whole storeys; towers step back near the top, and lower blocks
 * carry a plant room. Nothing is placed inside the map, nor along a street that leaves it
 * (the street carries on out, and it is where hordes walk in).
 */
export function placeOutskirts(city: CityMap, seed = 1): OutskirtBox[] {
  const out: OutskirtBox[] = [];
  const pitch = 34;
  const streets = outskirtStreets(city);
  const onStreet = (x: number, z: number, r: number) =>
    streets.some((s) => {
      const t = (x - s.x) * s.dx + (z - s.z) * s.dz;
      if (t < -r) return false;
      const across = Math.abs((x - s.x) * s.dz - (z - s.z) * s.dx);
      return across < s.width / 2 + 3 + r;
    });
  // The lots run along the map's streets: square to the map, a turned city's outskirts
  // stood askew to every street that left it (a playtest report).
  const grain = streetGrain(city);
  const ring = city.decor?.ring ?? 0;
  const cos = Math.cos(grain);
  const sin = Math.sin(grain);
  const mx = city.width / 2;
  const mz = city.height / 2;
  // Square to the map, the lots start at its corner as they always did.
  const far0 = OUTSKIRTS_FAR + ring;
  const ox = grain ? -(Math.hypot(city.width, city.height) / 2 + far0) : -mx - far0;
  const oz = grain ? ox : -mz - far0;
  const nx = Math.ceil((grain ? -ox * 2 : city.width + far0 * 2) / pitch);
  const nz = Math.ceil((grain ? -oz * 2 : city.height + far0 * 2) / pitch);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const pu = ox + (i + 0.5) * pitch;
      const pv = oz + (j + 0.5) * pitch;
      const cx = mx + pu * cos - pv * sin;
      const cz = mz + pu * sin + pv * cos;
      // Distance outside the map's rectangle (and the ring drawn round it); zero or less
      // means inside it.
      const dx = Math.max(-ring - cx, cx - city.width - ring, 0);
      const dz = Math.max(-ring - cz, cz - city.height - ring, 0);
      const dist = Math.hypot(dx, dz);
      if (dist < OUTSKIRTS_NEAR || dist > OUTSKIRTS_FAR) continue;
      const far = (dist - OUTSKIRTS_NEAR) / (OUTSKIRTS_FAR - OUTSKIRTS_NEAR);
      // Thin out with distance: almost every lot near the edge, one in three far away.
      if (hash(i, j, seed) > 0.92 - far * 0.6) continue;
      const w = 12 + hash(i, j, seed + 1) * 14;
      const d = 12 + hash(i, j, seed + 2) * 14;
      const ou = (hash(i, j, seed + 3) - 0.5) * (pitch - w - 4);
      const ov = (hash(i, j, seed + 4) - 0.5) * (pitch - d - 4);
      const x = cx + ou * cos - ov * sin;
      const z = cz + ou * sin + ov * cos;
      // Turned, a block's corner reaches past its half-width: keep it off the map.
      if (grain) {
        const reach = Math.hypot(w, d) / 2;
        if (Math.hypot(Math.max(-ring - x, x - city.width - ring, 0), Math.max(-ring - z, z - city.height - ring, 0)) < reach + 6) continue;
      }
      if (onStreet(x, z, Math.hypot(w, d) / 2)) continue;
      const tall = hash(i, j, seed + 5);
      // Whole storeys and a parapet band, as on the map, so the windows meet the roof.
      const floors = Math.max(2, Math.round(((7 + tall * tall * 44) * (1 - far * 0.45)) / FLOOR));
      const h = floors * FLOOR + 0.6;
      const pick = hash(i, j, seed + 7);
      // Mostly brick and plaster: from the game's camera the office glass reads as stripes.
      const style: FacadeStyle =
        floors >= 7 ? (pick < 0.25 ? "office" : "residential") : pick < 0.7 ? "residential" : pick < 0.82 ? "office" : "industrial";
      const roof = hash(i, j, seed + 8);
      let top: OutskirtBox["top"];
      if (floors >= 7 && roof < 0.6) {
        const k = 0.55 + roof * 0.3;
        top = { w: w * k, d: d * k, h: (2 + Math.floor(roof * 6)) * FLOOR + 0.6, plant: false };
      } else if (roof < 0.45) {
        const k = 0.22 + roof * 0.2;
        top = { w: w * k, d: d * k, h: 2.6, plant: true };
      }
      out.push({
        x,
        z,
        w,
        d,
        h,
        shade: 0.75 + hash(i, j, seed + 6) * 0.25,
        style,
        ...(top ? { top } : {}),
        ...(grain ? { yaw: -grain } : {}),
      });
    }
  }
  return out;
}

/**
 * Tints per facade, in the tone of the map's own buildings: brighter, under the Lambert
 * light the outskirts use, they glared beside the city (a playtest report).
 */
const OUTSKIRT_TINT: Record<FacadeStyle, [number, number, number]> = {
  residential: [0.7, 0.6, 0.52],
  office: [0.6, 0.62, 0.66],
  industrial: [0.64, 0.62, 0.58],
};
const OUTSKIRT_STYLES: FacadeStyle[] = ["residential", "office", "industrial"];

/**
 * World-scaled texture coordinates for a unit box stretched by its instance: a wall takes
 * the facade module across and up (4 bays by 4 floors of 3.2 m), a roof the roof tile.
 * Texture coordinates of a stretched unit box would squeeze a whole facade onto every wall.
 */
function worldUv(mat: THREE.Material, module: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_MAP
        vec3 oskSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 oskP = position * oskSize;
        vec2 oskUv = abs(normal.x) > 0.5 ? vec2(oskP.z * sign(normal.x), oskP.y)
          : abs(normal.z) > 0.5 ? vec2(-oskP.x * sign(normal.z), oskP.y) : oskP.xz;
        vMapUv = oskUv / ${module.toFixed(2)};
      #endif`,
    );
  };
}

/**
 * The outskirts: one instanced box mesh per facade style (walls in the facade, roofs in
 * the roof tile) and plant rooms in bare concrete. No shadows, fogged, a handful of draw
 * calls. The streets out of the map are drawn with the map's own (cityMeshes.ts).
 */
export function buildOutskirts(boxes: OutskirtBox[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "outskirts";
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  worldUv(roofMat, 8);
  roofMat.name = "outskirts-roof";
  for (const style of OUTSKIRT_STYLES) {
    const pieces: { x: number; y: number; z: number; w: number; d: number; h: number; shade: number; yaw: number }[] = [];
    for (const b of boxes) {
      if (b.style !== style) continue;
      const y = b.y ?? 0;
      const yaw = b.yaw ?? 0;
      pieces.push({ x: b.x, y, z: b.z, w: b.w, d: b.d, h: b.h, shade: b.shade, yaw });
      if (b.top && !b.top.plant) pieces.push({ x: b.x, y: y + b.h, z: b.z, w: b.top.w, d: b.top.d, h: b.top.h, shade: b.shade, yaw });
    }
    if (!pieces.length) continue;
    const wall = new THREE.MeshLambertMaterial({ color: 0xffffff });
    wall.name = `outskirts-${style}`;
    worldUv(wall, MODULE);
    // Walls on the four sides, the roof tile on top and underneath.
    const mesh = new THREE.InstancedMesh(geo, [wall, wall, roofMat, roofMat, wall, wall], pieces.length);
    const [tr, tg, tb] = OUTSKIRT_TINT[style];
    pieces.forEach((p, i) => {
      place(m, p.x, p.y, p.z, p.w, p.h, p.d, p.yaw);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setRGB(tr * p.shade, tg * p.shade, tb * p.shade));
    });
    finish(mesh, `outskirts-${style}`);
    mesh.userData.style = style;
    group.add(mesh);
  }
  const plants = boxes.filter((b) => b.top?.plant);
  if (plants.length) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, plants.length);
    plants.forEach((b, i) => {
      place(m, b.x, (b.y ?? 0) + b.h, b.z, b.top!.w, b.top!.h, b.top!.d, b.yaw ?? 0);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setRGB(0.5 * b.shade, 0.49 * b.shade, 0.47 * b.shade));
    });
    finish(mesh, "outskirts-plant");
    group.add(mesh);
  }
  return group;
}

function finish(mesh: THREE.InstancedMesh, name: string): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
}

const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** A unit box's matrix: stretched, turned about the vertical, stood at a point. */
function place(m: THREE.Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number): void {
  m.compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(UP, yaw), tmpS.set(w, h, d));
}

/** Puts the map's facade and roof textures on the outskirts once they have loaded. */
export function setOutskirtsArt(group: THREE.Group, art: Partial<FacadeArt>): void {
  group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshLambertMaterial)) continue;
      const tex = mat.name === "outskirts-roof" ? art.roof : art[`facade_${o.userData.style as FacadeStyle}` as keyof FacadeArt];
      if (!tex || mat.map === tex) continue;
      mat.map = tex;
      mat.needsUpdate = true;
    }
  });
}

/** Frees the outskirts' geometry and materials. */
export function disposeOutskirts(group: THREE.Group): void {
  const seen = new Set<unknown>();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    for (const mat of Array.isArray(o.material) ? o.material : [o.material])
      if (!seen.has(mat)) {
        seen.add(mat);
        mat.dispose();
      }
  });
}
