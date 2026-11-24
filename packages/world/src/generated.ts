import { BUILDING_TYPES, type BuildingType, type Zone } from "@afterfall/content";
import { Rng, deriveSeed, distToPolyline, type Rect, type Vec2 } from "@afterfall/shared";
import type { BridgeDef, BuildingDef, CityMap, ParkDef, RoadDef, WaterDef } from "./city";
import { CellKind, NavGrid, isWalkableKind } from "./navgrid";
import type { TerrainDef } from "./terrain";

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
 * The sizes a player can ask for: about how many metres the map runs across. The biggest
 * real place loads at 600 m; 800 m is a generated city's own, about 3.5 times the area of
 * the 420 by 352 m classic grid.
 */
export const CITY_SIZES = { small: 350, medium: 450, large: 600, huge: 800 } as const;
export type CitySize = keyof typeof CITY_SIZES;
/** Fewest buildings a medium map may have (scaled by area for the others), and the kinds it must have. */
const MIN_BUILDINGS = 40;
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
  rect: Rect;
  facing: Vec2;
}

function attemptCity(seed: number, attempt: number, opts: VariedOptions): CityMap | null {
  const rng = new Rng(deriveSeed(seed, `varied:${attempt}`));
  const site: Site = opts.site ?? rng.weighted<Site>({ hills: 30, valley: 30, escarpment: 20, rolling: 20 });
  const layout: Layout = site === "valley" ? "river" : "grid";

  // Blocks of uneven sizes between streets of two widths, an avenue every few blocks. The
  // map is a little wider than it is tall and never larger than the size asked for: the
  // blocks are drawn at random, then scaled together to fill it.
  const size = CITY_SIZES[opts.size ?? "medium"];
  const k = size / CITY_SIZES.medium;
  const snap = (v: number) => Math.round(v / CELL) * CELL;
  const wantW = size * rng.range(0.88, 1);
  const wantH = size * rng.range(0.72, 0.95);
  const cols = Math.max(4, Math.round(wantW / 67));
  const rows = Math.max(4, Math.round(wantH / 64));
  const roadW = Array.from({ length: cols + 1 }, () => 10);
  const roadH = Array.from({ length: rows + 1 }, () => 10);
  for (let a = 0; a < Math.max(1, Math.round(cols / 6)); a++) roadW[rng.int(1, cols - 1)] = 16;
  for (let a = 0; a < Math.max(1, Math.round(rows / 6)); a++) roadH[rng.int(1, rows - 1)] = 16;
  const fill = (n: number, lo: number, hi: number, total: number) => {
    const raw = Array.from({ length: n }, () => rng.range(lo, hi));
    const sum = raw.reduce((x, y) => x + y, 0);
    return raw.map((v) => Math.max(36, Math.min(80, snap((v * total) / sum))));
  };
  const blockW = fill(cols, 40, 72, wantW - roadW.reduce((x, y) => x + y, 0));
  const blockH = fill(rows, 40, 66, wantH - roadH.reduce((x, y) => x + y, 0));
  const xs: number[] = [];
  const ys: number[] = [];
  let x = 0;
  for (let i = 0; i <= cols; i++) {
    xs.push(x);
    x += roadW[i] + (i < cols ? blockW[i] : 0);
  }
  let y = 0;
  for (let j = 0; j <= rows; j++) {
    ys.push(y);
    y += roadH[j] + (j < rows ? blockH[j] : 0);
  }
  const width = x;
  const height = y;
  const vx = (i: number) => xs[i] + roadW[i] / 2;
  const hy = (j: number) => ys[j] + roadH[j] / 2;

  // A river across the valley, wandering north to south.
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
  }
  const riverDist = (px: number, py: number) => (river ? distToPolyline(px, py, river) - riverW / 2 : Infinity);

  // Superblocks: a few interior cross streets between two blocks are left out.
  const cut = new Set<string>();
  if (layout === "grid") {
    const n = rng.int(1, Math.max(3, Math.round((cols * rows) / 10)));
    for (let c = 0; c < n; c++) cut.add(`${rng.int(1, cols - 1)}:${rng.int(0, rows - 1)}`);
  }

  // The relief.
  const relief = makeRelief(rng, site, width, height, riverDist, k);
  // On an escarpment, the band too steep to build on.
  const scarp = relief.scarp;

  // Streets as centre lines. A street is cut at the river's banks, except on the rows
  // that bridge it.
  const roads: RoadDef[] = [];
  const bridges: BridgeDef[] = [];
  const bridgeRows = new Set<number>();
  if (river) {
    const interior = rng.shuffle(Array.from({ length: rows + 1 }, (_, j) => j).filter((j) => j > 0 && j < rows));
    const n = Math.min(interior.length, rng.int(1, Math.max(3, Math.round(rows / 3))));
    for (let b = 0; b < n; b++) bridgeRows.add(interior[b]);
  }
  const bank = 3;
  const addRoad = (id: string, a: Vec2, b: Vec2, w: number, bridged: boolean) => {
    // Sample along the street and keep the runs that stay out of the water.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    let start = -1;
    const runs: [number, number][] = [];
    let wet: [number, number] | null = null;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const d = riverDist(px, py);
      const dry = bridged || d > bank;
      if (bridged && d < 1) wet = wet ? [wet[0], t] : [t, t];
      if (dry && start < 0) start = s;
      if ((!dry || s === steps) && start >= 0) {
        const end = dry ? s : s - 1;
        runs.push([start / steps, end / steps]);
        start = -1;
      }
    }
    runs.forEach(([t0, t1], k) => {
      if ((t1 - t0) * len < 12) return;
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      roads.push({
        id: `${id}_${k}`,
        rect: {
          x: Math.min(p0.x, p1.x) - w / 2,
          y: Math.min(p0.y, p1.y) - w / 2,
          w: Math.abs(p1.x - p0.x) + w,
          h: Math.abs(p1.y - p0.y) + w,
        },
        horizontal: Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y),
        path: [p0, p1],
        width: w,
      });
    });
    if (wet) {
      // The deck: the stretch over water and a few metres onto each bank.
      const t0 = Math.max(0, wet[0] - 6 / len);
      const t1 = Math.min(1, wet[1] + 6 / len);
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      const half = w / 2 + 1.5;
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);
      const horizontal = x1 - x0 >= y1 - y0;
      const r = horizontal ? { x0, x1, y0: y0 - half, y1: y1 + half } : { x0: x0 - half, x1: x1 + half, y0, y1 };
      bridges.push({
        id: `bridge${bridges.length}`,
        polygon: [
          { x: r.x0, y: r.y0 },
          { x: r.x1, y: r.y0 },
          { x: r.x1, y: r.y1 },
          { x: r.x0, y: r.y1 },
        ],
      });
    }
  };
  for (let j = 0; j <= rows; j++) addRoad(`h${j}`, { x: 0, y: hy(j) }, { x: width, y: hy(j) }, roadH[j], bridgeRows.has(j));
  for (let i = 0; i <= cols; i++) {
    // A vertical street runs from row to row, leaving out the stretches cut for superblocks.
    let from = 0;
    for (let j = 0; j < rows; j++) {
      if (!cut.has(`${i}:${j}`)) continue;
      addRoad(`v${i}_${j}`, { x: vx(i), y: from }, { x: vx(i), y: hy(j) }, roadW[i], false);
      from = hy(j + 1);
    }
    addRoad(`v${i}_end`, { x: vx(i), y: from }, { x: vx(i), y: height }, roadW[i], false);
  }

  // Blocks: a superblock joins the blocks either side of a cut street.
  interface Block {
    rect: Rect;
    ci: number;
    cj: number;
    zone: Zone;
    special?: BuildingType;
  }
  const blocks: Block[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (i > 0 && cut.has(`${i}:${j}`)) continue;
      let i1 = i;
      while (i1 + 1 < cols && cut.has(`${i1 + 1}:${j}`)) i1++;
      const x0 = xs[i] + roadW[i];
      const x1 = xs[i1 + 1];
      blocks.push({ rect: { x: x0, y: ys[j] + roadH[j], w: x1 - x0, h: blockH[j] }, ci: (i + i1) / 2, cj: j, zone: "residential" });
    }
  const blockClear = (r: Rect, margin: number) => {
    for (let px = r.x; px <= r.x + r.w; px += 4)
      for (const py of [r.y, r.y + r.h / 2, r.y + r.h]) if (riverDist(px, py) < margin) return false;
    for (let py = r.y; py <= r.y + r.h; py += 4) for (const px of [r.x, r.x + r.w]) if (riverDist(px, py) < margin) return false;
    // The escarpment's face is half its width either side of the line; keep 3 m off it.
    if (scarp) for (const [px, py] of corners(r)) if (Math.abs(scarp(px, py)) < SCARP_CLEAR) return false;
    return true;
  };

  // Zones: a commercial core, a residential ring, industry and parks outside.
  const ccx = (cols - 1) / 2;
  const ccy = (rows - 1) / 2;
  const maxD = Math.hypot(ccx, ccy) || 1;
  const centre = (b: Block) => Math.hypot(b.ci - ccx, b.cj - ccy) / maxD;
  for (const b of blocks) {
    const d = centre(b) + rng.range(-0.12, 0.12);
    b.zone = d < 0.3 ? "commercial" : d < 0.78 ? "residential" : rng.chance(0.6) ? "industrial" : "residential";
  }
  const usable = rng.shuffle(blocks.filter((b) => blockClear(b.rect, 6)));
  const take = (pred: (b: Block) => boolean) =>
    usable.find((b) => !b.special && b.zone !== "park" && pred(b)) ?? usable.find((b) => !b.special && b.zone !== "park");
  const specials: [BuildingType, (b: Block) => boolean, Zone][] = [
    ["hospital", (b) => centre(b) < 0.6, "civic"],
    ["police", (b) => centre(b) < 0.7, "civic"],
    ["school", (b) => b.zone === "residential", "civic"],
    ["supermarket", (b) => b.zone === "residential", "commercial"],
    ["supermarket", (b) => centre(b) > 0.4, "commercial"],
  ];
  for (const [type, pred, zone] of specials) {
    const b = take(pred);
    if (!b) return null;
    b.special = type;
    b.zone = zone;
  }
  let parkCount = 0;
  for (const b of usable) {
    if (parkCount >= 3) break;
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
  const margin = 4;
  for (const b of blocks) {
    const { x: bx, y: by, w: bw, h: bh } = b.rect;
    if (b.zone === "park") {
      const trees: Vec2[] = [];
      const n = Math.round((bw * bh) / 260);
      for (let t = 0; t < n; t++) trees.push({ x: bx + rng.range(4, bw - 4), y: by + rng.range(4, bh - 4) });
      parks.push({ id: `p${parks.length}`, rect: { ...b.rect }, polygon: corners(b.rect).map(([px, py]) => ({ x: px, y: py })), trees });
      continue;
    }
    if (b.special) {
      const inset = b.special === "supermarket" ? 8 : 6;
      lots.push({
        type: b.special,
        zone: b.zone,
        rect: { x: bx + inset, y: by + inset, w: Math.min(bw - inset * 2, 60), h: bh - inset * 2 - (b.special === "school" ? 10 : 0) },
        facing: { x: 0, y: 1 },
      });
      continue;
    }
    if (b.zone === "industrial") {
      const n = Math.max(1, Math.round(bw / 56));
      const w = bw / n;
      for (let k = 0; k < n; k++)
        for (const top of [true, false])
          lots.push({
            type: typeForZone("industrial"),
            zone: b.zone,
            rect: { x: bx + k * w + margin, y: top ? by + margin : by + bh / 2 + margin, w: w - margin * 2, h: bh / 2 - margin * 2 },
            facing: { x: 0, y: top ? -1 : 1 },
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
        const fw = lotW - margin * 2;
        const fh = lotH - margin * 2;
        const w = fw * (big ? rng.range(0.8, 1) : rng.range(0.6, 0.95));
        const hh = fh * (big ? rng.range(0.75, 1) : rng.range(0.55, 0.9));
        const lx = bx + c * lotW + margin + (fw - w) / 2;
        const ly = r === 0 ? by + margin : by + lotH + margin + (fh - hh);
        lots.push({ type, zone: b.zone, rect: { x: lx, y: ly, w, h: hh }, facing: { x: 0, y: r === 0 ? -1 : 1 } });
      }
  }

  // Lots in the water, on the bank or on the face of the escarpment are left empty.
  const sited = lots.filter((l) => blockClear(l.rect, 4));

  const water: WaterDef[] = river ? [{ id: "river", path: river, width: riverW }] : [];
  const terrain = relief.def;
  const intersections: Vec2[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) intersections.push({ x: vx(i), y: hy(j) });

  const toBuilding = (l: Lot, index: number): BuildingDef => {
    const def = BUILDING_TYPES[l.type];
    const floors = rng.int(def.floors[0], def.floors[1]);
    const r = { x: snap(l.rect.x), y: snap(l.rect.y), w: Math.max(CELL * 3, snap(l.rect.w)), h: Math.max(CELL * 3, snap(l.rect.h)) };
    const entrance = {
      x: r.x + Math.floor(r.w / 2 / CELL) * CELL + CELL / 2,
      y: l.facing.y > 0 ? r.y + r.h + CELL / 2 : r.y - CELL / 2,
    };
    return {
      id: `g${index}`,
      index,
      type: l.type,
      zone: l.zone,
      rect: r,
      area: r.w * r.h,
      floors,
      height: floors * 3.2 + 0.6,
      entrance,
      facing: l.facing,
    };
  };
  let buildings = sited.map(toBuilding);

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
    parks: parks.filter((p) => blockClear(p.rect, 2)),
    ...(water.length ? { waters: water } : {}),
    ...(bridges.length ? { bridges } : {}),
    terrain,
    spawnPoints: [],
    generated: { site, layout },
  };

  // Doors that open onto a street someone can reach from the edge of the map.
  const grid = NavGrid.fromCity(map);
  map.spawnPoints = borderEntries(roads, width, height, grid);
  if (map.spawnPoints.length < 4) return null;
  const reach = reachable(grid, map.spawnPoints);
  buildings = buildings.filter((b) => {
    const c = grid.cellOf(b.entrance.x, b.entrance.y);
    return grid.kind[c] === CellKind.Free && reach[c];
  });
  buildings.forEach((b, i) => {
    b.index = i;
    b.id = `g${i}`;
  });
  map.buildings = buildings;
  if (buildings.length < Math.round(MIN_BUILDINGS * Math.min(1, k * k))) return null;
  for (const type of ESSENTIAL) if (!buildings.some((b) => b.type === type)) return null;
  return map;
}

function corners(r: Rect): [number, number][] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
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
}

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
function makeRelief(rng: Rng, site: Site, width: number, height: number, riverDist: (x: number, y: number) => number, k: number): Relief {
  const noiseSeed = Math.floor(rng.next() * 2 ** 31);
  let field: (x: number, y: number) => number;
  let scarp: ((x: number, y: number) => number) | undefined;
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
      // A plateau broken off along a line: a face of grade over 1 that only the streets
      // climb, so every street up it is a way in to hold.
      const angle = rng.range(-0.5, 0.5) + (rng.chance(0.5) ? 0 : Math.PI / 2);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      const cx = width * rng.range(0.35, 0.65);
      const cy = height * rng.range(0.35, 0.65);
      const rise = rng.range(13, 17);
      const face = rng.range(10, 14);
      const flip = rng.chance(0.5) ? 1 : -1;
      const roll = fbm(noiseSeed, 120, 2.5);
      scarp = (x, y) => ((x - cx) * nx + (y - cy) * ny) * flip;
      field = (x, y) => rise * smooth(-face / 2, face / 2, scarp!(x, y)) + roll(x, y);
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
  return { def, at: (x, y) => field(x, y) - min, scarp };
}
