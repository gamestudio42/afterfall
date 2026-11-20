import * as THREE from "three";
import { heightRange, latticeFrame, type BuildingDef, type TerrainDef } from "@afterfall/world";
import { latticeTower } from "./lattice";

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

/**
 * Where a building sits on a hillside: `foot` is the lowest ground under its outline, `base`
 * where its walls start. A building stands on its foot, the uphill wall running into the
 * hill, unless the hill would reach past its roof: then it is raised until the roof clears
 * the highest ground by a storey's worth, on a stone plinth down to the foot.
 */
export function buildingSeat(b: BuildingDef, terrain: TerrainDef | undefined): { base: number; foot: number } {
  if (!terrain) return { base: 0, foot: 0 };
  const r = heightRange(terrain, [...outlineOf(b), { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 }]);
  const clear = Math.min(2.5, b.height * 0.5);
  return { foot: r.min, base: Math.max(r.min, r.max + clear - b.height) };
}

/** How far a plinth reaches under the foot, so it never shows a gap at the low corner. */
const PLINTH_SINK = 0.4;

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
/** `iron` is untextured: the members of a lattice tower (lattice.ts). */
export const GROUPS = ["residential", "office", "industrial", "storefront", "roof", "trim", "iron"] as const;
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
  iron: 1,
};

const WINDOW_GLOW = new THREE.Color(0xffa94d);

/**
 * How far gone a building is, 0 (shut up and sound) to 1 (burnt out, overgrown).
 * Most are in between and a few are wrecks, so a street reads as abandoned without
 * every facade shouting it. Deterministic per building; the litter scatter reads it
 * too, so the worst buildings have the most rubble at their feet.
 */
