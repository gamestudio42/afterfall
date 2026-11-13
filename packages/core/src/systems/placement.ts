import { STRUCTURES, type StructureKind } from "@afterfall/content";
import { lineCells, type LineFrame } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import type { Simulation } from "../simulation";
import type { Entity, EntityId } from "../state";

/**
 * Where a structure may go. The build preview and the simulation ask the same question
 * here: when they disagreed (the preview did not know about building doors), the preview
 * showed a valid piece the simulation then dropped without a word.
 */
export interface Placement {
  cells: number[];
  /** A built wall this piece takes the place of when it finishes (a gate set into a wall), or -1. */
  replaces: EntityId;
}

/** Walls and gates are axial: their long side runs along a line, so they have an angle. */
export function isAxial(kind: StructureKind): boolean {
  return kind === "wall" || kind === "gate";
}

/**
 * The cells a structure covers. A wall or gate keeps its one cell at any angle (it is a
 * thin panel); a turned tower, farm or well covers every cell its turned square reaches
 * into, so it cannot be set with a corner inside a wall or a house.
 */
export function structureCells(sim: Simulation, kind: StructureKind, cx: number, cy: number, yaw = 0): number[] | null {
  const def = STRUCTURES[kind];
  const g = sim.grid;
  const turned = !isAxial(kind) && Math.abs(Math.sin(2 * yaw)) > 1e-6;
  if (!turned) {
    const cells = g.footprint(cx, cy, def.size);
    return cells.length === def.size * def.size ? cells : null;
  }
  const h = def.size / 2;
  const ox = cx + h;
  const oy = cy + h;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const r = h * Math.SQRT2;
  const cells: number[] = [];
  for (let y = Math.floor(oy - r); y < Math.ceil(oy + r); y++)
    for (let x = Math.floor(ox - r); x < Math.ceil(ox + r); x++) {
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy++)
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES - ox;
          const py = y + (sy + 0.5) / SAMPLES - oy;
          // Into the square's own frame (render yaw turns +x towards -y on the grid).
          const u = px * cos - py * sin;
          const v = px * sin + py * cos;
          if (Math.abs(u) <= h && Math.abs(v) <= h) inside++;
        }
      if (inside < COVERED) continue;
      if (!g.inBounds(x, y)) return null;
      cells.push(g.index(x, y));
    }
  return cells;
}

/**
 * Sub-samples per cell side, and how many of the 16 must fall inside to claim the cell.
 * One: a tower turned 45° reaches 0.8 m into the next cell, through any wall standing
 * there. What can slip between samples is under a quarter of a metre deep.
 */
const SAMPLES = 4;
const COVERED = 1;

export function placementAt(sim: Simulation, kind: StructureKind, cx: number, cy: number, yaw = 0): Placement | null {
  const g = sim.grid;
  const cells = structureCells(sim, kind, cx, cy, yaw);
  if (!cells) return null;
  let replaces = -1;
  for (const i of cells) {
    const owner = g.structureAt[i];
    if (owner !== -1) {
      // A gate goes into a finished wall: the wall stands until the gate is done, so the
      // line never opens while it is being built.
      const wall = kind === "gate" ? sim.state.entities.get(owner) : undefined;
      if (!wall?.structure || wall.structure.kind !== "wall" || !wall.structure.built || replacedBy(sim, owner) >= 0) return null;
      replaces = owner;
      continue;
    }
    if (g.kind[i] !== CellKind.Free) return null;
  }
  // Do not seal off building doors.
  if (kind !== "farm" && touchesEntrance(sim, cells)) return null;
  return { cells, replaces };
}

/** The blueprint waiting to take a wall's place, or -1. */
export function replacedBy(sim: Simulation, wall: EntityId): EntityId {
  for (const e of sim.structures()) if (e.structure.replaces === wall) return e.id;
  return -1;
}

function touchesEntrance(sim: Simulation, cells: number[]): boolean {
  for (const b of sim.city.buildings) {
    const ei = sim.grid.cellOf(b.entrance.x, b.entrance.y);
    if (cells.includes(ei)) return true;
  }
  return false;
}

/** True when the cells are exactly the straight line from the first to the last one. */
export function isDrawnLine(cells: [number, number][]): boolean {
  if (cells.length < 2) return false;
  const line = lineCells(cells[0], cells[cells.length - 1]);
  return line.length === cells.length && line.every(([x, y], i) => cells[i][0] === x && cells[i][1] === y);
}

/** A yaw folded into (-π/4, π/4]: the smallest turn that lines a square up with an angle. */
export function foldQuarter(yaw: number): number {
  const q = Math.PI / 2;
  let y = yaw % q;
  if (y <= -q / 2) y += q;
  if (y > q / 2) y -= q;
  return y;
}

/** A yaw folded into (-π, π]. */
export function foldTurn(yaw: number): number {
  let y = yaw % (2 * Math.PI);
  if (y <= -Math.PI) y += 2 * Math.PI;
  if (y > Math.PI) y -= 2 * Math.PI;
  return y;
}

/** A yaw folded into (-π/2, π/2]: a wall panel looks the same turned half a turn. */
export function foldYaw(yaw: number): number {
  let y = yaw % Math.PI;
  if (y <= -Math.PI / 2) y += Math.PI;
  if (y > Math.PI / 2) y -= Math.PI;
  return y;
}

function axialAt(sim: Simulation, x: number, y: number): Entity | null {
  const g = sim.grid;
  if (!g.inBounds(x, y)) return null;
  const e = sim.state.entities.get(g.structureAt[g.index(x, y)]);
  return e?.structure && isAxial(e.structure.kind) ? e : null;
}

