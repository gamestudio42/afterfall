import { describe, expect, it } from "vitest";
import { lineCells } from "@afterfall/shared";
import { CellKind, cityFromOverpass } from "@afterfall/world";
import { FIXTURE_CENTER, syntheticOverpass } from "../../world/tests/fixtures/osm";
import { createSimulation, deserialize, serialize, type Simulation } from "../src";
import { destroyStructure } from "../src/systems/infected";
import { foldYaw, placementAt, placementYaw, structureCells } from "../src/systems/placement";
import { cancelTask, finishStructure, placeStructures } from "../src/systems/tasks";
import { pickBase } from "./autoplay";

function started(seed = 3): Simulation {
  const sim = createSimulation({ seed });
  sim.enqueue({ type: "setBase", building: pickBase(sim) });
  sim.tick();
  return sim;
}

/** A free spot near the base with room for a run of `len` walls east of it, and a clear row around it. */
function freeSpot(sim: Simulation, len = 6): [number, number] {
  const g = sim.grid;
  const hq = sim.hqEntrance();
  const c0 = g.cellOf(hq.x, hq.y);
  const hx = c0 % g.cols;
  const hy = Math.floor(c0 / g.cols);
  for (let r = 3; r < 60; r++)
    for (let y = hy - r; y <= hy + r; y++)
      for (let x = hx - r; x <= hx + r; x++) {
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx < len + 2 && ok; dx++) ok = !!placementAt(sim, "wall", x + dx, y + dy);
        if (ok) return [x, y];
      }
  throw new Error("no free spot");
}

function at(sim: Simulation, x: number, y: number) {
  return sim.state.entities.get(sim.grid.structureAt[sim.grid.index(x, y)]);
}

function finishAll(sim: Simulation): void {
  for (const e of [...sim.structures()]) if (!e.structure.built) finishStructure(sim, e);
}

