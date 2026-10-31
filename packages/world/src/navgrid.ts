import { pointInPolygon, polygonBounds, polygonCentroid, type Vec2 } from "@afterfall/shared";
import type { CityMap } from "./city";
import { MinHeap } from "./heap";

export const enum CellKind {
  Free = 0,
  Building = 1,
  /** Solid player structure: blocks everyone. */
  Solid = 2,
  /** Gate: survivors pass, infected must break it. */
  Gate = 3,
  /** Non-solid structure such as a farm: passable. */
  Soft = 4,
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
 * Buildings are stamped in once; structures are added/removed at runtime.
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
        g.stampPolygon(b.footprint, b.index);
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
    return g;
  }

  /** Marks the cells whose centers fall inside a building outline (at least one cell). */
  stampPolygon(poly: Vec2[], building: number): number {
    const r = polygonBounds(poly);
    const x0 = Math.max(0, Math.floor(r.x / this.cell));
    const y0 = Math.max(0, Math.floor(r.y / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w) / this.cell));
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h) / this.cell));
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!pointInPolygon((x + 0.5) * this.cell, (y + 0.5) * this.cell, poly)) continue;
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

  passableIndex(i: number, agent: Agent): boolean {
    const k = this.kind[i];
    if (k === CellKind.Free || k === CellKind.Soft) return true;
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
