import { describe, expect, it } from "vitest";
import { generateCity } from "@afterfall/world";
import { buildReclamation, inBuilding, onRoad } from "../src/reclamation";
import { buildingDecay } from "../src/buildingBatch";
import { LITTER_CAP, LITTER_KINDS, LITTER_RADIUS, placeLitter } from "../src/litter";

describe("litter scatter", () => {
  const city = generateCity({ seed: 4242 });
  const field = buildReclamation(city);
  const litter = placeLitter(city, field);
  const all = [...litter.entries()].flatMap(([kind, list]) => list.map((p) => ({ kind, ...p })));

  it("is deterministic, varied and within budget", () => {
    expect(placeLitter(city, field)).toEqual(litter);
    expect(all.length).toBeGreaterThan(80);
    expect(all.length).toBeLessThanOrEqual(LITTER_CAP);
    expect(new Set(all.map((p) => p.kind)).size).toBe(LITTER_KINDS.length);
  });

  it("keeps footprints off carriageways, out of buildings and clear of doors", () => {
    for (const p of all) {
      const reach = LITTER_RADIUS[p.kind] * p.scale;
      expect(onRoad(field, p.x, p.z)).toBe(false);
      for (let a = 0; a < 8; a++) {
        const x = p.x + Math.cos((a * Math.PI) / 4) * reach;
        const z = p.z + Math.sin((a * Math.PI) / 4) * reach;
        expect(inBuilding(field, x, z)).toBe(false);
      }
      for (const b of city.buildings) expect(Math.hypot(b.entrance.x - p.x, b.entrance.y - p.z)).toBeGreaterThan(3);
    }
  });

  it("gathers against walls and keeps clear of street props", () => {
    const nearWall = all.filter((p) =>
      [0.5, 1, 1.5, 2, 2.5, 3, 3.5].some((d) =>
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dz]) =>
          inBuilding(field, p.x + dx * (LITTER_RADIUS[p.kind] * p.scale + d), p.z + dz * (LITTER_RADIUS[p.kind] * p.scale + d)),
        ),
      ),
    );
    expect(nearWall.length / all.length).toBeGreaterThan(0.6);
    const prop = { x: all[0].x, z: all[0].z, rot: 0, scale: 1 };
    const without = [...placeLitter(city, field, [prop]).values()].flat();
    expect(without.some((p) => p.x === prop.x && p.z === prop.z)).toBe(false);
  });

  it("thins evenly when asked for less", () => {
    const thin = [...placeLitter(city, field, [], 0.35).values()].flat();
    expect(thin.length).toBeLessThan(all.length * 0.55);
    expect(thin.length).toBeGreaterThan(all.length * 0.15);
  });
});

describe("building decay", () => {
  it("spans sound to wrecked, with most buildings in between", () => {
    const city = generateCity({ seed: 4242 });
    const decay = city.buildings.map((b) => buildingDecay(b));
    expect(Math.min(...decay)).toBeGreaterThanOrEqual(0.12);
    expect(Math.max(...decay)).toBeLessThanOrEqual(1);
    const wrecks = decay.filter((d) => d > 0.7).length / decay.length;
    expect(wrecks).toBeGreaterThan(0.08);
    expect(wrecks).toBeLessThan(0.35);
    expect(buildingDecay(city.buildings[3])).toBe(decay[3]);
  });
});
