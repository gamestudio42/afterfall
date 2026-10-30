import { BUILDING_TYPES, type BuildingType, type Zone } from "@afterfall/content";
import { Rng, deriveSeed, type Rect, type Vec2 } from "@afterfall/shared";

export interface BuildingDef {
  id: string;
  index: number;
  type: BuildingType;
  zone: Zone;
  /** Footprint rectangle in meters. */
  rect: Rect;
  floors: number;
  height: number;
  /** A walkable point just outside the door. */
  entrance: Vec2;
  /** Which side the door faces (unit vector). */
  facing: Vec2;
}

export interface RoadDef {
  id: string;
  rect: Rect;
  horizontal: boolean;
}

export interface ParkDef {
  id: string;
  rect: Rect;
  trees: Vec2[];
}

export interface CityMap {
  seed: number;
  name: string;
  width: number;
  height: number;
  cellSize: number;
  blockSize: number;
  roadWidth: number;
  blocksX: number;
  blocksY: number;
  roads: RoadDef[];
  intersections: Vec2[];
  buildings: BuildingDef[];
  parks: ParkDef[];
  /** Road ends at the map border, where hordes enter. */
  spawnPoints: Vec2[];
}

export interface CityOptions {
  seed: number;
  blocksX?: number;
  blocksY?: number;
  blockSize?: number;
  roadWidth?: number;
}

const CITY_PREFIXES = ["Nova", "Porto", "Vila", "São", "Monte", "Campo", "Alto", "Rio"];
const CITY_SUFFIXES = ["Esperança", "Cinzento", "Aurora", "Ferro", "Silêncio", "Verde", "Bruma", "Quieto"];

/**
 * Generates a small grid city: a road lattice with blocks subdivided into
 * lots. Every lot touches a road, so every door is reachable.
 */
