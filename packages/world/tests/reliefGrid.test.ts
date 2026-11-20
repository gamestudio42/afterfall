import { describe, expect, it } from "vitest";
import { BALANCE } from "@afterfall/content";
import { CellKind, NavGrid, cityFromOverpass, stampTerrain, type TerrainDef } from "../src";
import { FIXTURE_CENTER, syntheticOverpass } from "./fixtures/osm";

const size = 480;
const opts = { ...FIXTURE_CENTER, size, label: "relief" };

/** A terrain from a height function over the map (metres, drawn as given). */
function terrain(h: (x: number, y: number) => number): TerrainDef {
  const cell = 4;
  const cols = size / cell + 1;
  const heights: number[] = [];
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) heights.push(Math.round(h(c * cell, r * cell) * 10));
  return { cell, cols, rows: cols, heights, scale: 1, base: 0 };
}

describe("relief on the navigation grid", () => {
  it("leaves a flat map without heights, as before", () => {
    const g = NavGrid.fromCity(cityFromOverpass(syntheticOverpass(), opts));
    expect(g.elev).toBeNull();
    expect([...g.kind].includes(CellKind.Cliff)).toBe(false);
  });

  it("turns ground steeper than the cliff grade into cliffs, but never a street", () => {
    // A ridge across the map: a 2:1 wall from x 300 to 310, flat elsewhere.
    const t = terrain((x) => (x < 300 ? 0 : x > 310 ? 20 : (x - 300) * 2));
    const city = cityFromOverpass(syntheticOverpass(), { ...opts, terrain: t });
    const g = NavGrid.fromCity(city);
    expect(g.elev).not.toBeNull();
    let cliffs = 0;
    for (let i = 0; i < g.kind.length; i++) {
      if (g.kind[i] !== CellKind.Cliff) continue;
      cliffs++;
      const c = g.centerOf(i);
      expect(c.x).toBeGreaterThan(296);
      expect(c.x).toBeLessThan(314);
      expect(g.steep![i]).toBeGreaterThan(BALANCE.terrainCliffGrade);
    }
    expect(cliffs).toBeGreaterThan(50);
    // Streets cross the ridge: a survivor still gets from one side to the other.
    expect(g.findPath(250, 240, 360, 240, "survivor")).not.toBeNull();
  });

  it("walks round a hill rather than over it when the level way is not much longer", () => {
    // A cone 45 m high and 50 m in radius, grade 0.9: steep, but under the cliff grade.
    // Over it costs R (2 + 1.5 x 0.9) = 3.35 R; round it, half the circumference, 3.14 R.
    const t = terrain((x, y) => Math.max(0, 45 - Math.hypot(x - 240, y - 240) * 0.9));
    // Open ground, nothing in the way but the dome.
    const flat = new NavGrid(size, size, 2);
    const hilly = new NavGrid(size, size, 2);
    stampTerrain(hilly, { roads: [], terrain: t });
    // The path is a few waypoints: walk it a metre at a time and add up every rise.
    const climb = (g: NavGrid, points: { x: number; y: number }[]) => {
      let up = 0;
      let prev = g.elev![g.cellOf(points[0].x, points[0].y)];
      for (let k = 1; k < points.length; k++) {
        const a = points[k - 1];
        const b = points[k];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
        for (let s = 1; s <= steps; s++) {
          const h = g.elev![g.cellOf(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps)];
          up += Math.max(0, h - prev);
          prev = h;
        }
      }
      return up;
    };
    // A path lists the waypoints after the start; the walk begins at the start.
    const across = (g: NavGrid) => {
      const r = g.findPath(170, 241, 310, 241, "survivor")!;
      return { points: [{ x: 170, y: 241 }, ...r.points] };
    };
    const straight = across(flat);
    const round = across(hilly);
    // The straight way goes over the dome's flank.
    expect(climb(hilly, straight.points)).toBeGreaterThan(5);
    // Measured on the hilly grid, the flat map's straight path climbs more than the one taken.
    expect(climb(hilly, round.points)).toBeLessThan(climb(hilly, straight.points));
  });
});
