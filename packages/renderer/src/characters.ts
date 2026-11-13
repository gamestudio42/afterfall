import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { INFECTED, WEAPONS, type WeaponId } from "@afterfall/content";
import type { Entity } from "@afterfall/core";

export const WALK_KEYS = 8;
export const RUN_KEYS = 12;
/** The morph layout `tools/blender/characters.py` exports, in order. */
export const CHARACTER_MORPHS = [
  ...Array.from({ length: WALK_KEYS }, (_, i) => `walk${i}`),
  ...Array.from({ length: RUN_KEYS }, (_, i) => `run${i}`),
  "breath",
  "shift",
  "windup",
  "strike",
  "aim",
  "hit",
];
const RUN = WALK_KEYS;
const BREATH = WALK_KEYS + RUN_KEYS;
const SHIFT = BREATH + 1;
const WINDUP = BREATH + 2;
const STRIKE = BREATH + 3;
const AIM = BREATH + 4;
const HIT = BREATH + 5;
/**
 * Metres of ground one full cycle (two steps) covers. The feet in each gait
 * were authored to sweep exactly this far while planted, so advancing the
 * phase by distance over these keeps a planted foot on its spot. They mirror
 * `CYCLE` in `tools/blender/characters.py`. The old 1.65 m for a survivor at
 * 3.1 m/s was 3.8 steps a second, a scurry; 2.5 m is 2.5 steps a second, a jog.
 */
export const CYCLE_LENGTH = { survivorRun: 2.5, infectedWalk: 1.0, infectedRun: 2.2 } as const;
// Muted, worn colours: jackets, trousers and hair of people who have been outside for a while.
const CLOTHES = [0x5d6b52, 0x7a6a4f, 0x4f6274, 0x8a5a48, 0x6b6f76, 0x8c8468, 0x5a4a5e, 0x9a7b4a];
const PANTS = [0x39424f, 0x4a4438, 0x2f3338, 0x55503f, 0x3d4a57];
const HAIR = [0x2a1c12, 0x15110e, 0x5b3d22, 0x8a6a3c, 0x6e6a64, 0x3a2418];
const SKIN = [0xd6a47d, 0x9a694a, 0xe2b997, 0xb7805b, 0x704c38];
const skinTint = new THREE.Color();
const clothTint = new THREE.Color();
const pantsTint = new THREE.Color();
const hairTint = new THREE.Color();
const woundTint = new THREE.Color(0xb3b683);
const pallorTint = new THREE.Color(0x8d9482);
const selectedTint = new THREE.Color(0x75ceee);
const dangerTint = new THREE.Color(0xff3020);

/** Distance-driven locomotion and simulation-time actions; never advances while paused. */
export class CharacterMotion {
  readonly weights = Array<number>(CHARACTER_MORPHS.length).fill(0);
  phase: number;
  heading: number;
  private x: number;
  private y: number;
  private time: number;
  private moving = 0;
  private cooldown: number;
  private hp: number;
  private attackAt = -Infinity;
  private hitAt = -Infinity;
  private ranged = false;
  private ammo: number;

  get firing(): boolean {
    return this.ranged && this.time - this.attackAt < 0.6;
  }

  constructor(e: Entity, x: number, y: number, time: number) {
    this.phase = (e.id * 0.61803398875) % 1;
    this.heading = e.transform!.heading;
    this.x = x;
    this.y = y;
    this.time = time;
    this.cooldown = e.survivor?.cooldown ?? e.infected?.cooldown ?? 0;
    this.hp = e.health?.hp ?? 0;
    this.ammo = e.survivor?.ammo ?? 0;
  }

