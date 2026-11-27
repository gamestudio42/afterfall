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
  type Rect,
  type Vec2,
} from "@afterfall/shared";
import type { BridgeDef, BuildingDef, CityMap, ParkDef, RoadDef, WaterDef } from "./city";
import { CellKind, NavGrid, isWalkableKind } from "./navgrid";
import { cutBuildingPads, heightAt, padOutlines, type TerrainDef } from "./terrain";

/**
 * A generated city with relief and an irregular street plan.
 *
 * The first generator laid every seed out the same way: six by five square blocks of 56 m
 * on flat ground, so only the zones changed from one game to the next. This one draws a
 * site first (a hill or two, an escarpment, rolling ground, or a river valley) and a street
 * plan on it: a grid of blocks of uneven sizes with an avenue and some blocks joined into
 * superblocks, or, in a valley, the same grid cut by a river that only a few bridges cross.
 *
 * The map comes out in the shape an imported place has (streets as centre lines, relief as
 * a heightfield, water, bridge decks), so everything the game already does with relief and
 * water applies to it: climbing is slow, high ground shoots further, a slope too steep to
 * climb is a cliff that only a street crosses, and nobody walks on water but over a bridge.
 */

export type Site = "hills" | "escarpment" | "rolling" | "valley";
export type Layout = "grid" | "river";

/** Metres between relief nodes, as on an imported map. */
const RELIEF_CELL = 4;
const CELL = 2;
/**
 * The sizes a player can ask for: about how many metres the map runs across. A real place
 * loads at up to 800 m too; a huge generated city is about 3.5 times the area of the
 * 420 by 352 m classic grid.
 */
export const CITY_SIZES = { small: 350, medium: 450, large: 600, huge: 800 } as const;
export type CitySize = keyof typeof CITY_SIZES;
/** Fewest buildings a medium map may have (scaled by area for the others), and the kinds it must have. */
const MIN_BUILDINGS = 40;
/**
 * How far the city carries on past the map's edge, by size: real blocks, streets and
 * buildings, drawn but not played. A plain box skyline stands beyond it (sky.ts).
 */
const RING: Record<CitySize, number> = { small: 140, medium: 140, large: 120, huge: 90 };
const RING_MAX = 140;

/** Half the widest escarpment face, and 3 m more. */
const SCARP_CLEAR = 11;
const ESSENTIAL: BuildingType[] = ["hospital", "police", "school", "supermarket"];
const NAME_PREFIXES = ["Nova", "Porto", "Vila", "São", "Monte", "Campo", "Alto", "Rio"];
const NAME_SUFFIXES = ["Esperança", "Cinzento", "Aurora", "Ferro", "Silêncio", "Verde", "Bruma", "Quieto"];

export interface VariedOptions {
  /** Force a site, for tests and screenshots. */
  site?: Site;
  /** How big a city to lay out; medium when absent. */
  size?: CitySize;
  /** Force how the street grid lies on the map, for tests and screenshots. */
  shape?: Shape;
}

export function generateVariedCity(seed: number, opts: VariedOptions = {}): CityMap {
  // A plan can fail the checks (a door cut off by a cliff, a hospital in the river): the
  // next attempt is drawn from the same seed, so a seed always gives the same map.
  for (let attempt = 0; attempt < 12; attempt++) {
    const map = attemptCity(seed >>> 0, attempt, opts);
    if (map) return map;
  }
  throw new Error(`No playable generated city for seed ${seed}`);
}

interface Lot {
  type: BuildingType;
  zone: Zone;
  /** In plan coordinates: the street grid before it is turned and bent onto the map. */
  rect: Rect;
  /** Which way the door faces, in plan coordinates (±v). */
  side: 1 | -1;
}

/** How the street grid lies on the map: square to it, turned, or turned and bent. */
export type Shape = "square" | "turned" | "bent";

