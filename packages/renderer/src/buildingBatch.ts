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

/** Facade families, each one baked module (`tools/blender/facades.py`). */
export type FacadeStyle = "residential" | "office" | "industrial";

const STYLE_OF: Record<string, FacadeStyle> = {
  house: "residential",
  apartment: "residential",
  shop: "office",
  supermarket: "office",
  pharmacy: "office",
  office: "office",
  hospital: "office",
  school: "office",
  police: "office",
  warehouse: "industrial",
};

/** Types whose ground floor is a shop front with roller shutters. */
const STOREFRONT = new Set(["shop", "supermarket", "pharmacy"]);

/** The courtyards of a footprint, or none. */
export function holesOf(b: BuildingDef): { x: number; y: number }[][] {
  return b.holes ?? [];
}

export function facadeStyle(type: string): FacadeStyle {
  return STYLE_OF[type] ?? "residential";
}

/** The game's floor height, and the facade module: 4 bays by 4 floors. */
export const FLOOR = 3.2;
export const MODULE = 4 * FLOOR;
/** Every building is `floors * FLOOR + TOP` tall; the top is the parapet band. */
const TOP = 0.6;
/** The parapet stands this far above the roof, and is this thick. */
const PARAPET = 0.55;
const PARAPET_T = 0.3;
/** How far the cornice stands out of the wall. */
const CORNICE_OUT = 0.12;

/** Draw groups, one material each, in this order. */
export const GROUPS = ["residential", "office", "industrial", "storefront", "roof", "trim"] as const;
export type Group = (typeof GROUPS)[number];

interface Range {
  group: Group;
  start: number;
  count: number;
}

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  owner: number[] = [];
  get vertices(): number {
    return this.pos.length / 3;
  }
}

/** The surface maps the batch wears, all optional: a missing one keeps the flat colour. */
export interface FacadeArt {
  facade_residential: THREE.Texture | null;
  facade_office: THREE.Texture | null;
  facade_industrial: THREE.Texture | null;
  facade_storefront: THREE.Texture | null;
  facade_residential_lit: THREE.Texture | null;
  facade_office_lit: THREE.Texture | null;
  facade_industrial_lit: THREE.Texture | null;
  facade_storefront_lit: THREE.Texture | null;
  roof: THREE.Texture | null;
  roof_detail?: THREE.Texture | null;
  concrete: THREE.Texture | null;
}

/**
 * Brings each map's mean (linear light) up to the concrete map the buildings
 * wore before, about 0.45: the tar roof averages 0.25 and the office glass
 * 0.25, and multiplied under the building tint they went black at night.
 * Measured on the shipped JPEGs; applied only once the map is there, so the
 * flat-colour fallback is unchanged.
 */
const MAP_GAIN: Record<Group, number> = {
  residential: 1.15,
  office: 1.5,
  industrial: 1.25,
  storefront: 1.25,
  roof: 1.8,
  trim: 1,
};

const WINDOW_GLOW = new THREE.Color(0xffa94d);

/**
 * All buildings as extruded outlines in one merged mesh: facades by style,
 * a shop front on the ground floor of shops, a cornice and parapet around a
 * textured roof. Vertex colours carry the per-building tint (type, explored,
 * looted, function, overlays), so the facade maps are near neutral and
 * multiply under it. A per-vertex `glow` gates the night windows, so only
 * settlement buildings light up. Works for rectangles and real footprints,
 * and maps ray hits back to buildings.
 */
export class BuildingBatch {
  readonly mesh: THREE.Mesh;
  readonly materials: Record<Group, THREE.MeshStandardMaterial>;
  private ranges: Range[][] = [];
  /** Building index of each triangle of the mesh. */
  private triOwner: Int32Array;
  private night = 0;
  private lit: Partial<Record<Group, boolean>> = {};

