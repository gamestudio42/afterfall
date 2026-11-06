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
  /** Radius in metres, for events that cover an area (noise). */
  r?: number;
}

interface Burst {
  count: number;
  /** Scale of the flipbook burst, in metres. */
  sprite: number;
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

/**
 * Muzzle flash flipbook (`tools/effectcraft/muzzle_flash.build.json`): four
 * frames in a row, every one of them carrying the flash, so the whole strip plays.
 */
const MUZZLE_COLS = 4;
const MUZZLE_ROWS = 1;
const MUZZLE_ACTIVE = 4;
/** A flash is over in about a tenth of a second; four frames at ~36 fps. */
const MUZZLE_LIFE = 0.11;
const MUZZLE_SIZE = 2.6;
/** Metres from the shooter toward the target, so the flash sits at the barrel. */
const MUZZLE_REACH = 0.9;
const MUZZLE_HEIGHT = 1.45;

/**
 * Infected strike (`tools/effectcraft/melee_swipe.build.json`): three claw
 * streaks raked diagonally, seven frames of a 0.27 s render in a row. It sits on
 * the victim, pulled a little toward the attacker, and every other strike is
 * mirrored so a sustained attack does not stamp the same slash.
 */
const MELEE_COLS = 7;
const MELEE_ROWS = 1;
const MELEE_ACTIVE = 7;
const MELEE_LIFE = 0.24;
const MELEE_SIZE = 3.4;
/** Metres from the victim back toward the attacker. */
const MELEE_REACH = 0.5;
const MELEE_HEIGHT = 1.15;

/**
 * Clouds: flipbooks of dust or smoke that blend normally, because dark or
 * dull colours add nothing in an additive pass. Each replaces the spark and the
 * physics particles of its event once its sheet has loaded.
 *
 * - death (`tools/effectcraft/death_burst.build.json`): dust and dried blood,
 *   every other frame of a 0.53 s render, 4 by 2.
 * - build (`tools/effectcraft/build_dust.build.json`): pale dust rolling low
 *   and wide with a few chips kicked up, twelve frames of a 0.7 s render, 4 by 3
 *   at 96 px. The event fires every 15 ticks for every worker on any task, so
 *   it is capped: a busy site must not take the slots shots and deaths need.
 *   The render sits in the lower half of its frame, so the quad stands higher
 *   than the death cloud's: at 0.7 m the ground cut the dust off flat.
 */
/**
 * Noise ring (`tools/effectcraft/noise_ring.build.json`): a wave and a fainter
 * echo spreading over the ground to the radius that pulls infected toward a
 * shot, 45 m for a pistol and 70 m for a rifle. Eight frames of a 1 s render,
 * 4 by 2 at 192 px. The ring is drawn by growing the shape, not the layer, so
 * the stroke stays thin at full size.
 *
 * It lies flat, and every shot in a fight fires one, so a ring is dropped
 * when another is still spreading from nearby, and at most a few are alive.
 * Without its sheet a noise draws nothing: it never had a spark of its own.
 */
const RING_COLS = 4;
const RING_ROWS = 2;
const RING_FRAMES = 8;
const RING_LIFE = 1.0;
/** The last frame's ring spans 496 of the 512 px it was rendered in. */
const RING_FILL = 496 / 512;
const RING_HEIGHT = 0.12;
const RING_CAP = 3;
/** A ring is dropped while another one spreads from within this many metres. */
const RING_MERGE = 10;
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

interface Cloud {
  cols: number;
  rows: number;
  frames: number;
  life: number;
  size: number;
  height: number;
  /** Most of these alive at once; further events are dropped. */
  cap: number;
}

const CLOUDS: Record<"death" | "build", Cloud> = {
  death: { cols: 4, rows: 2, frames: 8, life: 0.6, size: 6.4, height: 0.9, cap: MAX_SPRITES },
  build: { cols: 4, rows: 3, frames: 12, life: 0.75, size: 5.2, height: 1.6, cap: 6 },
};
type CloudKind = keyof typeof CLOUDS;

interface Sprite {
  /** The frames this burst plays: the spark sheet, or a strip or cloud sheet. */
  frames: THREE.Texture[];
  /**
   * spark: additive, rises, grows and fades in code. flash (muzzle, strike):
   * additive and still, the strip fades itself. smoke: normal blending, still,
   * faded by opacity. ring: additive and flat on the ground.
   */
  look: "spark" | "flash" | "smoke" | "ring";
  /** Mirrored horizontally, so repeated strikes alternate their slash. */
  flip?: boolean;
  /** Which cloud this is, so its cap can be counted. */
  cloud?: CloudKind;
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

function isCloud(type: string): type is CloudKind {
  return type in CLOUDS;
}

/** Slices a flipbook sheet into one texture per frame, left to right, top to bottom. */
function sliceAtlas(atlas: THREE.Texture, cols: number, rows: number, active: number): THREE.Texture[] {
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  const frames: THREE.Texture[] = [];
  for (let f = 0; f < active; f++) {
    const cell = atlas.clone();
    cell.repeat.set(1 / cols, 1 / rows);
    cell.offset.set((f % cols) / cols, 1 - (Math.floor(f / cols) + 1) / rows);
    cell.needsUpdate = true;
    frames.push(cell);
  }
  return frames;
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
  /** Exposed for the capture spec: it counts the visible quads. */
  pool: THREE.Mesh[] = [];
  private frameTextures: THREE.Texture[] = [];
  private muzzleFrames: THREE.Texture[] = [];
  private meleeFrames: THREE.Texture[] = [];
  private ringFrames: THREE.Texture[] = [];
  private strikes = 0;
  private cloudFrames: Partial<Record<CloudKind, THREE.Texture[]>> = {};
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
   * Gives the system its flipbook. The atlas is sliced into one texture per
   * frame with `offset` and `repeat`: three then owns the UV convention, so
   * there is no flipY arithmetic to get wrong, and the clones share one image
   * source, so the atlas is uploaded to the GPU once. Textures arrive after the
   * first frame, so the pool is built lazily.
   */
  setAtlas(atlas: THREE.Texture | null): void {
    if (!atlas || this.frameTextures.length > 0) return;
    this.frameTextures = sliceAtlas(atlas, ATLAS_COLS, ATLAS_ROWS, ATLAS_ACTIVE);
    this.ensurePool();
  }

  /**
   * Gives shots their own flash. Without it a shot falls back to the spark
   * burst, which is what every shot looked like before.
   */
  setMuzzleAtlas(atlas: THREE.Texture | null): void {
    if (!atlas || this.muzzleFrames.length > 0) return;
    this.muzzleFrames = sliceAtlas(atlas, MUZZLE_COLS, MUZZLE_ROWS, MUZZLE_ACTIVE);
    this.ensurePool();
  }

  /**
   * Gives infected strikes their claw slash. Without it a strike falls back to
   * the spark burst.
   */
  setMeleeAtlas(atlas: THREE.Texture | null): void {
    if (!atlas || this.meleeFrames.length > 0) return;
    this.meleeFrames = sliceAtlas(atlas, MELEE_COLS, MELEE_ROWS, MELEE_ACTIVE);
    this.ensurePool();
  }

  /** Whether strikes already play their own slash. */
  get meleeReady(): boolean {
    return this.meleeFrames.length > 0;
  }

  /** Gives gunfire noise its ring. Without it a noise draws nothing. */
  setNoiseAtlas(atlas: THREE.Texture | null): void {
    if (!atlas || this.ringFrames.length > 0) return;
    this.ringFrames = sliceAtlas(atlas, RING_COLS, RING_ROWS, RING_FRAMES);
    this.ensurePool();
  }

  /** Whether noise already draws its ring. */
  get noiseReady(): boolean {
    return this.ringFrames.length > 0;
  }

  /** Gives deaths their dark cloud. Without it a death plays the spark burst. */
  setDeathAtlas(atlas: THREE.Texture | null): void {
    this.setCloudAtlas("death", atlas);
  }

  /** Gives construction its dust. Without it a work tick plays the spark burst. */
  setDustAtlas(atlas: THREE.Texture | null): void {
    this.setCloudAtlas("build", atlas);
  }

  /** Whether deaths already play their own cloud (the sheet loads asynchronously). */
  get deathReady(): boolean {
    return !!this.cloudFrames.death;
  }

  /** Whether construction already plays its dust. */
  get dustReady(): boolean {
    return !!this.cloudFrames.build;
  }

  private setCloudAtlas(kind: CloudKind, atlas: THREE.Texture | null): void {
    if (!atlas || this.cloudFrames[kind]) return;
    const c = CLOUDS[kind];
    this.cloudFrames[kind] = sliceAtlas(atlas, c.cols, c.rows, c.frames);
    this.ensurePool();
  }

  private ensurePool(): void {
    if (this.pool.length > 0) return;
    const first =
      this.frameTextures[0] ??
      this.muzzleFrames[0] ??
      this.meleeFrames[0] ??
      this.ringFrames[0] ??
      this.cloudFrames.death?.[0] ??
      this.cloudFrames.build?.[0];
    for (let i = 0; i < MAX_SPRITES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: first,
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

  /** Whether shots already play their own flash (the strip loads asynchronously). */
  get muzzleReady(): boolean {
    return this.muzzleFrames.length > 0;
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
      if (fx.type === "noise") {
        if (this.ringFrames.length > 0) this.pushRing(fx);
        continue;
      }
      const burst = BURSTS[fx.type];
      if (!burst) continue;
      if (fx.type === "shot" && this.muzzleFrames.length > 0) {
        if (this.bursts.length < MAX_SPRITES) this.bursts.push(this.muzzle(fx));
      } else if (fx.type === "melee" && this.meleeFrames.length > 0) {
        if (this.bursts.length < MAX_SPRITES) this.bursts.push(this.strike(fx));
      } else if (isCloud(fx.type) && this.cloudFrames[fx.type]) {
        this.pushCloud(fx.type, fx);
      } else if (this.frameTextures.length > 0 && this.bursts.length < MAX_SPRITES) {
        this.bursts.push({
          frames: this.frameTextures,
          look: "spark",
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
      // The cloud carries its own droplets; the additive red particles on top of
      // it glowed like neon and buried the dark smoke, so a cloud replaces them.
      // The strike's pale particles did the same to the slash: blobs where the
      // claws should read.
      const replaced = (isCloud(fx.type) && !!this.cloudFrames[fx.type]) || (fx.type === "melee" && this.meleeFrames.length > 0);
      const sparks = replaced ? 0 : burst.count;
      for (let i = 0; i < sparks; i++) {
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
      const frame = b.frames[Math.min(b.frames.length - 1, Math.floor(t * b.frames.length))];
      if (mat.map !== frame) {
        // Swapping between textures does not change the shader: `needsUpdate`
        // here would recompile the program on every frame change, which is a
        // 12-compile stutter per burst and enough to starve the frame loop.
        mat.map = frame;
      }
      const spark = b.look === "spark";
      this.posVec.set(b.x, spark ? b.y + t * 0.4 : b.y, b.z);
      mesh.position.copy(this.posVec);
      mesh.quaternion.copy(b.look === "ring" ? FLAT : this.cameraQuat);
      // The flash and smoke sheets animate their own scale; only the spark is grown here.
      const scale = spark ? b.size * (0.6 + t * 1.1) : b.size;
      mesh.scale.set(b.flip ? -scale : scale, scale, scale);
      // The flash strips fade out on their own last frames; the spark and the
      // smoke still carry alpha at the end of their sheets, so they fade here.
      const fade = b.look === "flash" || b.look === "ring" || t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      // One pool serves both blend modes. Changing `blending` is render state,
      // not a different shader, so it needs no `needsUpdate` either.
      if (b.look === "smoke") {
        mat.blending = THREE.NormalBlending;
        mat.color.setRGB(1, 1, 1);
        mat.opacity = fade;
      } else {
        mat.blending = THREE.AdditiveBlending;
        mat.opacity = 1;
        // Additive: the colour going to black is the fade. The atlas carries its
        // own white-hot colour; tinting it with the event colour turned a spark
        // into a dull red dot, so the sprite stays warm and only the fade moves.
        // The ring keeps its own cool white: warmed, it read as another spark.
        if (b.look === "ring") mat.color.setRGB(1, 1, 1);
        else mat.color.setRGB(1.0 * fade, 0.94 * fade, 0.82 * fade);
      }
      this.bursts[sw] = b;
      sw++;
    }
    this.bursts.length = sw;
  }

  private pushCloud(kind: CloudKind, fx: FxEvent): void {
    const c = CLOUDS[kind];
    if (this.bursts.length >= MAX_SPRITES) return;
    let alive = 0;
    for (const b of this.bursts) if (b.cloud === kind && b.age < b.life) alive++;
    if (alive >= c.cap) return;
    this.bursts.push({
      frames: this.cloudFrames[kind]!,
      look: "smoke",
      cloud: kind,
      x: fx.x,
      y: c.height,
      z: fx.y,
      age: 0,
      life: c.life,
      size: c.size,
      r: 1,
      g: 1,
      b: 1,
    });
  }

  /** A flash at the barrel: from the shooter, a step toward the target. */
  private muzzle(fx: FxEvent): Sprite {
    const dx = (fx.tx ?? fx.x) - fx.x;
    const dz = (fx.ty ?? fx.y) - fx.y;
    const len = Math.hypot(dx, dz);
    const k = len > 1e-6 ? MUZZLE_REACH / len : 0;
    return {
      frames: this.muzzleFrames,
      look: "flash",
      x: fx.x + dx * k,
      y: MUZZLE_HEIGHT,
      z: fx.y + dz * k,
      age: 0,
      life: MUZZLE_LIFE,
      size: MUZZLE_SIZE,
      r: 1,
      g: 1,
      b: 1,
    };
  }

  private pushRing(fx: FxEvent): void {
    if (!fx.r || fx.r <= 0 || this.bursts.length >= MAX_SPRITES) return;
    let alive = 0;
    for (const b of this.bursts) {
      if (b.look !== "ring" || b.age >= b.life) continue;
      if (Math.hypot(b.x - fx.x, b.z - fx.y) < RING_MERGE) return;
      alive++;
    }
    if (alive >= RING_CAP) return;
    this.bursts.push({
      frames: this.ringFrames,
      look: "ring",
      x: fx.x,
      y: RING_HEIGHT,
      z: fx.y,
      age: 0,
      life: RING_LIFE,
      size: (fx.r * 2) / RING_FILL,
      r: 1,
      g: 1,
      b: 1,
    });
  }

  /** A slash on the victim, pulled back toward the attacker. */
  private strike(fx: FxEvent): Sprite {
    const tx = fx.tx ?? fx.x;
    const tz = fx.ty ?? fx.y;
    const dx = fx.x - tx;
    const dz = fx.y - tz;
    const len = Math.hypot(dx, dz);
    const k = len > 1e-6 ? Math.min(MELEE_REACH, len) / len : 0;
    this.strikes++;
    return {
      frames: this.meleeFrames,
      look: "flash",
      flip: this.strikes % 2 === 0,
      x: tx + dx * k,
      y: MELEE_HEIGHT,
      z: tz + dz * k,
      age: 0,
      life: MELEE_LIFE,
      size: MELEE_SIZE,
      r: 1,
      g: 1,
      b: 1,
    };
  }

  /** Gerador barato e deterministico (mesma sequencia em todo cliente). */
  private next(): number {
    this.rng ^= this.rng << 13;
    this.rng ^= this.rng >>> 17;
    this.rng ^= this.rng << 5;
    return ((this.rng >>> 0) % 10000) / 10000;
  }
}
