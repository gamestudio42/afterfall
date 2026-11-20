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
import type { BridgeDef, BuildingDef, CityMap, Landmark, MonumentDef, ParkDef, RailDef, RoadDef, WallDef, WaterDef } from "./city";
import type { TerrainDef } from "./terrain";
import { framePoint, latticeFrame } from "./landmarks";
import { CellKind, NavGrid, isWalkableKind, stampTerrain } from "./navgrid";

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
  /** A relation's members carry their own geometry when the query asks for `out geom`. */
  members?: { type: string; ref: number; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
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
  /**
   * The ground's relief, when the caller has it: its cliffs shape the grid the doors and
   * the reachable buildings are chosen on, and it is kept with the map.
   */
  terrain?: TerrainDef;
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

/**
 * How wide a street is, in metres.
 *
 * The class table alone is a guess: it draws every residential street eight metres wide,
 * and in a dense centre that is several metres wider than the street, so the asphalt runs
 * inside the buildings and a footprint that is exactly where OSM puts it reads as a
 * building standing on the road. The tag knows better; the lane count is the second best.
 */
function roadWidth(tags: Record<string, string>, kind: string): number {
  const byClass = ROAD_WIDTH[kind] ?? 8;
  const tag = Number.parseFloat(tags.width ?? "");
  const lanes = Number.parseFloat(tags.lanes ?? "");
  const guess = Number.isFinite(lanes) && lanes > 0 ? lanes * 3.2 + 1 : byClass;
  const width = Number.isFinite(tag) && tag > 0 ? tag : guess;
  return Math.max(3, Math.min(width, 24));
}

/**
 * Pulls a footprint back to the kerb where it reaches into a street.
 *
 * The ribbon is drawn from the way's own width, so a footprint mapped two metres into the
 * carriageway paints asphalt over the lot and the building reads as standing on the road.
 * Moving the polygon's vertices out to the corridor edge is cheaper than clipping two
 * polygons and keeps the shape recognisable; a footprint that would lose too much of
 * itself is dropped instead of mangled.
 */
function pullOutOfStreets(poly: Vec2[], roads: { line: Vec2[]; width: number }[]): Vec2[] | null {
  const out = poly.map((p) => ({ ...p }));
  for (const v of out) {
    let best = Infinity;
    let bx = 0;
    let by = 0;
    let half = 0;
    for (const r of roads) {
      const h = r.width / 2;
      for (let i = 1; i < r.line.length; i++) {
        const a = r.line[i - 1];
        const b = r.line[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        let t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        const d = Math.hypot(v.x - cx, v.y - cy);
        if (d - h < best) {
          best = d - h;
          bx = cx;
          by = cy;
          half = h;
        }
      }
    }
    if (best >= 0) continue;
    const dx = v.x - bx;
    const dy = v.y - by;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue; // exactly on the centre line: no side to push towards
    const target = half + 0.25;
    if (len > half + 6) continue;
    v.x = bx + (dx / len) * target;
    v.y = by + (dy / len) * target;
  }
  return polygonArea(out) > polygonArea(poly) * 0.6 ? out : null;
}

/** Share of a footprint that falls inside a street corridor. */
function streetFraction(poly: Vec2[], roads: { kind: string; line: Vec2[]; width: number }[]): number {
  const corridors = roads.map((r) => ({ line: r.line, half: r.width / 2 }));
  const b = polygonBounds(poly);
  const step = Math.max(0.8, Math.min(b.w, b.h) / 10);
  let total = 0;
  let on = 0;
  for (let y = b.y; y <= b.y + b.h; y += step) {
    for (let x = b.x; x <= b.x + b.w; x += step) {
      if (!pointInPolygon(x, y, poly)) continue;
      total++;
      for (const c of corridors) {
        if (distToPolyline(x, y, c.line) <= c.half) {
          on++;
          break;
        }
      }
    }
  }
  return total > 0 ? on / total : 0;
}

/** Share of `poly` that falls inside `other`, sampled on a grid over its bounding box. */
function insideFraction(poly: Vec2[], other: Vec2[]): number {
  const b = polygonBounds(poly);
  const step = Math.max(0.6, Math.min(b.w, b.h) / 12);
  let total = 0;
  let inside = 0;
  for (let y = b.y; y <= b.y + b.h; y += step) {
    for (let x = b.x; x <= b.x + b.w; x += step) {
      if (!pointInPolygon(x, y, poly)) continue;
      total++;
      if (pointInPolygon(x, y, other)) inside++;
    }
  }
  return total > 0 ? inside / total : 0;
}

export function overpassQuery(lat: number, lon: number, size: number): string {
  const b = bbox(lat, lon, size / 2 + 40);
  const box = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:40];
(
  way["building"](${box});
  relation["building"](${box});
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

/**
 * The second, optional request: water and railways.
 *
 * A river is mapped as a multipolygon whose rings can run for kilometres, so this answer
 * can be far larger than the first. It is asked for separately so that a slow or refused
 * answer costs the water, not the map.
 */
export function overpassTerrainQuery(lat: number, lon: number, size: number): string {
  const b = bbox(lat, lon, size / 2 + 40);
  const box = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:40];
(
  way["natural"="water"](${box});
  relation["natural"="water"](${box});
  way["waterway"="riverbank"](${box});
  way["waterway"~"^(river|canal)$"](${box});
  way["railway"~"^(rail|light_rail|narrow_gauge)$"](${box});
  way["man_made"="bridge"](${box});
  way["barrier"="city_wall"](${box});
  node["man_made"~"^(statue|monument)$"](${box});
  node["memorial"="statue"](${box});
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

/**
 * Ways on foot, read only where an area has no street at all: a heritage site reached by
 * paths and steps (Machu Picchu, the Great Wall at Badaling) is still a place to play.
 */
const TRAIL_WIDTH: Record<string, number> = { footway: 3, path: 2.5, steps: 3, bridleway: 3, cycleway: 3 };

/**
 * The fewest buildings a map needs: a headquarters, and a few to search and to adapt.
 * It was twelve, which ruled out every site that stands alone (the Taj Mahal has nine
 * buildings around it, Christ the Redeemer ten). Fewer buildings is a poorer map, and the
 * player can see that before choosing it.
 */
export const MIN_BUILDINGS = 5;

/**
 * Behind a defensive wall two buildings will do: the wall is the fortification the map is
 * about, and its towers are the base. The Great Wall at Badaling has two watchtowers and
 * nothing else in 480 m.
 */
export const MIN_BUILDINGS_WALLED = 2;

/** Metres of street under which an area's footpaths are walked as streets too. */
export const TRAIL_THRESHOLD = 1500;

function polylineLength(line: Vec2[]): number {
  let n = 0;
  for (let i = 1; i < line.length; i++) n += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  return n;
}

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
  /** Courtyard outlines inside the building, when OSM maps it as a multipolygon. */
  holes?: Vec2[][];
  tags: Record<string, string>;
  area: number;
  centroid: Vec2;
}

/**
 * The outer ring and the courtyards of a building relation.
 *
 * OSM maps a building with a courtyard — a Parisian block, a hospital with an inner square —
 * as a multipolygon: one outer way and one inner way per hole. Only ways were read, so those
 * buildings were missing from the map entirely, and a courtyard that arrived as a plain way
 * was stamped solid.
 */
function relationRings(el: OverpassElement, project: (p: { lat: number; lon: number }) => Vec2): { outer: Vec2[]; holes: Vec2[][] } | null {
  // An outline is often several ways end to end (the Colosseum's is four, the pyramid at
  // Chichén Itzá seventy-four): join them first. Read one at a time, each piece was closed
  // by a straight chord, and the building became a sliver of itself or nothing at all.
  const pieces = (inner: boolean): Vec2[][] =>
    (el.members ?? [])
      .filter((m) => m.type === "way" && (m.role === "inner") === inner)
      .map((m) => (m.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).map(project));
  const rings = (inner: boolean) =>
    joinRings(pieces(inner))
      .map((r) => simplifyPolygon(r))
      .filter((r) => r.length >= 3);
  let best: Vec2[] | null = null;
  let bestArea = 0;
  for (const r of rings(false)) {
    const area = polygonArea(r);
    if (area > bestArea) {
      bestArea = area;
      best = r;
    }
  }
  if (!best) return null;
  // A hole that is not inside the outer ring is not a courtyard.
  const holes = rings(true).filter((h) => {
    if (polygonArea(h) <= 20) return false;
    const c = polygonCentroid(h);
    return pointInPolygon(c.x, c.y, best!);
  });
  return { outer: best, holes };
}

/**
 * Closed rings from the open ways of a multipolygon.
 *
 * A river's outline is rarely one way: it is a chain of them, each ending where the next
 * begins, in no fixed direction. They are joined end to end by shared points; a chain that
 * never closes (a river cut off by the data) is dropped rather than guessed at.
 */
export function joinRings(pieces: Vec2[][]): Vec2[][] {
  const key = (p: Vec2) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const same = (a: Vec2, b: Vec2) => key(a) === key(b);
  const left = pieces.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings: Vec2[][] = [];
  while (left.length) {
    let ring = left.pop()!;
    while (!same(ring[0], ring[ring.length - 1])) {
      const end = ring[ring.length - 1];
      const at = left.findIndex((q) => same(q[0], end) || same(q[q.length - 1], end));
      if (at < 0) break;
      const next = left.splice(at, 1)[0];
      if (!same(next[0], end)) next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring.slice(0, -1));
  }
  return rings;
}

/** The areas of water a `natural=water` relation describes, islands cut out. */
function waterRelation(el: OverpassElement, project: (p: { lat: number; lon: number }) => Vec2): { polygon: Vec2[]; holes: Vec2[][] }[] {
  const pieces = (role: string): Vec2[][] =>
    (el.members ?? [])
      .filter((m) => m.type === "way" && (m.role === role || (role === "outer" && m.role === "")))
      .map((m) => (m.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).map(project));
  const outers = joinRings(pieces("outer"));
  const inners = joinRings(pieces("inner"));
  return outers.map((polygon) => {
    const holes = inners.filter((h) => {
      const c = polygonCentroid(h);
      return pointInPolygon(c.x, c.y, polygon);
    });
    return { polygon, holes };
  });
}

const RAIL_KINDS = new Set(["rail", "light_rail", "narrow_gauge"]);

/** Width in meters of a river or canal mapped as a line. */
const WATERWAY_WIDTH: Record<string, number> = { river: 18, canal: 12 };

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
  const rawRoads: { id: number; kind: string; line: Vec2[]; width: number; trail?: boolean }[] = [];
  const rawTrails: { id: number; kind: string; line: Vec2[]; width: number; trail: true }[] = [];
  const rawParks: { id: number; poly: Vec2[] }[] = [];
  const rawWaters: WaterDef[] = [];
  const rawRails: RailDef[] = [];
  const rawBridges: BridgeDef[] = [];
  const rawWalls: WallDef[] = [];
  const rawMonuments: MonumentDef[] = [];
  // Rings get clipped to the play area; a hole is clipped on its own, and only a piece
  // that still has area is kept.
  const addWater = (id: string, polygon: Vec2[], holes: Vec2[][] = []) => {
    const poly = clipPolygonToRect(simplifyPolygon(polygon, 1), bounds);
    if (poly.length < 3 || polygonArea(poly) < 150) return;
    const kept = holes.map((h) => clipPolygonToRect(simplifyPolygon(h, 1), bounds)).filter((h) => h.length >= 3 && polygonArea(h) > 20);
    rawWaters.push({ id, polygon: poly, ...(kept.length ? { holes: kept } : {}) });
  };

  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (el.type === "node") {
      if (el.lat === undefined || el.lon === undefined) continue;
      const p = project({ lat: el.lat, lon: el.lon });
      const monument = monumentOf(tags);
      if (monument) {
        if (p.x > 2 && p.y > 2 && p.x < size - 2 && p.y < size - 2 && !rawMonuments.some((m) => m.id === `mo${el.id}`))
          rawMonuments.push({ id: `mo${el.id}`, x: p.x, y: p.y, ...monument });
        continue;
      }
      pois.push({ p, tags });
      continue;
    }
    if (el.type === "relation") {
      if (tags.natural === "water" && tags.type === "multipolygon") {
        waterRelation(el, project).forEach((w, i) => addWater(`w${el.id}_${i}`, w.polygon, w.holes));
        continue;
      }
      if (!tags.building || tags.building === "no" || tags.type !== "multipolygon") continue;
      const rings = relationRings(el, project);
      if (!rings) continue;
      const outer: Vec2[] = rings.outer;
      if (!outer.every((p) => p.x > inner.x && p.y > inner.y && p.x < inner.x + inner.w && p.y < inner.y + inner.h)) continue;
      const area = polygonArea(outer) - rings.holes.reduce((n, h) => n + polygonArea(h), 0);
      if (area < 30) continue;
      rawBuildings.push({ osmId: el.id, poly: outer, holes: rings.holes, tags, area, centroid: polygonCentroid(outer) });
      continue;
    }
    if (el.type !== "way" || !el.geometry) continue;
    const pts = el.geometry.filter((g): g is { lat: number; lon: number } => !!g).map(project);
    if (pts.length < 2) continue;
    const closed = pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.01;
    // A defensive wall, mapped as a line (or a ring round a town). The Great Wall is also
    // tagged as steps along its top; it is read as a wall, not as a path to walk.
    if (tags.barrier === "city_wall" || tags.historic === "citywalls") {
      if (rawWalls.some((w) => w.id.startsWith(`cw${el.id}_`))) continue;
      const height = Math.max(3, Math.min(20, Number.parseFloat(tags.height ?? "") || 8));
      const width = Math.max(1.5, Math.min(10, Number.parseFloat(tags.width ?? "") || 3));
      for (const [k, piece] of clipPolylineToRect(pts, bounds).entries())
        rawWalls.push({ id: `cw${el.id}_${k}`, path: piece, height, width });
      continue;
    }
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
      for (const piece of clipPolylineToRect(pts, bounds)) {
        rawRoads.push({ id: el.id, kind: tags.highway, line: piece, width: roadWidth(tags, tags.highway) });
      }
    } else if (tags.highway && TRAIL_WIDTH[tags.highway] && tags.tunnel !== "yes" && tags.area !== "yes") {
      const width = Math.min(6, Number.parseFloat(tags.width ?? "") || TRAIL_WIDTH[tags.highway]);
      for (const piece of clipPolylineToRect(pts, bounds))
        rawTrails.push({ id: el.id, kind: tags.highway, line: piece, width, trail: true });
    } else if (tags.railway && RAIL_KINDS.has(tags.railway) && tags.tunnel !== "yes") {
      for (const [k, piece] of clipPolylineToRect(pts, bounds).entries()) rawRails.push({ id: `rail${el.id}_${k}`, path: piece });
    } else if (tags.waterway && WATERWAY_WIDTH[tags.waterway] && tags.tunnel !== "yes" && tags.tunnel !== "culvert" && !closed) {
      const width = Math.max(4, Number.parseFloat(tags.width ?? "") || WATERWAY_WIDTH[tags.waterway]);
      for (const [k, piece] of clipPolylineToRect(pts, bounds).entries()) rawWaters.push({ id: `ww${el.id}_${k}`, path: piece, width });
    } else if (closed && tags.man_made === "bridge") {
      const poly = clipPolygonToRect(simplifyPolygon(pts.slice(0, -1), 0.5), bounds);
      if (poly.length >= 3 && polygonArea(poly) > 40) rawBridges.push({ id: `br${el.id}`, polygon: poly });
    } else if (closed && (tags.natural === "water" || tags.waterway === "riverbank")) {
      addWater(`w${el.id}`, pts.slice(0, -1));
    } else if (closed && (tags.leisure || tags.landuse || tags.natural)) {
      const poly = clipPolygonToRect(pts.slice(0, -1), bounds);
      if (poly.length >= 3 && polygonArea(poly) > 150) rawParks.push({ id: el.id, poly });
    }
  }

  // A site with few or no streets is walked on its own paths. Measured on 480 m areas: the
  // Eiffel Tower and the Colosseum have over 5 km of streets, the Taj Mahal 0.2 km, Christ
  // the Redeemer 0.8, Giza 1.1, Machu Picchu and Chichén Itzá none. Below the threshold
  // the paths join the streets, so the buildings they reach are kept.
  const streetLength = rawRoads.reduce((n, r) => n + polylineLength(r.line), 0);
  if (streetLength < TRAIL_THRESHOLD) rawRoads.push(...rawTrails);
  if (rawRoads.length === 0) throw new OsmImportError("noStreets", "No streets in this area");

  // OSM sometimes maps one volume twice: a tower over its annex, or a building drawn again
  // as a part. Both are stamped and both are drawn, so the smaller one's walls cut through
  // the larger one's roof and out over the street — the slabs the fourth playtest report
  // showed. Keep the bigger of a pair and drop the one that sits inside it.
  const deduped: RawBuilding[] = [];
  const minaretsOf = new Map<RawBuilding, Vec2[]>();
  for (const rb of rawBuildings) {
    const box = polygonBounds(rb.poly);
    const swallowed = rawBuildings.find((other) => {
      if (other === rb || other.area <= rb.area) return false;
      const ob = polygonBounds(other.poly);
      if (box.x + box.w <= ob.x || ob.x + ob.w <= box.x || box.y + box.h <= ob.y || ob.y + ob.h <= box.y) return false;
      return insideFraction(rb.poly, other.poly) > 0.6;
    });
    if (!swallowed) deduped.push(rb);
    // A minaret on a mausoleum's platform is part of it: drawn with it, not as a building.
    else if (rb.tags["tower:type"] === "minaret") minaretsOf.set(swallowed, [...(minaretsOf.get(swallowed) ?? []), rb.centroid]);
  }
  // And a footprint that lies on a street is not a building the player can use: it would
  // swallow the road the survivors walk on. OSM has a few of these (a monument over a
  // passage, a mall mapped across an arcade). Keep the ones that merely overhang the
  // sidewalk; drop the ones that sit on the carriageway.
  const onStreet: RawBuilding[] = [];
  for (const rb of deduped) {
    // A building standing on the carriageway is not usable; one that pokes into it is
    // pulled back to the kerb so the street stays a street.
    if (streetFraction(rb.poly, rawRoads) > 0.4) continue;
    const pulled = pullOutOfStreets(rb.poly, rawRoads);
    if (!pulled) continue;
    onStreet.push({ ...rb, poly: pulled, centroid: polygonCentroid(pulled) });
  }
  rawBuildings.length = 0;
  rawBuildings.push(...onStreet);

  // Nearest to the center first, so a cap keeps the heart of the area.
  rawBuildings.sort(
    (a, b) =>
      Math.hypot(a.centroid.x - size / 2, a.centroid.y - size / 2) - Math.hypot(b.centroid.x - size / 2, b.centroid.y - size / 2) ||
      a.osmId - b.osmId,
  );
  rawBuildings.splice(opts.maxBuildings ?? 700);

  const roads: RoadDef[] = rawRoads.map((r, i) => {
    const b = polygonBounds(r.line);
    const width = r.width;
    return {
      id: `r${r.id}_${i}`,
      rect: { x: b.x - width / 2, y: b.y - width / 2, w: b.w + width, h: b.h + width },
      horizontal: b.w >= b.h,
      path: r.line,
      width,
      ...(r.trail ? { trail: true } : {}),
    };
  });
  const streets = rawRoads.filter((r) => r.kind !== "pedestrian" && r.kind !== "track");

  // First pass: stamp every candidate building, then pick doors on free cells.
  const typed = rawBuildings.map((rb) => ({ rb, type: classify(rb, pois) }));
  ensureEssentials(typed, size);
  const grid = new NavGrid(size, size, cellSize);
  typed.forEach((t, i) => grid.stampPolygon(t.rb.poly, i));
  stampTerrain(grid, {
    roads,
    waters: rawWaters,
    rails: rawRails,
    bridges: rawBridges,
    walls: rawWalls,
    monuments: rawMonuments,
    terrain: opts.terrain,
  });

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
    const floors = floorsOf(k.rb.tags, k.type, rng, k.rb.poly);
    const index = buildings.length;
    buildings.push({
      id: `osm${k.rb.osmId}`,
      index,
      type: k.type,
      zone: ZONE_OF[k.type],
      rect: polygonBounds(k.rb.poly),
      footprint: k.rb.poly,
      holes: k.rb.holes,
      area: Math.round(k.rb.area),
      floors,
      height: floors * 3.2 + 0.6,
      landmark: landmarkOf(k.rb.tags),
      ...landmarkLook(k.rb.tags, minaretsOf.get(k.rb) ?? cornerMinarets(k.rb)),
      entrance: k.entrance,
      facing: k.facing,
    });
  }
  const fewest = rawWalls.length ? MIN_BUILDINGS_WALLED : MIN_BUILDINGS;
  if (buildings.length < fewest) throw new OsmImportError("tooFewBuildings", `Only ${buildings.length} usable buildings`);

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
    ...(rawWaters.length ? { waters: rawWaters } : {}),
    ...(rawRails.length ? { rails: rawRails } : {}),
    ...(rawBridges.length ? { bridges: rawBridges } : {}),
    ...(rawWalls.length ? { walls: rawWalls } : {}),
    ...(rawMonuments.length ? { monuments: rawMonuments } : {}),
    ...(opts.terrain ? { terrain: opts.terrain } : {}),
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
  if (
    ["school", "college", "university", "kindergarten"].includes(amenity) ||
    ["school", "university", "college", "kindergarten"].includes(b)
  )
    return "school";
  if (["supermarket", "wholesale", "department_store", "greengrocer", "convenience"].includes(shop) && rb.area > 250) return "supermarket";
  if (shop === "supermarket" || b === "supermarket") return "supermarket";
  if (["pharmacy", "clinic", "doctors", "dentist"].includes(amenity) || ["chemist", "medical_supply"].includes(shop) || tags.healthcare)
    return "pharmacy";
  if (amenity === "fuel") return "gasStation";
  if (
    [
      "warehouse",
      "industrial",
      "factory",
      "manufacture",
      "hangar",
      "storage_tank",
      "garages",
      "garage",
      "shed",
      "barn",
      "service",
      "transportation",
    ].includes(b)
  )
    return "warehouse";
  if (b === "office" || b === "commercial" || tags.office) return "office";
  if (shop || b === "retail" || b === "kiosk" || ["restaurant", "cafe", "bar", "fast_food", "bank", "pub", "marketplace"].includes(amenity))
    return "shop";
  if (["apartments", "residential", "dormitory", "hotel"].includes(b)) return "apartment";
  if (["house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "cabin"].includes(b)) return "house";
  const levels = Number(tags["building:levels"]);
  if (rb.area < 180) return "house";
  if (levels >= 3 || rb.area < 600) return levels >= 3 ? "apartment" : rb.osmId % 5 === 0 ? "shop" : "house";
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

/**
 * Towers, spires and monuments, which OSM maps as the square around their base.
 *
 * The Eiffel Tower is one way tagged `building=tower`, `height=330`: extruded like a
 * building it becomes the hall between its four legs, six floors tall.
 */
/**
 * What a statue or monument point is drawn as, or nothing. A statue of Christ
 * (`subject:wikidata=Q302`) opens its arms, at Christ the Redeemer's proportions unless
 * OSM gives a height (30 m on an 8 m pedestal); any other statue is a figure a few metres
 * tall; a monument that is not a statue is a column.
 */
function monumentOf(tags: Record<string, string>): Omit<MonumentDef, "id" | "x" | "y"> | null {
  const statue = tags.man_made === "statue" || tags.memorial === "statue";
  if (!statue && tags.man_made !== "monument") return null;
  const total = Number.parseFloat(tags.height ?? "");
  const christ = tags["subject:wikidata"] === "Q302";
  const kind: MonumentDef["kind"] = christ ? "open-arms" : statue ? "statue" : "column";
  const [figure, pedestal] = christ ? [30, 8] : statue ? [3.5, 2] : [9, 1.5];
  if (Number.isFinite(total) && total > 1) {
    // The tagged height is the whole: the pedestal keeps its share of it.
    const share = pedestal / (figure + pedestal);
    return { kind, height: total * (1 - share), pedestal: total * share };
  }
  return { kind, height: figure, pedestal };
}

/** Named colours OSM uses in `building:colour` and `roof:colour`, beside #rrggbb. */
const NAMED_COLOUR: Record<string, number> = {
  white: 0xece8de,
  sand: 0xcdb48a,
  beige: 0xd2c3a0,
  grey: 0x8f8f8a,
  gray: 0x8f8f8a,
  brown: 0x7a5a40,
  red: 0x9a4a38,
  yellow: 0xc9a94e,
  black: 0x2e2c2a,
};

export function parseColour(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return Number.parseInt(v.slice(1), 16);
  if (/^#[0-9a-f]{3}$/.test(v))
    return Number.parseInt(
      v.slice(1).replace(/./g, (c) => c + c),
      16,
    );
  return NAMED_COLOUR[v];
}

/**
 * A great mausoleum's minarets when OSM does not map them: four, at the corners of a
 * platform at least 60 m across and nearly square — the Taj Mahal's, whose own towers are
 * mapped only as parts the request does not ask for.
 */
function cornerMinarets(rb: RawBuilding): Vec2[] | undefined {
  if (rb.tags.tomb !== "mausoleum") return undefined;
  const f = latticeFrame(rb.poly);
  if (Math.min(f.a, f.b) < 30 || Math.max(f.a, f.b) / Math.min(f.a, f.b) > 1.25) return undefined;
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([s, t]) => framePoint(f, s * 0.9, t * 0.9));
}

/** A landmark's own colour and its minarets; nothing for an ordinary building. */
function landmarkLook(tags: Record<string, string>, minarets: Vec2[] | undefined): { colour?: number; minarets?: Vec2[] } {
  if (!landmarkOf(tags)) return {};
  const colour = parseColour(tags["building:colour"]) ?? parseColour(tags["roof:colour"]);
  return { ...(colour !== undefined ? { colour } : {}), ...(minarets?.length ? { minarets } : {}) };
}

function landmarkOf(tags: Record<string, string>): Landmark | undefined {
  // Iron you can see through, on four piers: drawn as a lattice, and the ground between
  // the piers stays open.
  if (tags["tower:construction"] === "lattice" && (tags.man_made === "tower" || tags.building === "tower")) return "lattice";
  if (tags.building === "amphitheatre" || tags.archaeological_site === "amphitheatre") return "amphitheatre";
  // A tomb or a temple carved into a cliff (Petra's Treasury is tomb=rock-cut): a tall
  // facade in the rock, not a shed of the footprint's size.
  if (tags.tomb === "rock-cut" || tags["building:material"] === "rock" || tags.historic === "rock_cut") return "rockcut";
  // A pyramid tomb (Giza), or a pyramidal roof that is the whole of the building's height.
  // A house with a pyramidal roof has a roof a few metres tall over its walls.
  const roofHeight = parseFloat(tags["roof:height"] ?? "");
  const height = parseFloat(tags.height ?? "");
  if (
    tags.tomb === "pyramid" ||
    (tags["roof:shape"] === "pyramidal" &&
      roofHeight > 0 &&
      height > 0 &&
      roofHeight >= height * 0.8 &&
      !tags.man_made &&
      tags.building !== "tower")
  )
    return "pyramid";
  // OSM's building=pyramid is mostly Mesoamerican: terraces and a temple on the top.
  if (tags.building === "pyramid") return "stepped";
  // A dome: tagged as one, or a mausoleum (the Taj Mahal is tomb=mausoleum and nothing
  // more), or a mosque, which had been drawn with a church's spire.
  if (/^(dome|onion)$/.test(tags["roof:shape"] ?? "") || tags.tomb === "mausoleum" || tags.building === "mosque") return "dome";
  // A watchtower on a wall, or a castle's keep: a block of masonry with battlements, not a
  // tapering tower, and not a house with windows either.
  if (tags["tower:type"] === "defensive" || tags.defensive_tower === "yes" || tags.castle_type === "defensive") return "watchtower";
  if (tags.man_made === "tower" || tags.building === "tower" || tags["tower:type"]) return "tower";
  if (/^(cathedral|church|chapel|basilica|synagogue|temple|abbey)$/.test(tags.building ?? "")) return "spire";
  if (tags.historic === "monument" || tags.historic === "memorial" || tags.man_made === "obelisk") return "obelisk";
  return undefined;
}

function floorsOf(tags: Record<string, string>, type: BuildingType, rng: Rng, poly: Vec2[] = []): number {
  const landmark = landmarkOf(tags);
  const height = parseFloat(tags.height ?? "");
  // A landmark is a silhouette, not storeys: its height wins over a level count (the Great
  // Pyramid is tagged forty levels, which the twenty-floor cap turned into a 65 m block).
  if (landmark && Number.isFinite(height) && height > 2) return Math.max(1, Math.min(125, Math.round(height / 3.2)));
  if (landmark === "watchtower") {
    // An untagged watchtower stands a little taller than it is wide: the Great Wall's are
    // 11 m on 10 m.
    const r = polygonBounds(poly);
    return Math.max(2, Math.min(8, Math.round((Math.min(r.w, r.h) * 1.15) / 3.2)));
  }
  if (landmark === "rockcut") {
    // An untagged rock-cut facade stands about twice as tall as its footprint is long: the
    // Treasury rises 39 m over an outline mapped 18 m deep, the Monastery 48 m over 25.
    const r = polygonBounds(poly);
    return Math.max(4, Math.min(15, Math.round((Math.max(r.w, r.h) * 2.2) / 3.2)));
  }
  if (landmark === "dome") {
    // An untagged domed hall rises about six tenths of its width: the Taj Mahal's 73 m over a
    // 95 m platform, a mosque's dome over its prayer hall.
    const r = polygonBounds(poly);
    return Math.max(4, Math.min(30, Math.round((Math.min(r.w, r.h) * 0.6) / 3.2)));
  }
  if (landmark === "amphitheatre") {
    // Untagged amphitheatres rise about a quarter of their width: the Colosseum 48 m over
    // 156, Verona's 30 over 109.
    const r = polygonBounds(poly);
    return Math.max(3, Math.min(16, Math.round((Math.min(r.w, r.h) * 0.27) / 3.2)));
  }
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels >= 1) return Math.min(20, Math.round(levels));
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
    if (isWalkableKind(grid.kind[c]) && !seen[c]) {
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
      if (seen[n] || !isWalkableKind(grid.kind[n])) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}
