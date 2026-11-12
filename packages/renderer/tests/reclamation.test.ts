import { describe, expect, it } from "vitest";
import { generateCity } from "@afterfall/world";
import { buildReclamation, distanceField, growthAt, inBuilding, onRoad } from "../src/reclamation";
import { GRASS_CAP, placeGrass } from "../src/grass";

describe("reclamation field", () => {
  it("measures chamfer distance from a mask", () => {
    const mask = new Uint8Array(25);
    mask[12] = 1;
    const d = distanceField(mask, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[14]).toBe(2);
    expect(d[18]).toBeCloseTo(Math.SQRT2, 5);
  });

  it("is deterministic and keeps the middle of a carriageway clearer than its gutter and the walls", () => {
    const city = generateCity({ seed: 4242 });
    const f = buildReclamation(city);
    expect(Array.from(buildReclamation(city).growth)).toEqual(Array.from(f.growth));
    const road = city.roads.find((r) => r.horizontal)!;
    const mid = { x: road.rect.x + road.rect.w * 0.37, z: road.rect.y + road.rect.h / 2 };
    expect(onRoad(f, mid.x, mid.z)).toBe(true);
    let centre = 0,
      gutter = 0,
      wall = 0;
    const samples = 40;
    for (let i = 0; i < samples; i++) {
      const x = road.rect.x + (road.rect.w * (i + 0.5)) / samples;
      centre += growthAt(f, x, road.rect.y + road.rect.h / 2);
      gutter += growthAt(f, x, road.rect.y + 0.4);
    }
    for (const b of city.buildings.slice(0, samples)) wall += growthAt(f, b.rect.x - 0.6, b.rect.y + b.rect.h / 2);
    expect(gutter / samples).toBeGreaterThan(centre / samples + 0.15);
    expect(wall / samples).toBeGreaterThan(centre / samples + 0.25);
  });

  it("grows grass off the carriageway centre, out of buildings, away from doors and within budget", () => {
    const city = generateCity({ seed: 4242 });
    const f = buildReclamation(city);
    const tufts = placeGrass(city, f);
    expect(tufts).toEqual(placeGrass(city, f));
    expect(tufts.length).toBeGreaterThan(1500);
    expect(tufts.length).toBeLessThanOrEqual(GRASS_CAP);
    for (const t of tufts) {
      expect(inBuilding(f, t.x, t.z)).toBe(false);
      expect(t.height).toBeLessThan(1.2);
      for (const b of city.buildings)
        expect(Math.max(Math.abs(b.entrance.x - t.x), Math.abs(b.entrance.y - t.z))).toBeGreaterThanOrEqual(2.8);
    }
    const onCarriageway = tufts.filter((t) => onRoad(f, t.x, t.z)).length;
    expect(onCarriageway / tufts.length).toBeLessThan(0.2);
  });
});