function attemptCity(seed: number, attempt: number, opts: VariedOptions): CityMap | null {
  const rng = new Rng(deriveSeed(seed, `varied:${attempt}`));
  const site: Site = opts.site ?? rng.weighted<Site>({ hills: 30, valley: 30, escarpment: 20, rolling: 20 });
  const layout: Layout = site === "valley" ? "river" : "grid";
  const size = CITY_SIZES[opts.size ?? "medium"];
  const k = size / CITY_SIZES.medium;
  const snap = (v: number) => Math.round(v / CELL) * CELL;

  // The map: a little wider than it is tall, never larger than the size asked for.
  const width = snap(size * rng.range(0.88, 1));
  const height = snap(size * rng.range(0.72, 0.95));
  const bounds: Rect = { x: 0, y: 0, w: width, h: height };

  // The street grid is laid out in its own plan, (u, v) around the map's centre, then
  // turned and bent onto the map. Square to the map every street ran east-west or north-
  // south and every city read as the same chessboard.
  const shape: Shape = opts.shape ?? rng.weighted<Shape>({ square: 30, turned: 40, bent: 30 });
  const theta = shape === "square" ? 0 : shape === "turned" ? (rng.chance(0.5) ? 1 : -1) * rng.range(0.22, 0.7) : rng.range(-0.25, 0.25);
  const bend = shape === "bent" ? rng.range(14, 24) * Math.sqrt(k) : 0;
  const bendWave = rng.range(280, 420) * Math.sqrt(k);
  const bendPhase = rng.range(0, Math.PI * 2);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const toMap = (u: number, v: number): Vec2 => {
    const bu = u + bend * Math.sin((v / bendWave) * Math.PI * 2 + bendPhase);
    const bv = v + bend * 0.6 * Math.sin((u / bendWave) * Math.PI * 2 + bendPhase * 1.7);
    return { x: width / 2 + bu * cos - bv * sin, y: height / 2 + bu * sin + bv * cos };
  };
  // The plan covers the whole map once turned; square, it fits it exactly.
  const margin0 = shape === "square" ? 0 : bend + 24;
  const halfU = (width / 2) * Math.abs(cos) + (height / 2) * Math.abs(sin) + margin0;
  const halfV = (width / 2) * Math.abs(sin) + (height / 2) * Math.abs(cos) + margin0;

  // Blocks of uneven sizes between streets of two widths, an avenue every few blocks:
  // drawn at random, then scaled together to fill the plan.
  const cols = Math.max(4, Math.round((halfU * 2) / 67));
  const rows = Math.max(4, Math.round((halfV * 2) / 64));
  const roadW = Array.from({ length: cols + 1 }, () => 10);
  const roadH = Array.from({ length: rows + 1 }, () => 10);
  for (let a = 0; a < Math.max(1, Math.round(cols / 6)); a++) roadW[rng.int(1, cols - 1)] = 16;
  for (let a = 0; a < Math.max(1, Math.round(rows / 6)); a++) roadH[rng.int(1, rows - 1)] = 16;
  const fill = (n: number, lo: number, hi: number, total: number) => {
    const raw = Array.from({ length: n }, () => rng.range(lo, hi));
    const sum = raw.reduce((x, y) => x + y, 0);
    const out = raw.map((v) => Math.max(36, Math.min(80, snap((v * total) / sum))));
    // Snapping leaves a few metres over or under: the last block takes them.
    out[n - 1] += total - out.reduce((x, y) => x + y, 0);
    return out;
  };
  const blockW = fill(cols, 40, 72, halfU * 2 - roadW.reduce((x, y) => x + y, 0));
  const blockH = fill(rows, 40, 66, halfV * 2 - roadH.reduce((x, y) => x + y, 0));
  const us: number[] = [];
  const vs: number[] = [];
  let acc = -halfU;
  for (let i = 0; i <= cols; i++) {
    us.push(acc);
    acc += roadW[i] + (i < cols ? blockW[i] : 0);
  }
  acc = -halfV;
  for (let j = 0; j <= rows; j++) {
    vs.push(acc);
    acc += roadH[j] + (j < rows ? blockH[j] : 0);
  }
  const vu = (i: number) => us[i] + roadW[i] / 2;
  const hv = (j: number) => vs[j] + roadH[j] / 2;

  // A river across the valley, wandering north to south over the map.
  let river: Vec2[] | null = null;
  let riverW = 0;
  if (layout === "river") {
    riverW = snap(rng.range(18, 26));
    const x0 = width * rng.range(0.4, 0.6);
    const amp = rng.range(14, 32);
    const wave = rng.range(220, 340) * Math.sqrt(k);
    const phase = rng.range(0, Math.PI * 2);
    river = [];
    for (let py = -20; py <= height + 20; py += 12) {
      const t = (py / wave) * Math.PI * 2 + phase;
      river.push({ x: x0 + amp * Math.sin(t) + amp * 0.3 * Math.sin(t * 2.3 + 1), y: py });
    }
    // On out through the city round the map, straight: the relief past the edge is the
    // edge's own, held, and a straight valley floor is what it holds.
    const first = river[0];
    const last = river[river.length - 1];
    river.unshift({ x: first.x, y: -RING_MAX - 40 });
    river.push({ x: last.x, y: height + RING_MAX + 40 });
  }
  const riverDist = (px: number, py: number) => (river ? distToPolyline(px, py, river) - riverW / 2 : Infinity);

  // Superblocks: a few interior cross streets between two blocks are left out.
  const cut = new Set<string>();
  if (layout === "grid") {
    const n = rng.int(1, Math.max(3, Math.round((cols * rows) / 10)));
    for (let c = 0; c < n; c++) cut.add(`${rng.int(1, cols - 1)}:${rng.int(0, rows - 1)}`);
  }

  // Streets as centre lines on the map. A street is cut where it leaves the map and at
  // the river's banks, except on the rows that bridge it.
  const roads: RoadDef[] = [];
  const bridges: BridgeDef[] = [];
  const bridgeRows = new Set<number>();
  if (river) {
    const interior = rng.shuffle(Array.from({ length: rows + 1 }, (_, j) => j).filter((j) => j > 0 && j < rows));
    const n = Math.min(interior.length, rng.int(1, Math.max(3, Math.round(rows / 3))));
    for (let b = 0; b < n; b++) bridgeRows.add(interior[b]);
  }
  const BANK = 3;
  const addRoad = (id: string, a: Vec2, b: Vec2, w: number, bridged: boolean) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / (bend ? 4 : len)));
    const line: Vec2[] = [];
    for (let s = 0; s <= steps; s++) line.push(toMap(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps));
    for (const piece of clipPolylineToRect(line, bounds)) {
      // Split at the river: sample the piece every 2 m and keep the dry runs.
      const dense = densify(piece, 2);
      let run: Vec2[] = [];
      const wet: Vec2[] = [];
      const flush = () => {
        if (run.length > 1 && polylineLength(run) >= 12) {
          const path = simplifyLine(run);
          roads.push({ id: `${id}_${roads.length}`, rect: lineBounds(path, w), horizontal: isHorizontal(path), path, width: w });
        }
        run = [];
      };
      for (const p of dense) {
        const d = riverDist(p.x, p.y);
        if (bridged && d < 1) wet.push(p);
        if (bridged || d > BANK) run.push(p);
        else flush();
      }
      flush();
      if (wet.length > 1) {
        // The deck: the stretch over water and a few metres onto each bank.
        const p0 = wet[0];
        const p1 = wet[wet.length - 1];
        const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        const dx = (p1.x - p0.x) / dl;
        const dy = (p1.y - p0.y) / dl;
        const half = w / 2 + 1.5;
        const a0 = { x: p0.x - dx * 6, y: p0.y - dy * 6 };
        const a1 = { x: p1.x + dx * 6, y: p1.y + dy * 6 };
        bridges.push({
          id: `bridge${bridges.length}`,
          polygon: [
            { x: a0.x - dy * half, y: a0.y + dx * half },
            { x: a1.x - dy * half, y: a1.y + dx * half },
            { x: a1.x + dy * half, y: a1.y - dx * half },
            { x: a0.x + dy * half, y: a0.y - dx * half },
          ],
        });
      }
    }
  };
  for (let j = 0; j <= rows; j++) addRoad(`h${j}`, { x: -halfU, y: hv(j) }, { x: halfU, y: hv(j) }, roadH[j], bridgeRows.has(j));
  for (let i = 0; i <= cols; i++) {
    // A cross street runs from row to row, leaving out the stretches cut for superblocks.
    let from = -halfV;
    for (let j = 0; j < rows; j++) {
      if (!cut.has(`${i}:${j}`)) continue;
      addRoad(`v${i}_${j}`, { x: vu(i), y: from }, { x: vu(i), y: hv(j) }, roadW[i], false);
      from = hv(j + 1);
    }
    addRoad(`v${i}_end`, { x: vu(i), y: from }, { x: vu(i), y: halfV }, roadW[i], false);
  }
  if (river && bridges.length === 0) return null;

  // The relief, which knows the streets: where one climbs an escarpment the face is
  // drawn out into a ramp along it.
  const relief = makeRelief(rng, site, width, height, riverDist, k, roads, theta);
  const scarp = relief.scarp;

  // Blocks: a superblock joins the blocks either side of a cut street.
  interface Block {
    rect: Rect;
    zone: Zone;
    centre: number;
    special?: BuildingType;
  }
  const maxD = Math.hypot(width / 2, height / 2);
  const blocks: Block[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (i > 0 && cut.has(`${i}:${j}`)) continue;
      let i1 = i;
      while (i1 + 1 < cols && cut.has(`${i1 + 1}:${j}`)) i1++;
      const u0 = us[i] + roadW[i];
      const u1 = us[i1 + 1];
      const rect = { x: u0, y: vs[j] + roadH[j], w: u1 - u0, h: blockH[j] };
      const c = toMap(rect.x + rect.w / 2, rect.y + rect.h / 2);
      blocks.push({ rect, zone: "residential", centre: Math.hypot(c.x - width / 2, c.y - height / 2) / maxD });
    }
  // A plan rectangle as it lies on the map, its sides sampled so a bend shows.
  const outline = (r: Rect, step = 0): Vec2[] => {
    const pts: [number, number][] = [];
    const n = step ? Math.max(1, Math.round(r.w / step)) : 1;
    const m = step ? Math.max(1, Math.round(r.h / step)) : 1;
    for (let a = 0; a < n; a++) pts.push([r.x + (r.w * a) / n, r.y]);
    for (let a = 0; a < m; a++) pts.push([r.x + r.w, r.y + (r.h * a) / m]);
    for (let a = n; a > 0; a--) pts.push([r.x + (r.w * a) / n, r.y + r.h]);
    for (let a = m; a > 0; a--) pts.push([r.x, r.y + (r.h * a) / m]);
    return pts.map(([u, v]) => toMap(u, v));
  };
  const clear = (r: Rect, gap: number, inside: boolean) => {
    for (let u = r.x; u <= r.x + r.w + 1e-6; u += Math.max(2, r.w / Math.ceil(r.w / 4)))
      for (let v = r.y; v <= r.y + r.h + 1e-6; v += Math.max(2, r.h / Math.ceil(r.h / 4))) {
        const p = toMap(u, v);
        if (inside && (p.x < 3 || p.y < 3 || p.x > width - 3 || p.y > height - 3)) return false;
        if (riverDist(p.x, p.y) < gap) return false;
        if (scarp && relief.steep!(p.x, p.y)) return false;
      }
    return true;
  };

  // Zones: a commercial core, a residential ring, industry and parks outside.
  for (const b of blocks) {
    const d = b.centre + rng.range(-0.12, 0.12);
    b.zone = d < 0.3 ? "commercial" : d < 0.78 ? "residential" : rng.chance(0.6) ? "industrial" : "residential";
  }
  const usable = rng.shuffle(blocks.filter((b) => clear(b.rect, 6, true)));
  const take = (pred: (b: Block) => boolean) =>
    usable.find((b) => !b.special && b.zone !== "park" && pred(b)) ?? usable.find((b) => !b.special && b.zone !== "park");
  const specials: [BuildingType, (b: Block) => boolean, Zone][] = [
    ["hospital", (b) => b.centre < 0.6, "civic"],
    ["police", (b) => b.centre < 0.7, "civic"],
    ["school", (b) => b.zone === "residential", "civic"],
    ["supermarket", (b) => b.zone === "residential", "commercial"],
    ["supermarket", (b) => b.centre > 0.4, "commercial"],
  ];
  for (const [type, pred, zone] of specials) {
    const b = take(pred);
    if (!b) return null;
    b.special = type;
    b.zone = zone;
  }
  let parkCount = 0;
  for (const b of usable) {
    if (parkCount >= Math.max(3, Math.round(3 * k * k))) break;
    if (!b.special && b.zone === "residential" && rng.chance(0.5)) {
      b.zone = "park";
      parkCount++;
    }
  }

  const typeForZone = (zone: Zone): BuildingType => {
    switch (zone) {
      case "residential":
        return rng.weighted<BuildingType>({ house: 62, apartment: 30, shop: 5, pharmacy: 3 });
      case "commercial":
        return rng.weighted<BuildingType>({ shop: 40, office: 38, pharmacy: 10, gasStation: 7, apartment: 5 });
      case "industrial":
        return rng.weighted<BuildingType>({ warehouse: 80, gasStation: 12, office: 8 });
      default:
        return "house";
    }
  };

  const lots: Lot[] = [];
  const parks: ParkDef[] = [];
  const MARGIN = 4;
  for (const b of blocks) {
    const { x: bx, y: by, w: bw, h: bh } = b.rect;
    if (b.zone === "park") {
      const polygon = clipPolygonToRect(outline(b.rect, bend ? 8 : 0), bounds);
      if (polygon.length < 3 || !clear(b.rect, 2, false)) continue;
      const trees: Vec2[] = [];
      const n = Math.round((bw * bh) / 260);
      for (let t = 0; t < n; t++) {
        const p = toMap(bx + rng.range(4, bw - 4), by + rng.range(4, bh - 4));
        if (pointInPolygon(p.x, p.y, polygon)) trees.push(p);
      }
      parks.push({ id: `p${parks.length}`, rect: polygonBounds(polygon), polygon, trees });
      continue;
    }
    if (b.special) {
      const inset = b.special === "supermarket" ? 8 : 6;
      lots.push({
        type: b.special,
        zone: b.zone,
        rect: { x: bx + inset, y: by + inset, w: Math.min(bw - inset * 2, 60), h: bh - inset * 2 - (b.special === "school" ? 10 : 0) },
        side: 1,
      });
      continue;
    }
    if (b.zone === "industrial") {
      const n = Math.max(1, Math.round(bw / 56));
      const w = bw / n;
      for (let c = 0; c < n; c++)
        for (const top of [true, false])
          lots.push({
            type: typeForZone("industrial"),
            zone: b.zone,
            rect: { x: bx + c * w + MARGIN, y: top ? by + MARGIN : by + bh / 2 + MARGIN, w: w - MARGIN * 2, h: bh / 2 - MARGIN * 2 },
            side: top ? -1 : 1,
          });
      continue;
    }
    const n = Math.max(2, Math.round(bw / (b.zone === "residential" ? rng.range(18, 24) : rng.range(22, 30))));
    const lotW = bw / n;
    const lotH = bh / 2;
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < n; c++) {
        const type = typeForZone(b.zone);
        const big = type === "apartment" || type === "office";
        const fw = lotW - MARGIN * 2;
        const fh = lotH - MARGIN * 2;
        const w = fw * (big ? rng.range(0.8, 1) : rng.range(0.6, 0.95));
        const hh = fh * (big ? rng.range(0.75, 1) : rng.range(0.55, 0.9));
        const lu = bx + c * lotW + MARGIN + (fw - w) / 2;
        const lv = r === 0 ? by + MARGIN : by + lotH + MARGIN + (fh - hh);
        lots.push({ type, zone: b.zone, rect: { x: lu, y: lv, w, h: hh }, side: r === 0 ? -1 : 1 });
      }
  }

  // Lots off the map, in the water, on the bank or on the escarpment's face are left empty.
  const sited = lots.filter((l) => clear(l.rect, 4, true));

  const water: WaterDef[] = river ? [{ id: "river", path: river, width: riverW }] : [];
  const intersections: Vec2[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const p = toMap(vu(i), hv(j));
      if (p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height) intersections.push(p);
    }

  // Square to the map a building is a snapped rectangle, as on the classic grid; turned or
  // bent it is the outline of its lot on the map.
  let buildings: BuildingDef[] = sited.map((l, index) => {
    const def = BUILDING_TYPES[l.type];
    const floors = rng.int(def.floors[0], def.floors[1]);
    const base = { id: `g${index}`, index, type: l.type, zone: l.zone, floors, height: floors * 3.2 + 0.6 };
    if (shape === "square") {
      const p = toMap(l.rect.x, l.rect.y);
      const r = { x: snap(p.x), y: snap(p.y), w: Math.max(CELL * 3, snap(l.rect.w)), h: Math.max(CELL * 3, snap(l.rect.h)) };
      return { ...base, rect: r, area: r.w * r.h, entrance: { x: 0, y: 0 }, facing: { x: 0, y: l.side } };
    }
    const footprint = outline(l.rect, bend ? 10 : 0);
    return {
      ...base,
      rect: polygonBounds(footprint),
      footprint,
      area: Math.round(polygonArea(footprint)),
      entrance: { x: 0, y: 0 },
      facing: { x: 0, y: 0 },
    };
  });

  const decor = ringCity({
    seed,
    size: opts.size ?? "medium",
    width,
    height,
    toMap,
    outline,
    shape,
    bend,
    us,
    vs,
    roadW,
    roadH,
    blockW,
    blockH,
    cut,
    bridgeRows,
    riverDist,
    relief,
    lots,
    rowsBridged: !!river,
  });

  const map: CityMap = {
    seed,
    name: `${rng.pick(NAME_PREFIXES)} ${rng.pick(NAME_SUFFIXES)}`,
    width,
    height,
    cellSize: CELL,
    blockSize: 0,
    roadWidth: 10,
    blocksX: 0,
    blocksY: 0,
    roads,
    intersections,
    buildings,
    parks,
    ...(water.length ? { waters: water } : {}),
    ...(bridges.length ? { bridges } : {}),
    terrain: relief.def,
    spawnPoints: [],
    generated: { site, layout, shape },
    decor,
  };

  // Doors: on the street side of each lot, on the first free cell out from its wall.
  const grid = NavGrid.fromCity(map);
  const lotOf = new Map(buildings.map((b, i) => [b, sited[i]]));
  for (const b of buildings) {
    const l = lotOf.get(b)!;
    const mu = l.rect.x + l.rect.w / 2;
    const edge = l.side > 0 ? l.rect.y + l.rect.h : l.rect.y;
    const wall = toMap(mu, edge);
    const out = toMap(mu, edge + l.side);
    const len = Math.hypot(out.x - wall.x, out.y - wall.y) || 1;
    b.facing = { x: (out.x - wall.x) / len, y: (out.y - wall.y) / len };
    b.entrance = { x: -1, y: -1 };
    for (const step of [1.2, 2.2, 3.2]) {
      const p = { x: wall.x + b.facing.x * step, y: wall.y + b.facing.y * step };
      if (p.x < 1 || p.y < 1 || p.x > width - 1 || p.y > height - 1) break;
      const c = grid.cellOf(p.x, p.y);
      if (grid.kind[c] !== CellKind.Free) continue;
      b.entrance = grid.centerOf(c);
      break;
    }
  }
  // And only doors that open onto a street someone can reach from the edge of the map.
  // A street clipped at a corner of a turned plan can be a stub cut off from the rest:
  // the city is the largest piece of ground the streets reach, the hordes come in only
  // where they can get to it, and a door must open onto it. Dropping a building moves the
  // abandoned cars, which are placed from the doors, so this runs until it settles.
  let stable = false;
  for (let pass = 0; pass < 4 && !stable; pass++) {
    // Rebuilt each pass: the cars keep clear of the doors just chosen.
    const g = NavGrid.fromCity(map);
    let reach: Uint8Array | null = null;
    let reachCount = -1;
    const entries = borderEntries(roads, width, height, g);
    for (const p of entries) {
      if (reach?.[g.cellOf(p.x, p.y)]) continue;
      const r = reachable(g, [p]);
      let n = 0;
      for (const v of r) n += v;
      if (n > reachCount) {
        reach = r;
        reachCount = n;
      }
    }
    if (!reach) return null;
    const city = reach;
    map.spawnPoints = entries.filter((p) => city[g.cellOf(p.x, p.y)]);
    const kept = buildings.filter((b) => {
      if (b.entrance.x < 0) return false;
      const c = g.cellOf(b.entrance.x, b.entrance.y);
      return g.kind[c] === CellKind.Free && city[c];
    });
    stable = kept.length === buildings.length;
    buildings = kept;
    buildings.forEach((b, i) => {
      b.index = i;
      b.id = `g${i}`;
    });
    map.buildings = buildings;
  }
  if (!stable || map.spawnPoints.length < 4) return null;
  // Each building's site is cut into the slope it stands on.
  map.terrain = cutBuildingPads(map.terrain!, padOutlines(map.buildings), map.roads);
  if (buildings.length < Math.round(MIN_BUILDINGS * Math.min(1, k * k))) return null;
  for (const type of ESSENTIAL) if (!buildings.some((b) => b.type === type)) return null;
  return map;
}

