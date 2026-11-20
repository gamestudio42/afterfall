import * as THREE from "three";
import { heightAt, type TerrainDef } from "@afterfall/world";

/**
 * Gunfire noise: a line on the ground that opens to the radius that pulls infected toward
 * a shot (45 m for a pistol, 70 m for a rifle), holds there a moment so the reach can be
 * read, and fades.
 *
 * It replaced a flipbook of a white wave stretched over the whole radius. Scaled to 90 or
 * 140 m, the sheet's stroke became a blurred band several metres wide, drawn additively,
 * and from a low camera its near side swept across the screen like a shockwave every
 * second of a fight. This is a line drawn in the shader: about two pixels wide at any
 * distance, a warning amber blended over the ground rather than added to it, and one ring
 * per spot every couple of seconds however fast the shots come.
 */

/** Seconds a ring lives: it opens over the first part, then holds and fades. */
export const RING_LIFE = 1.6;
/** Share of the life spent opening. */
const OPEN = 0.45;
/** Most rings alive at once. */
export const RING_CAP = 3;
/** A new ring is dropped if one started within this many metres... */
export const RING_MERGE = 10;
/** ...less than this many seconds ago. */
export const RING_QUIET = 2.5;
/** Just over the ground decals, under everything that stands. */
const RING_Y = 0.14;

/** Radius as a share of the full reach, at a share of the ring's life. */
export function ringOpen(t: number): number {
  const k = Math.max(0, Math.min(1, t / OPEN));
  return 1 - (1 - k) ** 3;
}

/** Opacity at a share of the ring's life: steady while it opens, then a fade at full reach. */
export function ringAlpha(t: number): number {
  if (t >= 1) return 0;
  if (t <= OPEN) return 0.8;
  const k = (t - OPEN) / (1 - OPEN);
  return 0.8 * (1 - k) * (1 - k);
}

export interface NoiseRing {
  x: number;
  z: number;
  /** Full reach in metres. */
  radius: number;
  age: number;
}

const VERTEX = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = (uv - 0.5) * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uReach;
  uniform float uOpen;
  uniform float uAlpha;
  uniform vec3 uColor;
  varying vec2 vLocal;
  void main() {
    float d = length(vLocal) * uReach;
    float r = uOpen * uReach;
    // A line about two pixels wide wherever it is on screen: the width follows how many
    // metres a pixel covers here, so the near side does not swell into a band.
    float px = max(fwidth(d), 1e-4);
    float line = 1.0 - smoothstep(px * 0.9, px * 2.0, abs(d - r));
    // A thin shade just inside the line, so it reads as the edge of an area.
    float inside = step(d, r) * (1.0 - smoothstep(0.0, 2.5, r - d)) * 0.22;
    float a = (line + inside) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class NoiseRings {
  readonly group = new THREE.Group();
  readonly rings: NoiseRing[] = [];
  /** When and where recent rings started, alive or not, for the quiet period. */
  private recent: { x: number; z: number; at: number }[] = [];
  private clock = 0;
  private pin: number | null = null;
  private readonly meshes: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  /** Which ring each mesh's vertices were laid over, so a hillside is draped once per ring. */
  private draped: (NoiseRing | null)[] = [];
  private terrain: TerrainDef | undefined;

  /** On a hillside a ring lies over the ground; on a flat map it is one flat quad. */
  setGround(terrain: TerrainDef | undefined): void {
    this.terrain = terrain;
    this.draped = this.meshes.map(() => null);
    const segments = terrain ? 40 : 1;
    for (const m of this.meshes) {
      m.geometry.dispose();
      const geo = new THREE.PlaneGeometry(1, 1, segments, segments);
      geo.rotateX(-Math.PI / 2);
      m.geometry = geo;
    }
  }

  constructor() {
    this.group.name = "noise-rings";
    for (let i = 0; i < RING_CAP; i++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uReach: { value: 1 },
          uOpen: { value: 0 },
          uAlpha: { value: 0 },
          uColor: { value: new THREE.Color(1.0, 0.72, 0.32) },
        },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Starts a ring, unless one started nearby a moment ago or too many are alive. */
  push(x: number, z: number, radius: number): void {
    if (!(radius > 0)) return;
    this.recent = this.recent.filter((r) => this.clock - r.at < RING_QUIET);
    if (this.recent.some((r) => Math.hypot(r.x - x, r.z - z) < RING_MERGE)) return;
    if (this.rings.length >= RING_CAP) return;
    this.recent.push({ x, z, at: this.clock });
    this.rings.push({ x, z, radius, age: 0 });
  }

  /** Test and capture hook: hold every ring at a share of its life (null resumes). */
  debugPin(fraction: number | null): void {
    this.pin = fraction;
  }

  update(dt: number): void {
    this.clock += dt;
    let w = 0;
    for (const ring of this.rings) {
      if (this.pin === null) ring.age += dt;
      const t = this.pin ?? ring.age / RING_LIFE;
      if (t >= 1) continue;
      const mesh = this.meshes[w];
      mesh.visible = true;
      mesh.position.set(ring.x, RING_Y, ring.z);
      mesh.scale.set(ring.radius * 2, 1, ring.radius * 2);
      if (this.terrain && this.draped[w] !== ring) {
        // Each vertex takes the ground under it (the quad's y is not scaled).
        const p = mesh.geometry.getAttribute("position");
        for (let k = 0; k < p.count; k++)
          p.setY(k, heightAt(this.terrain, ring.x + p.getX(k) * ring.radius * 2, ring.z + p.getZ(k) * ring.radius * 2));
        p.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
        this.draped[w] = ring;
      }
      const u = mesh.material.uniforms;
      u.uReach.value = ring.radius;
      u.uOpen.value = ringOpen(t);
      u.uAlpha.value = ringAlpha(t);
      this.rings[w] = ring;
      w++;
    }
    this.rings.length = w;
    for (let i = w; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }

  /** How many rings are drawn now. */
  get visible(): number {
    return this.meshes.filter((m) => m.visible).length;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
