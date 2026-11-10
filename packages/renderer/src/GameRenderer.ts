import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BUILDING_TYPES, INFECTED, STRUCTURES, bagTotal, type StructureKind } from "@afterfall/content";
import type { Simulation, EntityId } from "@afterfall/core";
import { lerp } from "@afterfall/shared";
import { RtsCamera } from "./camera";
import { axialYaw } from "./structureLayout";
import { BuildingBatch, outlineOf } from "./buildingBatch";
import { buildCityGround, TEXTURED_TINT, type GroundMaterials } from "./cityMeshes";
import { loadArtTextures, type ArtTextures } from "./textures";
import { loadProps, placeProps, placeRoofProps, type PropKind, type PropPlacement, type PropScene, type RoofKind } from "./props";
import { Doors } from "./doors";
import { VfxSystem, type FxEvent } from "./vfx";

export type OverlayMode = "none" | "resources" | "danger";

export interface Selection {
  units: EntityId[];
  building: number;
  structure: EntityId;
}

export interface BuildPreview {
  kind: StructureKind;
  cells: [number, number][];
  valid: boolean[];
}

const MAX_UNITS = 64;
const MAX_INFECTED = 600;
const MAX_STRUCTURES = 1200;
const MAX_TRACERS = 96;
/**
 * Units are drawn at life size. They used to be 1.9x, for legibility at the map
 * zoom, but once the models read as people that made a survivor 3.65 m tall — 2.6
 * times the car and taller than the door module — so the whole world looked wrong.
 * The default camera distance came down with it (see `camera.ts`), which buys back
 * most of the pixels the scale gave up.
 */
const UNIT_SCALE = 1.0;
/**
 * Walk poses baked into both unit models (`tools/blender/survivors.py` and
 * `infected.py`): six keys of a stride plus one standing pose, exported as
 * `pose0`…`pose6`. The renderer picks one per unit, so the cycle costs
 * `poses x materials` draw calls and no skeleton — `InstancedMesh` cannot carry one,
 * and a `SkinnedMesh` per unit would cost a draw call per survivor.
 */
const WALK_POSES = 6;
const STAND_POSE = 6;
const POSES = WALK_POSES + 1;
/**
 * Metres of travel per pose step. Six steps make one full stride (two footfalls),
 * around 1.6 m, so the planted foot stays with the ground instead of sliding.
 */
const STRIDE_STEP = 0.26;

/** A loaded model: one instanced mesh per pose and part, plus the flat view. */
interface PoseSet {
  poses: THREE.InstancedMesh[][];
  /** The part that takes the gameplay tint, per pose. */
  colored: (THREE.InstancedMesh | null)[];
  flat: THREE.InstancedMesh[];
}