interface RingInput {
  seed: number;
  size: CitySize;
  width: number;
  height: number;
  toMap: (u: number, v: number) => Vec2;
  outline: (r: Rect, step?: number) => Vec2[];
  shape: Shape;
  bend: number;
  us: number[];
  vs: number[];
  roadW: number[];
  roadH: number[];
  blockW: number[];
  blockH: number[];
  cut: Set<string>;
  bridgeRows: Set<number>;
  riverDist: (x: number, y: number) => number;
  relief: Relief;
  lots: Lot[];
  rowsBridged: boolean;
}

/**
 * The city round the map: the same street grid carried on outward for a ring of blocks,
 * with the same lots and the same buildings, and the map's own lots that fell past its
 * edge. It is drawn as the map is and played not at all. Drawn from its own random
 * stream, so the map inside is exactly the one it was without it.
 */
function ringCity(o: RingInput): NonNullable<CityMap["decor"]> {
  const rng = new Rng(deriveSeed(o.seed, "varied:ring"));
  const ring = RING[o.size];
  const typeFor = (zone: Zone): BuildingType =>
    zone === "industrial"
      ? rng.weighted<BuildingType>({ warehouse: 80, gasStation: 12, office: 8 })
      : rng.weighted<BuildingType>({ house: 62, apartment: 30, shop: 5, pharmacy: 3 });
  const snap = (v: number) => Math.round(v / CELL) * CELL;
  const outer: Rect = { x: -ring, y: -ring, w: o.width + ring * 2, h: o.height + ring * 2 };
  // The plan's half extent that covers the ring once turned.
  const reach = Math.hypot(o.width + ring * 2, o.height + ring * 2) / 2 + 40;

  // Grid lines carried outward: streets of 10 m between blocks of 40 to 72 m.
  const grow = (starts: number[], widths: number[], blocks: number[], lo: number, hi: number) => {
    const s = [...starts];
    const w = [...widths];
    const b = [...blocks];
    let added = 0;
    while (s[0] > lo) {
      const bw = snap(rng.range(40, 72));
      s.unshift(s[0] - bw - 10);
      w.unshift(10);
      b.unshift(bw);
      added++;
    }
    while (s[s.length - 1] + w[w.length - 1] < hi) {
      const bw = snap(rng.range(40, 72));
      b.push(bw);
      s.push(s[s.length - 1] + w[w.length - 1] + bw);
      w.push(10);
    }
    return { s, w, b, added };
  };
  const gu = grow(o.us, o.roadW, o.blockW, -reach, reach);
  const gv = grow(o.vs, o.roadH, o.blockH, -reach, reach);
  const cols = gu.b.length;
  const rows = gv.b.length;
  const isOriginal = (i: number, j: number) =>
    i >= gu.added && i < gu.added + o.blockW.length && j >= gv.added && j < gv.added + o.blockH.length;

  // Streets in the ring only: each grid line clipped to the four strips round the map.
  const strips: Rect[] = [
    { x: -ring, y: -ring, w: ring, h: o.height + ring * 2 },
    { x: o.width, y: -ring, w: ring, h: o.height + ring * 2 },
    { x: 0, y: -ring, w: o.width, h: ring },
    { x: 0, y: o.height, w: o.width, h: ring },
  ];
  const roads: RoadDef[] = [];
  const bridges: BridgeDef[] = [];
  const addRoad = (a: Vec2, b: Vec2, w: number, bridged: boolean) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / (o.bend ? 4 : len)));
    const line: Vec2[] = [];
    for (let s = 0; s <= steps; s++) line.push(o.toMap(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps));
    for (const strip of strips)
      for (const piece of clipPolylineToRect(line, strip)) {
        let run: Vec2[] = [];
        const wet: Vec2[] = [];
        const flush = () => {
          if (run.length > 1 && polylineLength(run) >= 6) {
            const path = simplifyLine(run);
            roads.push({ id: `ring${roads.length}`, rect: lineBounds(path, w), horizontal: isHorizontal(path), path, width: w });
          }
          run = [];
        };
        for (const p of densify(piece, 2)) {
          const d = o.riverDist(p.x, p.y);
          if (bridged && d < 1) wet.push(p);
          if (bridged || d > 3) run.push(p);
          else flush();
        }
        flush();
        if (wet.length > 1) bridges.push({ id: `ringBridge${bridges.length}`, polygon: deck(wet, w) });
      }
  };
  for (let j = 0; j <= rows; j++) {
    const v = gv.s[j] + gv.w[j] / 2;
    const original = j - gv.added;
    const bridged = o.rowsBridged && (o.bridgeRows.has(original) || (original < 0 || original > o.blockH.length ? rng.chance(0.5) : false));
    addRoad({ x: -reach, y: v }, { x: reach, y: v }, gv.w[j], bridged);
  }
  for (let i = 0; i <= cols; i++) {
    const u = gu.s[i] + gu.w[i] / 2;
    let from = -reach;
    for (let j = 0; j < rows; j++) {
      if (!o.cut.has(`${i - gu.added}:${j - gv.added}`)) continue;
      addRoad({ x: u, y: from }, { x: u, y: gv.s[j] + gv.w[j] / 2 }, gu.w[i], false);
      from = gv.s[j + 1] + gv.w[j + 1] / 2;
    }
    addRoad({ x: u, y: from }, { x: u, y: reach }, gu.w[i], false);
  }

  // Lots that lie wholly in the ring, clear of the water, on ground that does not climb.
  const inRing = (r: Rect, gap: number) => {
    let low = Infinity;
    let high = -Infinity;
    for (let u = r.x; u <= r.x + r.w + 1e-6; u += Math.max(2, r.w / Math.ceil(r.w / 4)))
      for (let v = r.y; v <= r.y + r.h + 1e-6; v += Math.max(2, r.h / Math.ceil(r.h / 4))) {
        const p = o.toMap(u, v);
        if (p.x < outer.x || p.y < outer.y || p.x > outer.x + outer.w || p.y > outer.y + outer.h) return false;
        if (p.x > -3 && p.y > -3 && p.x < o.width + 3 && p.y < o.height + 3) return false;
        if (o.riverDist(p.x, p.y) < gap) return false;
        const h = heightAt(o.relief.def, p.x, p.y);
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
    return high - low < 2.5;
  };
  const lots: Lot[] = o.lots.filter((l) => inRing(l.rect, 4));
  const parks: ParkDef[] = [];
  const MARGIN = 4;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (isOriginal(i, j)) continue;
      const rect = { x: gu.s[i] + gu.w[i], y: gv.s[j] + gv.w[j], w: gu.b[i], h: gv.b[j] };
      const zone: Zone = rng.chance(0.12) ? "park" : rng.chance(0.3) ? "industrial" : "residential";
      if (zone === "park") {
        if (!inRing(rect, 2)) continue;
        const polygon = o.outline(rect, o.bend ? 8 : 0);
        const trees: Vec2[] = [];
        const n = Math.round((rect.w * rect.h) / 260);
        for (let t = 0; t < n; t++) trees.push(o.toMap(rect.x + rng.range(4, rect.w - 4), rect.y + rng.range(4, rect.h - 4)));
        parks.push({ id: `ringPark${parks.length}`, rect: polygonBounds(polygon), polygon, trees });
        continue;
      }
      if (zone === "industrial") {
        for (const top of [true, false])
          lots.push({
            type: typeFor("industrial"),
            zone,
            rect: {
              x: rect.x + MARGIN,
              y: top ? rect.y + MARGIN : rect.y + rect.h / 2 + MARGIN,
              w: rect.w - MARGIN * 2,
              h: rect.h / 2 - MARGIN * 2,
            },
            side: top ? -1 : 1,
          });
        continue;
      }
      const n = Math.max(2, Math.round(rect.w / rng.range(18, 24)));
      const lotW = rect.w / n;
      const lotH = rect.h / 2;
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < n; c++) {
          const type = typeFor("residential");
          const big = type === "apartment" || type === "office";
          const fw = lotW - MARGIN * 2;
          const fh = lotH - MARGIN * 2;
          const w = fw * (big ? rng.range(0.8, 1) : rng.range(0.6, 0.95));
          const hh = fh * (big ? rng.range(0.75, 1) : rng.range(0.55, 0.9));
          lots.push({
            type,
            zone,
            rect: {
              x: rect.x + c * lotW + MARGIN + (fw - w) / 2,
              y: r === 0 ? rect.y + MARGIN : rect.y + lotH + MARGIN + (fh - hh),
              w,
              h: hh,
            },
            side: r === 0 ? -1 : 1,
          });
        }
    }

  const buildings: BuildingDef[] = lots
    .filter((l) => inRing(l.rect, 4))
    .map((l, index) => {
      const def = BUILDING_TYPES[l.type];
      const floors = rng.int(def.floors[0], def.floors[1]);
      const footprint = o.outline(l.rect, o.bend ? 10 : 0);
      const mu = l.rect.x + l.rect.w / 2;
      const edge = l.side > 0 ? l.rect.y + l.rect.h : l.rect.y;
      const wall = o.toMap(mu, edge);
      const out = o.toMap(mu, edge + l.side);
      const len = Math.hypot(out.x - wall.x, out.y - wall.y) || 1;
      const facing = { x: (out.x - wall.x) / len, y: (out.y - wall.y) / len };
      return {
        id: `ring${index}`,
        index,
        type: l.type,
        zone: l.zone,
        rect: polygonBounds(footprint),
        ...(o.shape === "square" ? {} : { footprint }),
        area: Math.round(polygonArea(footprint)),
        floors,
        height: floors * 3.2 + 0.6,
        entrance: { x: wall.x + facing.x * 1.5, y: wall.y + facing.y * 1.5 },
        facing,
      };
    });
  return { ring, roads, buildings, parks, bridges };
}

