import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { INFECTED, WEAPONS, type WeaponId } from "@afterfall/content";
import type { Entity } from "@afterfall/core";

export const WALK_KEYS = 8;
export const CHARACTER_MORPHS = [
  ...Array.from({ length: WALK_KEYS }, (_, i) => `walk${i}`),
  "breath",
  "windup",
  "strike",
  "aim",
  ...Array.from({ length: 4 }, (_, i) => `run${i}`),
];
const CLOTHES = [0x608ca0, 0xb48b56, 0x74846a, 0x996556, 0x667d99, 0x9eaaa1];
const SKIN = [0xd6a47d, 0x9a694a, 0xe2b997, 0xb7805b, 0x704c38];
const skinTint = new THREE.Color();
const clothTint = new THREE.Color();
const woundTint = new THREE.Color(0xb3b683);
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
    if (walking) this.phase = (this.phase + distance / ((running ? 1.65 : 1.32) * strideScale)) % 1;
    if (teleport) this.moving = 0;
    else this.moving += ((walking ? 1 : 0) - this.moving) * (1 - Math.exp(-dt * 16));
    const angle = e.transform!.heading;
    const turn = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
    this.heading += turn * (1 - Math.exp(-dt * 18));
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
    const keys = running ? 4 : WALK_KEYS;
    const offset = running ? 12 : 0;
    const p = this.phase * keys;
    const from = Math.floor(p) % keys;
    this.weights[offset + from] = (1 - (p % 1)) * walk;
    this.weights[offset + ((from + 1) % keys)] = (p % 1) * walk;
    this.weights[8] = (1 - walk) * (1 - attack) * (0.5 + 0.5 * Math.sin(time * 2.3 + e.id * 1.7));
    if (this.ranged) this.weights[11] = Math.min(1, attack * 2);
    else if (age < 0.12) {
      this.weights[9] = 1 - age / 0.12;
      this.weights[10] = age / 0.12;
    } else this.weights[10] = attack;
    const flinch = Math.max(0, 1 - (time - this.hitAt) / 0.22) * 0.35;
    // A reaction occupies part of the pose, rather than pushing weights past one.
    for (let i = 0; i < this.weights.length; i++) this.weights[i] *= 1 - flinch;
    this.weights[9] += flinch;
    const total = this.weights.reduce((sum, weight) => sum + weight, 0);
    if (total > 1) for (let i = 0; i < this.weights.length; i++) this.weights[i] /= total;
  }
}

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
        if (name === "skin" || name === "cloth") mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
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
    } catch {
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
    clothTint.setHex(CLOTHES[e.id % CLOTHES.length]);
    if (s?.infected) skinTint.lerp(woundTint, 0.45);
    if (selected) clothTint.lerp(selectedTint, 0.42);
    else if (s?.manual) clothTint.multiplyScalar(1.12);
    if (danger && this.infected) skinTint.lerp(dangerTint, 0.5);
    for (const { mesh, sample, name } of this.parts) {
      if ((name === "crowbar" || name === "pistol" || name === "rifle") && name !== weapon) continue;
      const at = mesh.count;
      if (at >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(at, matrix);
      if (mesh.instanceColor) mesh.setColorAt(at, name === "skin" ? skinTint : clothTint);
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
