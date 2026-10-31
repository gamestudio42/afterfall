import { BUILDING_TYPES, type BuildingType, type Zone } from "@afterfall/content";
import {
  Rng,
  clipPolygonToRect,
  clipPolylineToRect,
  deriveSeed,
  distToPolyline,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  signedArea,
  simplifyPolygon,
  type Rect,
  type Vec2,
} from "@afterfall/shared";
import type { BuildingDef, CityMap, ParkDef, RoadDef } from "./city";
import { CellKind, NavGrid } from "./navgrid";

/**
 * Turns OpenStreetMap data (an Overpass API JSON answer with `out geom`)
 * into a playable CityMap: building footprints with game types and floors,
 * road center lines, parks, doors facing the nearest street, and horde
 * entry points where streets leave the map.
 */

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OsmMapOptions {
  lat: number;
  lon: number;
  /** Side of the square play area in meters. */
  size: number;
  label: string;
  /** Upper bound on buildings kept, nearest to the center first. */
  maxBuildings?: number;
}

export class OsmImportError extends Error {
  constructor(
    readonly code: "tooFewBuildings" | "noStreets",
    message: string,
  ) {
    super(message);
  }
}

/** Overpass QL for everything the importer reads inside the play area plus a margin. */
export function overpassQuery(lat: number, lon: number, size: number): string {
  const b = bbox(lat, lon, size / 2 + 40);
  const box = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:40];