export function buildingDecay(b: Pick<BuildingDef, "index">): number {
  let h = Math.imul(b.index + 1, 2654435761) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  return 0.12 + 0.88 * Math.pow(r, 1.6);
}

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
  /** What each building is painted with (wall and glow, roof), so an unchanged one is skipped. */
  private painted: Float64Array;
  /** Vertex ranges repainted since the last commit. */
  private dirty: Range[] = [];

  constructor(buildings: BuildingDef[], terrain?: TerrainDef) {
    const parts = Object.fromEntries(GROUPS.map((g) => [g, new Builder()])) as Record<Group, Builder>;
    const local: { group: Group; start: number; count: number }[][] = [];
    const seats = buildings.map((b) => buildingSeat(b, terrain));
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
      // A raised building's plinth, in the building's own frame (below its base at 0).
      const seat = seats[b.index] ?? { base: 0, foot: 0 };
      if (seat.base - seat.foot > 0.1 && b.landmark !== "lattice")
        add("trim", (o) => walls(poly, seat.foot - seat.base - PLINTH_SINK, 0, o, 0, 0, 3, 3));
      const top = Math.max(FLOOR * 0.5, b.height - TOP);
      const style = facadeStyle(b.type);
      // Shift each building by whole bays and floors, so neighbours do not
      // show the same lit windows and boards in the same places.
      const du = ((b.index * 5) % 4) * FLOOR;
      const dv = ((b.index * 3) % 4) * FLOOR;
      if (b.landmark === "lattice") {
        add("iron", (o) => latticeTower(b, o));
        local.push(mine);
        continue;
      }
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
    this.painted = new Float64Array(buildings.length * 2).fill(-1);
    this.triOwner = owners;

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    geo.setAttribute("glow", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    const decay = new Float32Array(pos.length / 3);
    // On a hillside a building stands on the lowest ground under its outline: the downhill
    // wall meets the ground, the uphill one runs into it. The facade shader measures its
    // grime and creepers from this base, not from sea level.
    const groundY = new Float32Array(pos.length / 3);
    buildings.forEach((b, i) => {
      const d = buildingDecay(b);
      const base = seats[i].base;
      for (const r of this.ranges[i] ?? []) {
        decay.fill(d, r.start, r.start + r.count);
        if (!base) continue;
        groundY.fill(base, r.start, r.start + r.count);
        for (let v = r.start; v < r.start + r.count; v++) pos[v * 3 + 1] += base;
      }
    });
    geo.setAttribute("decay", new THREE.Float32BufferAttribute(decay, 1));
    geo.setAttribute("groundY", new THREE.Float32BufferAttribute(groundY, 1));
    geo.computeBoundingSphere();

    this.materials = Object.fromEntries(GROUPS.map((g) => [g, facadeMaterial(g)])) as Record<Group, THREE.MeshStandardMaterial>;
    this.mesh = new THREE.Mesh(
      geo,
      GROUPS.map((g) => this.materials[g]),
    );
    this.mesh.castShadow = this.mesh.receiveShadow = true;
  }

  /**
   * Per-building colours: walls, roof and trim, and whether its windows glow at night.
   *
   * The game asks for every building's colour five times a second and almost none of
   * them change, so a building that already wears the colour is skipped, and only the
   * vertex ranges that were repainted are sent to the GPU (see `commitColors`).
   */
  setColors(i: number, wall: THREE.Color, roofColor: THREE.Color, glow: number): void {
    const key = wall.getHex() * 2 + (glow ? 1 : 0);
    const roofKey = roofColor.getHex();
    if (this.painted[i * 2] === key && this.painted[i * 2 + 1] === roofKey) return;
    this.painted[i * 2] = key;
    this.painted[i * 2 + 1] = roofKey;
    const color = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const glowAttr = this.mesh.geometry.getAttribute("glow") as THREE.BufferAttribute;
    const trim = tmp.copy(wall).multiplyScalar(0.86);
    for (const r of this.ranges[i] ?? []) {
      const c = r.group === "roof" ? roofColor : r.group === "trim" ? trim : wall;
      paint(color, r, c);
      const g = glowAttr.array as Float32Array;
      g.fill(glow, r.start, r.start + r.count);
      this.dirty.push(r);
    }
  }

  /** Sends what `setColors` repainted since the last call, and nothing when nothing changed. */
  commitColors(): void {
    if (this.dirty.length === 0) return;
    const color = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const glow = this.mesh.geometry.getAttribute("glow") as THREE.BufferAttribute;
    color.clearUpdateRanges();
    glow.clearUpdateRanges();
    // A handful of buildings go as their own ranges; a repaint of the whole city (a new
    // map, an overlay) is cheaper as one upload than as thousands of small ones.
    if (this.dirty.length <= MAX_DIRTY_RANGES) {
      for (const r of this.dirty) {
        color.addUpdateRange(r.start * 3, r.count * 3);
        glow.addUpdateRange(r.start, r.count);
      }
    }
    this.dirty.length = 0;
    color.needsUpdate = true;
    glow.needsUpdate = true;
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
/** Above this many repainted ranges the colour buffers are uploaded whole. */
const MAX_DIRTY_RANGES = 96;

/**
 * Where each style's windows sit inside a 3.2 m bay and floor, as `tools/blender/facades.py`
 * bakes them: centre across, half width, sill and head heights. Fire damage starts there.
 * Industrial walls only glaze every other floor; the storefront is left to its shutters.
 */
const WINDOWS: Partial<Record<Group, { cx: number; hw: number; sill: number; head: number; alternate: boolean }>> = {
  residential: { cx: 1.6, hw: 0.65, sill: 0.9, head: 2.5, alternate: false },
  office: { cx: 1.6, hw: 1.5, sill: 0.85, head: 2.75, alternate: false },
  industrial: { cx: 1.6, hw: 1.3, sill: 1.9, head: 2.7, alternate: true },
};

const f = (v: number) => v.toFixed(3);

/** Value noise and a hash, shared by the decay terms. */
const DECAY_COMMON = /* glsl */ `
  float dHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float dNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), f.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + 1.0), f.x), f.y);
  }
`;

/**
 * The wear of years on a wall, from the building's decay: soot plumes over burnt-out
 * windows (never on a building the settlement uses), plaster spalled off in patches,
 * creepers climbing from the ground, and a moss and grime that thickens with decay.
 */
function wallDecay(group: Group): string {
  const w = WINDOWS[group];
  const burn = w
    ? `
        // Fire: a share of the windows burnt out, black inside, soot fanning up the wall.
        float burnt = 0.0;
        float fireChance = smoothstep(0.3, 0.9, vDecay) * 0.6 * (1.0 - step(0.5, vGlow));
        for (int k = 0; k < 3; k++) {
          vec2 src = vec2(cell.x, cell.y - float(k));
          ${w.alternate ? "if (mod(src.y, 2.0) < 0.5) continue;" : ""}
          // Salted by the building, rounded: an interpolated varying differs in its last
          // bits from pixel to pixel, and a hash turns that into speckle.
          if (dHash(src + floor(vDecay * 997.0 + 0.5) * 0.731) >= fireChance) continue;
          float x = inCell.x - ${f(w.cx)};
          float up = inCell.y + float(k) * 3.2;
          // Inside the opening: charred black.
          float opening = step(abs(x), ${f(w.hw)}) * step(${f(w.sill)}, up) * step(up, ${f(w.head)});
          // Above it: a plume that widens and fades as it climbs, ragged at the edges.
          float rise = up - ${f(w.head)};
          float width = ${f(w.hw)} * 1.05 + rise * 0.45;
          float plume = step(0.0, rise) * exp(-rise / 3.4) * smoothstep(width, width * 0.35, abs(x) + (dNoise(facadeMetres * 2.3) - 0.5) * 0.5);
          burnt = max(burnt, max(opening, plume * 0.92));
        }
        diffuseColor.rgb *= 1.0 - burnt * 0.9;
        burntWindow = burnt;`
    : "";
  return /* glsl */ `
        vec2 cell = floor(facadeMetres / 3.2);
        vec2 inCell = facadeMetres - cell * 3.2;
        float rot = smoothstep(0.2, 1.0, vDecay);
        // Plaster spalled off in patches: paler, flatter render underneath.
        float spall = smoothstep(0.66, 0.74, dNoise(facadeMetres * vec2(0.55, 0.8) + vDecay * 37.0)) * rot;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.12, 1.02) + 0.035, spall * 0.7);
        // Creepers from the ground: columns of uneven height, thinning as they climb.
        float column = dNoise(vec2(facadeMetres.x * 0.9, 3.7));
        float reach = vDecay * (2.0 + 12.0 * column * column);
        float vine = smoothstep(0.42, 0.6, dNoise(facadeMetres * vec2(1.6, 0.45))) * (1.0 - smoothstep(reach * 0.55, reach, facadePosition.y));
        vine *= smoothstep(0.25, 0.5, column) * smoothstep(0.12, 0.45, vDecay);
        float leaf = dNoise(facadeMetres * 7.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.15, 0.06) + leaf * vec3(0.06, 0.08, 0.02), vine * 0.9);
        // Grime climbing from the street, higher on the worse buildings.
        diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 1.0 + 3.0 * vDecay, facadePosition.y)) * 0.18 * vDecay;
        ${burn}
      `;
}

/** A flat roof left to rain: moss in the low corners, tar bleached, puddle stains. */
const ROOF_DECAY = /* glsl */ `
        float rot = smoothstep(0.15, 1.0, vDecay);
        vec2 p = facadePosition.xz;
        float moss = smoothstep(0.55, 0.75, dNoise(p * 0.22 + vDecay * 13.0) * 0.7 + dNoise(p * 0.9) * 0.3) * rot;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.19, 0.08) * (0.8 + dNoise(p * 4.0) * 0.4), moss * 0.85);
        float stain = smoothstep(0.62, 0.7, dNoise(p * 0.4 + 7.0)) * rot;
        diffuseColor.rgb *= 1.0 - stain * 0.22;
`;

function facadeMaterial(group: Group): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: group === "roof" ? 0.95 : group === "iron" ? 0.62 : 0.86,
    // Painted wrought iron: a little sheen where the sky catches a member, never a mirror.
    metalness: group === "iron" ? 0.3 : 0,
    emissive: WINDOW_GLOW,
    emissiveIntensity: 0,
  });
  // The lit-window mask is shared by every building of a style; the per-vertex
  // `glow` decides which buildings use it (settlement buildings only).
  const varyings = "varying float vGlow;\nvarying vec3 facadePosition;\nvarying float vDecay;\nvarying vec2 facadeMetres;";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float glow;\nattribute float decay;\nattribute float groundY;\n${varyings}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvGlow = glow;\nfacadePosition = position - vec3(0.0, groundY, 0.0);\nvDecay = decay;\nfacadeMetres = uv * ${f(MODULE)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${varyings}\n// How much of this fragment is a burnt-out window, so it never glows at night.\nfloat burntWindow = 0.0;\n${DECAY_COMMON}`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow * (1.0 - burntWindow);");
    if (group !== "roof") {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float column = floor((facadePosition.x + facadePosition.z) * 1.9);
        float streak = fract(sin(column * 127.1) * 43758.5453);
        float damp = 1.0 - smoothstep(0.2, 2.6, facadePosition.y);
        float rain = smoothstep(0.68, 0.98, streak) * 0.12;
        diffuseColor.rgb *= 1.0 - damp * 0.23 - rain;
        ${group === "trim" || group === "iron" ? "" : `{${wallDecay(group)}}`}
      `,
      );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>\n{${ROOF_DECAY}}`);
    }
  };
  mat.customProgramCacheKey = () => `facade-decay-${group}`;
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

  if (b.landmark === "pyramid") {
    // Four faces to an apex; a sliver of a cap so the point is closed.
    add("trim", (o) => frustumWalls(poly, ring(0.015), 0, h, o, du, dv, MODULE, MODULE));
    add("trim", (o) => cap(ring(0.015), h, o, MODULE));
    return;
  }

  if (b.landmark === "stepped") {
    add("trim", (o) => steppedPyramid(poly, h, o));
    return;
  }

  if (b.landmark === "amphitheatre") {
    add("trim", (o) => amphitheatre(poly, h, o));
    return;
  }

  if (b.landmark === "watchtower") {
    add("trim", (o) => watchtower(poly, h, o));
    return;
  }

  if (b.landmark === "dome") {
    add("trim", (o) => domedHall(poly, h, b.minarets ?? [], o));
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

/** A flat band between two outlines of the same polygon (`ring` under another name). */
function band(a: { x: number; y: number }[], b: { x: number; y: number }[], y: number, up: 1 | -1, out: Builder): void {
  ring(a, b, y, up, out);
}

/** One flat-shaded quad or triangle, wound to face along `hint`. */
function face(out: Builder, pts: [number, number, number][], hint: [number, number, number]): void {
  const [a, b, c] = pts;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map((v) => v / l);
  let order = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) {
    n = n.map((v) => -v);
    order = pts.length === 4 ? [0, 2, 1, 0, 3, 2] : [0, 2, 1];
  }
  for (const k of order) {
    const p = pts[k];
    out.pos.push(p[0], p[1], p[2]);
    out.nrm.push(n[0], n[1], n[2]);
    out.uv.push((p[0] + p[2]) / 3, p[1] / 3);
  }
}

