import { describe, expect, it } from "vitest";
import type { BuildingDef, CityMap, RoadDef } from "@afterfall/world";
import { DECAL_COLS, DECAL_ROWS, decalGeometry, placeDecals } from "../src/decals";

function road(x: number, y: number, w: number, h: number): RoadDef {
  return { id: `${x},${y}`, rect: { x, y, w, h }, horizontal: w > h, width: h } as RoadDef;
}

function building(index: number, x: number, y: number): BuildingDef {
  return {
    id: `b${index}`,
    index,
    type: "house",
    zone: "residential",
    rect: { x, y, w: 12, h: 12 },
    area: 144,
    floors: 3,
    height: 9,
    entrance: { x, y },
    facing: { x: 0, y: 1 },
  } as BuildingDef;
}

function city(buildings: BuildingDef[] = []): CityMap {
  return {
    seed: 11,
    name: "Test",
    width: 200,
    height: 200,
    cellSize: 2,
    blockSize: 40,
    roadWidth: 12,
    blocksX: 4,
    blocksY: 4,
    roads: [road(0, 60, 200, 12), road(60, 0, 12, 200)],
    intersections: [],
    buildings,
    parks: [],
    spawnPoints: [],
  } as CityMap;
}

describe("placeDecals", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    const a = placeDecals(city(), 11);
    const b = placeDecals(city(), 11);
    const c = placeDecals(city(), 12);
    expect(a.length).toBeGreaterThan(50);
    expect(a.slice(0, 40)).toEqual(b.slice(0, 40));
    expect(a.slice(0, 40)).not.toEqual(c.slice(0, 40));
  });

  it("keeps every decal on the map, on the road or at a doorstep", () => {
    const map = city([building(0, 80, 60), building(1, 120, 30)]);
    for (const d of placeDecals(map, 11)) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(map.width);
      expect(d.z).toBeGreaterThanOrEqual(0);
      expect(d.z).toBeLessThanOrEqual(map.height);
      expect(d.size).toBeGreaterThan(0.5);
      expect(d.tile).toBeGreaterThanOrEqual(0);
      expect(d.tile).toBeLessThan(DECAL_COLS * DECAL_ROWS);
    }
  });

  it("puts nothing down on a map without roads or buildings", () => {
    const empty = { ...city(), roads: [], buildings: [] } as CityMap;
    expect(placeDecals(empty, 11)).toHaveLength(0);
  });

  it("never exceeds its cap", () => {
    expect(placeDecals(city(), 11, 25).length).toBeLessThanOrEqual(25);
  });
});

describe("decalGeometry", () => {
  it("builds one quad per decal with UVs inside the atlas", () => {
    const placements = placeDecals(city(), 11, 120);
    const geo = decalGeometry(placements);
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv");
    expect(pos.count).toBe(placements.length * 4);
    expect(geo.index?.count).toBe(placements.length * 6);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
    // Every quad lies flat: the layer is seen only from above.
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBe(0);
  });

  it("winds its faces up, or the whole layer is invisible from the camera", () => {
    const geo = decalGeometry(placeDecals(city(), 11, 8));
    expect(geo.getAttribute("normal").getY(0)).toBeCloseTo(1, 5);
  });

  it("keeps a decal within its own footprint", () => {
    const placements = placeDecals(city(), 11, 60);
    const geo = decalGeometry(placements);
    const pos = geo.getAttribute("position");
    const first = placements[0]!;
    for (let i = 0; i < 4; i++) {
      const dx = Math.abs(pos.getX(i) - first.x);
      const dz = Math.abs(pos.getZ(i) - first.z);
      expect(Math.max(dx, dz)).toBeLessThanOrEqual(first.size * 0.75);
    }
  });
});