/** A bridge deck over the wet stretch of a street, and a few metres onto each bank. */
function deck(wet: Vec2[], w: number): Vec2[] {
  const p0 = wet[0];
  const p1 = wet[wet.length - 1];
  const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const dx = (p1.x - p0.x) / dl;
  const dy = (p1.y - p0.y) / dl;
  const half = w / 2 + 1.5;
  const a0 = { x: p0.x - dx * 6, y: p0.y - dy * 6 };
  const a1 = { x: p1.x + dx * 6, y: p1.y + dy * 6 };
  return [
    { x: a0.x - dy * half, y: a0.y + dx * half },
    { x: a1.x - dy * half, y: a1.y + dx * half },
    { x: a1.x + dy * half, y: a1.y - dx * half },
    { x: a0.x + dy * half, y: a0.y - dx * half },
  ];
}

function distToSegment(x: number, y: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
}

/** Points along a polyline no further apart than `step`. */
function densify(line: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 1; s <= n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  return out;
}

/** Drops points that lie on the straight line between their neighbours. */
function simplifyLine(line: Vec2[]): Vec2[] {
  const out: Vec2[] = [line[0]];
  for (let i = 1; i < line.length - 1; i++) {
    const a = out[out.length - 1];
    const b = line[i];
    const c = line[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    if (Math.abs(cross) / len > 0.15) out.push(b);
  }
  out.push(line[line.length - 1]);
  return out;
}

function polylineLength(line: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  return s;
}

function lineBounds(line: Vec2[], w: number): Rect {
  const b = polygonBounds(line);
  return { x: b.x - w / 2, y: b.y - w / 2, w: b.w + w, h: b.h + w };
}

function isHorizontal(line: Vec2[]): boolean {
  const a = line[0];
  const b = line[line.length - 1];
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
}

/** Where streets leave the map: the hordes come in there. */
function borderEntries(roads: RoadDef[], width: number, height: number, grid: NavGrid): Vec2[] {
  const out: Vec2[] = [];
  const onBorder = (p: Vec2) => p.x < 0.5 || p.y < 0.5 || p.x > width - 0.5 || p.y > height - 0.5;
  for (const r of roads) {
    const l = r.path!;
    for (const [p, toward] of [
      [l[0], l[1]],
      [l[l.length - 1], l[l.length - 2]],
    ]) {
      if (!onBorder(p)) continue;
      const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
      const q = { x: p.x + ((toward.x - p.x) / d) * 3, y: p.y + ((toward.y - p.y) / d) * 3 };
      const c = grid.cellOf(q.x, q.y);
      if (!isWalkableKind(grid.kind[c])) continue;
      if (out.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 25)) continue;
      out.push(grid.centerOf(c));
    }
  }
  return out;
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
      if (!grid.inBounds(x + dx, y + dy)) continue;
      const n = grid.index(x + dx, y + dy);
      if (seen[n] || !isWalkableKind(grid.kind[n])) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Relief
// ---------------------------------------------------------------------------

interface Relief {
  def: TerrainDef;
  at(x: number, y: number): number;
  /** Signed distance across an escarpment's face, in metres; absent on other sites. */
  scarp?: (x: number, y: number) => number;
  /** On an escarpment: ground too steep to build on (the face, and the sides of its ramps). */
  steep?: (x: number, y: number) => boolean;
}

/** Grade of the ramp a street climbs an escarpment by: steep, but a street. */
const RAMP_GRADE = 0.22;

function smooth(e0: number, e1: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [-1, 1], from a seed. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number) => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const u = x - x0;
    const v = y - y0;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);
    return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
  };
}