/** Farther than this from a street, a lone piece has no street to line up with. */
const ROAD_REACH = 14;

/**
 * The angle a single wall or gate takes when the player has not turned it: the wall it
 * joins or sits in, else the nearest street, else the grid. On an imported map the
 * streets run at any angle, and a lone piece stuck east-west across them looked dropped
 * rather than built.
 */
export function placementYaw(sim: Simulation, kind: StructureKind, cx: number, cy: number): number {
  if (!isAxial(kind)) {
    // A tower, farm or well squares up to the street it stands by. A square looks the
    // same a quarter turn on, so the smallest turn that lines it up is the one taken.
    const h = STRUCTURES[kind].size / 2;
    const road = nearestRoadYaw(sim, (cx + h) * sim.grid.cell, (cy + h) * sim.grid.cell);
    return road === null ? 0 : foldQuarter(road);
  }
  const self = axialAt(sim, cx, cy);
  if (self?.structure!.line) return self.structure!.line.yaw;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ]) {
    const n = axialAt(sim, cx + dx, cy + dy);
    if (n?.structure!.line) return n.structure!.line.yaw;
  }
  const ns = axialAt(sim, cx, cy - 1) || axialAt(sim, cx, cy + 1);
  const ew = axialAt(sim, cx + 1, cy) || axialAt(sim, cx - 1, cy);
  if (ns && !ew) return Math.PI / 2;
  if (ew) return 0;
  const road = nearestRoadYaw(sim, (cx + 0.5) * sim.grid.cell, (cy + 0.5) * sim.grid.cell);
  return road ?? 0;
}

function nearestRoadYaw(sim: Simulation, x: number, y: number): number | null {
  let best = ROAD_REACH;
  let yaw: number | null = null;
  for (const r of sim.city.roads) {
    const path = r.path ?? [
      r.horizontal ? { x: r.rect.x, y: r.rect.y + r.rect.h / 2 } : { x: r.rect.x + r.rect.w / 2, y: r.rect.y },
      r.horizontal ? { x: r.rect.x + r.rect.w, y: r.rect.y + r.rect.h / 2 } : { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h },
    ];
    const half = (r.width ?? (r.horizontal ? r.rect.h : r.rect.w)) / 2;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      // Distance from the kerb, not the centre line, so wide avenues count as near.
      const d = Math.max(0, Math.hypot(a.x + dx * t - x, a.y + dy * t - y) - half);
      if (d < best) {
        best = d;
        yaw = foldYaw(Math.atan2(-dy, dx));
      }
    }
  }
  return yaw;
}

/**
 * The frame for a single piece at a chosen angle. A piece on a grid axis that already
 * has orthogonal neighbours is left to them, so it still forms corners and T junctions.
 */
export function singleFrame(sim: Simulation, cx: number, cy: number, yaw: number): LineFrame | null {
  const y = foldYaw(yaw);
  const joined = joinFrame(sim, cx, cy, y);
  if (joined) return joined;
  const onAxis = Math.abs(Math.sin(2 * y)) < 1e-6;
  if (onAxis) {
    const joined = axialAt(sim, cx + 1, cy) || axialAt(sim, cx - 1, cy) || axialAt(sim, cx, cy + 1) || axialAt(sim, cx, cy - 1);
    if (joined) return null;
  }
  return { yaw: y, stretch: 1, ox: 0, oy: 0 };
}

/** The turn of a tower, farm or well, or null when it stands square to the grid. */
export function turnFrame(yaw: number): LineFrame | null {
  const y = foldTurn(yaw);
  return Math.abs(y) < 1e-6 ? null : { yaw: y, stretch: 1, ox: 0, oy: 0 };
}

/**
 * The frame of a piece set onto the line of a slanted wall next to it: a gate in a gap,
 * or one more panel at the end. Taking only the neighbour's angle left the piece on its
 * cell centre and unstretched, a step out of a line whose pieces sit up to half a cell
 * off their centres. Null when no neighbour's line at this angle passes through the cell.
 */
function joinFrame(sim: Simulation, cx: number, cy: number, yaw: number): LineFrame | null {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const line = axialAt(sim, cx + dx, cy + dy)?.structure!.line;
      if (!line || Math.abs(Math.sin(line.yaw - yaw)) > 1e-3) continue;
      // The neighbour's point on the line, and the line's direction on the grid.
      const px = cx + dx + line.ox;
      const py = cy + dy + line.oy;
      const ux = Math.cos(line.yaw);
      const uy = -Math.sin(line.yaw);
      let ox = 0;
      let oy = 0;
      if (Math.abs(ux) >= Math.abs(uy)) oy = py + ((cx - px) * uy) / ux - cy;
      else ox = px + ((cy - py) * ux) / uy - cx;
      // Further than that, the line runs through another cell: this piece is beside it.
      if (Math.abs(ox) + Math.abs(oy) > 0.5 + 1e-6) continue;
      return { yaw: line.yaw, stretch: line.stretch, ox, oy };
    }
  return null;
}

/** The frame a single wall or gate will be drawn with, for the preview. */
export function previewFrame(sim: Simulation, cx: number, cy: number, yaw: number): LineFrame {
  const self = axialAt(sim, cx, cy)?.structure!.line;
  return self ?? singleFrame(sim, cx, cy, yaw) ?? { yaw: foldYaw(yaw), stretch: 1, ox: 0, oy: 0 };
}
