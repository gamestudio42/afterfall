/**
 * The ground's height on an imported map.
 *
 * A grid of heights over the play area, read once from open elevation data when the map is
 * built and kept with it (and so with saves). Phase 1 of the terrain work: it shapes what is
 * drawn, and no rule reads it yet. A map without one is flat, as every map was before.
 */
export interface TerrainDef {
  /** Metres between grid nodes. */
  cell: number;
  /** Nodes per row and per column: the grid covers the map from 0 to its size inclusive. */
  cols: number;
  rows: number;
  /** Height of each node above the map's lowest point, in decimetres, row by row. */
  heights: number[];
  /**
   * How much of the real relief is drawn. Christ the Redeemer's hill rises 400 m inside a
   * 480 m map while the camera climbs to 255 m at most: drawn at full height it is a wall.
   */
  scale: number;
  /** Real height of the lowest node above sea level, in metres, for the record. */
  base: number;
}

/** Metres between nodes: the open elevation tiles are about 4.5 m a pixel at zoom 15. */
export const TERRAIN_CELL = 4;
/** Share of the real relief drawn; chosen from captures of Corcovado and Machu Picchu. */
export const TERRAIN_SCALE = 0.5;
/** Below this much relief in the whole area, the map stays flat. */
export const TERRAIN_MIN_RELIEF = 2;

const M_PER_DEG_LAT = 111_132;

/** The latitude and longitude of a map point, as the importer projects them. */
export function mapToLatLon(center: { lat: number; lon: number }, size: number, x: number, y: number): { lat: number; lon: number } {
  const kLon = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  return { lat: center.lat - (y - size / 2) / M_PER_DEG_LAT, lon: center.lon + (x - size / 2) / kLon };
}

/**
 * Samples an elevation source over the map. Returns null when the area is flat enough that
 * a heightfield would only cost vertices, or when the source has no data there.
 */
export function buildTerrain(
  center: { lat: number; lon: number },
  size: number,
  elevation: (lat: number, lon: number) => number,
  options: { cell?: number; scale?: number } = {},
): TerrainDef | null {
  const cell = options.cell ?? TERRAIN_CELL;
  const cols = Math.round(size / cell) + 1;
  const rows = cols;
  const raw = new Float64Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = mapToLatLon(center, size, c * cell, r * cell);
      const h = elevation(p.lat, p.lon);
      if (!Number.isFinite(h)) return null;
      raw[r * cols + c] = h;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  if (max - min < TERRAIN_MIN_RELIEF) return null;
  const heights = Array.from(raw, (h) => Math.round((h - min) * 10));
  return { cell, cols, rows, heights, scale: options.scale ?? TERRAIN_SCALE, base: Math.round(min * 10) / 10 };
}

/** The drawn height of the ground at a map point, in metres: 0 on a flat map. */
export function heightAt(t: TerrainDef | undefined, x: number, y: number): number {
  if (!t) return 0;
  const fx = Math.max(0, Math.min(t.cols - 1, x / t.cell));
  const fy = Math.max(0, Math.min(t.rows - 1, y / t.cell));
  const c0 = Math.min(t.cols - 2, Math.floor(fx));
  const r0 = Math.min(t.rows - 2, Math.floor(fy));
  const u = fx - c0;
  const v = fy - r0;
  const h = t.heights;
  const i = r0 * t.cols + c0;
  const top = h[i] * (1 - u) + h[i + 1] * u;
  const bottom = h[i + t.cols] * (1 - u) + h[i + t.cols + 1] * u;
  return ((top * (1 - v) + bottom * v) / 10) * t.scale;
}

/** Lowest and highest drawn ground under a set of points (a footprint), in metres. */
export function heightRange(t: TerrainDef | undefined, pts: { x: number; y: number }[]): { min: number; max: number } {
  if (!t || pts.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const h = heightAt(t, p.x, p.y);
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  return { min, max };
}

/** Terrarium tiles pack metres as (R * 256 + G + B / 256) - 32768. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Fractional tile coordinates of a point in Web Mercator at a zoom level. */
export function tileXY(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n };
}
