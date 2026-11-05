/**
 * Impact visual effects: physics sparks plus a rendered flipbook burst.
 *
 * Reads the same events as the audio (`sim.fx`), so what makes noise also
 * makes sparks. Everything in one InstancedMesh with additive blending: one
 * draw call per system, and the fade comes for free (additive plus colour
 * going to black equals invisible).
 */

import * as THREE from "three";

export type FxKind = "shot" | "melee" | "hit" | "death" | "noise" | "build";

export interface FxEvent {
  seq: number;
  type: string;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
}

interface Burst {
  count: number;
  /** Scale of the flipbook burst, in metres. */
  life: number;
  speed: number;
  size: number;
  lift: number;
  color: THREE.Color;
  spread: number;
}

const BURSTS: Record<string, Burst> = {
  hit: { count: 10, life: 0.52, speed: 6.0, size: 1.5, lift: 2.6, color: new THREE.Color(0xffd27a), spread: Math.PI, sprite: 4.2 },
  melee: { count: 8, life: 0.42, speed: 5.0, size: 1.3, lift: 2.0, color: new THREE.Color(0xe8e2cc), spread: Math.PI, sprite: 3.2 },
  death: { count: 20, life: 0.95, speed: 4.0, size: 2.4, lift: 3.6, color: new THREE.Color(0xb3402f), spread: Math.PI, sprite: 6.4 },
  build: { count: 14, life: 1.15, speed: 2.6, size: 2.8, lift: 4.6, color: new THREE.Color(0xcfc0a8), spread: Math.PI * 0.6, sprite: 5.2 },
  noise: { count: 6, life: 0.8, speed: 2.4, size: 1.8, lift: 1.6, color: new THREE.Color(0xa9b2bc), spread: Math.PI, sprite: 3.6 },
  shot: { count: 4, life: 0.34, speed: 7.0, size: 1.1, lift: 1.0, color: new THREE.Color(0xfff0c0), spread: 0.6, sprite: 2.0 },
};

const MAX_PARTICLES = 720;

/** Grid of the flipbook atlas, and how many of its frames carry the effect. */
const ATLAS_COLS = 6;
const ATLAS_ROWS = 5;
// The render is spent by frame 12 of the atlas: the rest of the sheet is empty,
// and playing it would make the burst vanish halfway through its life.
const ATLAS_ACTIVE = 12;
const MAX_SPRITES = 24;

interface Sprite {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

/** Textura de faisca gerada em canvas: um degrade radial, sem arquivo. */
function sparkTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

export class VfxSystem {
  readonly mesh: THREE.InstancedMesh;
  /**
   * The flipbook bursts: a pool of quads, each one swapping in the geometry that
   * carries its atlas frame. Baking the UVs into a geometry per frame avoids a
   * custom shader, which is one less thing that can fail silently on a driver.
   */
  private pool: THREE.Mesh[] = [];
  private frameTextures: THREE.Texture[] = [];
  private bursts: Sprite[] = [];
  private pin: number | null = null;
  private readonly sceneRef: THREE.Scene;
  private readonly particles: Particle[] = [];
  private readonly cameraQuat = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly scaleVec = new THREE.Vector3();
  private readonly posVec = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private lastSeq = 0;
  private rng = 0x2f6e2b1;

  constructor(scene: THREE.Scene, max = MAX_PARTICLES, atlas: THREE.Texture | null = null) {
    this.sceneRef = scene;
    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = sparkTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    if (atlas) this.setAtlas(atlas);
  }

  /**
   * Gives the system its flipbook. Textures arrive after the first frame, so the
   * pool is built lazily and the atlas can also be handed over later.
   */
  /**
   * Gives the system its flipbook. The atlas is sliced into one texture per
   * frame with `offset` and `repeat`: three then owns the UV convention, so
   * there is no flipY arithmetic to get wrong, and the clones share one image
   * source, so the atlas is uploaded to the GPU once.
   */
  setAtlas(atlas: THREE.Texture | null): void {
    if (!atlas || this.pool.length > 0) return;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.needsUpdate = true;
    for (let f = 0; f < ATLAS_ACTIVE; f++) {
      const cell = atlas.clone();
      cell.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS);
      cell.offset.set((f % ATLAS_COLS) / ATLAS_COLS, 1 - (Math.floor(f / ATLAS_COLS) + 1) / ATLAS_ROWS);
      cell.needsUpdate = true;
      this.frameTextures.push(cell);
    }
    for (let i = 0; i < MAX_SPRITES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.frameTextures[0],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.pool.push(mesh);
      this.sceneRef.add(mesh);
    }
  }

