import { pointInPolygon, polygonBounds, polygonCentroid, type Vec2 } from "@afterfall/shared";
import type { CityMap, RailDef, RoadDef, WaterDef } from "./city";
import { MinHeap } from "./heap";
import { abandonedVehicles, vehicleContains } from "./vehicles";

export const enum CellKind {
  Free = 0,
  Building = 1,
  /** Solid player structure: blocks everyone. */
  Solid = 2,
  /** Gate: survivors pass, infected must break it. */
  Gate = 3,
  /** Non-solid structure such as a farm: passable. */
  Soft = 4,
  /** Open water: nobody crosses it, and nothing is built on it. */
  Water = 5,
  /** A railway track: walkable, but not a place to build. */
  Rail = 6,
}

/** Whether an agent can stand on a cell of this kind, gates aside. */
export function isWalkableKind(k: number): boolean {
  return k === CellKind.Free || k === CellKind.Soft || k === CellKind.Rail;
}

export type Agent = "survivor" | "infected";

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export interface PathResult {
  points: Vec2[];
  expanded: number;
}

/**
 * Uniform navigation grid used for local and long-range pathfinding.
 * Buildings and abandoned vehicles are stamped in once; structures are
 * added/removed at runtime.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly kind: Uint8Array;
  readonly buildingAt: Int32Array;
  readonly structureAt: Int32Array;
  /** Incremented whenever passability changes; consumers cache by it. */
  version = 0;

  private gScore: Float64Array;
  private cameFrom: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private search = 0;
  private heap: MinHeap;
  /**
   * Connected components of the passable cells, one array per agent, rebuilt lazily when
   * the grid version changes. A* on a sealed map used to expand the whole 35k-cell grid
   * for every unit that asked for an unreachable cell — 93% of the frame in `findPath`,
   * measured at 22 survivors. Comparing components first answers the same question in
   * constant time.
   */
  private compSurvivor: Int32Array | null = null;
  private compInfected: Int32Array | null = null;
  private compVersion = -1;

  constructor(width: number, height: number, cell: number) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    const n = this.cols * this.rows;
    this.kind = new Uint8Array(n);
    this.buildingAt = new Int32Array(n).fill(-1);
    this.structureAt = new Int32Array(n).fill(-1);
    this.gScore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new MinHeap(4096);
  }

  static fromCity(city: CityMap): NavGrid {
    const g = new NavGrid(city.width, city.height, city.cellSize);
    for (const b of city.buildings) {
      if (b.footprint) {
        g.stampPolygon(b.footprint, b.index, b.holes);
        continue;
      }
      const x0 = Math.floor(b.rect.x / g.cell);
      const y0 = Math.floor(b.rect.y / g.cell);
      const x1 = Math.ceil((b.rect.x + b.rect.w) / g.cell);
      const y1 = Math.ceil((b.rect.y + b.rect.h) / g.cell);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          if (!g.inBounds(x, y)) continue;
          const i = g.index(x, y);
          g.kind[i] = CellKind.Building;
          g.buildingAt[i] = b.index;
        }
    }
    stampTerrain(g, city);
    for (const car of abandonedVehicles(city)) {
      for (let y = Math.floor((car.z - 4) / g.cell); y <= Math.ceil((car.z + 4) / g.cell); y++) {
        for (let x = Math.floor((car.x - 4) / g.cell); x <= Math.ceil((car.x + 4) / g.cell); x++) {
          if (!g.inBounds(x, y)) continue;
          const p = g.centerOf(g.index(x, y));
          if (vehicleContains(car, p.x, p.y, (g.cell * Math.SQRT2) / 2) && g.kind[g.index(x, y)] === CellKind.Free)
            g.kind[g.index(x, y)] = CellKind.Solid;
        }
      }
    }
    g.version++;
    return g;
  }

  /** Marks the cells whose centers fall inside a building outline (at least one cell). */
  stampPolygon(poly: Vec2[], building: number, holes: Vec2[][] = []): number {
    const r = polygonBounds(poly);
    const x0 = Math.max(0, Math.floor(r.x / this.cell));
    const y0 = Math.max(0, Math.floor(r.y / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w) / this.cell));
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h) / this.cell));
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cx = (x + 0.5) * this.cell;
        const cy = (y + 0.5) * this.cell;
        if (!pointInPolygon(cx, cy, poly)) continue;
        // A courtyard is inside the outline and not a building: a survivor can cross it.
        if (holes.some((h) => pointInPolygon(cx, cy, h))) continue;
        const i = this.index(x, y);
        this.kind[i] = CellKind.Building;
        this.buildingAt[i] = building;
        n++;
      }
    if (n === 0) {
      const c = polygonCentroid(poly);
      const i = this.cellOf(c.x, c.y);
      this.kind[i] = CellKind.Building;
      this.buildingAt[i] = building;
      n = 1;
    }
    return n;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  index(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return cy * this.cols + cx;
  }

  centerOf(i: number): Vec2 {
    return { x: ((i % this.cols) + 0.5) * this.cell, y: (Math.floor(i / this.cols) + 0.5) * this.cell };
  }

  /** Component id of a cell for an agent, or -1 when the cell is not passable for it. */
  componentOf(i: number, agent: Agent): number {
    this.rebuildComponents();
    const comp = agent === "survivor" ? this.compSurvivor : this.compInfected;
    return comp ? comp[i] : -1;
  }

  private rebuildComponents(): void {
    if (this.compVersion === this.version && this.compSurvivor && this.compInfected) return;
    const n = this.cols * this.rows;
    if (!this.compSurvivor) this.compSurvivor = new Int32Array(n);
    if (!this.compInfected) this.compInfected = new Int32Array(n);
    const stack = new Int32Array(n);
    for (const [agent, out] of [
      ["survivor", this.compSurvivor],
      ["infected", this.compInfected],
    ] as const) {
      out.fill(-1);
      let next = 0;
      for (let seed = 0; seed < n; seed++) {
        if (out[seed] !== -1 || !this.passableIndex(seed, agent)) continue;
        const id = next++;
        out[seed] = id;
        let top = 0;
        stack[top++] = seed;
        while (top > 0) {
          const cur = stack[--top];
          const cx = cur % this.cols;
          const cy = (cur - cx) / this.cols;
          for (let d = 0; d < 8; d++) {
            const nx = cx + DX[d];
            const ny = cy + DY[d];
            if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
            const ni = ny * this.cols + nx;
            if (out[ni] !== -1 || !this.passableIndex(ni, agent)) continue;
            // Diagonals may not cut a corner, same rule the search uses.
            if (d >= 4 && (!this.passableIndex(cy * this.cols + nx, agent) || !this.passableIndex(ny * this.cols + cx, agent))) continue;
            out[ni] = id;
            stack[top++] = ni;
          }
        }
      }
    }
    this.compVersion = this.version;
  }

  passableIndex(i: number, agent: Agent): boolean {
    const k = this.kind[i];
    if (isWalkableKind(k)) return true;
    return agent === "survivor" && k === CellKind.Gate;
  }

  passable(x: number, y: number, agent: Agent): boolean {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (!this.inBounds(cx, cy)) return false;
    return this.passableIndex(this.index(cx, cy), agent);
  }

  setStructure(cells: number[], kind: CellKind, structureId: number): void {
    for (const i of cells) {
      this.kind[i] = kind;
      this.structureAt[i] = kind === CellKind.Free ? -1 : structureId;
    }
    this.version++;
  }

  /** Reserves cells for an unbuilt structure without changing passability. */
  reserveStructure(cells: number[], structureId: number): void {
    for (const i of cells) this.structureAt[i] = structureId;
  }

  /** Clears a reservation only when the cell still belongs to that structure. */
  releaseStructure(cells: number[], structureId: number): void {
    for (const i of cells) if (this.structureAt[i] === structureId) this.structureAt[i] = -1;
  }

  /** Cells covered by a square footprint whose top-left cell is (cx, cy). */
  footprint(cx: number, cy: number, size: number): number[] {
    const out: number[] = [];
    for (let y = cy; y < cy + size; y++) for (let x = cx; x < cx + size; x++) if (this.inBounds(x, y)) out.push(this.index(x, y));
    return out;
  }

  /** Breadth-first search for the closest passable cell center. */
  nearestPassable(x: number, y: number, agent: Agent, maxRadius = 30): Vec2 | null {
    const start = this.cellOf(x, y);
    if (this.passableIndex(start, agent)) return this.centerOf(start);
    const sx = start % this.cols;
    const sy = Math.floor(start / this.cols);
    for (let r = 1; r <= maxRadius; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = sx + dx;
          const cy = sy + dy;
          if (!this.inBounds(cx, cy)) continue;
          const i = this.index(cx, cy);
          if (!this.passableIndex(i, agent)) continue;
          const c = this.centerOf(i);
          const d = (c.x - x) ** 2 + (c.y - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return this.centerOf(best);
    }
    return null;
  }

  /** Line of sight: only buildings block vision; walls can be shot over. */
  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const i = this.cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (this.kind[i] === CellKind.Building) return false;
    }
    return true;
  }

  /** Whether an agent can walk in a straight line (with clearance) between two points. */
  walkable(ax: number, ay: number, bx: number, by: number, agent: Agent, radius = 0.45): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 1e-6) return this.passable(ax, ay, agent);
    const nx = -(by - ay) / d;
    const ny = (bx - ax) / d;
    const steps = Math.ceil(d / (this.cell * 0.4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (!this.passable(px, py, agent)) return false;
      if (!this.passable(px + nx * radius, py + ny * radius, agent)) return false;
      if (!this.passable(px - nx * radius, py - ny * radius, agent)) return false;
    }
    return true;
  }

  /**
   * A* over the 8-connected grid without corner cutting.
   * Returns a smoothed list of waypoints (excluding the start) or null.
   */
  findPath(sx: number, sy: number, tx: number, ty: number, agent: Agent, maxExpanded = 60000): PathResult | null {
    let start = this.cellOf(sx, sy);
    if (!this.passableIndex(start, agent)) {
      const n = this.nearestPassable(sx, sy, agent, 3);
      if (!n) return null;
      start = this.cellOf(n.x, n.y);
    }
    let goal = this.cellOf(tx, ty);
    if (!this.passableIndex(goal, agent)) {
      const n = this.nearestPassable(tx, ty, agent);
      if (!n) return null;
      goal = this.cellOf(n.x, n.y);
    }
    if (start === goal) return { points: [{ x: tx, y: ty }], expanded: 0 };
    // Nothing to search for: the two cells are not even in the same region.
    const comp = this.componentOf(start, agent);
    if (comp < 0 || comp !== this.componentOf(goal, agent)) return null;

    const cols = this.cols;
    const gx = goal % cols;
    const gy = Math.floor(goal / cols);
    const search = ++this.search;
    const heap = this.heap;
    heap.clear();
    this.stamp[start] = search;
    this.gScore[start] = 0;
    this.cameFrom[start] = -1;
    heap.push(start, 0);
    let expanded = 0;
    let found = false;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === search) continue;
      this.closed[cur] = search;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpanded) break;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      const g = this.gScore[cur];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= this.rows) continue;
        const ni = ny * cols + nx;
        if (!this.passableIndex(ni, agent)) continue;
        if (d >= 4 && (!this.passableIndex(cy * cols + nx, agent) || !this.passableIndex(ny * cols + cx, agent))) continue;
        if (this.closed[ni] === search) continue;
        const ng = g + DC[d];
        if (this.stamp[ni] === search && this.gScore[ni] <= ng) continue;
        this.stamp[ni] = search;
        this.gScore[ni] = ng;
        this.cameFrom[ni] = cur;
        const hx = Math.abs(nx - gx);
        const hy = Math.abs(ny - gy);
        const h = Math.max(hx, hy) + (Math.SQRT2 - 1) * Math.min(hx, hy);
        heap.push(ni, ng + h * 1.001);
      }
    }
    if (!found) return null;

    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.cameFrom[c]) cells.push(c);
    cells.reverse();
    const raw = cells.map((c) => this.centerOf(c));
    const end = this.passable(tx, ty, agent) ? { x: tx, y: ty } : raw[raw.length - 1];
    raw[raw.length - 1] = end;
    // String pulling: skip waypoints that can be reached in a straight line.
    const points: Vec2[] = [];
    let anchor: Vec2 = { x: sx, y: sy };
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.walkable(anchor.x, anchor.y, raw[j].x, raw[j].y, agent)) j--;
      points.push(raw[j]);
      anchor = raw[j];
      i = j;
    }
    if (points.length === 0) points.push(end);
    return { points, expanded };
  }

  /**
   * Dijkstra distance field from goal cells. `cost(i)` returns the cost of
   * entering cell i, or Infinity if impassable.
   */
  distanceField(goals: number[], cost: (i: number) => number, out?: Float32Array): Float32Array {
    const n = this.cols * this.rows;
    const dist = out ?? new Float32Array(n);
    dist.fill(Infinity);
    const heap = new MinHeap(8192);
    for (const g of goals) {
      dist[g] = 0;
      heap.push(g, 0);
    }
    const cols = this.cols;
    while (heap.size > 0) {
      const cur = heap.pop();
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      const dc = dist[cur];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= this.rows) continue;
        const ni = ny * cols + nx;
        const c = cost(ni);
        if (c === Infinity) continue;
        if (d >= 4 && (cost(cy * cols + nx) === Infinity || cost(ny * cols + cx) === Infinity)) continue;
        const nd = dc + c * DC[d];
        if (nd < dist[ni]) {
          dist[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
    return dist;
  }

  /** Neighbor of `i` with the smallest field value (respecting corner rules). */
  descend(field: Float32Array, i: number, cost: (i: number) => number): number {
    const cols = this.cols;
    const cx = i % cols;
    const cy = (i - cx) / cols;
    let best = -1;
    let bestV = field[i];
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= this.rows) continue;
      const ni = ny * cols + nx;
      if (d >= 4 && (cost(cy * cols + nx) === Infinity || cost(ny * cols + cx) === Infinity)) continue;
      if (field[ni] < bestV) {
        bestV = field[ni];
        best = ni;
      }
    }
    return best;
  }
}