  update(e: Entity, x: number, y: number, time: number, strideScale = 1): void {
    const dt = Math.max(0, time - this.time);
    const distance = Math.hypot(x - this.x, y - this.y);
    const teleport = distance > 3 || time < this.time;
    const walking = distance > 0.00001 && !teleport;
    this.x = x;
    this.y = y;
    this.time = time;
    const running = !!e.survivor || e.infected?.kind === "runner";
    const cycle = e.survivor ? CYCLE_LENGTH.survivorRun : running ? CYCLE_LENGTH.infectedRun : CYCLE_LENGTH.infectedWalk;
    if (walking) this.phase = (this.phase + distance / (cycle * strideScale)) % 1;
    if (teleport) this.moving = 0;
    // A body takes a moment to get going and to settle: at 16 the gait snapped on and off.
    else this.moving += ((walking ? 1 : 0) - this.moving) * (1 - Math.exp(-dt * 9));
    const angle = e.transform!.heading;
    const turn = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
    this.heading += turn * (1 - Math.exp(-dt * 12));
    const cooldown = e.survivor?.cooldown ?? e.infected?.cooldown ?? 0;
    if (cooldown > this.cooldown + 0.001) {
      this.attackAt = time;
      this.ranged = !!e.survivor && WEAPONS[e.survivor.weapon].usesAmmo && (e.survivor.ammo > 0 || e.survivor.ammo < this.ammo);
    }
    this.cooldown = cooldown;
    this.ammo = e.survivor?.ammo ?? 0;
    const hp = e.health?.hp ?? 0;
    if (hp < this.hp) this.hitAt = time;
    this.hp = hp;
    const age = time - this.attackAt;
    const attack = Math.max(0, 1 - age / (this.ranged ? 0.48 : 0.6));
    this.weights.fill(0);
    const walk = this.moving * (1 - attack * 0.8);
    const keys = running ? RUN_KEYS : WALK_KEYS;
    const offset = running ? RUN : 0;
    const p = this.phase * keys;
    const from = Math.floor(p) % keys;
    this.weights[offset + from] = (1 - (p % 1)) * walk;
    this.weights[offset + ((from + 1) % keys)] = (p % 1) * walk;
    // Standing still is not standing frozen: the chest rises and falls, and every
    // so often the weight goes onto the other leg with a look over the shoulder.
    const idle = (1 - walk) * (1 - attack);
    const wander = 0.5 + 0.5 * Math.sin(time * 0.41 + e.id * 2.3);
    const shift = wander * wander * (3 - 2 * wander);
    this.weights[SHIFT] = idle * Math.max(0, (shift - 0.55) / 0.45) * 0.9;
    this.weights[BREATH] = idle * (1 - this.weights[SHIFT] / Math.max(idle, 1e-6)) * (0.5 + 0.5 * Math.sin(time * 1.9 + e.id * 1.7));
    if (this.ranged) this.weights[AIM] = Math.min(1, attack * 2);
    else if (age < 0.12) {
      this.weights[WINDUP] = 1 - age / 0.12;
      this.weights[STRIKE] = age / 0.12;
    } else this.weights[STRIKE] = attack;
    const flinch = Math.max(0, 1 - (time - this.hitAt) / 0.28) * 0.6;
    // A reaction occupies part of the pose, rather than pushing weights past one.
    for (let i = 0; i < this.weights.length; i++) this.weights[i] *= 1 - flinch;
    this.weights[HIT] += flinch;
    const total = this.weights.reduce((sum, weight) => sum + weight, 0);
    if (total > 1) for (let i = 0; i < this.weights.length; i++) this.weights[i] /= total;
  }
}

/** Materials whose vertex colours are multiplied by a colour per person. */
const TINTED = new Set(["skin", "cloth", "pants", "hair"]);

export interface CharacterPart {
  mesh: THREE.InstancedMesh;
  sample: THREE.Mesh;
  name: string;
}

/** One batch per material, with independent GPU morph weights for every person. */
export class CharacterBatch {
  readonly parts: CharacterPart[] = [];
  readonly meshes: THREE.InstancedMesh[] = [];
  private constructor(
    private readonly scene: THREE.Scene,
    readonly infected: boolean,
  ) {}

