import * as THREE from "three";
import type { BuildingDef } from "@afterfall/world";

/** Outline of a building: its real footprint, or its rectangle. */
export function outlineOf(b: BuildingDef): { x: number; y: number }[] {
  if (b.footprint) return b.footprint;
  const r = b.rect;
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

interface Range {
  start: number;
  count: number;
}

/**
 * All buildings as extruded outlines in two merged meshes (walls with
 * roofs, and the window bands), with per-building vertex colors. Works for
 * rectangles and real footprints alike, and maps ray hits back to buildings.
 */
export class BuildingBatch {
  readonly mesh: THREE.Mesh;
  readonly windows: THREE.Mesh;
  private wallRanges: Range[] = [];
  private roofRanges: Range[] = [];
  private windowRanges: Range[] = [];
  /** Building index of each triangle of the main mesh. */
  private triOwner: Int32Array;

  constructor(buildings: BuildingDef[], windowMat: THREE.Material) {
    const pos: number[] = [];
    const nrm: number[] = [];
    const wpos: number[] = [];
    const wnrm: number[] = [];
    const owners: number[] = [];
    for (const b of buildings) {
      const poly = outlineOf(b);
      const start = pos.length / 3;
      walls(poly, 0, b.height, pos, nrm);
      this.wallRanges.push({ start, count: pos.length / 3 - start });
      const roofStart = pos.length / 3;
      roof(poly, b.height, pos, nrm);
      this.roofRanges.push({ start: roofStart, count: pos.length / 3 - roofStart });
      for (let t = start; t < pos.length / 3; t += 3) owners.push(b.index);
      // Window band: a thin ring just outside the walls, on the first floor.
      const wStart = wpos.length / 3;
      const y0 = Math.min(b.height - 1.6, 1.6);
      walls(inflate(poly, 0.05), y0, y0 + 0.7, wpos, wnrm);
      this.windowRanges.push({ start: wStart, count: wpos.length / 3 - wStart });
    }
    this.triOwner = Int32Array.from(owners);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
    this.mesh.castShadow = this.mesh.receiveShadow = true;

    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
    wgeo.setAttribute("normal", new THREE.Float32BufferAttribute(wnrm, 3));
    wgeo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(wpos.length).fill(0), 3));
    wgeo.computeBoundingSphere();
    this.windows = new THREE.Mesh(wgeo, windowMat);
  }

  setColors(i: number, wall: THREE.Color, roofColor: THREE.Color, windowColor: THREE.Color): void {
    paint(this.mesh.geometry, this.wallRanges[i], wall);
    paint(this.mesh.geometry, this.roofRanges[i], roofColor);
    paint(this.windows.geometry, this.windowRanges[i], windowColor);
  }

  commitColors(): void {
    this.mesh.geometry.getAttribute("color").needsUpdate = true;
    this.windows.geometry.getAttribute("color").needsUpdate = true;
  }

  /** Building under the ray, or -1. */
  pick(raycaster: THREE.Raycaster): number {
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || hit.faceIndex == null) return -1;
    return this.triOwner[hit.faceIndex] ?? -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.windows.geometry.dispose();
  }
}

function paint(geo: THREE.BufferGeometry, r: Range, c: THREE.Color): void {
  const a = geo.getAttribute("color") as THREE.BufferAttribute;
  const arr = a.array as Float32Array;
  for (let v = r.start; v < r.start + r.count; v++) {
    arr[v * 3] = c.r;
    arr[v * 3 + 1] = c.g;
    arr[v * 3 + 2] = c.b;
  }
}

/** Polygon centroid, used to know which side of a wall is outside. */
function center(poly: { x: number; y: number }[]): { x: number; y: number } {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

function isCcw(poly: { x: number; y: number }[]): boolean {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return a > 0;
}

/** Wall quads between y0 and y1, wound and lit to face outward. */
function walls(poly: { x: number; y: number }[], y0: number, y1: number, pos: number[], nrm: number[]): void {
  const ccw = isCcw(poly);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    // Outward normal in the ground plane (x, z = map y).
    let nx = (b.y - a.y) / len;
    let nz = -(b.x - a.x) / len;
    if (!ccw) {
      nx = -nx;
      nz = -nz;
    }
    // Two triangles; order them so the face normal points outward.
    const tri = [
      [a.x, y0, a.y],
      [b.x, y0, b.y],
      [b.x, y1, b.y],
      [a.x, y0, a.y],
      [b.x, y1, b.y],
      [a.x, y1, a.y],
    ];
    const ex = b.x - a.x;
    const ez = b.y - a.y;
    // Face normal of (a0, b0, b1) is (edge × up); flip the order when it points inward.
    const fx = -ez;
    const fz = ex;
    if (fx * nx + fz * nz < 0) {
      [tri[1], tri[2]] = [tri[2], tri[1]];
      [tri[4], tri[5]] = [tri[5], tri[4]];
    }
    for (const v of tri) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(nx, 0, nz);
    }
  }
}

function roof(poly: { x: number; y: number }[], y: number, pos: number[], nrm: number[]): void {
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [i, j, k] of tris) {
    const a = poly[i];
    let b = poly[j];
    let c = poly[k];
    // Upward face: (b - a) × (c - a) must have a positive y component.
    const cy = (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
    if (cy < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      pos.push(p.x, y, p.y);
      nrm.push(0, 1, 0);
    }
  }
}

function inflate(poly: { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const c = center(poly);
  return poly.map((p) => {
    const l = Math.hypot(p.x - c.x, p.y - c.y) || 1;
    return { x: p.x + ((p.x - c.x) / l) * d, y: p.y + ((p.y - c.y) / l) * d };
  });
}
