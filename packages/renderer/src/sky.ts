import * as THREE from "three";
import type { CityMap } from "@afterfall/world";

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
 * A dome that follows the camera: gradient, sun or moon with a glow, drifting
 * clouds and stars. Drawn first and without depth, so it is always behind the
 * city, and outside the fog, because it is what the fog fades into.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
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
    this.mesh.renderOrder = -100;
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
}

/** How far past the map's edge the outskirts start and end, in metres. */
export const OUTSKIRTS_NEAR = 26;
export const OUTSKIRTS_FAR = 340;

/**
 * The city beyond the playable map: blocks of plain volumes on a loose grid,
 * denser and taller near the edge and thinning out, so the map sits in a city
 * instead of on a lawn. Nothing is placed inside the map, nor in the corridor
 * where one of its streets leaves it, which is where hordes walk in.
 */
export function placeOutskirts(city: CityMap, seed = 1): OutskirtBox[] {
  const out: OutskirtBox[] = [];
  const pitch = 34;
  // Streets of a generated city are axis-aligned rectangles; keep their lines clear.
  const vertical = city.roads.filter((r) => !r.path && !r.horizontal).map((r) => [r.rect.x - 3, r.rect.x + r.rect.w + 3]);
  const horizontal = city.roads.filter((r) => !r.path && r.horizontal).map((r) => [r.rect.y - 3, r.rect.y + r.rect.h + 3]);
  const overlaps = (lines: number[][], a: number, b: number) => lines.some(([lo, hi]) => a < hi && b > lo);
  const x0 = -OUTSKIRTS_FAR;
  const z0 = -OUTSKIRTS_FAR;
  const nx = Math.ceil((city.width + OUTSKIRTS_FAR * 2) / pitch);
  const nz = Math.ceil((city.height + OUTSKIRTS_FAR * 2) / pitch);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * pitch;
      const cz = z0 + (j + 0.5) * pitch;
      // Distance outside the map's rectangle; zero or less means inside it.
      const dx = Math.max(-cx, cx - city.width, 0);
      const dz = Math.max(-cz, cz - city.height, 0);
      const dist = Math.hypot(dx, dz);
      if (dist < OUTSKIRTS_NEAR || dist > OUTSKIRTS_FAR) continue;
      const far = (dist - OUTSKIRTS_NEAR) / (OUTSKIRTS_FAR - OUTSKIRTS_NEAR);
      // Thin out with distance: almost every lot near the edge, one in three far away.
      if (hash(i, j, seed) > 0.92 - far * 0.6) continue;
      const w = 12 + hash(i, j, seed + 1) * 14;
      const d = 12 + hash(i, j, seed + 2) * 14;
      const x = cx + (hash(i, j, seed + 3) - 0.5) * (pitch - w - 4);
      const z = cz + (hash(i, j, seed + 4) - 0.5) * (pitch - d - 4);
      if (overlaps(vertical, x - w / 2, x + w / 2) && dx === 0) continue;
      if (overlaps(horizontal, z - d / 2, z + d / 2) && dz === 0) continue;
      const tall = hash(i, j, seed + 5);
      const h = (7 + tall * tall * 44) * (1 - far * 0.45);
      out.push({ x, z, w, d, h, shade: 0.75 + hash(i, j, seed + 6) * 0.25 });
    }
  }
  return out;
}

/** The outskirts as one instanced mesh of boxes: one draw call, no shadows, fogged. */
export function buildOutskirts(boxes: OutskirtBox[]): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, boxes.length));
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  boxes.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setRGB(0.42 * b.shade, 0.41 * b.shade, 0.4 * b.shade));
  });
  mesh.count = boxes.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = "outskirts";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}