/**
 * A Mesoamerican pyramid: terraces stepping in to a platform, a stair up the middle of
 * each face, and a temple on the top (El Castillo at Chichén Itzá has nine terraces under
 * a temple a fifth of its height).
 */
function steppedPyramid(poly: { x: number; y: number }[], h: number, out: Builder): void {
  const TOP = 0.36;
  const platform = h * 0.8;
  const n = Math.max(4, Math.min(12, Math.round(platform / 3.3)));
  const at = (k: number) => 1 - ((1 - TOP) * k) / n;
  for (let k = 0; k < n; k++) {
    const y0 = (platform * k) / n;
    const y1 = (platform * (k + 1)) / n;
    walls(scalePoly(poly, at(k)), y0, y1, out, 0, 0, 3, 3);
    band(scalePoly(poly, at(k)), scalePoly(poly, at(k + 1)), y1, 1, out);
  }
  cap(scalePoly(poly, TOP), platform, out, 3);
  const temple = scalePoly(poly, TOP * 0.58);
  walls(temple, platform, h, out, 0, 0, 3, 3);
  cap(temple, h, out, 3);
  // The stairs: a slab up the middle of each face, a little proud of the terraces, with
  // its balustrades down to the ground.
  const f = latticeFrame(poly);
  const width = Math.min(f.a, f.b) * 0.32;
  for (const [ax, ay, half, side] of [
    [f.u.x, f.u.y, f.a, f.v],
    [-f.u.x, -f.u.y, f.a, f.v],
    [f.v.x, f.v.y, f.b, f.u],
    [-f.v.x, -f.v.y, f.b, f.u],
  ] as const) {
    const foot = { x: f.centre.x + ax * half * 1.04, y: f.centre.y + ay * half * 1.04 };
    const head = { x: f.centre.x + ax * half * TOP, y: f.centre.y + ay * half * TOP };
    const sx = side.x * width * 0.5;
    const sy = side.y * width * 0.5;
    const lift = platform / n;
    const fl: [number, number, number] = [foot.x - sx, 0, foot.y - sy];
    const fr: [number, number, number] = [foot.x + sx, 0, foot.y + sy];
    const hl: [number, number, number] = [head.x - sx, platform + lift * 0.3, head.y - sy];
    const hr: [number, number, number] = [head.x + sx, platform + lift * 0.3, head.y + sy];
    face(out, [fl, fr, hr, hl], [ax, 1, ay]);
    face(out, [fl, hl, [head.x - sx, 0, head.y - sy]], [-side.x, 0, -side.y]);
    face(out, [fr, hr, [head.x + sx, 0, head.y + sy]], [side.x, 0, side.y]);
  }
}

