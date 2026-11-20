import { describe, expect, it } from "vitest";
import { cityFromOverpass, type CityMap } from "@afterfall/world";
import { buildReclamation } from "../src/reclamation";
import { bridgeGeometry, quayGeometry, shoreDistance, SHORE_REACH } from "../src/water";
import { FIXTURE_CENTER, syntheticOverpass, syntheticTerrain } from "../../world/tests/fixtures/osm";

const { lat, lon } = FIXTURE_CENTER;
const kLon = 111_320 * Math.cos((lat * Math.PI) / 180);
const geo = (x: number, y: number) => ({ lat: lat - y / 111_132, lon: lon + x / kLon });
// The fixture's river runs from y 30 to 70 (local metres, map centre at 240, 240).
const city: CityMap = cityFromOverpass(
  {
    elements: [
      ...syntheticOverpass().elements,
      ...syntheticTerrain(),
      {
        type: "way",
        id: 9101,
        tags: { man_made: "bridge" },
        geometry: [geo(-229, 20), geo(-219, 20), geo(-219, 80), geo(-229, 80), geo(-229, 20)],
      },
    ],
  },
  { ...FIXTURE_CENTER, size: 480, label: "Test" },
);
const field = buildReclamation(city);
const shore = shoreDistance(field, city);
const at = (x: number, y: number) => {
  const c = Math.floor((x + 240 - field.x0) / field.cell);
  const r = Math.floor((y + 240 - field.z0) / field.cell);
  return shore[r * field.cols + c];
};

describe("distance to the bank", () => {
  it("is zero on land and grows towards the middle of the river", () => {
    expect(at(-60, 0)).toBe(0);
    const edge = at(-60, 32);
    const middle = at(-60, 50);
    expect(middle).toBeGreaterThan(edge);
    // The river is 40 m wide: its middle is 20 m from either bank.
    expect(middle * SHORE_REACH).toBeGreaterThan(16);
    expect(middle * SHORE_REACH).toBeLessThan(23);
  });

  it("runs on under a bridge instead of making a bank of the deck", () => {
    const without = shoreDistance(
      buildReclamation(
        cityFromOverpass(
          { elements: [...syntheticOverpass().elements, ...syntheticTerrain()] },
          { ...FIXTURE_CENTER, size: 480, label: "Test" },
        ),
      ),
      city,
    );
    const c = Math.floor((-224 + 240 - field.x0) / field.cell);
    const r = Math.floor((50 + 240 - field.z0) / field.cell);
    expect(at(-224, 50)).toBeCloseTo(without[r * field.cols + c], 2);
  });

  it("does not grow a bank where the map cuts the river", () => {
    // At the map's west edge the river runs on out of the map: past the edge, the water
    // is as far from a bank as the last texel inside it.
    const inside = at(-237, 50);
    const c = Math.floor((-250 + 240 - field.x0) / field.cell);
    const r = Math.floor((50 + 240 - field.z0) / field.cell);
    expect(shore[r * field.cols + c]).toBeGreaterThan(0);
    expect(shore[r * field.cols + c]).toBeCloseTo(inside, 1);
  });
});

describe("quays", () => {
  const q = quayGeometry(city, field)!;
  const pos = q.getAttribute("position");

  it("line the banks, but not the edge where the map cuts the river", () => {
    expect(pos.count).toBeGreaterThan(0);
    // No triangle lies along the map's west border, where the river was cut.
    for (let i = 0; i < pos.count; i += 3) {
      const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)];
      expect(Math.max(...xs)).toBeGreaterThan(0.75);
    }
  });

  it("never pave over a street or the bridge", () => {
    for (let i = 0; i < pos.count; i += 6) {
      const x = pos.getX(i) + 0.01,
        z = pos.getZ(i) + 0.01;
      const c = Math.floor((x - field.x0) / field.cell),
        r = Math.floor((z - field.z0) / field.cell);
      // The quad's own corner may touch a kerb; its far side must be on open ground.
      expect(field.wet![r * field.cols + c] === 1 || field.road[r * field.cols + c] === 0).toBe(true);
    }
  });
});

describe("a bridge", () => {
  const b = bridgeGeometry(city, field)!;

  it("has a deck and a parapet", () => {
    expect(b.deck.getAttribute("position").count).toBeGreaterThan(0);
    expect(b.parapet).not.toBeNull();
  });

  it("puts its parapet over the water only, along the two long sides", () => {
    const pos = b.parapet!.getAttribute("position");
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      // Map y of the parapet: inside the river's 30..70, never out over the banks.
      const y = pos.getZ(i) - 240;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // Along the long sides, x = -229 or -219 (give or take the parapet's thickness).
      const x = pos.getX(i) - 240;
      expect(Math.min(Math.abs(x + 229), Math.abs(x + 219))).toBeLessThan(0.6);
    }
    expect(minY).toBeGreaterThan(24);
    expect(maxY).toBeLessThan(76);
  });
});

describe("a map without water", () => {
  it("has no quays and no bridges", () => {
    const dry = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size: 480, label: "Test" });
    const f = buildReclamation(dry);
    expect(quayGeometry(dry, f)).toBeNull();
    expect(bridgeGeometry(dry, f)).toBeNull();
  });
});