(
  way["building"](${box});
  way["highway"](${box});
  way["leisure"~"^(park|garden|playground|pitch)$"](${box});
  way["landuse"~"^(grass|recreation_ground|forest|meadow|village_green)$"](${box});
  way["natural"="wood"](${box});
  node["amenity"](${box});
  node["shop"](${box});
  node["healthcare"](${box});
);
out geom;`;
}

const M_PER_DEG_LAT = 111_132;

function bbox(lat: number, lon: number, half: number) {
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

/** Drivable highway classes and the road width drawn for each. */
const ROAD_WIDTH: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 11,
  tertiary: 10,
  unclassified: 8,
  residential: 8,
  living_street: 6,
  pedestrian: 6,
  service: 5,
  track: 4,
  motorway_link: 8,
  trunk_link: 8,
  primary_link: 8,
  secondary_link: 8,
  tertiary_link: 8,
};

/** Classes busy enough for hordes to arrive along. */
const MAJOR_ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential"]);

const ZONE_OF: Record<BuildingType, Zone> = {
  house: "residential",
  apartment: "residential",
  shop: "commercial",
  supermarket: "commercial",
  pharmacy: "commercial",
  office: "commercial",
  gasStation: "commercial",
  warehouse: "industrial",
  hospital: "civic",
  school: "civic",
  police: "civic",
};

interface RawBuilding {
  osmId: number;
  poly: Vec2[];
  tags: Record<string, string>;
  area: number;
  centroid: Vec2;
}

export function cityFromOverpass(data: OverpassResponse, opts: OsmMapOptions): CityMap {
  const size = Math.round(opts.size / 2) * 2;
  const cellSize = 2;
  const kLon = 111_320 * Math.cos((opts.lat * Math.PI) / 180);
  const project = (p: { lat: number; lon: number }): Vec2 => ({
    x: (p.lon - opts.lon) * kLon + size / 2,
    y: (opts.lat - p.lat) * M_PER_DEG_LAT + size / 2,
  });
  const bounds: Rect = { x: 0, y: 0, w: size, h: size };
  const inner: Rect = { x: 1, y: 1, w: size - 2, h: size - 2 };
  const seed = deriveSeed(Math.round(opts.lat * 1e5) ^ Math.imul(Math.round(opts.lon * 1e5), 2654435761), "osm");

  const pois: { p: Vec2; tags: Record<string, string> }[] = [];
  const rawBuildings: RawBuilding[] = [];
  const rawRoads: { id: number; kind: string; line: Vec2[] }[] = [];
  const rawParks: { id: number; poly: Vec2[] }[] = [];

  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (el.type === "node") {
      if (el.lat !== undefined && el.lon !== undefined) pois.push({ p: project({ lat: el.lat, lon: el.lon }), tags });
      continue;
    }
    if (el.type !== "way" || !el.geometry) continue;
    const pts = el.geometry.filter((g): g is { lat: number; lon: number } => !!g).map(project);
    if (pts.length < 2) continue;
    const closed = pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.01;
    if (tags.building && closed) {
      if (tags.building === "no" || tags.building === "roof" || tags.location === "underground") continue;
      const poly = simplifyPolygon(pts.slice(0, -1));
      if (poly.length < 3) continue;
      // Keep only buildings fully inside the play area.
      if (!poly.every((p) => p.x > inner.x && p.y > inner.y && p.x < inner.x + inner.w && p.y < inner.y + inner.h)) continue;
      const area = polygonArea(poly);
      if (area < 30) continue;
      rawBuildings.push({ osmId: el.id, poly, tags, area, centroid: polygonCentroid(poly) });
    } else if (tags.highway && ROAD_WIDTH[tags.highway] && tags.tunnel !== "yes" && tags.area !== "yes") {
      for (const piece of clipPolylineToRect(pts, bounds)) rawRoads.push({ id: el.id, kind: tags.highway, line: piece });
    } else if (closed && (tags.leisure || tags.landuse || tags.natural)) {
      const poly = clipPolygonToRect(pts.slice(0, -1), bounds);
      if (poly.length >= 3 && polygonArea(poly) > 150) rawParks.push({ id: el.id, poly });
    }
  }

  if (rawRoads.length === 0) throw new OsmImportError("noStreets", "No streets in this area");

  // Nearest to the center first, so a cap keeps the heart of the area.
  rawBuildings.sort(
    (a, b) => Math.hypot(a.centroid.x - size / 2, a.centroid.y - size / 2) - Math.hypot(b.centroid.x - size / 2, b.centroid.y - size / 2) || a.osmId - b.osmId,
  );
  rawBuildings.splice(opts.maxBuildings ?? 700);

  const roads: RoadDef[] = rawRoads.map((r, i) => {
    const b = polygonBounds(r.line);
    const width = ROAD_WIDTH[r.kind];
    return {
      id: `r${r.id}_${i}`,
      rect: { x: b.x - width / 2, y: b.y - width / 2, w: b.w + width, h: b.h + width },
      horizontal: b.w >= b.h,
      path: r.line,
      width,
    };
  });
  const streets = rawRoads.filter((r) => r.kind !== "pedestrian" && r.kind !== "track");

  // First pass: stamp every candidate building, then pick doors on free cells.
  const typed = rawBuildings.map((rb) => ({ rb, type: classify(rb, pois) }));
  ensureEssentials(typed, size);
  const grid = new NavGrid(size, size, cellSize);
  typed.forEach((t, i) => grid.stampPolygon(t.rb.poly, i));

  const kept: { rb: RawBuilding; type: BuildingType; entrance: Vec2; facing: Vec2 }[] = [];
  for (const t of typed) {
    const door = pickDoor(t.rb.poly, grid, streets.length ? streets : rawRoads);
    if (door) kept.push({ ...t, ...door });
  }

  // Horde entry points: where streets cross the border.
  const spawnPoints = borderEntries(rawRoads, size, grid);

  // Drop buildings whose door cannot be reached from the streets (closed courtyards).
  const reach = reachable(grid, spawnPoints.length ? spawnPoints : roads.map((r) => r.path![0]));
  const buildings: BuildingDef[] = [];
  for (const k of kept) {
    if (!reach[grid.cellOf(k.entrance.x, k.entrance.y)]) continue;
    const rng = new Rng(deriveSeed(k.rb.osmId >>> 0, "floors"));
    const floors = floorsOf(k.rb.tags, k.type, rng);
    const index = buildings.length;
    buildings.push({
      id: `osm${k.rb.osmId}`,
      index,
      type: k.type,
      zone: ZONE_OF[k.type],
      rect: polygonBounds(k.rb.poly),
      footprint: k.rb.poly,
      area: Math.round(k.rb.area),
      floors,
      height: floors * 3.2 + 0.6,
      entrance: k.entrance,
      facing: k.facing,
    });
  }
  if (buildings.length < 12) throw new OsmImportError("tooFewBuildings", `Only ${buildings.length} usable buildings`);

  const parks: ParkDef[] = rawParks.map((p, i) => {
    const rng = new Rng(deriveSeed(p.id >>> 0, "trees"));
    const rect = polygonBounds(p.poly);
    const want = Math.min(40, Math.floor(polygonArea(p.poly) / 250));
    const trees: Vec2[] = [];
    for (let t = 0; t < want * 4 && trees.length < want; t++) {
      const x = rect.x + rng.next() * rect.w;
      const y = rect.y + rng.next() * rect.h;
      if (!pointInPolygon(x, y, p.poly)) continue;
      if (grid.kind[grid.cellOf(x, y)] !== CellKind.Free) continue;
      trees.push({ x, y });
    }
    return { id: `p${i}`, rect, polygon: p.poly, trees };
  });

  return {
    seed,
    name: opts.label,
    width: size,
    height: size,
    cellSize,
    blockSize: 0,
    roadWidth: 8,
    blocksX: 0,
    blocksY: 0,
    roads,
    intersections: intersections(rawRoads, size),
    buildings,
    parks,
    spawnPoints,
    source: { kind: "osm", label: opts.label, lat: opts.lat, lon: opts.lon, size, attribution: OSM_ATTRIBUTION },
  };
}

/** Game building type from OSM tags and the points of interest inside the footprint. */
function classify(rb: RawBuilding, pois: { p: Vec2; tags: Record<string, string> }[]): BuildingType {
  const tags = { ...rb.tags };
  for (const poi of pois) {
    if (pointInPolygon(poi.p.x, poi.p.y, rb.poly)) {
      for (const k of ["amenity", "shop", "healthcare"]) if (poi.tags[k] && !tags[k]) tags[k] = poi.tags[k];
    }
  }
  const b = tags.building;
  const amenity = tags.amenity ?? "";
  const shop = tags.shop ?? "";
  if (amenity === "hospital" || tags.healthcare === "hospital" || b === "hospital") return "hospital";
  if (amenity === "police" || b === "police") return "police";
  if (["school", "college", "university", "kindergarten"].includes(amenity) || ["school", "university", "college", "kindergarten"].includes(b)) return "school";
  if (["supermarket", "wholesale", "department_store", "greengrocer", "convenience"].includes(shop) && rb.area > 250) return "supermarket";
  if (shop === "supermarket" || b === "supermarket") return "supermarket";
  if (["pharmacy", "clinic", "doctors", "dentist"].includes(amenity) || ["chemist", "medical_supply"].includes(shop) || tags.healthcare) return "pharmacy";
  if (amenity === "fuel") return "gasStation";
  if (["warehouse", "industrial", "factory", "manufacture", "hangar", "storage_tank", "garages", "garage", "shed", "barn", "service", "transportation"].includes(b)) return "warehouse";
  if (b === "office" || b === "commercial" || tags.office) return "office";
  if (shop || b === "retail" || b === "kiosk" || ["restaurant", "cafe", "bar", "fast_food", "bank", "pub", "marketplace"].includes(amenity)) return "shop";
  if (["apartments", "residential", "dormitory", "hotel"].includes(b)) return "apartment";
  if (["house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "cabin"].includes(b)) return "house";
  const levels = Number(tags["building:levels"]);
  if (rb.area < 180) return "house";
  if (levels >= 3 || rb.area < 600) return levels >= 3 ? "apartment" : (rb.osmId % 5 === 0 ? "shop" : "house");
  return levels >= 3 ? "office" : "warehouse";
}

/**
 * Real neighborhoods may lack a police station or a supermarket, which the
 * game's economy leans on (ammo and food). Promote a suitable building near
 * the center so every map has at least one of each.
 */
function ensureEssentials(typed: { rb: RawBuilding; type: BuildingType }[], size: number): void {
  const center = (t: { rb: RawBuilding }) => Math.hypot(t.rb.centroid.x - size / 2, t.rb.centroid.y - size / 2);
  for (const need of ["supermarket", "police"] as BuildingType[]) {
    if (typed.some((t) => t.type === need)) continue;
    const candidates = typed
      .filter((t) => (t.type === "shop" || t.type === "office" || t.type === "warehouse") && t.rb.area >= 150 && t.rb.area <= 1500)
      .sort((a, b) => center(a) - center(b));
    const pick = candidates[Math.min(3, candidates.length - 1)];
    if (pick) pick.type = need;
  }
}

function floorsOf(tags: Record<string, string>, type: BuildingType, rng: Rng): number {
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels >= 1) return Math.min(20, Math.round(levels));
  const height = parseFloat(tags.height ?? "");
  if (Number.isFinite(height) && height > 2) return Math.max(1, Math.min(20, Math.round(height / 3.2)));
  const [lo, hi] = BUILDING_TYPES[type].floors;
  return rng.int(lo, hi);
}

/** The door is the free spot just outside the wall closest to a street. */
function pickDoor(poly: Vec2[], grid: NavGrid, roads: { line: Vec2[] }[]): { entrance: Vec2; facing: Vec2 } | null {
  const ccw = signedArea(poly) > 0;
  let best: { entrance: Vec2; facing: Vec2 } | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) continue;
    // Outward normal in screen coordinates (y down).
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    const steps = len > 12 ? [0.25, 0.5, 0.75] : [0.5];
    for (const t of steps) {
      for (const out of [1.6, 2.8]) {
        const x = a.x + (b.x - a.x) * t + nx * out;
        const y = a.y + (b.y - a.y) * t + ny * out;
        const c = grid.cellOf(x, y);
        if (x < 1 || y < 1 || x > grid.cols * grid.cell - 1 || y > grid.rows * grid.cell - 1) continue;
        if (grid.kind[c] !== CellKind.Free) continue;
        let d = Infinity;
        for (const r of roads) d = Math.min(d, distToPolyline(x, y, r.line));
        const score = d + out;
        if (score < bestScore) {
          bestScore = score;
          const center = grid.centerOf(c);
          best = { entrance: center, facing: { x: nx, y: ny } };
        }
        break;
      }
    }
  }
  return best;
}

function borderEntries(roads: { kind: string; line: Vec2[] }[], size: number, grid: NavGrid): Vec2[] {
  const out: Vec2[] = [];
  const onBorder = (p: Vec2) => p.x < 0.5 || p.y < 0.5 || p.x > size - 0.5 || p.y > size - 0.5;
  const add = (p: Vec2, toward: Vec2) => {
    const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
    const q = { x: p.x + ((toward.x - p.x) / d) * 3, y: p.y + ((toward.y - p.y) / d) * 3 };
    const c = grid.cellOf(q.x, q.y);
    if (grid.kind[c] !== CellKind.Free) return;
    if (out.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 25)) return;
    out.push(grid.centerOf(c));
  };
  for (const pass of [MAJOR_ROADS, null]) {
    for (const r of roads) {
      if (pass && !pass.has(r.kind)) continue;
      const l = r.line;
      if (onBorder(l[0])) add(l[0], l[1]);
      if (onBorder(l[l.length - 1])) add(l[l.length - 1], l[l.length - 2]);
    }
    if (out.length >= 4) break;
  }
  if (out.length < 4) {
    for (const p of [
      { x: size / 2, y: 1 },
      { x: size / 2, y: size - 1 },
      { x: 1, y: size / 2 },
      { x: size - 1, y: size / 2 },
    ])
      add(p, { x: size / 2, y: size / 2 });
  }
  return out;
}

function intersections(roads: { line: Vec2[] }[], size: number): Vec2[] {
  const seen = new Map<string, { p: Vec2; n: number }>();
  for (const r of roads)
    for (const p of r.line) {
      const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
      const e = seen.get(key);
      if (e) e.n++;
      else seen.set(key, { p, n: 1 });
    }
  const out = [...seen.values()].filter((e) => e.n >= 2).map((e) => e.p);
  return out.length ? out : [{ x: size / 2, y: size / 2 }];
}

/** Cells reachable on foot from any of the given points. */
function reachable(grid: NavGrid, from: Vec2[]): Uint8Array {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const queue: number[] = [];
  for (const p of from) {
    const c = grid.cellOf(p.x, p.y);
    if (grid.kind[c] === CellKind.Free && !seen[c]) {
      seen[c] = 1;
      queue.push(c);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const x = c % grid.cols;
    const y = (c - x) / grid.cols;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const n = grid.index(nx, ny);
      if (seen[n] || grid.kind[n] !== CellKind.Free) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}
