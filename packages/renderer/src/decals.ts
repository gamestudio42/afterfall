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
export const DECAL_TILES = [
  "crack_a",
  "crack_b",
  "patch",
  "oil",
  "rubble",
  "weeds",
  "leaves",
  "soot",
  "manhole",
  "drain",
  "puddle",
  "paper",
] as const;
export type DecalTile = (typeof DECAL_TILES)[number];
export const DECAL_COLS = 4;
export const DECAL_ROWS = 3;

export interface DecalPlacement {
  tile: number;
  x: number;
  z: number;
  size: number;
  rot: number;
  /** Brightness multiplier, so two cracks of the same tile do not look stamped. */
  shade: number;
  /** Cross-road scale relative to length. */
  aspect?: number;
}

/** Deterministic hash noise in [0, 1), the same family the map generators use. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TILE_INDEX = new Map<DecalTile, number>(DECAL_TILES.map((t, i) => [t, i]));

/**
 * Repairs and fractures follow the carriageway; litter collects by the kerb.
 * Buildings that have been picked over carry rubble at their door.
 */
export function placeDecals(
  city: CityMap,
  seed = 1,
  max = 3600,
  /** Buildings the survivors have picked clean: their doorsteps stay littered. */
  looted: ReadonlySet<number> = new Set(),
  /** Buildings turned into a home, a workshop or a lab: their doorsteps are swept. */
  kept: ReadonlySet<number> = new Set(),
): DecalPlacement[] {
  const out: DecalPlacement[] = [];
  const push = (tile: DecalTile, x: number, z: number, size: number, s: number, shade: number, rot?: number, aspect = 1) => {
    if (out.length >= max) return;
    out.push({
      tile: TILE_INDEX.get(tile) ?? 0,
      x,
      z,
      size,
      rot: rot ?? hash(Math.round(x), Math.round(z), seed + 7) * Math.PI * 2,
      shade,
      aspect,
    });
  };

  // Sample actual centerline segments. An imported road's rectangle is only
  // a bounding box: filling it stamps courtyards and the inside of every bend.
  for (const road of city.roads) {
    const r = road.rect;
    const path =
      road.path ??
      (road.horizontal
        ? [
            { x: r.x, y: r.y + r.h / 2 },
            { x: r.x + r.w, y: r.y + r.h / 2 },
          ]
        : [
            { x: r.x + r.w / 2, y: r.y },
            { x: r.x + r.w / 2, y: r.y + r.h },
          ]);
    const width = road.path ? (road.width ?? 8) : road.horizontal ? r.h : r.w;
    for (let segment = 1; segment < path.length; segment++) {
      const a = path[segment - 1],
        b = path[segment];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 2 || width < 2) continue;
      const dx = (b.x - a.x) / length,
        dz = (b.y - a.y) / length,
        angle = Math.atan2(dz, dx);
      for (let along = 2; along < length - 2; along += 3.2) {
        for (let lane = -1; lane <= 1; lane++) {
          const roll = hash(Math.round((a.x + dx * along) * 3), Math.round((a.y + dz * along) * 3), seed + lane * 91);
          const edge = lane !== 0;
          const across = lane * (width / 2 - 0.85);
          const x = a.x + dx * along - dz * across,
            z = a.y + dz * along + dx * across;
          if (edge) {
            const tile = roll < 0.25 ? "weeds" : roll < 0.58 ? "leaves" : roll < 0.78 ? "paper" : null;
            if (tile) push(tile, x, z, 1.5, seed, 0.72 + roll * 0.35, angle, 0.65);
            if (Math.floor(along / 3.2) % 10 === 3 && lane === 1) push("drain", x, z, 1.2, seed, 1, angle, 0.75);
          } else {
            // A narrower footprint stays inside the carriageway at every angle.
            const size = Math.min(2.6 + roll * 1.5, width * 0.66);
            const tile =
              roll < 0.32
                ? "crack_a"
                : roll < 0.47
                  ? "crack_b"
                  : roll < 0.62
                    ? "patch"
                    : roll < 0.74
                      ? "oil"
                      : roll < 0.85
                        ? "puddle"
                        : null;
            if (tile) push(tile, x, z, size, seed, 0.8 + roll * 0.2, angle + (roll - 0.5) * 0.3, 0.65);
            if (Math.floor(along / 3.2) % 13 === 5) push("manhole", x - dz * width * 0.2, z + dx * width * 0.2, 1.15, seed, 1, angle);
          }
        }
      }
    }
  }

  // Doorsteps: a building the survivors picked clean keeps its debris, a building they
  // moved into gets swept, and the rest are left to the weather.
  for (const b of city.buildings) {
    const r = hash(b.index, seed, seed + 3);
    const isLooted = looted.has(b.index);
    const isKept = kept.has(b.index);
    if (isKept) continue;
    if (!isLooted && r > 0.34) continue;
    const e = b.entrance;
    const fx = Math.cos(r * 9) * 1.3;
    const fz = Math.sin(r * 9) * 1.3;
    const scale = isLooted ? 1.35 : 1;
    push(r < 0.1 ? "soot" : "rubble", e.x + fx, e.y + fz, (1.0 + r * 2.4) * scale, seed, 0.8 + r * 0.4);
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
    const aspect = d.aspect ?? 1;
    const corners: [number, number][] = [
      [-c + s * aspect, -s - c * aspect],
      [c + s * aspect, s - c * aspect],
      [c - s * aspect, s + c * aspect],
      [-c - s * aspect, -s + c * aspect],
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
