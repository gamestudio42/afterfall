import { describe, expect, it } from "vitest";
import { generateCity } from "@afterfall/world";
import { distToPolyline } from "@afterfall/shared";
import { placeVegetation, VEGETATION_CAP } from "../src/vegetation";

describe("vegetation placement", () => {
  it("is deterministic, varied and stays within its instance budget", () => {
    const city = generateCity({ seed: 4242 });
    const a = placeVegetation(city);
    expect(a).toEqual(placeVegetation(city));
    expect(a.length).toBeGreaterThan(20);
    expect(new Set(a.map((p) => p.species)).size).toBe(4);
    const park = city.parks[0];
    park.trees = Array.from({ length: 800 }, () => ({ ...park.trees[0] }));
    expect(placeVegetation(city).length).toBeLessThanOrEqual(VEGETATION_CAP);
  });

  it("keeps trunks away from buildings and bent imported roads", () => {
    const city = generateCity({ seed: 4242 });
    city.parks = [
      {
        id: "park",
        rect: { x: 0, y: 0, w: 120, h: 120 },
        trees: [
          { x: 20, y: 20 },
          { x: 30, y: 30 },
          { x: 75, y: 35 },
          { x: 70, y: 75 },
        ],
      },
    ];
    city.buildings = [{ ...city.buildings[0], rect: { x: 15, y: 15, w: 10, h: 10 } }];
    const path = [
      { x: 10, y: 10 },
      { x: 60, y: 60 },
      { x: 100, y: 60 },
    ];
    city.roads = [{ id: "bent", horizontal: true, rect: { x: 10, y: 10, w: 90, h: 50 }, width: 8, path }];
    const plants = placeVegetation(city);
    expect(plants.some((p) => p.x === 75 && p.z === 35)).toBe(true);
    expect(plants.some((p) => p.x === 20 || p.x === 30)).toBe(false);
    // Trunks keep the road's margin; brush may reach the gutter but never the carriageway.
    for (const p of plants) expect(distToPolyline(p.x, p.z, path)).toBeGreaterThanOrEqual(p.species === "bush" ? 4.8 : 5.5);
  });

  it("fills an untended city: more trees than the map's parks list, some of them in the streets", () => {
    const city = generateCity({ seed: 4242 });
    const plants = placeVegetation(city);
    const listed = city.parks.reduce((n, p) => n + p.trees.length, 0);
    const trees = plants.filter((p) => p.species !== "bush");
    expect(trees.length).toBeGreaterThan(listed * 1.5);
    const inAPark = (x: number, z: number) =>
      city.parks.some((p) => x > p.rect.x && x < p.rect.x + p.rect.w && z > p.rect.y && z < p.rect.y + p.rect.h);
    const street = trees.filter((p) => !inAPark(p.x, p.z));
    expect(street.length).toBeGreaterThan(10);
    for (const t of street)
      for (const b of city.buildings) expect(Math.hypot(b.entrance.x - t.x, b.entrance.y - t.z)).toBeGreaterThanOrEqual(6);
  });
});
