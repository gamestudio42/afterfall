import { describe, expect, it } from "vitest";
import { sidewalk } from "../src/cityMeshes";

const ROAD = 8;
const WALK = 2.5;

describe("sidewalk beside an imported road", () => {
  it("never covers the carriageway", () => {
    // A straight road along +x; the sidewalk must stay clear of |z| < ROAD / 2.
    const path = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    const parts = sidewalk(path, ROAD, WALK, 0.02);
    expect(parts.length).toBe(2);
    for (const g of parts) {
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        // Vertices sit outside the road; a strip that reached into it would z-fight with
        // the asphalt, and at distance the fight reads as white dashes on the road.
        expect(Math.abs(z)).toBeGreaterThanOrEqual(ROAD / 2 - 1e-3);
      }
    }
  });

  it("puts one strip on each side, and they do not overlap each other", () => {
    const parts = sidewalk(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      ROAD,
      WALK,
      0,
    );
    const sides = parts.map((g) => {
      const pos = g.getAttribute("position");
      let sum = 0;
      for (let i = 0; i < pos.count; i++) sum += pos.getZ(i);
      return Math.sign(sum / pos.count);
    });
    expect(sides.sort()).toEqual([-1, 1]);
  });
});
