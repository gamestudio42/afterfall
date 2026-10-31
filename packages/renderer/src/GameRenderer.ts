import * as THREE from "three";
import { BUILDING_TYPES, INFECTED, STRUCTURES, bagTotal, type StructureKind } from "@afterfall/content";
import type { Simulation, EntityId } from "@afterfall/core";
import { lerp } from "@afterfall/shared";
import { RtsCamera } from "./camera";
import { buildCityGround } from "./cityMeshes";

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
/** Units are drawn larger than life so they read at strategic zoom levels. */
const UNIT_SCALE = 1.9;

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
  private buildings: THREE.InstancedMesh | null = null;
  private roofs: THREE.InstancedMesh | null = null;
  private windows: THREE.InstancedMesh | null = null;
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
  private tracerAge = new Float32Array(MAX_TRACERS);
  private tracerNext = 0;
  private lastFxSeq = 0;
  private structureIds: EntityId[] = [];
  private blueprintIds: EntityId[] = [];
  private markers: THREE.Group = new THREE.Group();
  selection: Selection = { units: [], building: -1, structure: -1 };
  buildPreview: BuildPreview | null = null;
  overlay: OverlayMode = "none";
  hoverBuilding = -1;
  private time = 0;
  private windowMat: THREE.MeshBasicMaterial;

  constructor(readonly canvas: HTMLCanvasElement) {
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
    const ring = new THREE.RingGeometry(0.62, 0.8, 24);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.12, 0);
    this.rings = this.instanced(ring, new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.9, depthWrite: false }), MAX_UNITS, false);
    const zombie = new THREE.CapsuleGeometry(0.36, 0.8, 3, 7);
    zombie.translate(0, 0.76, 0);
    this.infected = this.instanced(zombie, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), MAX_INFECTED, true);
    const bar = new THREE.PlaneGeometry(1, 0.14);
    this.hpBg = this.instanced(bar, new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false, transparent: true, opacity: 0.8 }), MAX_UNITS + MAX_INFECTED, false);
    const fg = new THREE.PlaneGeometry(1, 0.14);
    fg.translate(0.5, 0, 0.001);
    this.hpFg = this.instanced(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }), MAX_UNITS + MAX_INFECTED, false);
    this.hpBg.renderOrder = 10;
    this.hpFg.renderOrder = 11;

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.structures = this.instanced(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), MAX_STRUCTURES, true);
    this.blueprints = this.instanced(box, new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.35, depthWrite: false }), MAX_STRUCTURES, false);
    this.preview = this.instanced(box, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), 400, false);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    this.selectionBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffd34d }));
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5).translate(1.3, 7.1, 0), new THREE.MeshStandardMaterial({ color: 0xe8913a, side: THREE.DoubleSide }));
    flag.add(pole, cloth);
    this.hqMarker = new THREE.Mesh();
    this.hqMarker.add(flag);
    this.hqMarker.visible = false;
    this.scene.add(this.hqMarker);

    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    tg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);

    this.windowMat = new THREE.MeshBasicMaterial({ color: 0xffc66b, transparent: true, opacity: 0 });
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
      for (const m of [this.buildings, this.roofs, this.windows]) if (m) this.scene.remove(m);
    }
    const city = sim.city;
    this.cityGroup = buildCityGround(city);
    this.scene.add(this.cityGroup);

    const n = city.buildings.length;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.buildings = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), n);
    this.roofs = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), n);
    // Window bands: thin slabs slightly larger than the building on two floors.
    this.windows = new THREE.InstancedMesh(box, this.windowMat, n);
    this.buildings.castShadow = this.buildings.receiveShadow = true;
    this.roofs.castShadow = this.roofs.receiveShadow = true;
    city.buildings.forEach((b, i) => {
      const cx = b.rect.x + b.rect.w / 2;
      const cz = b.rect.y + b.rect.h / 2;
      tmpM.compose(tmpV.set(cx, 0, cz), tmpQ.identity(), tmpS.set(b.rect.w, b.height, b.rect.h));
      this.buildings!.setMatrixAt(i, tmpM);
      tmpM.compose(tmpV.set(cx, b.height, cz), tmpQ.identity(), tmpS.set(b.rect.w - 0.8, 0.5, b.rect.h - 0.8));
      this.roofs!.setMatrixAt(i, tmpM);
      tmpM.compose(tmpV.set(cx, Math.min(b.height - 1.6, 1.6), cz), tmpQ.identity(), tmpS.set(b.rect.w + 0.08, 0.7, b.rect.h + 0.08));
      this.windows!.setMatrixAt(i, tmpM);
    });
    this.scene.add(this.buildings, this.roofs, this.windows);
    this.refreshBuildingColors();
    this.rts.setBounds(0, city.width, 0, city.height);
    this.rts.jumpTo(city.width / 2, city.height / 2);
    this.lastFxSeq = sim.fxSeq;
  }

  /** Recolors buildings for exploration, functions and overlays. */
  refreshBuildingColors(): void {
    const sim = this.sim;
    if (!sim || !this.buildings || !this.roofs || !this.windows) return;
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
      this.buildings!.setColorAt(i, tmpC);
      this.roofs!.setColorAt(i, tmpC.multiplyScalar(0.7));
      // Windows glow only in settlement buildings.
      tmpC.setHex(st.fn !== "none" ? 0xffc66b : 0x15171a);
      this.windows!.setColorAt(i, tmpC);
    });
    this.buildings.instanceColor!.needsUpdate = true;
    this.roofs.instanceColor!.needsUpdate = true;
    this.windows.instanceColor!.needsUpdate = true;
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
    const hit = this.ray(ndcX, ndcY).intersectObject(this.buildings, false)[0];
    return hit?.instanceId ?? -1;
  }

  pickStructure(ndcX: number, ndcY: number): EntityId {
    const r = this.ray(ndcX, ndcY);
    const a = r.intersectObject(this.structures, false)[0];
    const b = r.intersectObject(this.blueprints, false)[0];
    if (a && (!b || a.distance <= b.distance)) return this.structureIds[a.instanceId!] ?? -1;
    if (b) return this.blueprintIds[b.instanceId!] ?? -1;
    return -1;
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
    const daylight = Math.min(1, Math.max(0, (Math.min(h - 5.3, 19.2 - h)) / 1.6));
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
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.windowMat.opacity = (1 - daylight) * 0.95;
    const hq = sim.state.hq;
    if (hq >= 0) {
      const b = sim.city.buildings[hq];
      this.hqLight.position.set(b.entrance.x, 6, b.entrance.y);
      this.hqLight.intensity = (1 - daylight) * 400;
      this.hqMarker.visible = true;
      this.hqMarker.position.set(b.rect.x + 1.5, b.height + 0.2, b.rect.y + 1.5);
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
        this.survivors.setColorAt(su, tmpC.setHex(selected.has(e.id) ? 0x67c4ff : color));
        su++;
        if (bagTotal(s.carry) > 0) this.packs.setMatrixAt(sp++, tmpM);
        if (selected.has(e.id)) {
          tmpM.compose(tmpV.set(x, y, z), tmpQ.identity(), tmpS.set(UNIT_SCALE, 1, UNIT_SCALE));
          this.rings.setMatrixAt(sr++, tmpM);
        }
        const h = e.health!;
        if (selected.has(e.id) || h.hp < h.max) addBar(x, y + 2.2 * UNIT_SCALE, z, h.hp / h.max, h.hp > 60 ? 0x5fd36b : h.hp > 30 ? 0xf0c040 : 0xe0503c);
      } else if (e.infected) {
        if (zi >= MAX_INFECTED) continue;
        const def = INFECTED[e.infected.kind];
        const sway = Math.sin(e.infected.bob) * 0.12;
        tmpQ.setFromAxisAngle(UP, -t.heading + Math.PI / 2);
        const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.18 + sway);
        tmpQ.multiply(lean);
        tmpM.compose(tmpV.set(x, 0, z), tmpQ, tmpS.set(def.scale * UNIT_SCALE, def.scale * UNIT_SCALE * (1 + sway * 0.1), def.scale * UNIT_SCALE));
        this.infected.setMatrixAt(zi, tmpM);
        tmpC.setHex(def.color);
        if (this.overlay === "danger") tmpC.lerp(new THREE.Color(0xff3020), 0.5);
        this.infected.setColorAt(zi, tmpC);
        zi++;
        const h = e.health!;
        if (h.hp < h.max) addBar(x, 2.1 * def.scale * UNIT_SCALE, z, h.hp / h.max, 0xd04a3a);
      }
    }
    this.survivors.count = su;
    this.heads.count = su;
    this.packs.count = sp;
    this.rings.count = sr;
    this.infected.count = zi;
    this.hpBg.count = bars;
    this.hpFg.count = bars;
    for (const m of [this.survivors, this.heads, this.packs, this.rings, this.infected, this.hpBg, this.hpFg]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private updateStructures(sim: Simulation): void {
    let n = 0;
    let b = 0;
    this.structureIds.length = 0;
    this.blueprintIds.length = 0;
    const cell = sim.grid.cell;
    for (const e of sim.structures()) {
      const s = e.structure;
      const def = STRUCTURES[s.kind];
      const size = def.size * cell;
      const cx = (s.cx + def.size / 2) * cell;
      const cz = (s.cy + def.size / 2) * cell;
      if (s.built) {
        if (n >= MAX_STRUCTURES) continue;
        const inset = s.kind === "wall" || s.kind === "gate" ? 0 : 0.3;
        tmpM.compose(tmpV.set(cx, 0, cz), tmpQ.identity(), tmpS.set(size - inset, def.height, size - inset));
        this.structures.setMatrixAt(n, tmpM);
        tmpC.setHex(def.color);
        const hpFrac = e.health ? e.health.hp / e.health.max : 1;
        if (hpFrac < 0.99) tmpC.lerp(new THREE.Color(0x8a2a20), (1 - hpFrac) * 0.8);
        if (e.id === this.selection.structure) tmpC.lerp(new THREE.Color(0xffd34d), 0.4);
        this.structures.setColorAt(n, tmpC);
        this.structureIds[n++] = e.id;
      } else {
        if (b >= MAX_STRUCTURES) continue;
        const frac = Math.max(0.08, s.progress / def.work);
        tmpM.compose(tmpV.set(cx, 0, cz), tmpQ.identity(), tmpS.set(size - 0.1, Math.max(0.2, def.height * frac), size - 0.1));
        this.blueprints.setMatrixAt(b, tmpM);
        this.blueprints.setColorAt(b, tmpC.setHex(e.id === this.selection.structure ? 0xffd34d : 0x6fd0ff));
        this.blueprintIds[b++] = e.id;
      }
    }
    this.structures.count = n;
    this.blueprints.count = b;
    for (const m of [this.structures, this.blueprints]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private updateSelection(sim: Simulation): void {
    const i = this.selection.building;
    if (i >= 0) {
      const b = sim.city.buildings[i];
      this.selectionBox.visible = true;
      this.selectionBox.position.set(b.rect.x + b.rect.w / 2, 0, b.rect.y + b.rect.h / 2);
      this.selectionBox.scale.set(b.rect.w + 0.6, b.height + 0.8, b.rect.h + 0.6);
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
    for (const fx of sim.fx) {
      if (fx.seq <= this.lastFxSeq) continue;
      if (fx.type !== "shot") continue;
      const i = this.tracerNext;
      this.tracerNext = (this.tracerNext + 1) % MAX_TRACERS;
      pos.setXYZ(i * 2, fx.x, 1.3, fx.y);
      pos.setXYZ(i * 2 + 1, fx.tx, 1.0, fx.ty);
      this.tracerAge[i] = 0.12;
    }
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