/**
 * A watchtower: a block of masonry without windows, a flat roof behind a parapet, and
 * merlons along every edge of it — the Great Wall's towers, a castle's keep.
 */
function watchtower(poly: { x: number; y: number }[], h: number, out: Builder): void {
  const PARAPET = 0.7;
  const MERLON_H = 0.9;
  const MERLON_W = 0.9;
  const PITCH = 1.8;
  const THICK = 0.55;
  walls(poly, 0, h + PARAPET, out, 0, 0, 3, 3);
  const inner = inflate(poly, -THICK);
  walls(inner, h, h + PARAPET, out, 0, 0, 3, 3, true);
  cap(inner, h, out, 3);
  band(poly, inner, h + PARAPET, 1, out);
  const ccw = isCcw(poly);
  const top = h + PARAPET;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < MERLON_W + 0.4) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.y - a.y) / len;
    // Outward normal, and the inward offset to the parapet's inner face.
    const nx = ccw ? dz : -dz;
    const nz = ccw ? -dx : dx;
    const count = Math.max(1, Math.floor((len - 0.4) / PITCH));
    const start = (len - (count - 1) * PITCH - MERLON_W) / 2;
    for (let k = 0; k < count; k++) {
      const d0 = start + k * PITCH;
      const d1 = d0 + MERLON_W;
      const p = (d: number, off: number, y: number): [number, number, number] => [a.x + dx * d - nx * off, y, a.y + dz * d - nz * off];
      const y1 = top + MERLON_H;
      face(out, [p(d0, 0, top), p(d1, 0, top), p(d1, 0, y1), p(d0, 0, y1)], [nx, 0, nz]);
      face(out, [p(d0, THICK, top), p(d1, THICK, top), p(d1, THICK, y1), p(d0, THICK, y1)], [-nx, 0, -nz]);
      face(out, [p(d0, 0, y1), p(d1, 0, y1), p(d1, THICK, y1), p(d0, THICK, y1)], [0, 1, 0]);
      face(out, [p(d0, 0, top), p(d0, THICK, top), p(d0, THICK, y1), p(d0, 0, y1)], [-dx, 0, -dz]);
      face(out, [p(d1, 0, top), p(d1, THICK, top), p(d1, THICK, y1), p(d1, 0, y1)], [dx, 0, dz]);
    }
  }
}

