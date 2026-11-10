import * as THREE from "three";
import type { CityMap } from "@afterfall/world";

/**
 * Street wear, laid flat on the ground: cracks, repairs, oil, rubble, weeds through the
 * kerb joints, drifted leaves and soot.
 *
 * The tiles are the atlas in `public/art/decals.png`, in this order — the generator
 * (`tools/make-decals.ts`) and this file have to agree, which is why the order lives here
 * as a constant instead of a comment there.
 */
export const DECAL_TILES = ["crack_a", "crack_b", "patch", "oil", "rubble", "weeds", "leaves", "soot"] as const;
export type DecalTile = (typeof DECAL_TILES)[number];
export const DECAL_COLS = 4;
export const DECAL_ROWS = 2;

export interface DecalPlacement {
  tile: number;
  x: number;
  z: number;
  size: number;
  rot: number;
  /** Brightness multiplier, so two cracks of the same tile do not look stamped. */
  shade: number;
}

/** Deterministic hash noise in [0, 1), the same family the map generators use. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TILE_INDEX = new Map<DecalTile, number>(DECAL_TILES.map((t, i) => [t, i]));

/**
 * Scatters the wear the way a city accumulates it: nothing in the middle of the road,
 * everything against the kerb, and the buildings that have been picked over carry rubble
 * at their door.
 */
export function placeDecals(city: CityMap, seed = 1, max = 3600): DecalPlacement[] {
  const out: DecalPlacement[] = [];
  const push = (tile: DecalTile, x: number, z: number, size: number, s: number, shade: number) => {
    if (out.length >= max) return;
    out.push({ tile: TILE_INDEX.get(tile) ?? 0, x, z, size, rot: hash(Math.round(x), Math.round(z), seed + 7) * Math.PI * 2, shade });
  };

  // Roads: cracks and repairs in the carriageway, weeds and leaves against the kerb.
  for (const road of city.roads) {
    const { x, y, w, h } = road.rect;
    const step = 3.2;
    for (let cz = y + 1; cz < y + h; cz += step) {
      for (let cx = x + 1; cx < x + w; cx += step) {
        const r = hash(Math.round(cx * 3), Math.round(cz * 3), seed);
        const edge = Math.min(cx - x, x + w - cx, cz - y, y + h - cz);
        const jitterX = (hash(cx | 0, cz | 0, seed + 1) - 0.5) * step * 0.8;
        const jitterZ = (hash(cx | 0, cz | 0, seed + 2) - 0.5) * step * 0.8;
        // Jitter must not push a decal off the carriageway and into a kerb or a wall.
        const px = Math.min(x + w, Math.max(x, cx + jitterX));
        const pz = Math.min(y + h, Math.max(y, cz + jitterZ));
        if (edge < 1.6) {
          if (r < 0.34) push("weeds", px, pz, 1.0 + r * 1.4, seed, 0.9 + r * 0.25);
          else if (r < 0.5) push("leaves", px, pz, 1.8 + r * 2.2, seed, 0.8 + r * 0.3);
        } else if (edge < 5) {
          if (r < 0.34) push("crack_a", px, pz, 4.4 + r * 4.6, seed, 0.7 + r * 0.5);
          else if (r < 0.5) push("crack_b", px, pz, 5.2 + r * 4.8, seed, 0.65 + r * 0.5);
          else if (r < 0.55) push("patch", px, pz, 3.6 + r * 3.6, seed, 0.75 + r * 0.35);
        } else if (r < 0.1) {
          push("oil", px, pz, 1.8 + r * 3.2, seed, 0.7 + r);
        }
      }
    }
  }

  // Doorsteps: rubble where a building has been searched out, soot where it burned.
  for (const b of city.buildings) {
    const r = hash(b.index, seed, seed + 3);
    if (r > 0.34) continue;
    const e = b.entrance;
    const fx = Math.cos(r * 9) * 1.3;
    const fz = Math.sin(r * 9) * 1.3;
    push(r < 0.1 ? "soot" : "rubble", e.x + fx, e.y + fz, 1.0 + r * 2.4, seed, 0.8 + r * 0.4);
  }

  return out;
}

/**
 * One merged geometry for every decal of a map: four vertices each, so a thousand pieces
 * of wear cost one draw call and no instancing. Rebuilt only when the map changes.
 */
export function decalGeometry(placements: DecalPlacement[]): THREE.BufferGeometry {
  const n = placements.length;
  const positions = new Float32Array(n * 4 * 3);
  const uvs = new Float32Array(n * 4 * 2);
  const colors = new Float32Array(n * 4 * 3);
  const indices = new Uint32Array(n * 6);
  const cellW = 1 / DECAL_COLS;
  const cellH = 1 / DECAL_ROWS;
  // Half a texel in from the tile edge, or the neighbouring tile bleeds in at the mipmap.
  const insetU = 0.5 / (DECAL_COLS * 128);
  const insetV = 0.5 / (DECAL_ROWS * 128);

  for (let i = 0; i < n; i++) {
    const d = placements[i]!;
    const col = d.tile % DECAL_COLS;
    const row = Math.floor(d.tile / DECAL_COLS);
    // Atlas rows run bottom-up in GL, and the generator writes top-down.
    // Mirroring the tile is free and turns the two crack tiles into eight apparent
    // shapes, which is the difference between wear and a repeated stamp.
    const flipU = hash(i, 3, 91) > 0.5;
    const flipV = hash(i, 5, 97) > 0.5;
    const uA = col * cellW + insetU;
    const uB = (col + 1) * cellW - insetU;
    const vA = 1 - row * cellH - insetV;
    const vB = 1 - (row + 1) * cellH + insetV;
    const u0 = flipU ? uB : uA;
    const u1 = flipU ? uA : uB;
    const v0 = flipV ? vA : vB;
    const v1 = flipV ? vB : vA;
    const h = d.size / 2;
    const c = Math.cos(d.rot) * h;
    const s = Math.sin(d.rot) * h;
    const corners: [number, number][] = [
      [-c + s, -s - c],
      [c + s, s - c],
      [c - s, s + c],
      [-c - s, -s + c],
    ];
    const uvsCorners: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      positions[vi * 3] = d.x + corners[k]![0];
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = d.z + corners[k]![1];
      uvs[vi * 2] = uvsCorners[k]![0];
      uvs[vi * 2 + 1] = uvsCorners[k]![1];
      colors[vi * 3] = d.shade;
      colors[vi * 3 + 1] = d.shade;
      colors[vi * 3 + 2] = d.shade;
    }
    const b = i * 4;
    // Counter-clockwise seen from above, so the face normal is +Y and the default
    // FrontSide culling keeps it. Reversing these two triangles makes the whole layer
    // invisible from the RTS camera, which is the only angle it is ever seen from.
    indices[i * 6] = b;
    indices[i * 6 + 1] = b + 2;
    indices[i * 6 + 2] = b + 1;
    indices[i * 6 + 3] = b;
    indices[i * 6 + 4] = b + 3;
    indices[i * 6 + 5] = b + 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}