/** Tint applied to settlement buildings, by function. */
export const FUNCTION_TINT: Record<string, number> = {
  hq: 0xe8913a,
  shelter: 0x5f8fc9,
  storage: 0xb08a4f,
  workshop: 0x9a6fc0,
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Draws a Simulation with Three.js. Reads simulation state but never
 * mutates it; interpolates positions between ticks.
 */
/**
 * Where the portrait camera sits for the survivor model: head, one shoulder and
 * the shirt. Tighter than this and the pose's raised arms take over the frame;
 * further out and the face stops reading at 72 px.
 */
export function portraitFraming(): { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number } {
  return { eye: { x: 0.45, y: 1.8, z: 0.95 }, target: { x: 0, y: 1.6, z: 0 }, fov: 32 };
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rts: RtsCamera;
  private sim: Simulation | null = null;
  private raycaster = new THREE.Raycaster();
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a3328, 1);
  private hqLight = new THREE.PointLight(0xffb060, 0, 60, 1.6);
  private cityGroup: THREE.Group | null = null;
  /** Exposed for the capture specs. */
  doors: Doors | null = null;
  /** Exposed for the capture specs. */
  buildings: BuildingBatch | null = null;
  private survivors: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private packs: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private infected: THREE.InstancedMesh;
  private hpBg: THREE.InstancedMesh;
  private hpFg: THREE.InstancedMesh;
  private structures: THREE.InstancedMesh;
  private blueprints: THREE.InstancedMesh;
  private preview: THREE.InstancedMesh;
  private selectionBox: THREE.LineSegments;
  private hqMarker: THREE.Mesh;
  private tracers: THREE.LineSegments;
  readonly vfx: VfxSystem;
  private tracerAge = new Float32Array(MAX_TRACERS);
  private tracerNext = 0;
  private lastFxSeq = 0;
  private structureIds: EntityId[] = [];
  private blueprintIds: EntityId[] = [];
  /** One instanced mesh per material per kind, once `art/structures` lands. */
  private structureModels = new Map<StructureKind, { parts: THREE.InstancedMesh[]; ids: EntityId[] }>();
  private structuresReady = false;
  private markers: THREE.Group = new THREE.Group();
  selection: Selection = { units: [], building: -1, structure: -1 };
  private selectionOutlineOf = -1;
  buildPreview: BuildPreview | null = null;
  overlay: OverlayMode = "none";
  hoverBuilding = -1;
  private time = 0;

  /**
   * Renders the survivor model once into a small image for the side panel. One
   * portrait serves every survivor: they share geometry and only differ by the
   * shirt tint, and a placeholder face would be worse than none.
   */
  survivorPortrait(): string | null {
    if (this.portraitTried) return this.portrait;
    this.portraitTried = true;
    // The contact pose alone: drawing every pose would stack six bodies in the frame.
    const parts = this.unitPoses[0] ?? [];
    if (parts.length === 0) return null;
    try {
      const size = 128;
      const target = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.SRGBColorSpace });
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1b2028);
      for (const part of parts) {
        const mat = (part.material as THREE.MeshStandardMaterial).clone();
        // The shirt is white in the model and takes its colour from the squad
        // tint, which a plain mesh does not have: give it the survivor blue so
        // the portrait is not a white torso.
        if (mat.color.getHex() === 0xffffff) mat.color.setHex(0x4a90b8);
        scene.add(new THREE.Mesh(part.geometry, mat));
      }
      // Three-quarter view from the shoulders up.
      // Framed for the head, one shoulder and the shirt: tighter than this and
      // the pose's raised arms take over the frame.
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
      camera.position.set(0.45, 1.8, 0.95);
      camera.lookAt(0, 1.6, 0);
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(1.2, 3, 2);
      const fill = new THREE.HemisphereLight(0xbcd2ea, 0x30302c, 1.4);
      scene.add(key, fill);

      const prevTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(scene, camera);
      const pixels = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      this.renderer.setRenderTarget(prevTarget);

      // readRenderTargetPixels returns bottom-up rows: flip into an ImageData.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const image = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        image.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
      }
      ctx.putImageData(image, 0, 0);
      this.portrait = canvas.toDataURL("image/png");

      target.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
      return this.portrait;
    } catch {
      return null;
    }
  }

  /**
   * Loads the survivor model and swaps it in place of the capsules. The capsule
   * kit stays in the scene as the fallback until the model is ready, and stays
   * if the file is missing, so a broken asset costs a silhouette and nothing
   * else.
   */
  /**
   * Loads a GLB laid out as `pose0`…`pose5`, each mesh carrying one primitive per
   * material, and returns one instanced mesh per pose and part. Three.js keeps the
   * glTF mesh name on the primitive, so the pose comes from `child.name`; the
   * materials decide which part carries the gameplay tint.
   */
  private async loadPoseSet(
    url: string,
    max: number,
    dress: (src: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial | null,
    tintMaterial: string,
  ): Promise<PoseSet | null> {
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(url);
    } catch {
      return null;
    }
    gltf.scene.updateMatrixWorld(true);
    const poses: THREE.InstancedMesh[][] = Array.from({ length: POSES }, () => []);
    const colored: (THREE.InstancedMesh | null)[] = Array.from({ length: POSES }, () => null);
    const flat: THREE.InstancedMesh[] = [];
    gltf.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const poseMatch = /pose(\d+)/.exec(child.name ?? "");
      if (!poseMatch) return;
      const pose = Number(poseMatch[1]);
      if (!Number.isInteger(pose) || pose < 0 || pose >= POSES) return;
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      const src = child.material as THREE.MeshStandardMaterial;
      const mat = dress(src);
      if (!mat) return;
      const inst = new THREE.InstancedMesh(geo, mat, max);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Only the part that carries gameplay colour is tinted: an instanceColor on
      // every part multiplies the rest to black, the bug that made black heads.
      if ((src.name ?? "").toLowerCase().includes(tintMaterial)) {
        inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
        colored[pose] = inst;
      }
      inst.count = 0;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      poses[pose].push(inst);
      flat.push(inst);
      this.scene.add(inst);
    });
    // Every pose must arrive, or the cycle would fall back to a single stance.
    if (poses.some((parts) => parts.length === 0)) {
      for (const m of flat) this.scene.remove(m);
      return null;
    }
    return { poses, colored, flat };
  }

  private async loadUnitModel(): Promise<void> {
    const set = await this.loadPoseSet(
      `${this.artBase}art/survivors/walker.glb`,
      MAX_UNITS,
      (src) => {
        // Survivors get a human tone and a shirt that takes the squad colour. They
        // keep dark eyes: the glow the model shipped with belongs to the infected,
        // and a squad that glows reads as the enemy.
        const name = (src.name ?? "").toLowerCase();
        const isClothes = name.includes("roupa");
        const isSkin = name.includes("pele");
        return new THREE.MeshStandardMaterial({
          name: src.name,
          color: isClothes ? new THREE.Color(0xffffff) : isSkin ? new THREE.Color(0xd8ab86) : src.color.clone(),
          roughness: isSkin ? 0.75 : 0.9,
          metalness: 0,
          flatShading: true,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0,
        });
      },
      "roupa",
    );
    if (!set) return;
    for (const m of this.unitFallback) m.visible = false;
    this.unitPoses = set.poses;
    this.unitPoseColored = set.colored;
    this.unitParts = set.flat;
  }

  /**
   * Loads the infected model and swaps it in place of the capsule: one instanced
   * mesh per pose and material, so a horde of six hundred walks for `6 x 3` draw
   * calls and a silhouette that says "enemy" before the health bar does.
   */
  private async loadInfectedModel(): Promise<void> {
    const set = await this.loadPoseSet(
      `${this.artBase}art/infected/infected.glb`,
      MAX_INFECTED,
      (src) => {
        const name = (src.name ?? "").toLowerCase();
        // `skin` is white in the model and takes INFECTED[kind].color as its
        // instance colour. The rags stay near black and the eyes are the only
        // emissive surface, which is what makes a horde read after dark.
        const isEyes = name.includes("eye");
        return new THREE.MeshStandardMaterial({
          name: src.name,
          color: src.color.clone(),
          roughness: isEyes ? 0.4 : 0.8,
          metalness: 0,
          flatShading: true,
          emissive: isEyes ? new THREE.Color(0x8fe35a) : new THREE.Color(0x000000),
          emissiveIntensity: isEyes ? 1.4 : 0,
        });
      },
      "skin",
    );
    // Without the skin there is nothing to tint by kind, so the capsule stays.
    if (!set) return;
    this.infected.visible = false;
    this.infectedPoses = set.poses;
    this.infectedPoseColored = set.colored;
    this.infectedParts = set.flat;
  }

  /**
   * Loads the five structure models and keeps one instanced mesh per material per kind.
   * Until they arrive (or if a file is missing) the single box mesh keeps drawing, so a
   * broken download costs a silhouette and nothing else.
   */
  private async loadStructureModels(): Promise<void> {
    const kinds: StructureKind[] = ["wall", "gate", "tower", "farm", "well"];
    const loaded = new Map<StructureKind, THREE.InstancedMesh[]>();
    await Promise.all(
      kinds.map(async (kind) => {
        let gltf;
        try {
          gltf = await new GLTFLoader().loadAsync(`${this.artBase}art/structures/${kind}.glb`);
        } catch {
          return;
        }
        gltf.scene.updateMatrixWorld(true);
        const parts: THREE.InstancedMesh[] = [];
        gltf.scene.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const geo = child.geometry.clone();
          geo.applyMatrix4(child.matrixWorld);
          const src = child.material as THREE.MeshStandardMaterial;
          const mat = new THREE.MeshStandardMaterial({
            name: src.name,
            color: src.color.clone(),
            roughness: src.roughness ?? 0.85,
            metalness: src.metalness ?? 0,
            flatShading: true,
          });
          const inst = new THREE.InstancedMesh(geo, mat, MAX_STRUCTURES);
          inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          // White keeps the material's own colour; damage and selection lerp from here.
          inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STRUCTURES * 3).fill(1), 3);
          inst.count = 0;
          inst.castShadow = true;
          inst.receiveShadow = true;
          inst.frustumCulled = false;
          this.scene.add(inst);
          parts.push(inst);
        });
        if (parts.length > 0) loaded.set(kind, parts);
      }),
    );
    // Every kind has to arrive: a half-loaded kit would show walls and not gates.
    if (loaded.size !== kinds.length) {
      for (const parts of loaded.values()) {
        for (const part of parts) {
          this.scene.remove(part);
          part.geometry.dispose();
        }
      }
      return;
    }
    for (const [kind, parts] of loaded) this.structureModels.set(kind, { parts, ids: [] });
    this.structuresReady = true;
    this.structures.visible = false;
  }

  /**
   * Drops the prop kit on the sidewalks. Loading is asynchronous and the city
   * can change while it runs, so a token guards against a stale kit landing on
   * a new map.
   */
  private dressStreets(sim: Simulation): void {
    for (const m of this.propScene?.meshes ?? []) this.scene.remove(m);
    this.propScene = null;
    const token = ++this.propToken;
    const placements = new Map<PropKind | RoofKind, PropPlacement[]>([
      ...placeProps(sim.city, this.sim!.grid, sim.city.seed ?? 1),
      ...placeRoofProps(sim.city.buildings, sim.city.seed ?? 1),
    ]);
    void loadProps(this.artBase, placements, (kit) => {
      if (token !== this.propToken) {
        for (const m of kit.meshes) m.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        return;
      }
      for (const m of kit.meshes) this.scene.add(m);
      this.propScene = kit;
    });
  }

  /**
   * Hands the loaded maps to the materials that can wear them. Called once per
   * texture as it arrives, so the city gains detail without waiting on boot.
   */
  private applyArt(art: ArtTextures): void {
    const g = this.groundMats;
    if (g) {
      const set = (key: keyof GroundMaterials, tex: THREE.Texture | null) => {
        const mat = g[key];
        if (!mat || !tex || mat.map === tex) return;
        mat.map = tex;
        mat.color.setHex(TEXTURED_TINT[key]);
        mat.needsUpdate = true;
      };
      set("ground", art.grass);
      set("blocks", art.sidewalk);
      set("curbs", art.concrete);
      set("roads", art.asphalt);
      set("parks", art.grass);
    }
    if (this.buildings) this.buildings.setArt(art);
    this.doors?.setMap(art.door);
    this.vfx?.setAtlas(art.spark_atlas);
    this.vfx?.setMuzzleAtlas(art.muzzle_atlas);
    this.vfx?.setMeleeAtlas(art.melee_atlas);
    this.vfx?.setNoiseAtlas(art.noise_atlas);
    this.vfx?.setDeathAtlas(art.death_atlas);
    this.vfx?.setDustAtlas(art.dust_atlas);
    this.vfx?.setCollapseAtlas(art.collapse_atlas);
  }

  private groundMats: GroundMaterials | null = null;
  private art: ArtTextures;
  private propScene: PropScene | null = null;
  /** Meshes of the survivor model: one instanced mesh per pose and part. */
  private unitPoses: THREE.InstancedMesh[][] = [];
  private unitPoseColored: (THREE.InstancedMesh | null)[] = [];
  /** Flat view of every pose part, for the per-frame needsUpdate and the portrait. */
  private unitParts: THREE.InstancedMesh[] = [];
  /** The same for the infected model. */
  private infectedPoses: THREE.InstancedMesh[][] = [];
  private infectedPoseColored: (THREE.InstancedMesh | null)[] = [];
  private infectedParts: THREE.InstancedMesh[] = [];
  /**
   * Walk phase per entity, advanced by the distance it actually travelled: a stride
   * locked to movement keeps the planted foot with the ground, where a phase ticking
   * with time slides the feet whenever the simulation speeds up or slows down.
   */
  private walkPhase = new Map<EntityId, { x: number; y: number; p: number; idle: number }>();
  private portrait: string | null = null;
  private portraitTried = false;
  private unitFallback: THREE.InstancedMesh[] = [];
  private artBase: string;
  private propToken = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: { baseUrl?: string } = {},
  ) {
    this.artBase = opts.baseUrl ?? "./";
    this.art = loadArtTextures(this.artBase, (art) => this.applyArt(art));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.rts = new RtsCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.scene.fog = new THREE.Fog(0x9fb2c0, 220, 620);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.hqLight, this.markers);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -160;
    sc.right = 160;
    sc.top = 160;
    sc.bottom = -160;
    sc.near = 10;
    sc.far = 600;
    this.sun.shadow.bias = -0.0008;

    const capsule = new THREE.CapsuleGeometry(0.34, 0.85, 3, 8);
    capsule.translate(0, 0.77, 0);
    this.survivors = this.instanced(capsule, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), MAX_UNITS, true);
    const head = new THREE.SphereGeometry(0.27, 10, 8);
    head.translate(0, 1.72, 0);
    this.heads = this.instanced(head, new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.7 }), MAX_UNITS, true);
    const pack = new THREE.BoxGeometry(0.5, 0.55, 0.3);
    pack.translate(0, 1.0, -0.38);
    this.packs = this.instanced(pack, new THREE.MeshStandardMaterial({ color: 0x8a6a3c }), MAX_UNITS, false);
    this.unitFallback = [this.survivors, this.heads, this.packs];
    void this.loadUnitModel();
    const ring = new THREE.RingGeometry(0.62, 0.8, 24);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.12, 0);
    this.rings = this.instanced(
      ring,
      new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.9, depthWrite: false }),
      MAX_UNITS,
      false,
    );
    const zombie = new THREE.CapsuleGeometry(0.36, 0.8, 3, 7);
    zombie.translate(0, 0.76, 0);
    this.infected = this.instanced(
      zombie,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
      MAX_INFECTED,
      true,
    );
    // The capsule keeps drawing until the model lands, then it is hidden: a
    // missing GLB costs an infected its silhouette and nothing else.
    void this.loadInfectedModel();
    // The box above keeps drawing until the five models land; if they never do, the
    // game still shows a structure, just a crude one.
    void this.loadStructureModels();
    const bar = new THREE.PlaneGeometry(1, 0.14);
    this.hpBg = this.instanced(
      bar,
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false, transparent: true, opacity: 0.8 }),
      MAX_UNITS + MAX_INFECTED,
      false,
    );
    const fg = new THREE.PlaneGeometry(1, 0.14);
    fg.translate(0.5, 0, 0.001);
    this.hpFg = this.instanced(
      fg,
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
      MAX_UNITS + MAX_INFECTED,
      false,
    );
    this.hpBg.renderOrder = 10;
    this.hpFg.renderOrder = 11;

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.structures = this.instanced(
      box,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
      MAX_STRUCTURES,
      true,
    );
    this.blueprints = this.instanced(
      box,
      new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.35, depthWrite: false }),
      MAX_STRUCTURES,
      false,
    );
    this.preview = this.instanced(
      box,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
      400,
      false,
    );

    this.selectionBox = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd34d }));
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    const flag = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 8, 6).translate(0, 4, 0),
      new THREE.MeshStandardMaterial({ color: 0xdddddd }),
    );
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.5).translate(1.3, 7.1, 0),
      new THREE.MeshStandardMaterial({ color: 0xe8913a, side: THREE.DoubleSide }),
    );
    flag.add(pole, cloth);
    this.hqMarker = new THREE.Mesh();
    this.hqMarker.add(flag);
    this.hqMarker.visible = false;
    this.scene.add(this.hqMarker);

    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    tg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    this.tracers = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);

    this.vfx = new VfxSystem(this.scene, undefined, this.art.spark_atlas);
    this.vfx.setMuzzleAtlas(this.art.muzzle_atlas);
    this.vfx.setMeleeAtlas(this.art.melee_atlas);
    this.vfx.setNoiseAtlas(this.art.noise_atlas);
    this.vfx.setDeathAtlas(this.art.death_atlas);
    this.vfx.setDustAtlas(this.art.dust_atlas);
    this.vfx.setCollapseAtlas(this.art.collapse_atlas);
  }

  /**
   * Picks a unit's walk pose from the distance it has travelled and writes the matrix
   * into that pose's bucket. A unit that has not moved keeps the contact pose, so a
   * standing survivor plants both feet instead of marching on the spot.
   */
  private placePose(
    set: THREE.InstancedMesh[][],
    colored: (THREE.InstancedMesh | null)[],
    buckets: Int32Array,
    id: EntityId,
    x: number,
    z: number,
    matrix: THREE.Matrix4,
    tint: THREE.Color,
  ): void {
    let state = this.walkPhase.get(id);
    let moved = 0;
    if (!state) {
      // A deterministic per-unit offset, or a squad that walks in lockstep reads as a
      // chorus line instead of four people.
      state = { x, y: z, p: (id * 0.618) % WALK_POSES, idle: 60 };
      this.walkPhase.set(id, state);
    } else {
      moved = Math.hypot(x - state.x, z - state.y);
      state.x = x;
      state.y = z;
      // A jump longer than a stride in one frame is a teleport, not a step.
      if (moved > 1e-4 && moved < 2) state.p = (state.p + moved / STRIDE_STEP) % WALK_POSES;
    }
    if (moved > 1e-4 && moved < 2) state.idle = 0;
    else state.idle = Math.min(state.idle + 1, 600);
    // Standing units get the standing pose: freezing them on the contact pose leaves a
    // squad permanently mid-lunge with its feet almost a metre apart. The idle grace
    // bridges the frames between simulation ticks, which would otherwise flicker the
    // pose at 60 fps with a 20 ms tick.
    const pose = state.idle < 8 ? Math.floor(state.p) % WALK_POSES : STAND_POSE;
    const parts = set[pose];
    if (!parts || parts.length === 0) return;
    const at = buckets[pose];
    if (at >= parts[0].instanceMatrix.count) return;
    for (const part of parts) part.setMatrixAt(at, matrix);
    colored[pose]?.setColorAt(at, tint);
    buckets[pose] = at + 1;
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, shadows: boolean): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(m);
    return m;
  }

  setSimulation(sim: Simulation): void {
    this.sim = sim;
    if (this.cityGroup) {
      this.scene.remove(this.cityGroup);
    }
    if (this.buildings) {
      this.scene.remove(this.buildings.mesh);
      this.buildings.dispose();
    }
    const city = sim.city;
    this.selectionOutlineOf = -1;
    const ground = buildCityGround(city);
    this.cityGroup = ground.group;
    this.groundMats = ground.materials;
    this.applyArt(this.art);
    this.scene.add(this.cityGroup);

    this.buildings = new BuildingBatch(city.buildings);
    // Textures may already have arrived before the city existed: apply the
    // building maps now, and let applyArt handle anything that lands later.
    this.buildings.setArt(this.art);
    this.scene.add(this.buildings.mesh);
    if (this.doors) {
      this.scene.remove(this.doors.group);
      this.doors.dispose();
    }
    this.doors = new Doors(city.buildings);
    this.doors.setMap(this.art.door);
    this.scene.add(this.doors.group);
    this.refreshBuildingColors();
    this.dressStreets(sim);
    this.rts.setBounds(0, city.width, 0, city.height);
    this.rts.jumpTo(city.width / 2, city.height / 2);
    this.lastFxSeq = sim.fxSeq;
  }

  /** Recolors buildings for exploration, functions and overlays. */
  refreshBuildingColors(): void {
    const sim = this.sim;
    if (!sim || !this.buildings) return;
    const roofC = new THREE.Color();
    sim.city.buildings.forEach((def, i) => {
      const st = sim.state.buildings[i];
      tmpC.setHex(BUILDING_TYPES[def.type].color);
      if (this.overlay === "resources") {
        const left = st.fn === "none" ? bagTotal(st.remainingLoot) / Math.max(1, st.searchTotal) : 0;
        tmpC.setRGB(0.25 + 0.1 * (1 - left), 0.3 + 0.6 * left, 0.25);
      } else if (this.overlay === "danger") {
        const d = Math.min(1, st.hiddenInfected / 8);
        tmpC.setRGB(0.3 + 0.6 * d, 0.3 * (1 - d) + 0.15, 0.3 * (1 - d) + 0.15);
      } else {
        if (st.fn !== "none") tmpC.lerp(new THREE.Color(FUNCTION_TINT[st.fn] ?? 0xffffff), 0.55);
        else if (st.searchProgress >= st.searchTotal) tmpC.multiplyScalar(0.55);
        else if (!st.explored) tmpC.multiplyScalar(0.82);
        if (st.cache) tmpC.lerp(new THREE.Color(0x4ee0c0), 0.5);
      }
      if (i === this.hoverBuilding) tmpC.lerp(new THREE.Color(0xffffff), 0.18);
      // The roof map is already dark tar: tinting it at 0.7 as well turned roofs to mud.
      roofC.copy(tmpC);
      // Windows glow only in settlement buildings.
      this.buildings!.setColors(i, tmpC, roofC, st.fn !== "none" ? 1 : 0);
    });
    this.buildings.commitColors();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.rts.camera.aspect = width / Math.max(1, height);
    this.rts.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------

  private ray(ndcX: number, ndcY: number): THREE.Raycaster {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.rts.camera);
    return this.raycaster;
  }

  groundPoint(ndcX: number, ndcY: number): { x: number; y: number } | null {
    const r = this.ray(ndcX, ndcY).ray;
    if (Math.abs(r.direction.y) < 1e-6) return null;
    const t = -r.origin.y / r.direction.y;
    if (t < 0) return null;
    return { x: r.origin.x + r.direction.x * t, y: r.origin.z + r.direction.z * t };
  }

  pickBuilding(ndcX: number, ndcY: number): number {
    if (!this.buildings) return -1;
    return this.buildings.pick(this.ray(ndcX, ndcY));
  }

  pickStructure(ndcX: number, ndcY: number): EntityId {
    const r = this.ray(ndcX, ndcY);
    let best: { id: EntityId; d: number } | null = null;
    for (const { parts, ids } of this.structureModels.values()) {
      for (const part of parts) {
        const hit = r.intersectObject(part, false)[0];
        if (!hit || hit.instanceId === undefined) continue;
        const id = ids[hit.instanceId] ?? -1;
        if (id >= 0 && (!best || hit.distance < best.d)) best = { id, d: hit.distance };
      }
    }
    if (!this.structuresReady) {
      const hit = r.intersectObject(this.structures, false)[0];
      if (hit && hit.instanceId !== undefined) {
        const id = this.structureIds[hit.instanceId] ?? -1;
        if (id >= 0 && (!best || hit.distance < best.d)) best = { id, d: hit.distance };
      }
    }
    const blue = r.intersectObject(this.blueprints, false)[0];
    if (blue && blue.instanceId !== undefined && (!best || blue.distance < best.d)) {
      return this.blueprintIds[blue.instanceId] ?? -1;
    }
    return best?.id ?? -1;
  }

  /** Screen position (CSS pixels) of a world point. */
  toScreen(x: number, y: number, h = 1): { x: number; y: number; visible: boolean } {
    tmpV.set(x, h, y).project(this.rts.camera);
    const w = this.canvas.clientWidth;
    const hh = this.canvas.clientHeight;
    return { x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * hh, visible: tmpV.z < 1 };
  }

  // ---------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------

  render(dt: number): void {
    const sim = this.sim;
    this.time += dt;
    this.rts.update(dt);
    if (sim) {
      const alpha = sim.alpha;
      this.updateLighting(sim);
      this.updateUnits(sim, alpha);
      this.updateStructures(sim);
      this.updateSelection(sim);
      this.updatePreview(sim);
      this.updateFx(sim, dt);
    }
    this.vfx.update(dt, this.rts.camera);
    this.renderer.render(this.scene, this.rts.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  private updateLighting(sim: Simulation): void {
    const h = sim.clock.hourFloat;
    // Sun travels east to west between 06:00 and 18:00.
    const dayT = (h - 6) / 12;
    const elev = Math.sin(Math.PI * Math.min(1, Math.max(0, dayT)));
    const daylight = Math.min(1, Math.max(0, Math.min(h - 5.3, 19.2 - h) / 1.6));
    const az = Math.PI * dayT;
    const tgt = this.rts.target;
    this.sun.position.set(tgt.x + Math.cos(az) * 160, 30 + elev * 200, tgt.z + 70);
    this.sun.target.position.copy(tgt);
    const dusk = 1 - Math.abs(elev * 2 - 0.4) * 1.2;
    const sunColor = new THREE.Color(0xfff2dd).lerp(new THREE.Color(0xff9a50), Math.max(0, Math.min(1, dusk)) * 0.6);
    this.sun.color.copy(daylight > 0.05 ? sunColor : new THREE.Color(0x7d93c9));
    this.sun.intensity = lerp(1.0, 3.4, daylight);
    this.hemi.intensity = lerp(1.25, 1.6, daylight);
    this.hemi.color.set(daylight > 0.3 ? 0xbfd4e6 : 0x6a80bb);
    const sky = new THREE.Color(0x141d33).lerp(new THREE.Color(0x9fb2c0), daylight);
    if (daylight > 0.05 && daylight < 0.7) sky.lerp(new THREE.Color(0xd08a5a), 0.35 * (1 - Math.abs(daylight - 0.35) / 0.35));
    this.scene.background = sky;
    // Night pulls the fog in: the map edge disappears and the streets read as a
    // place you cannot see the end of, which is the point of the night phase.
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    fog.near = lerp(150, 220, daylight);
    fog.far = lerp(520, 620, daylight);
    this.buildings?.setNight(1 - daylight);
    const hq = sim.state.hq;
    if (hq >= 0) {
      const b = sim.city.buildings[hq];
      this.hqLight.position.set(b.entrance.x, 6, b.entrance.y);
      this.hqLight.intensity = (1 - daylight) * 400;
      this.hqMarker.visible = true;
      // Flag on the roof, near the first corner of the outline.
      const corner = outlineOf(b)[0];
      const cx = b.rect.x + b.rect.w / 2;
      const cy = b.rect.y + b.rect.h / 2;
      const d = Math.hypot(cx - corner.x, cy - corner.y) || 1;
      const k = Math.min(1.5, d * 0.4) / d;
      this.hqMarker.position.set(corner.x + (cx - corner.x) * k, b.height + 0.2, corner.y + (cy - corner.y) * k);
    } else {
      this.hqMarker.visible = false;
      this.hqLight.intensity = 0;
    }
  }

  private updateUnits(sim: Simulation, alpha: number): void {
    const cam = this.rts.camera;
    let su = 0;
    let sp = 0;
    let sr = 0;
    let zi = 0;
    let bars = 0;
    /** How many units each pose is drawing this frame: the buckets the poses fill. */
    const unitBuckets = new Int32Array(POSES);
    const infectedBuckets = new Int32Array(POSES);
    const selected = new Set(this.selection.units);
    const barQ = cam.quaternion;
    const addBar = (x: number, y: number, z: number, frac: number, color: number) => {
      if (bars >= MAX_UNITS + MAX_INFECTED) return;
      tmpM.compose(tmpV.set(x, y, z), barQ, tmpS.set(1.6, 1.6, 1));
      this.hpBg.setMatrixAt(bars, tmpM);
      tmpV.set(-0.8, 0, 0).applyQuaternion(barQ);
      tmpM.compose(tmpV.add(tmpS.set(x, y, z)), barQ, tmpS.set(Math.max(0.001, frac) * 1.6, 1.6, 1));
      this.hpFg.setMatrixAt(bars, tmpM);
      this.hpFg.setColorAt(bars, tmpC.setHex(color));
      bars++;
    };
    for (const e of sim.state.entities.values()) {
      const t = e.transform;
      if (!t) continue;
      const x = lerp(t.px, t.x, alpha);
      const z = lerp(t.py, t.y, alpha);
      if (e.survivor) {
        const s = e.survivor;
        if (s.inside >= 0 || su >= MAX_UNITS) continue;
        const y = s.mounted >= 0 ? 3.4 : 0;
        tmpQ.setFromAxisAngle(UP, -t.heading + Math.PI / 2);
        tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
        this.survivors.setMatrixAt(su, tmpM);
        this.heads.setMatrixAt(su, tmpM);
        const color = s.infected ? 0x9fbf6a : s.manual ? 0x3f7fe0 : 0x4a90b8;
        const tint = tmpC.setHex(selected.has(e.id) ? 0x67c4ff : color);
        this.survivors.setColorAt(su, tint);
        this.placePose(this.unitPoses, this.unitPoseColored, unitBuckets, e.id, x, z, tmpM, tint);
        su++;
        if (bagTotal(s.carry) > 0) this.packs.setMatrixAt(sp++, tmpM);
        if (selected.has(e.id)) {
          tmpM.compose(tmpV.set(x, y, z), tmpQ.identity(), tmpS.set(UNIT_SCALE, 1, UNIT_SCALE));
          this.rings.setMatrixAt(sr++, tmpM);
        }
        const h = e.health!;
        if (selected.has(e.id) || h.hp < h.max)
          addBar(x, y + 2.2 * UNIT_SCALE, z, h.hp / h.max, h.hp > 60 ? 0x5fd36b : h.hp > 30 ? 0xf0c040 : 0xe0503c);
      } else if (e.infected) {
        if (zi >= MAX_INFECTED) continue;
        const def = INFECTED[e.infected.kind];
        const sway = Math.sin(e.infected.bob) * 0.12;
        tmpQ.setFromAxisAngle(UP, -t.heading + Math.PI / 2);
        const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.18 + sway);
        tmpQ.multiply(lean);
        tmpM.compose(
          tmpV.set(x, 0, z),
          tmpQ,
          tmpS.set(def.scale * UNIT_SCALE, def.scale * UNIT_SCALE * (1 + sway * 0.1), def.scale * UNIT_SCALE),
        );
        tmpC.setHex(def.color);
        if (this.overlay === "danger") tmpC.lerp(new THREE.Color(0xff3020), 0.5);
        if (this.infectedPoses.length > 0) {
          this.placePose(this.infectedPoses, this.infectedPoseColored, infectedBuckets, e.id, x, z, tmpM, tmpC);
        } else {
          this.infected.setMatrixAt(zi, tmpM);
          this.infected.setColorAt(zi, tmpC);
        }
        zi++;
        const h = e.health!;
        if (h.hp < h.max) addBar(x, 2.1 * def.scale * UNIT_SCALE, z, h.hp / h.max, 0xd04a3a);
      }
    }
    // Entities that died keep their phase forever otherwise.
    for (const id of this.walkPhase.keys()) {
      if (!sim.state.entities.has(id)) this.walkPhase.delete(id);
    }
    this.survivors.count = su;
    this.heads.count = su;
    // Each pose draws only the units whose phase selected it this frame.
    for (let p = 0; p < POSES; p++) {
      for (const part of this.unitPoses[p] ?? []) part.count = unitBuckets[p];
      for (const part of this.infectedPoses[p] ?? []) part.count = infectedBuckets[p];
    }
    this.packs.count = sp;
    this.rings.count = sr;
    // The capsule only draws the frames before the model lands.
    this.infected.count = this.infectedParts.length > 0 ? 0 : zi;
    this.hpBg.count = bars;
    this.hpFg.count = bars;
    for (const m of [
      this.survivors,
      this.heads,
      this.packs,
      this.rings,
      this.infected,
      this.hpBg,
      this.hpFg,
      ...this.unitParts,
      ...this.infectedParts,
    ]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private updateStructures(sim: Simulation): void {
    let b = 0;
    this.blueprintIds.length = 0;
    this.structureIds.length = 0;
    const cell = sim.grid.cell;
    for (const model of this.structureModels.values()) model.ids.length = 0;
    for (const model of this.structureModels.values()) for (const part of model.parts) part.count = 0;

    // Walls and gates are axial pieces: their long side has to run along the line they
    // are part of, or a north-south wall is drawn as a row of slabs lying across the
    // line. The neighbours in the navigation grid decide; a corner (both axes) and a
    // lone piece default to the east-west orientation the model is authored in.
    const wallYaw = (s: { cx: number; cy: number }): number => {
      const g = sim.grid;
      const at = (x: number, y: number) => g.inBounds(x, y) && g.structureAt[g.index(x, y)] >= 0;
      return axialYaw(at(s.cx, s.cy - 1), at(s.cx, s.cy + 1), at(s.cx + 1, s.cy), at(s.cx - 1, s.cy));
    };

    const tmpQ2 = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const e of sim.structures()) {
      const s = e.structure;
      const def = STRUCTURES[s.kind];
      const size = def.size * cell;
      const cx = (s.cx + def.size / 2) * cell;
      const cz = (s.cy + def.size / 2) * cell;
      if (!s.built) {
        if (b >= MAX_STRUCTURES) continue;
        const frac = Math.max(0.08, s.progress / def.work);
        // The ghost wears the same footprint and the same orientation as the finished
        // piece: a wall under construction is a thin slab along its line, not a cube.
        const axial = s.kind === "wall" || s.kind === "gate";
        const yawB = axial ? wallYaw(s) : 0;
        tmpQ2.setFromAxisAngle(up, yawB);
        tmpM.compose(tmpV.set(cx, 0, cz), tmpQ2, tmpS.set(size - 0.1, Math.max(0.2, def.height * frac), axial ? 0.5 : size - 0.1));
        this.blueprints.setMatrixAt(b, tmpM);
        this.blueprints.setColorAt(b, tmpC.setHex(e.id === this.selection.structure ? 0xffd34d : 0x6fd0ff));
        this.blueprintIds[b++] = e.id;
        continue;
      }
      const model = this.structureModels.get(s.kind);
      if (!model) {
        // Fallback box, until the models land.
        if (this.structureIds.length >= MAX_STRUCTURES) continue;
        const n = this.structureIds.length;
        const inset = s.kind === "wall" || s.kind === "gate" ? 0 : 0.3;
        tmpM.compose(tmpV.set(cx, 0, cz), tmpQ.identity(), tmpS.set(size - inset, def.height, size - inset));
        this.structures.setMatrixAt(n, tmpM);
        this.structures.setColorAt(n, tmpC.setHex(def.color));
        this.structureIds[n] = e.id;
        continue;
      }
      if (model.ids.length >= MAX_STRUCTURES) continue;
      const n = model.ids.length;
      const yaw = s.kind === "wall" || s.kind === "gate" ? wallYaw(s) : 0;
      tmpQ2.setFromAxisAngle(up, yaw);
      tmpM.compose(tmpV.set(cx, 0, cz), tmpQ2, tmpS.set(1, 1, 1));
      const hpFrac = e.health ? e.health.hp / e.health.max : 1;
      tmpC.setHex(0xffffff);
      if (hpFrac < 0.99) tmpC.lerp(new THREE.Color(0x8a2a20), (1 - hpFrac) * 0.8);
      if (e.id === this.selection.structure) tmpC.lerp(new THREE.Color(0xffd34d), 0.4);
      for (const part of model.parts) {
        part.setMatrixAt(n, tmpM);
        part.setColorAt(n, tmpC);
        part.count = n + 1;
      }
      model.ids[n] = e.id;
    }

    this.structures.count = this.structureIds.length;
    this.blueprints.count = b;
    for (const model of this.structureModels.values()) {
      for (const part of model.parts) {
        part.instanceMatrix.needsUpdate = true;
        if (part.instanceColor) part.instanceColor.needsUpdate = true;
      }
    }
    for (const m of [this.structures, this.blueprints]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private updateSelection(sim: Simulation): void {
    const i = this.selection.building;
    if (i >= 0) {
      if (i !== this.selectionOutlineOf) {
        // Outline the building's own shape: bottom and top rings plus the corners.
        const b = sim.city.buildings[i];
        const poly = outlineOf(b);
        const c = { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
        const pts = poly.map((p) => {
          const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
          return { x: p.x + ((p.x - c.x) / d) * 0.3, y: p.y + ((p.y - c.y) / d) * 0.3 };
        });
        const top = b.height + 0.4;
        const v: number[] = [];
        pts.forEach((p, k) => {
          const q = pts[(k + 1) % pts.length];
          v.push(p.x, 0.05, p.y, q.x, 0.05, q.y, p.x, top, p.y, q.x, top, q.y, p.x, 0.05, p.y, p.x, top, p.y);
        });
        this.selectionBox.geometry.dispose();
        this.selectionBox.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
        this.selectionOutlineOf = i;
      }
      this.selectionBox.visible = true;
    } else this.selectionBox.visible = false;
  }

  private updatePreview(sim: Simulation): void {
    const p = this.buildPreview;
    if (!p) {
      this.preview.count = 0;
      return;
    }
    const def = STRUCTURES[p.kind];
    const cell = sim.grid.cell;
    let n = 0;
    p.cells.forEach(([cx, cy], i) => {
      if (n >= 400) return;
      tmpM.compose(
        tmpV.set((cx + def.size / 2) * cell, 0, (cy + def.size / 2) * cell),
        tmpQ.identity(),
        tmpS.set(def.size * cell - 0.1, Math.max(0.4, def.height), def.size * cell - 0.1),
      );
      this.preview.setMatrixAt(n, tmpM);
      this.preview.setColorAt(n, tmpC.setHex(p.valid[i] ? 0x7dff9a : 0xff5040));
      n++;
    });
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
  }

  private updateFx(sim: Simulation, dt: number): void {
    const pos = this.tracers.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.tracers.geometry.getAttribute("color") as THREE.BufferAttribute;
    const fresh: FxEvent[] = [];
    for (const fx of sim.fx) {
      if (fx.seq <= this.lastFxSeq) continue;
      fresh.push(fx);
      if (fx.type !== "shot") continue;
      const i = this.tracerNext;
      this.tracerNext = (this.tracerNext + 1) % MAX_TRACERS;
      pos.setXYZ(i * 2, fx.x, 1.3, fx.y);
      pos.setXYZ(i * 2 + 1, fx.tx, 1.0, fx.ty);
      this.tracerAge[i] = 0.12;
    }
    this.vfx.emit(fresh);
    this.lastFxSeq = sim.fxSeq;
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracerAge[i] = Math.max(0, this.tracerAge[i] - dt);
      const k = this.tracerAge[i] / 0.12;
      col.setXYZ(i * 2, 1 * k, 0.85 * k, 0.4 * k);
      col.setXYZ(i * 2 + 1, 0.6 * k, 0.3 * k, 0.1 * k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