/** Half the width of the gravel a railway lies on, in meters: the cells a track takes. */
const RAIL_REACH = 1.7;

/**
 * Stamps water and railways onto a grid whose buildings are already in it.
 *
 * Streets win over both: a street that crosses a river is a bridge, one that crosses a
 * railway a level crossing, and either way it stays a street. Buildings win over water
 * too, so a footprint mapped a little into a bank is not drowned. Water is stamped first
 * and the rails after it, so a railway bridge keeps its deck.
 */
export function stampTerrain(g: NavGrid, t: { roads: RoadDef[]; waters?: WaterDef[]; rails?: RailDef[] }): void {
  if (!t.waters?.length && !t.rails?.length) return;
  const n = g.cols * g.rows;
  const road = new Uint8Array(n);
  const near = (path: Vec2[], reach: number, mark: (i: number) => void) => {
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach) / g.cell));
      const x1 = Math.min(g.cols - 1, Math.floor((Math.max(a.x, b.x) + reach) / g.cell));
      const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach) / g.cell));
      const y1 = Math.min(g.rows - 1, Math.floor((Math.max(a.y, b.y) + reach) / g.cell));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) * g.cell;
          const py = (y + 0.5) * g.cell;
          const u = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
          if (Math.hypot(px - a.x - dx * u, py - a.y - dy * u) <= reach) mark(y * g.cols + x);
        }
    }
  };
  for (const r of t.roads) {
    if (r.path) near(r.path, (r.width ?? 8) / 2 + 0.5, (i) => (road[i] = 1));
    else {
      const x0 = Math.max(0, Math.floor(r.rect.x / g.cell));
      const x1 = Math.min(g.cols - 1, Math.floor((r.rect.x + r.rect.w) / g.cell));
      const y0 = Math.max(0, Math.floor(r.rect.y / g.cell));
      const y1 = Math.min(g.rows - 1, Math.floor((r.rect.y + r.rect.h) / g.cell));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) road[y * g.cols + x] = 1;
    }
  }
  const stamp = (i: number, kind: CellKind, over: CellKind[]) => {
    if (road[i] || !over.includes(g.kind[i])) return;
    g.kind[i] = kind;
  };
  const onlyFree = [CellKind.Free];
  for (const w of t.waters ?? []) {
    if (w.polygon) {
      // Even-odd over the outline and its islands together: scan each row once.
      const rings = [w.polygon, ...(w.holes ?? [])];
      for (let y = 0; y < g.rows; y++) {
        const py = (y + 0.5) * g.cell;
        const xs: number[] = [];
        for (const ring of rings)
          for (let k = 0; k < ring.length; k++) {
            const a = ring[k];
            const b = ring[(k + 1) % ring.length];
            if (a.y > py === b.y > py) continue;
            xs.push(a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x));
          }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.max(0, Math.ceil(xs[k] / g.cell - 0.5));
          const x1 = Math.min(g.cols - 1, Math.floor(xs[k + 1] / g.cell - 0.5));
          for (let x = x0; x <= x1; x++) stamp(y * g.cols + x, CellKind.Water, onlyFree);
        }
      }
    }
    if (w.path) near(w.path, (w.width ?? 12) / 2, (i) => stamp(i, CellKind.Water, onlyFree));
  }
  for (const r of t.rails ?? []) near(r.path, RAIL_REACH, (i) => stamp(i, CellKind.Rail, [CellKind.Free, CellKind.Water]));
}