export function generateCity(opts: CityOptions): CityMap {
  const seed = opts.seed >>> 0;
  const rng = new Rng(deriveSeed(seed, "city"));
  const blocksX = opts.blocksX ?? 6;
  const blocksY = opts.blocksY ?? 5;
  const blockSize = opts.blockSize ?? 56;
  const roadWidth = opts.roadWidth ?? 12;
  const cellSize = 2;
  const pitch = blockSize + roadWidth;
  const width = blocksX * pitch + roadWidth;
  const height = blocksY * pitch + roadWidth;

  const roads: RoadDef[] = [];
  for (let j = 0; j <= blocksY; j++) {
    roads.push({ id: `rh${j}`, horizontal: true, rect: { x: 0, y: j * pitch, w: width, h: roadWidth } });
  }
  for (let i = 0; i <= blocksX; i++) {
    roads.push({ id: `rv${i}`, horizontal: false, rect: { x: i * pitch, y: 0, w: roadWidth, h: height } });
  }
  const intersections: Vec2[] = [];
  for (let j = 0; j <= blocksY; j++)
    for (let i = 0; i <= blocksX; i++)
      intersections.push({ x: i * pitch + roadWidth / 2, y: j * pitch + roadWidth / 2 });

  const spawnPoints: Vec2[] = [];
  for (let i = 0; i <= blocksX; i++) {
    spawnPoints.push({ x: i * pitch + roadWidth / 2, y: 1 });
    spawnPoints.push({ x: i * pitch + roadWidth / 2, y: height - 1 });
  }
  for (let j = 1; j < blocksY; j++) {
    spawnPoints.push({ x: 1, y: j * pitch + roadWidth / 2 });
    spawnPoints.push({ x: width - 1, y: j * pitch + roadWidth / 2 });
  }

  // Zone assignment: commercial core, residential ring, industry and parks outside.
  type BlockPlan = { i: number; j: number; zone: Zone; special?: BuildingType };
  const blocks: BlockPlan[] = [];
  const cx = (blocksX - 1) / 2;
  const cy = (blocksY - 1) / 2;
  const maxD = Math.hypot(cx, cy) || 1;
  for (let j = 0; j < blocksY; j++) {
    for (let i = 0; i < blocksX; i++) {
      const d = Math.hypot(i - cx, j - cy) / maxD + rng.range(-0.12, 0.12);
      let zone: Zone;
      if (d < 0.3) zone = "commercial";
      else if (d < 0.78) zone = "residential";
      else zone = rng.chance(0.6) ? "industrial" : "residential";
      blocks.push({ i, j, zone });
    }
  }
  const shuffled = rng.shuffle([...blocks]);
  const take = (pred: (b: BlockPlan) => boolean) => {
    const b = shuffled.find((x) => !x.special && x.zone !== "park" && pred(x)) ?? shuffled.find((x) => !x.special && x.zone !== "park");
    return b!;
  };
  const centerDist = (b: BlockPlan) => Math.hypot(b.i - cx, b.j - cy) / maxD;
  const specials: [BuildingType, (b: BlockPlan) => boolean, Zone][] = [
    ["hospital", (b) => centerDist(b) < 0.6, "civic"],
    ["police", (b) => centerDist(b) < 0.7, "civic"],
    ["school", (b) => b.zone === "residential", "civic"],
    ["supermarket", (b) => b.zone === "residential", "commercial"],
    ["supermarket", (b) => centerDist(b) > 0.4, "commercial"],
  ];
  for (const [type, pred, zone] of specials) {
    const b = take(pred);
    b.special = type;
    b.zone = zone;
  }
  let parks = 0;
  for (const b of shuffled) {
    if (parks >= 3) break;
    if (!b.special && b.zone === "residential" && rng.chance(0.5)) {
      b.zone = "park";
      parks++;
    }
  }

  const buildings: BuildingDef[] = [];
  const parkDefs: ParkDef[] = [];
  const addBuilding = (type: BuildingType, zone: Zone, rect: Rect, facing: Vec2) => {
    const def = BUILDING_TYPES[type];
    const floors = rng.int(def.floors[0], def.floors[1]);
    // Snap the footprint to whole nav cells so the grid matches the geometry.
    const snap = (v: number) => Math.round(v / cellSize) * cellSize;
    const r = { x: snap(rect.x), y: snap(rect.y), w: Math.max(cellSize * 3, snap(rect.w)), h: Math.max(cellSize * 3, snap(rect.h)) };
    const entrance = {
      x: facing.x === 0 ? r.x + Math.floor(r.w / 2 / cellSize) * cellSize + cellSize / 2 : facing.x > 0 ? r.x + r.w + cellSize / 2 : r.x - cellSize / 2,
      y: facing.y === 0 ? r.y + Math.floor(r.h / 2 / cellSize) * cellSize + cellSize / 2 : facing.y > 0 ? r.y + r.h + cellSize / 2 : r.y - cellSize / 2,
    };
    const index = buildings.length;
    buildings.push({ id: `b${index}`, index, type, zone, rect: r, floors, height: floors * 3.2 + 0.6, entrance, facing });
  };

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

  for (const b of blocks) {
    const bx = roadWidth + b.i * pitch;
    const by = roadWidth + b.j * pitch;
    const margin = 4;
    if (b.zone === "park") {
      const rect = { x: bx, y: by, w: blockSize, h: blockSize };
      const trees: Vec2[] = [];
      const n = rng.int(10, 18);
      for (let t = 0; t < n; t++) trees.push({ x: bx + rng.range(4, blockSize - 4), y: by + rng.range(4, blockSize - 4) });
      parkDefs.push({ id: `p${parkDefs.length}`, rect, trees });
      continue;
    }
    if (b.special) {
      const inset = b.special === "supermarket" ? 8 : 6;
      addBuilding(b.special, b.zone, { x: bx + inset, y: by + inset, w: blockSize - inset * 2, h: blockSize - inset * 2 - (b.special === "school" ? 10 : 0) }, { x: 0, y: 1 });
      continue;
    }
    if (b.zone === "industrial") {
      const half = blockSize / 2;
      addBuilding(typeForZone("industrial"), b.zone, { x: bx + margin, y: by + margin, w: blockSize - margin * 2, h: half - margin * 2 }, { x: 0, y: -1 });
      addBuilding(typeForZone("industrial"), b.zone, { x: bx + margin, y: by + half + margin, w: blockSize - margin * 2, h: half - margin * 2 }, { x: 0, y: 1 });
      continue;
    }
    const cols = b.zone === "residential" ? rng.pick([2, 3, 3]) : rng.pick([2, 3]);
    const rows = 2;
    const lotW = blockSize / cols;
    const lotH = blockSize / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = typeForZone(b.zone);
        const big = type === "apartment" || type === "office";
        const fw = lotW - margin * 2;
        const fh = lotH - margin * 2;
        const w = fw * (big ? rng.range(0.8, 1) : rng.range(0.6, 0.95));
        const h = fh * (big ? rng.range(0.75, 1) : rng.range(0.55, 0.9));
        const lx = bx + c * lotW + margin + (fw - w) / 2;
        // Buildings hug the street they face.
        const ly = r === 0 ? by + margin : by + lotH + margin + (fh - h);
        addBuilding(type, b.zone, { x: lx, y: ly, w, h }, { x: 0, y: r === 0 ? -1 : 1 });
      }
    }
  }

  const name = `${rng.pick(CITY_PREFIXES)} ${rng.pick(CITY_SUFFIXES)}`;
  return {
    seed, name, width, height, cellSize, blockSize, roadWidth, blocksX, blocksY,
    roads, intersections, buildings, parks: parkDefs, spawnPoints,
  };
}
