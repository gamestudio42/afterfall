import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { INFECTED, WEAPONS, type WeaponId } from "@afterfall/content";
import type { Entity } from "@afterfall/core";
import { BONE_FLOATS, CharacterRig, type RigData } from "./rig";

export const WALK_KEYS = 16;
export const RUN_KEYS = 24;
/** The key poses `tools/blender/characters.py` exports, in the order a motion weights them. */
export const CHARACTER_POSES = [
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
export const CYCLE_LENGTH = { survivorWalk: 1.2, survivorRun: 2.5, infectedWalk: 1.0, infectedRun: 2.2 } as const;
/**
 * A survivor's speed, in metres a second, at which the gait goes from walk to jog and back.
 * Two thresholds, so one hovering between them does not flicker: it walks at 1.7 (1.3 when
 * hurt and loaded) and jogs at 3.0 (2.25 when both).
 */
const GAIT_UP = 2.15;
const GAIT_DOWN = 1.95;
/** The most a body leans into a turn, in radians: 12°, a sharp corner at a run. */
const MAX_BANK = (12 * Math.PI) / 180;
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

/**
 * How one infected body differs from the next, fixed by its id. The horde shares one walk,
 * and in step at one height it read as a parade. Mirrored, the other leg drags and the other
 * arm hangs; a taller body takes longer strides at the same pace; and each carries itself
 * its own way, hunched or upright, listing to a side, and rocking more or less as it goes.
 */
export interface InfectedBuild {
  mirror: boolean;
  /** Height as a fraction of the kind's. */
  height: number;
  /** Forward lean, in radians. */
  lean: number;
  /** Sideways list, in radians, positive to the body's right. */
  list: number;
  /** Side-to-side rock at each step, in radians. */
  rock: number;
}

export function infectedBuild(id: number): InfectedBuild {
  const r = (k: number) => {
    const v = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const deg = Math.PI / 180;
  return {
    mirror: r(1) < 0.5,
    height: 0.92 + 0.16 * r(2),
    lean: (-2 + 8 * r(3)) * deg,
    list: (r(4) - 0.5) * 8 * deg,
    rock: (1.5 + 3 * r(5)) * deg,
  };
}

/** Distance-driven locomotion and simulation-time actions; never advances while paused. */
export class CharacterMotion {
  readonly weights = Array<number>(CHARACTER_POSES.length).fill(0);
  phase: number;
  heading: number;
  private x: number;
  private y: number;
  private time: number;
  private moving = 0;
  /** How much of the motion goes the way the body faces: 1 a step forward, 0 a shove to the side. */
  private forward = 1;
  /**
   * Sideways tilt into a turn, in radians, positive to the body's left: a body going round a
   * corner leans into it as a person does, by about atan(speed × turn rate / g).
   */
  bank = 0;
  /** The infected's own build; null for a survivor. */
  readonly build: InfectedBuild | null;
  /** 0 walking, 1 jogging, in between while the gait changes. */
  private gait = 1;
  private jogging = true;
  private speed = 0;
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
    this.build = e.infected ? infectedBuild(e.id) : null;
  }

  /** How far into the walk the body is, 0 standing to 1 striding. */
  get striding(): number {
    return this.moving;
  }

  update(e: Entity, x: number, y: number, time: number, strideScale = 1): void {
    const dt = Math.max(0, time - this.time);
    const dx = x - this.x;
    const dy = y - this.y;
    const distance = Math.hypot(dx, dy);
    const teleport = distance > 3 || time < this.time;
    const walking = distance > 0.00001 && !teleport;
    this.x = x;
    this.y = y;
    this.time = time;
    // A survivor walks about its chores and jogs when in a hurry: the gait follows the speed
    // it is actually going at, smoothed so one slow tick does not drop it to a walk.
    if (dt > 0 && !teleport) {
      const v = distance / dt;
      // Setting off, the first speed is the speed: no jog that fades into a walk.
      this.speed = this.moving < 0.1 ? v : this.speed + (v - this.speed) * (1 - Math.exp(-dt * 6));
    }
    const starting = this.moving < 0.1;
    if (e.survivor) {
      if (this.jogging && this.speed < GAIT_DOWN && walking) this.jogging = false;
      else if (!this.jogging && this.speed > GAIT_UP) this.jogging = true;
    } else this.jogging = e.infected?.kind === "runner";
    this.gait = starting ? (this.jogging ? 1 : 0) : this.gait + ((this.jogging ? 1 : 0) - this.gait) * (1 - Math.exp(-dt * 5));
    if (!e.survivor) this.gait = this.jogging ? 1 : 0;
    const cycle = e.survivor
      ? CYCLE_LENGTH.survivorWalk + (CYCLE_LENGTH.survivorRun - CYCLE_LENGTH.survivorWalk) * this.gait
      : this.jogging
        ? CYCLE_LENGTH.infectedRun
        : CYCLE_LENGTH.infectedWalk;
    if (walking) this.phase = (this.phase + distance / (cycle * strideScale)) % 1;
    if (teleport) this.moving = 0;
    // A body takes a moment to get going and to settle: at 16 the gait snapped on and off.
    else this.moving += ((walking ? 1 : 0) - this.moving) * (1 - Math.exp(-dt * 9));
    const angle = e.transform!.heading;
    const turn = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
    const step = turn * (1 - Math.exp(-dt * 12));
    this.heading += step;
    if (dt > 0) {
      // Lean into the turn: the heading is the smoothed one, so a path's corner is a curve.
      const lean = this.moving * Math.atan((this.speed * (step / dt)) / 9.81) * 0.6;
      const target = Math.max(-MAX_BANK, Math.min(MAX_BANK, teleport ? 0 : lean));
      this.bank += (target - this.bank) * (1 - Math.exp(-dt * 6));
      // A shove to the side (a crowd making room) is not a step forward: played as the walk,
      // a body pushed sideways walked on the spot facing the wrong way.
      if (walking) {
        const along = Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) / distance;
        this.forward += (along - this.forward) * (1 - Math.exp(-dt * 8));
      } else this.forward += (1 - this.forward) * (1 - Math.exp(-dt * 4));
    }
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
    const walk = this.moving * this.forward * (1 - attack * 0.8);
    const sidestep = this.moving * (1 - this.forward) * (1 - attack);
    // Both gaits share the phase (the left foot is forward at 0 in each), so a change of
    // gait cross-fades the two cycles in step instead of jumping between them.
    for (const [keys, offset, share] of [
      [WALK_KEYS, 0, 1 - this.gait],
      [RUN_KEYS, RUN, this.gait],
    ] as const) {
      if (share <= 0.001) continue;
      const p = this.phase * keys;
      const from = Math.floor(p) % keys;
      this.weights[offset + from] += (1 - (p % 1)) * walk * share;
      this.weights[offset + ((from + 1) % keys)] += (p % 1) * walk * share;
    }
    // Standing still is not standing frozen: the chest rises and falls, and every
    // so often the weight goes onto the other leg with a look over the shoulder.
    const idle = (1 - walk) * (1 - attack);
    const wander = 0.5 + 0.5 * Math.sin(time * 0.41 + e.id * 2.3);
    const shift = wander * wander * (3 - 2 * wander);
    // A sidestep is the weight going onto the other leg, the shift pose, not a stride.
    this.weights[SHIFT] = Math.min(idle, idle * Math.max(0, (shift - 0.55) / 0.45) * 0.9 + sidestep * 0.8);
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
  /** The infected's left-for-right twin of `mesh`, or null. */
  mirrored: THREE.InstancedMesh | null;
  name: string;
}

/** Swaps left and right in the model's own frame. */
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const mirroredMatrix = new THREE.Matrix4();

/**
 * Skins a material on the GPU from the batch's bone texture: each vertex follows its two
 * bones by its weight, and each instance reads the row of bones its motion was posed into.
 * The same code goes into the shadow pass's depth material, so shadows move with the body.
 */
function skinned<T extends THREE.Material>(material: T, bones: THREE.DataTexture): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.boneTex = { value: bones };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform highp sampler2D boneTex;
attribute vec3 skinBind;
attribute float boneRow;
mat4 boneAt(float bone) {
  int x = int(bone + 0.5) * 3;
  int y = int(boneRow + 0.5);
  return transpose(mat4(
    texelFetch(boneTex, ivec2(x, y), 0),
    texelFetch(boneTex, ivec2(x + 1, y), 0),
    texelFetch(boneTex, ivec2(x + 2, y), 0),
    vec4(0.0, 0.0, 0.0, 1.0)));
}`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec4 restPosition = vec4(position, 1.0);
vec3 transformed = skinBind.z * (boneAt(skinBind.x) * restPosition).xyz
  + (1.0 - skinBind.z) * (boneAt(skinBind.y) * restPosition).xyz;`,
      );
  };
  material.customProgramCacheKey = () => "afterfall-character-skin";
  return material;
}