  constructor(buildings: BuildingDef[]) {
    const parts = Object.fromEntries(GROUPS.map((g) => [g, new Builder()])) as Record<Group, Builder>;
    const local: { group: Group; start: number; count: number }[][] = [];
    for (const b of buildings) {
      const mine: { group: Group; start: number; count: number }[] = [];
      const add = (group: Group, fn: (out: Builder) => void) => {
        const out = parts[group];
        const start = out.vertices;
        fn(out);
        const count = out.vertices - start;
        for (let t = 0; t < count / 3; t++) out.owner.push(b.index);
        if (count) mine.push({ group, start, count });
      };
      const poly = outlineOf(b);
      const holes = holesOf(b);
      const top = Math.max(FLOOR * 0.5, b.height - TOP);
      const style = facadeStyle(b.type);
      // Shift each building by whole bays and floors, so neighbours do not
      // show the same lit windows and boards in the same places.
      const du = ((b.index * 5) % 4) * FLOOR;
      const dv = ((b.index * 3) % 4) * FLOOR;
      if (b.landmark) {
        buildLandmark(b, poly, style, du, dv, add);
        local.push(mine);
        continue;
      }
      let base = 0;
      if (STOREFRONT.has(b.type) && top >= FLOOR * 1.5) {
        add("storefront", (o) => walls(poly, 0, FLOOR, o, du, 0, MODULE, FLOOR));
        base = FLOOR;
      }
      // A footprint that is much taller than it is wide reads as a slab unless its top
      // steps in: the taper costs one extra ring and makes every slim tower read as one.
      const width = Math.min(b.rect.w, b.rect.h);
      const slim = width > 0.5 && b.height / width > 5;
      if (slim) {
        const shoulder = base + (top - base) * 0.55;
        add(style, (o) => walls(poly, base, shoulder, o, du, dv, MODULE, MODULE));
        add(style, (o) => frustumWalls(poly, scalePoly(poly, 0.78), shoulder, top, o, du, dv, MODULE, MODULE));
      } else {
        add(style, (o) => walls(poly, base, top, o, du, dv, MODULE, MODULE));
        add("trim", (o) => facadeDetails(poly, base, top, style, du, o));
      }
      // The crown follows the walls: a building whose top stepped in cannot carry a
      // cornice and a roof at the width of its base, or the taper disappears under it.
      const crown = slim ? scalePoly(poly, 0.78) : poly;
      add("trim", (o) => cornice(crown, top, b.height + PARAPET, o));
      add("roof", (o) => roof(crown, b.height, o, holes));
      // A courtyard is a hole you can see into: its walls face the yard, not the street.
      for (const hole of holes) add(style, (o) => walls(hole, 0, b.height, o, du, dv, MODULE, MODULE, true));
      local.push(mine);
    }

    // Concatenate the groups; ranges and owners move with them.
    //
    // Typed arrays and `set`, not `push(...array)`: spreading the vertex list as call
    // arguments overflowed the stack on a ten-by-ten-block city (435 buildings), which is
    // smaller than a real imported neighbourhood. The game could not start on a map the
    // importer happily produced.
    const total = GROUPS.reduce((n, g) => n + parts[g].vertices, 0);
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    // `owner` holds one id per triangle, not per vertex, so its offset moves in triangles.
    const owners = new Int32Array(total / 3);
    const offset: Partial<Record<Group, number>> = {};
    const geo = new THREE.BufferGeometry();
    let at = 0;
    let triAt = 0;
    for (const [i, g] of GROUPS.entries()) {
      const p = parts[g];
      offset[g] = at;
      geo.addGroup(at, p.vertices, i);
      pos.set(p.pos, at * 3);
      nrm.set(p.nrm, at * 3);
      uv.set(p.uv, at * 2);
      owners.set(p.owner, triAt);
      at += p.vertices;
      triAt += p.owner.length;
    }
    this.ranges = local.map((mine) => mine.map((r) => ({ group: r.group, start: r.start + offset[r.group]!, count: r.count })));
    this.triOwner = owners;

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    geo.setAttribute("glow", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    geo.computeBoundingSphere();

    this.materials = Object.fromEntries(GROUPS.map((g) => [g, facadeMaterial(g)])) as Record<Group, THREE.MeshStandardMaterial>;
    this.mesh = new THREE.Mesh(
      geo,
      GROUPS.map((g) => this.materials[g]),
    );
    this.mesh.castShadow = this.mesh.receiveShadow = true;
  }

  /** Per-building colours: walls, roof and trim, and whether its windows glow at night. */
  setColors(i: number, wall: THREE.Color, roofColor: THREE.Color, glow: number): void {
    const color = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const glowAttr = this.mesh.geometry.getAttribute("glow") as THREE.BufferAttribute;
    const trim = tmp.copy(wall).multiplyScalar(0.86);
    for (const r of this.ranges[i] ?? []) {
      const c = r.group === "roof" ? roofColor : r.group === "trim" ? trim : wall;
      paint(color, r, c);
      const g = glowAttr.array as Float32Array;
      g.fill(glow, r.start, r.start + r.count);
    }
  }

  commitColors(): void {
    this.mesh.geometry.getAttribute("color").needsUpdate = true;
    this.mesh.geometry.getAttribute("glow").needsUpdate = true;
  }

  /** Gives the batch its maps as they arrive; a missing one keeps the flat colour. */
  setArt(art: Partial<FacadeArt>): void {
    for (const g of GROUPS) {
      const mat = this.materials[g];
      const map = g === "trim" ? art.concrete : g === "roof" ? art.roof : art[`facade_${g}` as keyof FacadeArt];
      const lit = g === "trim" || g === "roof" ? null : art[`facade_${g}_lit` as keyof FacadeArt];
      let dirty = false;
      if (map && mat.map !== map) {
        mat.map = map;
        mat.color.setScalar(MAP_GAIN[g]);
        dirty = true;
      }
      if (lit && mat.emissiveMap !== lit) {
        mat.emissiveMap = lit;
        this.lit[g] = true;
        dirty = true;
      }
      if (g === "roof" && art.roof_detail && mat.bumpMap !== art.roof_detail) {
        mat.bumpMap = mat.roughnessMap = art.roof_detail;
        mat.bumpScale = 0.045;
        dirty = true;
      }
      if (dirty) mat.needsUpdate = true;
    }
    this.setNight(this.night);
  }

  /**
   * 0 by day, 1 at night. Only a style whose lit mask has arrived glows:
   * without the mask, the emissive term would light the whole wall.
   */
  setNight(amount: number): void {
    this.night = amount;
    // Below 1, so a lit window stays amber instead of clipping to cream.
    for (const g of GROUPS) this.materials[g].emissiveIntensity = this.lit[g] ? amount * 0.9 : 0;
  }

  /** Building that owns a triangle, or -1. Exposed so tests can audit the whole batch. */
  ownerOfTriangle(t: number): number {
    return this.triOwner[t] ?? -1;
  }

  /** Building under the ray, or -1. */
  pick(raycaster: THREE.Raycaster): number {
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || hit.faceIndex == null) return -1;
    return this.triOwner[hit.faceIndex] ?? -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const g of GROUPS) this.materials[g].dispose();
  }
}

