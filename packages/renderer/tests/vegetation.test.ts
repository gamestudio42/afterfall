import { describe, expect, it } from "vitest";
import { generateCity } from "@afterfall/world";
import { distToPolyline } from "@afterfall/shared";
import { placeVegetation } from "../src/vegetation";

describe("vegetation placement", () => {
  it("is deterministic, varied and stays within its instance budget", () => {
    const city = generateCity({ seed: 4242 });
    const a = placeVegetation(city);
    expect(a).toEqual(placeVegetation(city));
    expect(a.length).toBeGreaterThan(20);
    expect(new Set(a.map((p) => p.species)).size).toBe(4);
    const park = city.parks[0];
    park.trees = Array.from({ length: 800 }, () => ({ ...park.trees[0] }));
    expect(placeVegetation(city).length).toBeLessThanOrEqual(600);
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
    for (const p of plants) expect(distToPolyline(p.x, p.z, path)).toBeGreaterThanOrEqual(5.5);
  });
});
