import * as THREE from "three";
import type { BuildingDef } from "@afterfall/world";
import { outlineOf } from "./buildingBatch";

/** Where a door sits: a point on the wall and the wall's outward normal (map x, y). */
export interface DoorSpot {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** The door map frames 2.4 m by 3.2 m: the door, its surround and the canopy's edge. */
const DOOR_W = 2.4;
const DOOR_H = 3.2;
const CANOPY = { w: 2.5, h: 0.15, d: 0.9, y: 2.97 };
const STEP = { w: 2.4, h: 0.15, d: 0.55 };
/** Farther than this from its wall, an entrance is not drawn as a door. */
const MAX_REACH = 6;

/**
 * The door of a building: from its entrance (a walkable point just outside),
 * back along `-facing` to the first wall of its outline. The entrance is what
 * the simulation uses, so the door is drawn exactly where survivors go in.
 */
export function doorSpot(b: BuildingDef): DoorSpot | null {
  const poly = outlineOf(b);
  const ox = b.entrance.x;
  const oy = b.entrance.y;
  const dx = -b.facing.x;
  const dy = -b.facing.y;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - ox) * ey - (a.y - oy) * ex) / den;
    const u = ((a.x - ox) * dy - (a.y - oy) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  if (best > MAX_REACH) return null;
  const len = Math.hypot(b.facing.x, b.facing.y) || 1;
  return { x: ox + dx * best, y: oy + dy * best, nx: b.facing.x / len, ny: b.facing.y / len };
}

/**
 * Every building's front door, canopy and step, as three instanced meshes:
 * three draw calls for the whole city. The canopy is what reads from the RTS
 * camera, which looks down on the street and barely sees a wall.
 */
export class Doors {
  readonly group = new THREE.Group();
  readonly spots: (DoorSpot | null)[];
  private doorMat: THREE.MeshStandardMaterial;
  private meshes: THREE.InstancedMesh[] = [];

  constructor(buildings: BuildingDef[]) {
    this.group.name = "doors";
    this.spots = buildings.map(doorSpot);
    const placed = this.spots.filter((s): s is DoorSpot => s !== null);

    const doorGeo = new THREE.PlaneGeometry(DOOR_W, DOOR_H);
    doorGeo.translate(0, DOOR_H / 2, 0);
    this.doorMat = new THREE.MeshStandardMaterial({ color: 0x8f8b82, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xbab6ac, roughness: 0.9 });

    const canopyGeo = new THREE.BoxGeometry(CANOPY.w, CANOPY.h, CANOPY.d);
    canopyGeo.translate(0, CANOPY.y, CANOPY.d / 2);
    const stepGeo = new THREE.BoxGeometry(STEP.w, STEP.h, STEP.d);
    stepGeo.translate(0, STEP.h / 2, STEP.d / 2);

    const door = new THREE.InstancedMesh(doorGeo, this.doorMat, Math.max(1, placed.length));
    const canopy = new THREE.InstancedMesh(canopyGeo, trim, Math.max(1, placed.length));
    const step = new THREE.InstancedMesh(stepGeo, trim, Math.max(1, placed.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    placed.forEach((s, i) => {
      // Local +Z is the door's front: turn it to the wall's outward normal.
      q.setFromAxisAngle(up, Math.atan2(s.nx, s.ny));
      p.set(s.x + s.nx * 0.02, 0, s.y + s.ny * 0.02);
      m.compose(p, q, one);
      door.setMatrixAt(i, m);
      canopy.setMatrixAt(i, m);
      step.setMatrixAt(i, m);
    });
    for (const mesh of [door, canopy, step]) {
      mesh.count = placed.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    canopy.castShadow = true;
  }

  /** Gives the doors their map once it has loaded; until then they are flat. */
  setMap(tex: THREE.Texture | null): void {
    if (!tex || this.doorMat.map === tex) return;
    // The map is not tiled: clamp it, so mipmaps do not bleed the opposite edge in.
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.doorMat.map = tex;
    this.doorMat.color.setHex(0xffffff);
    this.doorMat.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