/**
 * One instanced mesh per material, skinned on the GPU: every person's bones are posed on
 * the CPU into a row of one texture, and each mesh instance names its row.
 */
export class CharacterBatch {
  readonly parts: CharacterPart[] = [];
  readonly meshes: THREE.InstancedMesh[] = [];
  /** One row per person: the skinning matrices of every bone. */
  bones!: THREE.DataTexture;
  private boneData!: Float32Array;
  rig!: CharacterRig;
  private rows = 0;
  private constructor(
    private readonly scene: THREE.Scene,
    readonly infected: boolean,
    readonly capacity: number,
  ) {}

  static async load(scene: THREE.Scene, url: string, capacity: number, infected: boolean): Promise<CharacterBatch | null> {
    const batch = new CharacterBatch(scene, infected, capacity);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      let data: RigData | null = null;
      gltf.scene.traverse((child) => {
        const rig = child.userData?.afterfall_rig;
        if (typeof rig === "string") data = JSON.parse(rig) as RigData;
      });
      if (!data) throw new Error("Character has no rig");
      const rigData = data as RigData;
      if (rigData.walkKeys !== WALK_KEYS || rigData.runKeys !== RUN_KEYS) throw new Error("Character rig has the wrong key count");
      batch.rig = new CharacterRig(rigData, CHARACTER_POSES);
      const width = batch.rig.bones * 3;
      batch.boneData = new Float32Array(width * capacity * 4);
      batch.bones = new THREE.DataTexture(batch.boneData, width, capacity, THREE.RGBAFormat, THREE.FloatType);
      batch.bones.minFilter = batch.bones.magFilter = THREE.NearestFilter;
      batch.bones.generateMipmaps = false;
      batch.bones.needsUpdate = true;
      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (!child.matrixWorld.equals(new THREE.Matrix4())) throw new Error("Character mesh is not at the origin");
        const src = child.geometry as THREE.BufferGeometry;
        const bind = src.morphAttributes.position?.[0] as THREE.BufferAttribute | undefined;
        if (!bind || child.morphTargetDictionary?.bind !== 0) throw new Error("Character has no bone binding");
        // The bind target carries each vertex's two bones and the first one's weight.
        const skin = new Float32Array(bind.count * 3);
        for (let i = 0; i < bind.count; i++) {
          skin[i * 3] = Math.round(bind.getX(i));
          skin[i * 3 + 1] = Math.round(bind.getY(i));
          skin[i * 3 + 2] = bind.getZ(i);
        }
        const skinBind = new THREE.BufferAttribute(skin, 3);
        const name = (child.material as THREE.MeshStandardMaterial).name;
        const mat = skinned(
          new THREE.MeshStandardMaterial({
            name,
            color: 0xffffff,
            vertexColors: true,
            roughness: 0.88,
            flatShading: true,
            side: infected && name === "cloth" ? THREE.DoubleSide : THREE.FrontSide,
            emissive: name === "eyes" ? 0x9bba52 : 0,
            emissiveIntensity: name === "eyes" ? 0.65 : 0,
          }),
          batch.bones,
        );
        const depth = skinned(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), batch.bones);
        const instanced = () => {
          // Each mesh has its own geometry for its own row indices; the vertex data is shared.
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", src.getAttribute("position"));
          if (src.getAttribute("color")) geo.setAttribute("color", src.getAttribute("color"));
          geo.setAttribute("skinBind", skinBind);
          if (src.index) geo.setIndex(src.index);
          const rows = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
          rows.setUsage(THREE.DynamicDrawUsage);
          geo.setAttribute("boneRow", rows);
          const mesh = new THREE.InstancedMesh(geo, mat, capacity);
          mesh.name = name;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.customDepthMaterial = depth;
          mesh.frustumCulled = false;
          if (TINTED.has(name)) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
          mesh.count = 0;
          batch.meshes.push(mesh);
          return mesh;
        };
        const mesh = instanced();
        // A mirrored twin, for the infected: a negative scale on the object itself, so Three
        // turns the winding round and faces and shadows stay the right way out.
        let mirrored: THREE.InstancedMesh | null = null;
        if (infected) {
          mirrored = instanced();
          mirrored.scale.x = -1;
          mirrored.updateMatrix();
          mirrored.matrixAutoUpdate = false;
        }
        batch.parts.push({ mesh, mirrored, name });
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
    this.rows = 0;
    for (const mesh of this.meshes) mesh.count = 0;
  }

  place(e: Entity, matrix: THREE.Matrix4, motion: CharacterMotion, selected: boolean, danger: boolean): void {
    // The twin's object matrix mirrors the world, so its instance is mirrored on both sides:
    // world = mirror · (mirror · matrix · mirror) = matrix · mirror, the body flipped in place.
    if (this.rows >= this.capacity) return;
    const row = this.rows++;
    this.rig.skin(motion.weights, this.boneData, row * this.rig.bones * BONE_FLOATS);
    const mirror = !!motion.build?.mirror && this.parts[0]?.mirrored != null;
    if (mirror) mirroredMatrix.multiplyMatrices(MIRROR, matrix).multiply(MIRROR);
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
    for (const part of this.parts) {
      const { name } = part;
      if ((name === "crowbar" || name === "pistol" || name === "rifle") && name !== weapon) continue;
      const mesh = mirror ? part.mirrored! : part.mesh;
      const at = mesh.count;
      if (at >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(at, mirror ? mirroredMatrix : matrix);
      if (mesh.instanceColor)
        mesh.setColorAt(at, name === "skin" ? skinTint : name === "pants" ? pantsTint : name === "hair" ? hairTint : clothTint);
      (mesh.geometry.getAttribute("boneRow") as THREE.InstancedBufferAttribute).setX(at, row);
      mesh.count++;
    }
  }

  end(): void {
    // Only the people on the map are sent: `needsUpdate` alone uploads the whole batch,
    // which is sized for a horde of six hundred.
    for (const mesh of this.meshes) {
      const n = mesh.count;
      if (n === 0) continue;
      for (const a of [mesh.instanceMatrix, mesh.instanceColor, mesh.geometry.getAttribute("boneRow") as THREE.InstancedBufferAttribute]) {
        if (!a) continue;
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    if (this.rows > 0) this.bones.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.customDepthMaterial?.dispose();
      mesh.dispose();
    }
    this.bones?.dispose();
  }
}