/**
 * Turns a profile of (radius, height) pairs round a vertical axis: a drum, a dome, a
 * minaret. Flat-shaded quads, outward normals from the profile's own slope.
 */
function lathe(cx: number, cz: number, profile: [number, number][], segments: number, out: Builder): void {
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, y0] = profile[k];
    const [r1, y1] = profile[k + 1];
    if (y1 === y0 && r1 === r0) continue;
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      // The normal leans up by how much the profile narrows as it rises.
      const nx = Math.cos(am) * (y1 - y0);
      const nz = Math.sin(am) * (y1 - y0);
      const ny = r0 - r1;
      const l = Math.hypot(nx, ny, nz) || 1;
      const p = (r: number, a: number, y: number): [number, number, number] => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      face(out, [p(r0, a0, y0), p(r0, a1, y0), p(r1, a1, y1), p(r1, a0, y1)], [nx / l, ny / l, nz / l]);
    }
  }
}

/**
 * A domed hall: a platform the size of the footprint, a hall on it, a drum and an onion
 * dome with its finial, and the minarets OSM maps on the platform (the Taj Mahal's four).
 * A mosque without mapped minarets gets the hall and the dome.
 */
function domedHall(poly: { x: number; y: number }[], h: number, minarets: { x: number; y: number }[], out: Builder): void {
  let cx = 0;
  let cz = 0;
  for (const p of poly) {
    cx += p.x / poly.length;
    cz += p.y / poly.length;
  }
  let reach = Infinity;
  for (const p of poly) reach = Math.min(reach, Math.hypot(p.x - cx, p.y - cz));
  const plinth = h * 0.1;
  walls(poly, 0, plinth, out, 0, 0, 3, 3);
  cap(poly, plinth, out, 3);
  const hall = scalePoly(poly, 0.62);
  const hallTop = h * 0.45;
  walls(hall, plinth, hallTop, out, 0, 0, 3, 3);
  cornice(hall, hallTop - 0.8, hallTop + 0.4, out);
  cap(hall, hallTop, out, 3);
  // The drum and the onion: it swells past the drum before it closes to the finial.
  const rd = Math.max(1.5, reach * 0.62 * 0.62);
  lathe(
    cx,
    cz,
    [
      [rd, hallTop],
      [rd, h * 0.56],
      [rd * 1.08, h * 0.6],
      [rd * 1.16, h * 0.66],
      [rd * 1.1, h * 0.73],
      [rd * 0.86, h * 0.8],
      [rd * 0.52, h * 0.87],
      [rd * 0.18, h * 0.93],
      [0.25, h * 0.96],
      [0.12, h],
      [0, h],
    ],
    24,
    out,
  );
  for (const m of minarets) {
    const rm = Math.max(1, reach * 0.055);
    const top = h * 0.6;
    lathe(
      m.x,
      m.y,
      [
        [rm * 1.15, 0],
        [rm * 1.15, plinth],
        [rm, plinth],
        [rm * 0.85, top],
        [rm * 1.25, top + 0.4],
        [rm * 1.25, top + 2.6],
        [rm * 0.9, top + 3.2],
        [rm * 0.5, top + 4.4],
        [0.1, top + 5.2],
        [0, top + 5.2],
      ],
      12,
      out,
    );
  }
}