describe("placing a single wall or gate", () => {
  it("keeps the angle the player turned it to", () => {
    const sim = started();
    const [x, y] = freeSpot(sim);
    placeStructures(sim, "wall", [[x, y]], Math.PI / 6);
    expect(at(sim, x, y)!.structure!.line).toEqual({ yaw: Math.PI / 6, stretch: 1, ox: 0, oy: 0 });
    // A lone piece turned onto the other axis keeps that too: nothing else orients it.
    placeStructures(sim, "gate", [[x + 3, y]], Math.PI / 2);
    expect(at(sim, x + 3, y)!.structure!.line?.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("leaves a piece on an axis next to others to them, so corners still form", () => {
    const sim = started();
    const [x, y] = freeSpot(sim);
    placeStructures(sim, "wall", [
      [x, y],
      [x + 1, y],
    ]);
    placeStructures(sim, "wall", [[x + 2, y]], 0);
    expect(at(sim, x + 2, y)!.structure!.line).toBeUndefined();
  });

  it("lines up with the wall it joins", () => {
    const sim = started();
    const [x, y] = freeSpot(sim, 8);
    const line = lineCells([x, y], [x + 6, y + 2]);
    placeStructures(sim, "wall", line);
    const yaw = at(sim, x, y)!.structure!.line!.yaw;
    expect(placementYaw(sim, "wall", x + 7, y + 2)).toBeCloseTo(yaw);
    // Along an axis, the run's own axis.
    const axis = started();
    const [a, b] = freeSpot(axis);
    placeStructures(axis, "wall", [
      [a, b],
      [a, b + 1],
    ]);
    expect(placementYaw(axis, "wall", a, b + 2)).toBeCloseTo(Math.PI / 2);
  });

  it("lines up with the nearest street on an imported map", () => {
    const map = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size: 480, label: "Test" });
    const sim = createSimulation({ seed: map.seed, map });
    const g = sim.grid;
    // Every slanted street: a free cell beside it takes its angle.
    let checked = 0;
    for (const r of sim.city.roads) {
      if (!r.path || checked > 4) continue;
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1];
        const b = r.path[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const slant = Math.abs(Math.sin(2 * Math.atan2(dy, dx)));
        if (len < 30 || slant < 0.3) continue;
        const half = (r.width ?? 8) / 2;
        const px = (a.x + b.x) / 2 - (dy / len) * (half + 2);
        const py = (a.y + b.y) / 2 + (dx / len) * (half + 2);
        const c = g.cellOf(px, py);
        if (g.kind[c] !== CellKind.Free) continue;
        const yaw = placementYaw(sim, "wall", c % g.cols, Math.floor(c / g.cols));
        expect(yaw).toBeCloseTo(foldYaw(Math.atan2(-dy, dx)), 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("a gate set into a wall", () => {
  it("keeps the wall standing until the gate is done, then takes its place and its line", () => {
    const sim = started();
    const [x, y] = freeSpot(sim, 8);
    placeStructures(sim, "wall", lineCells([x, y], [x + 6, y + 2]));
    finishAll(sim);
    const wall = at(sim, x + 3, y + 1)!;
    const i = sim.grid.index(x + 3, y + 1);
    placeStructures(sim, "gate", [[x + 3, y + 1]]);
    const gate = [...sim.structures()].find((e) => e.structure.kind === "gate")!;
    expect(gate.structure.replaces).toBe(wall.id);
    expect(gate.structure.line).toEqual(wall.structure!.line);
    // Still a wall while it is built: the line does not open.
    expect(sim.grid.kind[i]).toBe(CellKind.Solid);
    expect(sim.grid.structureAt[i]).toBe(wall.id);
    finishStructure(sim, gate);
    expect(sim.state.entities.has(wall.id)).toBe(false);
    expect(sim.grid.structureAt[i]).toBe(gate.id);
    expect(sim.grid.kind[i]).toBe(CellKind.Gate);
    expect(gate.structure.replaces).toBeUndefined();
  });

  it("goes only into a finished wall, and only once", () => {
    const sim = started();
    const [x, y] = freeSpot(sim);
    placeStructures(sim, "wall", [[x, y]]);
    expect(placementAt(sim, "gate", x, y)).toBeNull();
    finishAll(sim);
    expect(placementAt(sim, "gate", x, y)?.replaces).toBe(at(sim, x, y)!.id);
    expect(placementAt(sim, "wall", x, y)).toBeNull();
    placeStructures(sim, "gate", [[x, y]]);
    expect(placementAt(sim, "gate", x, y)).toBeNull();
  });

  it("leaves the wall when the gate is cancelled", () => {
    const sim = started();
    const [x, y] = freeSpot(sim);
    placeStructures(sim, "wall", [[x, y]]);
    finishAll(sim);
    const wall = at(sim, x, y)!;
    const task = placeStructures(sim, "gate", [[x, y]])!;
    cancelTask(sim, task);
    expect(sim.state.entities.has(wall.id)).toBe(true);
    expect(sim.grid.structureAt[sim.grid.index(x, y)]).toBe(wall.id);
    expect([...sim.structures()].some((e) => e.structure.kind === "gate")).toBe(false);
  });

  it("holds the cells on its own when the wall falls first", () => {
    const sim = started();
    const [x, y] = freeSpot(sim);
    placeStructures(sim, "wall", [[x, y]]);
    finishAll(sim);
    const wall = at(sim, x, y)!;
    placeStructures(sim, "gate", [[x, y]]);
    destroyStructure(sim, wall);
    const gate = [...sim.structures()].find((e) => e.structure.kind === "gate")!;
    expect(gate.structure.replaces).toBeUndefined();
    expect(sim.grid.structureAt[sim.grid.index(x, y)]).toBe(gate.id);
    expect(placementAt(sim, "wall", x, y)).toBeNull();
  });

  it("survives a save", () => {
    const sim = started();
    const [x, y] = freeSpot(sim);
    placeStructures(sim, "wall", [[x, y]]);
    finishAll(sim);
    const wall = at(sim, x, y)!;
    placeStructures(sim, "gate", [[x + 2, y]], Math.PI / 5);
    placeStructures(sim, "gate", [[x, y]]);
    const back = deserialize(JSON.stringify(serialize(sim)));
    const gates = [...back.structures()].filter((e) => e.structure.kind === "gate");
    expect(gates.find((g) => g.structure.replaces === wall.id)).toBeTruthy();
    expect(gates.find((g) => g.structure.cx === x + 2)!.structure.line?.yaw).toBeCloseTo(Math.PI / 5);
  });
});

describe("where a piece may go", () => {
  it("never on a building door, for the preview as for the simulation", () => {
    const sim = started();
    const b = sim.city.buildings.find((bb) => bb.index !== sim.state.hq)!;
    const c = sim.grid.cellOf(b.entrance.x, b.entrance.y);
    const x = c % sim.grid.cols;
    const y = Math.floor(c / sim.grid.cols);
    expect(placementAt(sim, "wall", x, y)).toBeNull();
    expect(placeStructures(sim, "wall", [[x, y]])).toBeNull();
  });
});

describe("turning a tower, farm or well", () => {
  it("covers its own square on the grid, and the cells a turned square reaches into", () => {
    const sim = started();
    const [x, y] = freeSpot(sim, 8);
    const square = structureCells(sim, "tower", x + 2, y, 0)!;
    expect(square).toHaveLength(4);
    // A quarter turn is the same square.
    expect(new Set(structureCells(sim, "tower", x + 2, y, Math.PI / 2))).toEqual(new Set(square));
    const turned = structureCells(sim, "tower", x + 2, y, Math.PI / 6)!;
    for (const i of square) expect(turned).toContain(i);
    expect(turned.length).toBeGreaterThan(4);
    // Every cell it claims is one the turned square really overlaps: none farther than
    // the square's half-diagonal from its centre.
    const g = sim.grid;
    for (const i of turned) {
      const cx = (i % g.cols) + 0.5 - (x + 3);
      const cy = Math.floor(i / g.cols) + 0.5 - (y + 1);
      expect(Math.hypot(cx, cy)).toBeLessThan(Math.SQRT2 + Math.SQRT1_2);
    }
  });

  it("keeps the turn and stamps every covered cell when built", () => {
    const sim = started();
    const [x, y] = freeSpot(sim, 8);
    placeStructures(sim, "tower", [[x + 2, y]], Math.PI / 6);
    const tower = [...sim.structures()].find((e) => e.structure.kind === "tower")!;
    expect(tower.structure.line?.yaw).toBeCloseTo(Math.PI / 6);
    expect(tower.structure.cells).toEqual(structureCells(sim, "tower", x + 2, y, Math.PI / 6));
    finishStructure(sim, tower);
    for (const i of tower.structure.cells) expect(sim.grid.kind[i]).toBe(CellKind.Solid);
    // Square to the grid: nothing stored, the old footprint.
    placeStructures(sim, "well", [[x + 5, y]], 0);
    const well = [...sim.structures()].find((e) => e.structure.kind === "well")!;
    expect(well.structure.line).toBeUndefined();
    expect(well.structure.cells).toHaveLength(4);
  });

  it("does not fit where a corner of the turned square would hit a wall", () => {
    const sim = started();
    const [x, y] = freeSpot(sim, 8);
    placeStructures(sim, "wall", [[x + 1, y]]);
    // Square to the grid the tower fits right beside the wall; turned, a corner reaches in.
    expect(placementAt(sim, "tower", x + 2, y, 0)).not.toBeNull();
    expect(placementAt(sim, "tower", x + 2, y, Math.PI / 4)).toBeNull();
  });

  it("squares up to the nearest street by the smallest turn", () => {
    const map = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size: 480, label: "Test" });
    const sim = createSimulation({ seed: map.seed, map });
    const g = sim.grid;
    let checked = 0;
    for (const r of sim.city.roads) {
      if (!r.path || checked > 4) continue;
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1];
        const b = r.path[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const slant = Math.abs(Math.sin(2 * Math.atan2(dy, dx)));
        if (len < 30 || slant < 0.3) continue;
        const half = (r.width ?? 8) / 2;
        const px = (a.x + b.x) / 2 - (dy / len) * (half + 3);
        const py = (a.y + b.y) / 2 + (dx / len) * (half + 3);
        const c = g.cellOf(px, py);
        // The cell is the tower's top-left; its centre is one cell further on.
        const yaw = placementYaw(sim, "tower", (c % g.cols) - 1, Math.floor(c / g.cols) - 1);
        expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
        // Lined up: the street's angle and the tower's differ by a whole quarter turn.
        const off = (Math.atan2(-dy, dx) - yaw) / (Math.PI / 2);
        expect(Math.abs(off - Math.round(off))).toBeLessThan(0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