/** Three octaves of noise, about `wave` metres across, `amp` metres high. */
function fbm(seed: number, wave: number, amp: number): (x: number, y: number) => number {
  const n = valueNoise(seed);
  return (x, y) => {
    let sum = 0;
    let a = 1;
    let f = 1 / wave;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      sum += n(x * f + o * 17.3, y * f - o * 9.1) * a;
      norm += a;
      a *= 0.5;
      f *= 2;
    }
    return (sum / norm) * amp;
  };
}

/** `k` is the map's size against a medium one: hills and valleys grow with it. */
function makeRelief(
  rng: Rng,
  site: Site,
  width: number,
  height: number,
  riverDist: (x: number, y: number) => number,
  k: number,
  roads: RoadDef[] = [],
  gridAngle = 0,
): Relief {
  const noiseSeed = Math.floor(rng.next() * 2 ** 31);
  let field: (x: number, y: number) => number;
  let scarp: ((x: number, y: number) => number) | undefined;
  let steep: ((x: number, y: number) => boolean) | undefined;
  switch (site) {
    case "hills": {
      // One or two round hills, off the centre, with rolling ground between them. The
      // steepest flank stays under a grade of 0.3: built on, climbed slowly.
      const n = rng.int(1, k > 1.2 ? 3 : 2);
      const hills = Array.from({ length: n }, () => ({
        x: width * rng.range(0.2, 0.8),
        y: height * rng.range(0.2, 0.8),
        h: rng.range(16, 28),
        s: rng.range(70, 105) * Math.sqrt(k),
      }));
      const roll = fbm(noiseSeed, 110, 3);
      field = (x, y) =>
        hills.reduce((sum, k) => sum + k.h * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (2 * k.s * k.s)), 0) + roll(x, y);
      break;
    }
    case "escarpment": {
      // A plateau broken off along a line: a face of grade over 1. Where a street crosses it
      // the face is drawn out into a ramp along the street, so the street climbs at a grade
      // a street has; drawn on the face itself it stood nearly upright (a playtest report).
      // Every street up the escarpment is a way in to hold.
      // Across the street grid at about 45°: a face nearly parallel to a street left that
      // street running down the face for a block or more.
      const angle = gridAngle + Math.PI / 4 + rng.range(-0.17, 0.17) + (rng.chance(0.5) ? 0 : Math.PI / 2);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      const rise = rng.range(13, 17);
      const face = rng.range(10, 14);
      const flip = rng.chance(0.5) ? 1 : -1;
      const roll = fbm(noiseSeed, 120, 2.5);
      const ramp = rise / RAMP_GRADE;
      // Every street's segments, sorted into those that cross the face and those along it.
      const segs = roads.flatMap((r) =>
        r.path!.slice(1).map((b, i) => {
          const a = r.path![i];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          // Within 9° of the face's line a street runs along it; any steeper, it crosses.
          return { a, b, hw: r.width! / 2, across: Math.abs(((b.x - a.x) * nx + (b.y - a.y) * ny) / len) > 0.15 };
        }),
      );
      // The face is moved off any street that runs along it: such a street would hang on it.
      const cx0 = width * rng.range(0.35, 0.65);
      const cy0 = height * rng.range(0.35, 0.65);
      let best = { cost: Infinity, o: 0 };
      for (let o = 0; Math.abs(o) <= 60; o = o > 0 ? -o : -o + 6) {
        let cost = 0;
        for (const sg of segs) {
          if (sg.across) continue;
          for (const p of densify([sg.a, sg.b], 4)) {
            const sd = (p.x - cx0) * nx + (p.y - cy0) * ny - o;
            if (Math.abs(sd) < face / 2 + sg.hw + 4) cost++;
          }
        }
        if (cost < best.cost) best = { cost, o };
        if (cost === 0) break;
      }
      const cx = cx0 + nx * best.o;
      const cy = cy0 + ny * best.o;
      const across = segs.filter((sg) => sg.across);
      const sdOf = (x: number, y: number) => ((x - cx) * nx + (y - cy) * ny) * flip;
      /** How far into a crossing street's corridor a point is: 1 on the street, 0 clear of it. */
      const onRamp = (x: number, y: number, shoulder: number) => {
        let w = 0;
        for (const sg of across) w = Math.max(w, 1 - smooth(sg.hw, sg.hw + shoulder, distToSegment(x, y, sg.a, sg.b)));
        return w;
      };
      scarp = sdOf;
      field = (x, y) => {
        const sd = sdOf(x, y);
        const w = Math.abs(sd) < ramp / 2 + 2 ? onRamp(x, y, 8) : 0;
        const f = face + (ramp - face) * w;
        return rise * smooth(-f / 2, f / 2, sd) + roll(x, y);
      };
      steep = (x, y) => {
        const sd = Math.abs(sdOf(x, y));
        return sd < SCARP_CLEAR || (sd < ramp / 2 + 4 && onRamp(x, y, 14) > 0);
      };
      break;
    }
    case "valley": {
      // A river on a flat floor between slopes that rise away from it on both sides.
      const rise = rng.range(12, 22);
      const reach = rng.range(110, 160) * Math.sqrt(k);
      const roll = fbm(noiseSeed, 100, 3);
      field = (x, y) => {
        const d = riverDist(x, y);
        const up = smooth(8, reach, d);
        // The water is drawn at the lowest point of its course and the floor would sit level
        // with it, which showed the water through every flat block of the valley: the banks
        // stand 1.5 m over it. The floor stays flat; only the slopes roll.
        return 1.5 * smooth(0, 6, d) + rise * up * up + (roll(x, y) + 3) * 0.5 * up;
      };
      break;
    }
    default: {
      const roll = fbm(noiseSeed, 150, rng.range(6, 9));
      const ripple = fbm(noiseSeed + 1, 60, 1.5);
      field = (x, y) => roll(x, y) + ripple(x, y);
    }
  }
  const cols = Math.ceil(width / RELIEF_CELL) + 1;
  const rows = Math.ceil(height / RELIEF_CELL) + 1;
  const raw = new Float64Array(cols * rows);
  let min = Infinity;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = field(c * RELIEF_CELL, r * RELIEF_CELL);
      raw[r * cols + c] = v;
      min = Math.min(min, v);
    }
  const heights = Array.from(raw, (v) => Math.round((v - min) * 10));
  const def: TerrainDef = { cell: RELIEF_CELL, cols, rows, heights, scale: 1, base: 0 };
  return { def, at: (x, y) => field(x, y) - min, scarp, steep };
}
