import { describe, expect, it } from "vitest";
import type { BuildingDef, CityMap, RoadDef } from "@afterfall/world";
import { buildCityGround, URBAN_GROUND_TINT } from "../src/cityMeshes";

function building(index: number): BuildingDef {
  return {
    id: `b${index}`,
    index,
    type: "house",
    zone: "residential",
    rect: { x: 10 + index * 20, y: 10, w: 12, h: 10 },
    area: 120,
    floors: 2,
    height: 7,
    entrance: { x: 16 + index * 20, y: 20 },
    facing: { x: 0, y: 1 },
  } as BuildingDef;
}

function map(over: Partial<CityMap>): CityMap {
  return {
    seed: 3,
    name: "Test",
    width: 200,
    height: 200,
    cellSize: 2,
    blockSize: 40,
    roadWidth: 8,
    blocksX: 4,
    blocksY: 4,
    roads: [],
    intersections: [],
    buildings: [building(0)],
    parks: [],
    spawnPoints: [],
    ...over,
  } as CityMap;
}

describe("ground for imported maps", () => {
  it("paves the base of a map that has no blocks", () => {
    const road: RoadDef = {
      id: "r",
      rect: { x: 0, y: 40, w: 200, h: 8 },
      path: [
        { x: 0, y: 44 },
        { x: 200, y: 44 },
      ],
    } as RoadDef;
    const imported = buildCityGround(map({ blocksX: 0, blocksY: 0, blockSize: 0, roads: [road] }));
    expect(imported.imported).toBe(true);
    // Grey pavement, not the olive of the generated city's grass.
    expect(imported.materials.ground.color.getHex()).toBe(0x6f6d66);
    imported.group.traverse((o) => {
      const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      m.geometry?.dispose();
      m.material?.dispose();
    });
  });

  it("keeps the grass base of a generated city", () => {
    const generated = buildCityGround(map({}));
    expect(generated.imported).toBe(false);
    expect(generated.materials.ground.color.getHex()).toBe(0x4a4d40);
  });

  it("paints an imported base with a light, neutral tint", () => {
    // The concrete map is near neutral; the tint must not colour it green or blue.
    const c = URBAN_GROUND_TINT;
    const r = (c >> 16) & 255;
    const g = (c >> 8) & 255;
    const b = c & 255;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(20);
  });
});