/**
 * An amphitheatre: the outer wall in four storeys, and inside it no roof but the bowl —
 * tiers of seating stepping down to an arena floor. From an RTS camera the open oval is
 * what makes it the Colosseum and not a stadium car park.
 */
function amphitheatre(poly: { x: number; y: number }[], h: number, out: Builder): void {
  const RIM = 0.88;
  const ARENA = 0.5;
  walls(poly, 0, h, out, 0, 0, 3, 3);
  // A cornice band at each storey, the shadow lines of its arcades.
  const outer = inflate(poly, 0.35);
  for (let k = 1; k <= 3; k++) {
    const y = (h * k) / 4;
    walls(outer, y - 0.45, y + 0.45, out, 0, 0, 3, 3);
    band(poly, outer, y + 0.45, 1, out);
    band(poly, outer, y - 0.45, -1, out);
  }
  band(poly, scalePoly(poly, RIM), h, 1, out);
  const top = h * 0.82;
  walls(scalePoly(poly, RIM), top, h, out, 0, 0, 3, 3, true);
  const tiers = 6;
  const floor = h * 0.1;
  for (let k = 0; k < tiers; k++) {
    const s0 = RIM - ((RIM - ARENA) * k) / tiers;
    const s1 = RIM - ((RIM - ARENA) * (k + 1)) / tiers;
    const y0 = top - ((top - floor) * k) / tiers;
    const y1 = top - ((top - floor) * (k + 1)) / tiers;
    band(scalePoly(poly, s0), scalePoly(poly, s1), y0, 1, out);
    walls(scalePoly(poly, s1), y1, y0, out, 0, 0, 3, 3, true);
  }
  // The podium wall round the arena, and the arena floor.
  walls(scalePoly(poly, ARENA), 0.6, floor, out, 0, 0, 3, 3, true);
  cap(scalePoly(poly, ARENA), 0.6, out, 3);
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
