import { describe, expect, it } from "vitest";
import { BALANCE } from "@afterfall/content";
import { cityFromOverpass, CellKind, type TerrainDef } from "@afterfall/world";
import { Simulation, placementAt } from "../src";
import { highGroundRange } from "../src/systems/combat";
import { climbSpeed } from "../src/systems/movement";
import { FIXTURE_CENTER, syntheticOverpass } from "../../world/tests/fixtures/osm";

const size = 480;

function terrain(h: (x: number, y: number) => number): TerrainDef {
  const cell = 4;
  const cols = size / cell + 1;
  const heights: number[] = [];
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) heights.push(Math.round(h(c * cell, r * cell) * 10));
  return { cell, cols, rows: cols, heights, scale: 1, base: 0 };
}

function sim(t?: TerrainDef): Simulation {
  const city = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size, label: "relief", ...(t ? { terrain: t } : {}) });
  return new Simulation({ seed: 3, map: city });
}

describe("relief rules", () => {
  it("slows a climb, and does not speed a descent", () => {
    expect(climbSpeed(4, 0)).toBe(4);
    expect(climbSpeed(4, -0.5)).toBe(4);
    expect(climbSpeed(4, 0.5)).toBeCloseTo(4 / (1 + BALANCE.terrainClimbCost * 0.5), 6);
    expect(climbSpeed(4, 1)).toBeLessThan(climbSpeed(4, 0.5));
  });

  it("lets a shooter on high ground reach further, up to a cap, and never shortens it from below", () => {
    expect(highGroundRange(20, 0)).toBe(20);
    expect(highGroundRange(20, -10)).toBe(20);
    expect(highGroundRange(20, 5)).toBeCloseTo(20 * (1 + 5 * BALANCE.highGroundRangePerMetre), 6);
    expect(highGroundRange(20, 1000)).toBeCloseTo(20 * (1 + BALANCE.highGroundRangeMax), 6);
  });

  it("builds nothing on ground steeper than the build grade", () => {
    const flat = sim();
    // A slope of 0.7 everywhere: too steep to build on, gentle enough to walk.
    const steep = sim(terrain((x) => x * 0.7));
    expect([...steep.grid.kind].includes(CellKind.Cliff)).toBe(false);
    let tried = 0;
    for (let cy = 20; cy < 200 && tried < 30; cy += 7)
      for (let cx = 20; cx < 200 && tried < 30; cx += 7) {
        if (!placementAt(flat, "tower", cx, cy)) continue;
        tried++;
        expect(placementAt(steep, "tower", cx, cy)).toBeNull();
      }
    expect(tried).toBeGreaterThan(5);
  });

  it("keeps a flat map exactly as it was", () => {
    const a = sim();
    expect(a.grid.elev).toBeNull();
    expect(a.city.terrain).toBeUndefined();
  });
});