  static async load(scene: THREE.Scene, url: string, capacity: number, infected: boolean): Promise<CharacterBatch | null> {
    const batch = new CharacterBatch(scene, infected);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (!CHARACTER_MORPHS.every((name, i) => child.morphTargetDictionary?.[name] === i))
          throw new Error("Invalid character morph layout");
        const geo = child.geometry.clone();
        geo.applyMatrix4(child.matrixWorld);
        // BufferGeometry.applyMatrix4 transforms the base attributes only. Relative
        // morph offsets need the same axis/scale conversion, without translation.
        const morphBasis = new THREE.Matrix3().setFromMatrix4(child.matrixWorld);
        for (const attribute of geo.morphAttributes.position ?? []) {
          if (geo.morphTargetsRelative) (attribute as THREE.BufferAttribute).applyMatrix3(morphBasis);
          else (attribute as THREE.BufferAttribute).applyMatrix4(child.matrixWorld);
        }
        const src = child.material as THREE.MeshStandardMaterial;
        const name = src.name;
        const mat = new THREE.MeshStandardMaterial({
          name,
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.88,
          flatShading: true,
          side: infected && name === "cloth" ? THREE.DoubleSide : THREE.FrontSide,
          emissive: name === "eyes" ? 0x9bba52 : 0,
          emissiveIntensity: name === "eyes" ? 0.65 : 0,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        if (TINTED.has(name)) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        const sample = new THREE.Mesh(geo, mat);
        // Allocate at full capacity before setting count=0; Three sizes the texture by count.
        mesh.setMorphAt(0, sample);
        mesh.count = 0;
        batch.parts.push({ mesh, sample, name });
        batch.meshes.push(mesh);
      });
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          for (const mat of Array.isArray(child.material) ? child.material : [child.material]) mat.dispose();
        }
      });
      if (!batch.parts.some((part) => part.name === "skin") || !batch.parts.some((part) => part.name === "cloth"))
        throw new Error("Incomplete character");
      for (const mesh of batch.meshes) scene.add(mesh);
      return batch;
    } catch (err) {
      console.error(`[CharacterBatch] Failed to load ${url}:`, err);
      batch.dispose();
      return null;
    }
  }

  begin(): void {
    for (const mesh of this.meshes) mesh.count = 0;
  }

  place(e: Entity, matrix: THREE.Matrix4, motion: CharacterMotion, selected: boolean, danger: boolean): void {
    const s = e.survivor;
    const weapon: WeaponId = s && (s.ammo > 0 || motion.firing) ? s.weapon : "crowbar";
    skinTint.setHex(s ? SKIN[e.id % SKIN.length] : INFECTED[e.infected!.kind].color);
    // The kind's colour is game information, but straight from the table it is a neon
    // green walker and an orange runner. Most of the way to a corpse's pallor, the
    // kinds still differ and the horde reads as dead flesh.
    if (!s) skinTint.lerp(pallorTint, 0.62);
    clothTint.setHex(CLOTHES[e.id % CLOTHES.length]);
    // Different strides through each list, so jacket, trousers and hair do not repeat together.
    pantsTint.setHex(PANTS[(e.id * 3 + 1) % PANTS.length]);
    hairTint.setHex(HAIR[(e.id * 5 + 2) % HAIR.length]);
    if (s?.infected) skinTint.lerp(woundTint, 0.45);
    if (selected) clothTint.lerp(selectedTint, 0.42);
    else if (s?.manual) clothTint.multiplyScalar(1.12);
    if (danger && this.infected) skinTint.lerp(dangerTint, 0.5);
    for (const { mesh, sample, name } of this.parts) {
      if ((name === "crowbar" || name === "pistol" || name === "rifle") && name !== weapon) continue;
      const at = mesh.count;
      if (at >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(at, matrix);
      if (mesh.instanceColor)
        mesh.setColorAt(at, name === "skin" ? skinTint : name === "pants" ? pantsTint : name === "hair" ? hairTint : clothTint);
      sample.morphTargetInfluences = motion.weights;
      mesh.setMorphAt(at, sample);
      mesh.count++;
    }
  }

  end(): void {
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