const tmp = new THREE.Color();

function facadeMaterial(group: Group): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: group === "roof" ? 0.95 : 0.86,
    emissive: WINDOW_GLOW,
    emissiveIntensity: 0,
  });
  // The lit-window mask is shared by every building of a style; the per-vertex
  // `glow` decides which buildings use it (settlement buildings only).
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;\nvarying vec3 facadePosition;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;\nfacadePosition = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nvarying vec3 facadePosition;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;");
    if (group !== "roof") {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float column = floor((facadePosition.x + facadePosition.z) * 1.9);
        float streak = fract(sin(column * 127.1) * 43758.5453);
        float damp = 1.0 - smoothstep(0.2, 2.6, facadePosition.y);
        float rain = smoothstep(0.68, 0.98, streak) * 0.12;
        diffuseColor.rgb *= 1.0 - damp * 0.23 - rain;
      `,
      );
    }
  };
  mat.customProgramCacheKey = () => `facade-weather-${group}`;
  return mat;
}

/** Shallow floor bands and residential sills cast real highlights and shadows. */
function facadeDetails(poly: { x: number; y: number }[], base: number, top: number, style: FacadeStyle, du: number, out: Builder): void {
  const outer = inflate(poly, 0.09);
  for (let y = Math.max(FLOOR, base); y < Math.min(top, FLOOR * 12); y += FLOOR) {
    walls(outer, y - 0.06, y + 0.06, out, 0, 0, 3, 3);
    ring(poly, outer, y + 0.06, 1, out);
    ring(poly, outer, y - 0.06, -1, out);
  }
  if (style !== "residential") return;
  let run = du;
  const sign = isCcw(poly) ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.1) continue;
    const dx = (b.x - a.x) / len,
      dz = (b.y - a.y) / len;
    const nx = dz * sign,
      nz = -dx * sign;
    for (let along = Math.ceil((run - 0.85) / FLOOR) * FLOOR + 0.85 - run; along + 1.5 < len; along += FLOOR) {
      if (along < 0.15) continue;
      const x = a.x + along * dx,
        z = a.y + along * dz;
      const sill = [
        { x, y: z },
        { x: x + dx * 1.5, y: z + dz * 1.5 },
        { x: x + dx * 1.5 + nx * 0.22, y: z + dz * 1.5 + nz * 0.22 },
        { x: x + nx * 0.22, y: z + nz * 0.22 },
      ];
      // Keep the ground floor flush: a projected sill must not cross a door.
      for (let y = Math.max(base, FLOOR) + 0.82; y < Math.min(top, FLOOR * 10); y += FLOOR) {
        walls(sill, y - 0.1, y, out, 0, 0, 3, 3);
        cap(sill, y, out, 3);
      }
    }
    run += len;
  }
}

function paint(a: THREE.BufferAttribute, r: Range, c: THREE.Color): void {
  const arr = a.array as Float32Array;
  for (let v = r.start; v < r.start + r.count; v++) {
    arr[v * 3] = c.r;
    arr[v * 3 + 1] = c.g;
    arr[v * 3 + 2] = c.b;
  }
}

function isCcw(poly: { x: number; y: number }[]): boolean {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return a > 0;
}

/**
 * Wall quads between y0 and y1, wound and lit to face outward (or inward, for
 * the inside of a parapet). U runs along the perimeter without restarting at
 * corners, V runs up the wall; both in metres over the module size, shifted by
 * whole bays and floors.
 */
function walls(
  poly: { x: number; y: number }[],
  y0: number,
  y1: number,
  out: Builder,
  du = 0,
  dv = 0,
  uSize = MODULE,
  vSize = MODULE,
  inward = false,
): void {
  if (y1 <= y0) return;
  const ccw = isCcw(poly);
  let run = du;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    let nx = (b.y - a.y) / len;
    let nz = -(b.x - a.x) / len;
    if (!ccw) {
      nx = -nx;
      nz = -nz;
    }
    if (inward) {
      nx = -nx;
      nz = -nz;
    }
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
    const fx = -ez;
    const fz = ex;
    if (fx * nx + fz * nz < 0) {
      [tri[1], tri[2]] = [tri[2], tri[1]];
      [tri[4], tri[5]] = [tri[5], tri[4]];
    }
    const u0 = run / uSize;
    const u1 = (run + len) / uSize;
    const v0 = (y0 + dv) / vSize;
    const v1 = (y1 + dv) / vSize;
    // UVs follow the same swap as the vertices.
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v0],
      [u1, v1],
      [u0, v1],
    ];
    if (fx * nx + fz * nz < 0) {
      [uvs[1], uvs[2]] = [uvs[2], uvs[1]];
      [uvs[4], uvs[5]] = [uvs[5], uvs[4]];
    }
    tri.forEach((v, k) => {
      out.pos.push(v[0], v[1], v[2]);
      out.nrm.push(nx, 0, nz);
      out.uv.push(uvs[k][0], uvs[k][1]);
    });
    run += len;
  }
}

/** Flat cap over a polygon at height y, facing up. */
function cap(poly: { x: number; y: number }[], y: number, out: Builder, tile: number, holes: { x: number; y: number }[][] = []): void {
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.y));
  const rings = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, rings);
  // The indices run over the contour followed by every hole, in order.
  const all = [...poly, ...holes.flat()];
  for (const [i, j, k] of tris) {
    const a = all[i];
    let b = all[j];
    let c = all[k];
    const cy = (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
    if (cy < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      out.pos.push(p.x, y, p.y);
      out.nrm.push(0, 1, 0);
      out.uv.push(p.x / tile, p.y / tile);
    }
  }
}

function roof(poly: { x: number; y: number }[], y: number, out: Builder, holes: { x: number; y: number }[][] = []): void {
  cap(poly, y, out, MODULE, holes);
}

/**
 * The top band: a cornice standing a little out of the wall from the last
 * floor line up to the parapet, the parapet's top, and its inner face down to
 * the roof. It gives every block a silhouette and a shadow line, where the old
 * box ended in a sharp edge.
 */
function cornice(poly: { x: number; y: number }[], y0: number, y1: number, out: Builder): void {
  const outer = inflate(poly, CORNICE_OUT);
  const inner = inflate(poly, -PARAPET_T);
  walls(outer, y0, y1, out, 0, 0, 3, 3);
  // Underside of the cornice lip, so it does not look paper thin from below.
  ring(poly, outer, y0, -1, out);
  ring(outer, inner, y1, 1, out);
  walls(inner, y1 - PARAPET, y1, out, 0, 0, 3, 3, true);
}

/** A flat ring between two outlines of the same polygon, at height y, facing up (1) or down (-1). */
function ring(a: { x: number; y: number }[], b: { x: number; y: number }[], y: number, up: 1 | -1, out: Builder): void {
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    const quad = [a[i], a[j], b[j], a[i], b[j], b[i]];
    // Wind for the requested facing.
    const e1x = quad[1].x - quad[0].x;
    const e1z = quad[1].y - quad[0].y;
    const e2x = quad[2].x - quad[0].x;
    const e2z = quad[2].y - quad[0].y;
    const ny = e1z * e2x - e1x * e2z;
    if (Math.sign(ny) !== up) {
      [quad[1], quad[2]] = [quad[2], quad[1]];
      [quad[4], quad[5]] = [quad[5], quad[4]];
    }
    for (const p of quad) {
      out.pos.push(p.x, y, p.y);
      out.nrm.push(0, up, 0);
      out.uv.push(p.x / 3, p.y / 3);
    }
  }
}

/**
 * Draws a landmark as the thing it is rather than as the square around its feet.
 *
 * OSM maps the Eiffel Tower as one way tagged `building=tower`, `height=330`, and its
 * footprint is the square that encloses the four legs: extruded like a building, the
 * tower becomes the hall between them, six floors tall. A tower wants rings that step in
 * as they rise, a church wants a slender spire over a squat nave, and a monument wants an
 * obelisk — all three come out of the same footprint and two dozen lines of geometry.
 */
function buildLandmark(
  b: BuildingDef,
  poly: { x: number; y: number }[],
  style: Group,
  du: number,
  dv: number,
  add: (group: Group, fn: (out: Builder) => void) => void,
): void {
  const h = b.height;
  const ring = (k: number) => scalePoly(poly, k);
  const wall = (g: Group, bottom: { x: number; y: number }[], top: { x: number; y: number }[], y0: number, y1: number) =>
    add(g, (o) => frustumWalls(bottom, top, y0, y1, o, du, dv, MODULE, MODULE));

  if (b.landmark === "tower") {
    // Four stages, each narrower than the one below it, then a mast.
    const stages: [number, number][] = [
      [0.0, 1.0],
      [0.16, 0.52],
      [0.42, 0.26],
      [0.68, 0.11],
    ];
    for (let i = 0; i < stages.length; i++) {
      const [at, k] = stages[i];
      const next = stages[i + 1]?.[1] ?? 0.11;
      const y0 = at * h;
      const y1 = (stages[i + 1]?.[0] ?? 0.92) * h;
      wall(style, ring(k), ring(next), y0, y1);
      if (i > 0) add("trim", (o) => cap(ring(k * 1.04), y0, o, MODULE));
    }
    add(style, (o) => walls(ring(0.11), 0.92 * h, h, o, du, dv, MODULE, MODULE));
    add("roof", (o) => cap(ring(0.11), h, o, MODULE));
    return;
  }

  if (b.landmark === "spire") {
    const nave = 0.45;
    add(style, (o) => walls(poly, 0, h * nave, o, du, dv, MODULE, MODULE));
    wall(style, poly, ring(0.03), h * nave, h);
    add("trim", (o) => cornice(ring(1.03), h * nave, h * nave + 0.6, o));
    return;
  }

  // Obelisk: a shaft that starts in the middle of itself and ends in a point.
  add(style, (o) => walls(poly, 0, h * 0.3, o, du, dv, MODULE, MODULE));
  wall(style, poly, ring(0.06), h * 0.3, h);
}

/** Shrinks a polygon towards its centroid — the cross-section of a leaning wall. */
function scalePoly(poly: { x: number; y: number }[], k: number): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x / poly.length;
    cy += p.y / poly.length;
  }
  return poly.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

/**
 * Connects two rings of the same length, so a wall can lean.
 *
 * `walls` builds a vertical quad from one polygon; a tower needs the top ring to be
 * smaller than the bottom one, and that is a different set of triangles with a normal
 * that is not horizontal.
 */
function frustumWalls(
  bottom: { x: number; y: number }[],
  top: { x: number; y: number }[],
  y0: number,
  y1: number,
  out: Builder,
  du = 0,
  dv = 0,
  uSize = MODULE,
  vSize = MODULE,
): void {
  if (y1 <= y0 || bottom.length !== top.length) return;
  let cx = 0;
  let cy = 0;
  for (const p of bottom) {
    cx += p.x / bottom.length;
    cy += p.y / bottom.length;
  }
  let run = du;
  for (let i = 0; i < bottom.length; i++) {
    const j = (i + 1) % bottom.length;
    const a0 = bottom[i];
    const b0 = bottom[j];
    const b1 = top[j];
    const a1 = top[i];
    const ex = b0.x - a0.x;
    const ez = b0.y - a0.y;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) continue;
    const ux = a1.x - a0.x;
    const uz = a1.y - a0.y;
    const uy = y1 - y0;
    // cross((ex, 0, ez), (ux, uy, uz))
    let nx = -ez * uy;
    let ny = ez * ux - ex * uz;
    let nz = ex * uy;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const mx = (a0.x + b0.x) / 2 - cx;
    const mz = (a0.y + b0.y) / 2 - cy;
    const tri = [
      [a0.x, y0, a0.y],
      [b0.x, y0, b0.y],
      [b1.x, y1, b1.y],
      [a0.x, y0, a0.y],
      [b1.x, y1, b1.y],
      [a1.x, y1, a1.y],
    ];
    if (nx * mx + nz * mz < 0) {
      [tri[1], tri[2]] = [tri[2], tri[1]];
      [tri[4], tri[5]] = [tri[5], tri[4]];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const u0 = run / uSize;
    const u1 = (run + len) / uSize;
    const v0 = (y0 + dv) / vSize;
    const v1 = (y1 + dv) / vSize;
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v0],
      [u1, v1],
      [u0, v1],
    ];
    if (tri[1][0] === b1.x && tri[1][1] === y1) {
      [uvs[1], uvs[2]] = [uvs[2], uvs[1]];
      [uvs[4], uvs[5]] = [uvs[5], uvs[4]];
    }
    tri.forEach((v, k) => {
      out.pos.push(v[0], v[1], v[2]);
      out.nrm.push(nx, ny, nz);
      out.uv.push(uvs[k][0], uvs[k][1]);
    });
    run += len;
  }
}

/** Offsets an outline along its corner bisectors (positive grows it). */
export function inflate(poly: { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const ccw = isCcw(poly);
  const n = poly.length;
  const res: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n];
    const c = poly[i];
    const q = poly[(i + 1) % n];
    const n1 = outward(p, c, ccw);
    const n2 = outward(c, q, ccw);
    let bx = n1.x + n2.x;
    let by = n1.y + n2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) {
      res.push({ x: c.x + n1.x * d, y: c.y + n1.y * d });
      continue;
    }
    bx /= bl;
    by /= bl;
    // Keep the offset distance along each edge's normal, capped at sharp corners.
    const cos = Math.max(0.35, bx * n1.x + by * n1.y);
    res.push({ x: c.x + (bx * d) / cos, y: c.y + (by * d) / cos });
  }
  return res;
}

function outward(a: { x: number; y: number }, b: { x: number; y: number }, ccw: boolean): { x: number; y: number } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = (b.y - a.y) / len;
  let ny = -(b.x - a.x) / len;
  if (!ccw) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}