  /** Test hook: pin the burst at a fraction of its life (null resumes). */
  debugPin(fraction: number | null): void {
    this.pin = fraction;
  }

  /** Quantas particulas estao vivas agora (util para teste e diagnostico). */
  get active(): number {
    return this.particles.length;
  }

  /** Consome os efeitos novos da simulacao e cria as particulas. */
  emit(events: readonly FxEvent[]): void {
    for (const fx of events) {
      if (fx.seq <= this.lastSeq) continue;
      this.lastSeq = fx.seq;
      const burst = BURSTS[fx.type];
      if (!burst) continue;
      if (this.pool.length > 0 && this.bursts.length < MAX_SPRITES) {
        this.bursts.push({
          x: fx.x,
          y: 1.05,
          z: fx.y,
          age: 0,
          life: burst.life,
          size: burst.sprite,
          r: burst.color.r,
          g: burst.color.g,
          b: burst.color.b,
        });
      }
      for (let i = 0; i < burst.count; i++) {
        if (this.particles.length >= MAX_PARTICLES) break;
        const angle = (this.next() - 0.5) * 2 * Math.PI;
        const speed = burst.speed * (0.45 + this.next() * 0.9);
        this.particles.push({
          x: fx.x + (this.next() - 0.5) * burst.spread,
          y: 1.1 + this.next() * 0.9,
          z: fx.y + (this.next() - 0.5) * burst.spread,
          vx: Math.cos(angle) * speed,
          vy: burst.lift * (0.4 + this.next() * 0.9),
          vz: Math.sin(angle) * speed,
          life: burst.life * (0.7 + this.next() * 0.6),
          maxLife: burst.life,
          size: burst.size * (0.6 + this.next() * 0.8),
          r: burst.color.r,
          g: burst.color.g,
          b: burst.color.b,
        });
      }
    }
  }

  /** Integra, gira para a camera e escreve as matrizes de instancia. */
  update(dt: number, camera: THREE.Camera): void {
    // Physics uses a clamped step (no jumps), but lifetime consumes real time:
    // coming back from a background tab leaves no ghost on screen.
    const step = Math.min(dt, 0.1);
    camera.getWorldQuaternion(this.cameraQuat);
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.z += p.vz * step;
      p.vy -= 9.4 * step;
      p.vx *= 1 - 2.2 * step;
      p.vz *= 1 - 2.2 * step;

      const t = Math.max(0, Math.min(1, p.life / p.maxLife));
      this.posVec.set(p.x, p.y, p.z);
      this.scaleVec.setScalar(p.size * (0.5 + t * 0.9));
      this.matrix.compose(this.posVec, this.cameraQuat, this.scaleVec);
      this.mesh.setMatrixAt(w, this.matrix);
      // Additive: the colour going to zero is the fade.
      this.color.setRGB(p.r * t, p.g * t, p.b * t);
      this.mesh.setColorAt(w, this.color);
      this.particles[w] = p;
      w += 1;
    }
    this.particles.length = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    for (const mesh of this.pool) mesh.visible = false;
    let sw = 0;
    for (const b of this.bursts) {
      b.age = this.pin === null ? b.age + dt : b.life * this.pin;
      if (b.age >= b.life) continue;
      const mesh = this.pool[sw];
      if (!mesh) break;
      const t = b.age / b.life;
      mesh.visible = true;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const frame = this.frameTextures[Math.min(ATLAS_ACTIVE - 1, Math.floor(t * ATLAS_ACTIVE))];
      if (mat.map !== frame) {
        mat.map = frame;
        mat.needsUpdate = true;
      }
      this.posVec.set(b.x, b.y + t * 0.4, b.z);
      mesh.position.copy(this.posVec);
      mesh.quaternion.copy(this.cameraQuat);
      mesh.scale.setScalar(b.size * (0.6 + t * 1.1));
      // The render ends white-hot and dies out; the tint carries the event and
      // the additive blend does the fade.
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      // The atlas carries its own white-hot colour; tinting it with the event
      // colour turned a spark into a dull red dot, so the sprite stays warm and
      // only the fade moves.
      mat.color.setRGB(1.0 * fade, 0.94 * fade, 0.82 * fade);
      this.bursts[sw] = b;
      sw++;
    }
    this.bursts.length = sw;
  }

  /** Gerador barato e deterministico (mesma sequencia em todo cliente). */
  private next(): number {
    this.rng ^= this.rng << 13;
    this.rng ^= this.rng >>> 17;
    this.rng ^= this.rng << 5;
    return ((this.rng >>> 0) % 10000) / 10000;
  }
}
