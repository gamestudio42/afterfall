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
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = mapToLatLon(center, size, c * cell, r * cell);
      const h = elevation(p.lat, p.lon);
      if (!Number.isFinite(h)) return null;
      raw[r * cols + c] = h;
    }
  despike(raw, cols, rows);
  let min = Infinity;
  let max = -Infinity;
  for (const h of raw) {
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  if (max - min < TERRAIN_MIN_RELIEF) return null;
  const heights = Array.from(raw, (h) => Math.round((h - min) * 10));
  return { cell, cols, rows, heights, scale: options.scale ?? TERRAIN_SCALE, base: Math.round(min * 10) / 10 };
}

/** How far a node may sit from its neighbours' median before it is taken for a void. */
const SPIKE = 25;

/**
 * Removes the holes the elevation source has where its survey had no return: near the Taj
 * Mahal a few pixels read -233 m in ground that runs from 147 to 185. A node that differs
 * from the median of its eight neighbours by more than `SPIKE` metres takes that median.
 */
function despike(h: Float64Array, cols: number, rows: number): void {
  const src = h.slice();
  const near: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      near.length = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) near.push(src[rr * cols + cc]);
        }
      near.sort((a, b) => a - b);
      const median = near[near.length >> 1];
      if (Math.abs(src[r * cols + c] - median) > SPIKE) h[r * cols + c] = median;
    }
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

/** What `cutBuildingPads` needs of a building: its outline on the ground. */
export interface PadOutline {
  outline: { x: number; y: number }[];
}

/** What it needs of a street: its centre line and width, or its rectangle. */
export interface PadStreet {
  path?: { x: number; y: number }[];
  width?: number;
  rect: { x: number; y: number; w: number; h: number };
}

/** Within this far outside a wall the ground is cut down to the building's base, in metres. */
export const PAD_FLAT = 1;
/** And from there it rises back to the hillside over this far, or further for a deep cut. */
export const PAD_MARGIN = 6;
/**
 * The deepest a site is cut, in metres: about two storeys. A building whose ground falls
 * further than this across its outline straddles a cliff or a terrace, and cutting the
 * whole plateau down to its foot left banks steeper than a cliff; it stays partly in the
 * hill, as before.
 */
export const PAD_MAX_DEPTH = 6;

/**
 * Cuts the ground under and round each building down to the building's base, as a site is
 * dug into a slope. A building stands on the lowest ground under it (decision 63), so on
 * a hillside its uphill side was buried to its second or third floor in the hill (on
 * São Paulo's Sé, 58 of 240 buildings by more than 3 m; a playtest report: the buildings
 * are sunk into the ground). The relief inside the outline is the base, it stays at the
 * base for `PAD_FLAT` outside the walls, and rises back to the hillside over
 * `PAD_MARGIN`. Ground is only ever cut, never filled, and a street is left as it is: the
 * cut does not dig holes in the paving. Returns a new relief; the input is not changed.
 */
export function cutBuildingPads(t: TerrainDef, buildings: PadOutline[], streets: PadStreet[]): TerrainDef {
  const heights = t.heights.slice();
  const onStreet = (x: number, y: number) =>
    streets.some((s) => {
      if (s.path && s.path.length > 1) {
        const half = (s.width ?? 8) / 2;
        for (let i = 1; i < s.path.length; i++) if (segDist(x, y, s.path[i - 1], s.path[i]) < half) return true;
        return false;
      }
      return x >= s.rect.x && x <= s.rect.x + s.rect.w && y >= s.rect.y && y <= s.rect.y + s.rect.h;
    });
  for (const b of buildings) {
    const poly = b.outline;
    if (poly.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (const p of poly) {
      cx += p.x / poly.length;
      cy += p.y / poly.length;
    }
    // The building's base, as it reads the relief: the lowest ground under its outline.
    const base = heightRange(t, [...poly, { x: cx, y: cy }]).min;
    const raw = (base / t.scale) * 10;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    // A deep cut rises back over a longer run, so its bank stays under a grade of 1.
    const fall = heightRange(t, poly).max - base;
    if (fall > PAD_MAX_DEPTH) continue;
    const deepest = fall * 2.5;
    const margin = Math.max(PAD_MARGIN, deepest);
    const reach = PAD_FLAT + margin;
    const c0 = Math.max(0, Math.floor((x0 - reach) / t.cell));
    const c1 = Math.min(t.cols - 1, Math.ceil((x1 + reach) / t.cell));
    const r0 = Math.max(0, Math.floor((y0 - reach) / t.cell));
    const r1 = Math.min(t.rows - 1, Math.ceil((y1 + reach) / t.cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const i = r * t.cols + c;
        if (heights[i] <= raw) continue;
        const x = c * t.cell;
        const y = r * t.cell;
        let d = 0;
        if (!inside(x, y, poly)) {
          d = Infinity;
          for (let k = 0; k < poly.length; k++) d = Math.min(d, segDist(x, y, poly[k], poly[(k + 1) % poly.length]));
          if (d >= reach || onStreet(x, y)) continue;
        }
        const keep = d <= PAD_FLAT ? 0 : smoothstep((d - PAD_FLAT) / margin);
        heights[i] = Math.min(heights[i], Math.round(raw + (heights[i] - raw) * keep));
      }
  }
  return { ...t, heights };
}

function smoothstep(v: number): number {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
}

function segDist(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
}

function inside(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The outline of each ordinary building, for `cutBuildingPads`: landmarks keep their ground. */
export function padOutlines(
  buildings: { footprint?: { x: number; y: number }[]; rect: { x: number; y: number; w: number; h: number }; landmark?: string }[],
): PadOutline[] {
  return buildings
    .filter((b) => !b.landmark)
    .map((b) => ({
      outline: b.footprint ?? [
        { x: b.rect.x, y: b.rect.y },
        { x: b.rect.x + b.rect.w, y: b.rect.y },
        { x: b.rect.x + b.rect.w, y: b.rect.y + b.rect.h },
        { x: b.rect.x, y: b.rect.y + b.rect.h },
      ],
    }));
}
