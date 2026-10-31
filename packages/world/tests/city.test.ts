import { describe, expect, it } from "vitest";
import { rectsOverlap } from "@afterfall/shared";
import { generateCity, NavGrid } from "../src";

describe("procedural city", () => {
  const city = generateCity({ seed: 1234 });

  it("is deterministic for a seed", () => {
    const again = generateCity({ seed: 1234 });
    expect(JSON.stringify(again)).toEqual(JSON.stringify(city));
    expect(JSON.stringify(generateCity({ seed: 99 }))).not.toEqual(JSON.stringify(city));
  });

  it("has roughly a hundred buildings with the required landmarks", () => {
    expect(city.buildings.length).toBeGreaterThanOrEqual(70);
    expect(city.buildings.length).toBeLessThanOrEqual(160);
    const types = new Set(city.buildings.map((b) => b.type));
    for (const t of ["supermarket", "hospital", "police", "school"]) expect(types.has(t as never)).toBe(true);
  });

  it("never places buildings on roads or on top of each other", () => {
    for (const b of city.buildings) {
      for (const r of city.roads) expect(rectsOverlap(b.rect, r.rect)).toBe(false);
    }
    for (let i = 0; i < city.buildings.length; i++)
      for (let j = i + 1; j < city.buildings.length; j++) expect(rectsOverlap(city.buildings[i].rect, city.buildings[j].rect)).toBe(false);
  });

  it("gives every building a reachable entrance", () => {
    const grid = NavGrid.fromCity(city);
    const start = city.intersections[0];
    for (const b of city.buildings) {
      expect(grid.passable(b.entrance.x, b.entrance.y, "survivor")).toBe(true);
      const path = grid.findPath(start.x, start.y, b.entrance.x, b.entrance.y, "survivor");
      expect(path).not.toBeNull();
    }
  });
});

describe("navigation grid", () => {
  const city = generateCity({ seed: 7 });
  const grid = NavGrid.fromCity(city);

  it("produces paths that never cross buildings", () => {
    const a = city.intersections[0];
    const b = city.intersections[city.intersections.length - 1];
    const path = grid.findPath(a.x, a.y, b.x, b.y, "survivor")!;
    expect(path).not.toBeNull();
    let prev = a;
    for (const p of path.points) {
      expect(grid.walkable(prev.x, prev.y, p.x, p.y, "survivor", 0)).toBe(true);
      prev = p;
    }
  });

  it("treats gates as passable for survivors only", () => {
    const p = city.intersections[8];
    const i = grid.cellOf(p.x, p.y);
    grid.setStructure([i], 3, 1);
    expect(grid.passableIndex(i, "survivor")).toBe(true);
    expect(grid.passableIndex(i, "infected")).toBe(false);
    grid.setStructure([i], 0, -1);
  });
});
