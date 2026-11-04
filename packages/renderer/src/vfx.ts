/**
 * Impact visual effects: instanced particles, no external texture.
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
  life: number;
  speed: number;
  size: number;
  lift: number;
  color: THREE.Color;
  spread: number;
}

const BURSTS: Record<string, Burst> = {
  hit: { count: 10, life: 0.36, speed: 6.0, size: 1.5, lift: 2.6, color: new THREE.Color(0xffd27a), spread: Math.PI },
  melee: { count: 8, life: 0.28, speed: 5.0, size: 1.3, lift: 2.0, color: new THREE.Color(0xe8e2cc), spread: Math.PI },
  death: { count: 20, life: 0.66, speed: 4.0, size: 2.4, lift: 3.6, color: new THREE.Color(0xb3402f), spread: Math.PI },
  build: { count: 14, life: 0.85, speed: 2.6, size: 2.8, lift: 4.6, color: new THREE.Color(0xcfc0a8), spread: Math.PI * 0.6 },
  noise: { count: 6, life: 0.55, speed: 2.4, size: 1.8, lift: 1.6, color: new THREE.Color(0xa9b2bc), spread: Math.PI },
  shot: { count: 4, life: 0.18, speed: 7.0, size: 1.1, lift: 1.0, color: new THREE.Color(0xfff0c0), spread: 0.6 },
};

const MAX_PARTICLES = 720;

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
  private readonly particles: Particle[] = [];
  private readonly cameraQuat = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly scaleVec = new THREE.Vector3();
  private readonly posVec = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private lastSeq = 0;
  private rng = 0x2f6e2b1;

  constructor(scene: THREE.Scene, max = MAX_PARTICLES) {
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
  }

  /** Gerador barato e deterministico (mesma sequencia em todo cliente). */
  private next(): number {
    this.rng ^= this.rng << 13;
    this.rng ^= this.rng >>> 17;
    this.rng ^= this.rng << 5;
    return ((this.rng >>> 0) % 10000) / 10000;
  }
}
